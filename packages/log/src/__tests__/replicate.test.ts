import rmrf from "rimraf";
import fs from "fs-extra";
import { Keystore, KeyWithMeta } from "@dao-xyz/peerbit-keystore";
import { LSession } from "@dao-xyz/peerbit-test-utils";
import { Ed25519Keypair } from "@dao-xyz/peerbit-crypto";
import { PubSubData, waitForSubscribers } from "@dao-xyz/libp2p-direct-sub";
import { randomBytes } from "@dao-xyz/peerbit-crypto";
import { Log } from "../log.js";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { Entry } from "../entry.js";
import path from "path";
import { signingKeysFixturesPath, testKeyStorePath } from "./utils.js";
import { createStore } from "./utils.js";
import { deserialize, serialize } from "@dao-xyz/borsh";
import { StringArray } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __filenameBase = path.parse(__filename).base;
const __dirname = dirname(__filename);

describe("ipfs-log - Replication", function () {
	let session: LSession,
		signKey: KeyWithMeta<Ed25519Keypair>,
		signKey2: KeyWithMeta<Ed25519Keypair>;

	let keystore: Keystore;

	beforeAll(async () => {
		rmrf.sync(testKeyStorePath(__filenameBase));

		await fs.copy(
			signingKeysFixturesPath(__dirname),
			testKeyStorePath(__filenameBase)
		);

		// Start two connected IPFS instances
		session = await LSession.connected(2);

		keystore = new Keystore(
			await createStore(testKeyStorePath(__filenameBase))
		);

		// Create an identity for each peers
		// @ts-ignore
		signKey = await keystore.getKey(new Uint8Array([0]));
		// @ts-ignore
		signKey2 = await keystore.getKey(new Uint8Array([1]));

		// sort keys so that the output becomes deterministic
		if (
			signKey.keypair.publicKey.publicKey > signKey2.keypair.publicKey.publicKey
		) {
			signKey = [signKey2, (signKey2 = signKey)][0];
		}
	});

	afterAll(async () => {
		rmrf.sync(testKeyStorePath(__filenameBase));
		await session.stop();
		await keystore?.close();
	});

	describe("replicates logs deterministically", function () {
		const amount = 10 + 1;
		const channel = "XXX";
		const logId = randomBytes(32);

		let log1: Log<string>,
			log2: Log<string>,
			input1: Log<string>,
			input2: Log<string>;
		const buffer1: Uint8Array[] = [];
		const buffer2: Uint8Array[] = [];
		let processing = 0;

		const handleMessage = async (message: PubSubData, topic: string) => {
			if (!message.topics.includes(topic)) {
				return;
			}
			buffer1.push(message.data);
			processing++;
			process.stdout.write("\r");
			process.stdout.write(
				`> Buffer1: ${buffer1.length} - Buffer2: ${buffer2.length}`
			);
			await log1.join(deserialize(message.data, StringArray).arr);
			processing--;
		};

		const handleMessage2 = async (message: PubSubData, topic: string) => {
			if (!message.topics.includes(topic)) {
				return;
			}
			buffer2.push(message.data);
			processing++;
			process.stdout.write("\r");
			process.stdout.write(
				`> Buffer1: ${buffer1.length} - Buffer2: ${buffer2.length}`
			);
			await log2.join(deserialize(message.data, StringArray).arr);
			processing--;
		};

		beforeEach(async () => {
			log1 = new Log({ id: logId });
			await log1.open(session.peers[0].services.blocks, {
				...signKey.keypair,
				sign: async (data: Uint8Array) => await signKey.keypair.sign(data),
			});
			log2 = new Log({ id: logId });
			await log2.open(session.peers[1].services.blocks, {
				...signKey2.keypair,
				sign: async (data: Uint8Array) => await signKey2.keypair.sign(data),
			});

			input1 = new Log({ id: logId });
			await input1.open(session.peers[0].services.blocks, {
				...signKey.keypair,
				sign: async (data: Uint8Array) => await signKey.keypair.sign(data),
			});
			input2 = new Log({ id: logId });
			await input2.open(session.peers[1].services.blocks, {
				...signKey2.keypair,
				sign: async (data: Uint8Array) => await signKey2.keypair.sign(data),
			});
			session.peers[0].services.pubsub.subscribe(channel);
			session.peers[1].services.pubsub.subscribe(channel);

			await session.peers[0].services.pubsub.addEventListener("data", (evt) => {
				handleMessage(evt.detail, channel);
			});
			await session.peers[1].services.pubsub.addEventListener("data", (evt) => {
				handleMessage2(evt.detail, channel);
			});
		});

		afterEach(async () => {
			await session.peers[0].services.pubsub.unsubscribe(channel);
			await session.peers[1].services.pubsub.unsubscribe(channel);
		});
		// TODO why is this test doing a lot of unchaught rejections? (Reproduce in VSCODE tick `Uncaught exceptions`)
		it("replicates logs", async () => {
			await waitForSubscribers(
				session.peers[0],
				[session.peers[1].peerId],
				channel
			);

			let prev1: Entry<any> = undefined as any;
			let prev2: Entry<any> = undefined as any;
			for (let i = 1; i <= amount; i++) {
				prev1 = (
					await input1.append("A" + i, {
						nexts: prev1 ? [prev1] : undefined,
					})
				).entry;
				prev2 = (
					await input2.append("B" + i, {
						nexts: prev2 ? [prev2] : undefined,
					})
				).entry;
				const hashes1 = await input1.getHeads();
				const hashes2 = await input2.getHeads();
				await session.peers[0].services.pubsub.publish(
					Buffer.from(
						serialize(new StringArray({ arr: hashes1.map((x) => x.hash) }))
					),
					{
						topics: [channel],
					}
				);
				await session.peers[1].services.pubsub.publish(
					Buffer.from(
						serialize(new StringArray({ arr: hashes2.map((x) => x.hash) }))
					),
					{
						topics: [channel],
					}
				);
			}

			const whileProcessingMessages = (timeoutMs: number) => {
				return new Promise<void>((resolve, reject) => {
					const timeout = setTimeout(
						() => reject(new Error("timeout")),
						timeoutMs
					);
					const timer = setInterval(() => {
						if (
							buffer1.length + buffer2.length === amount * 2 &&
							processing === 0
						) {
							clearInterval(timer);
							clearTimeout(timeout);
							resolve();
						}
					}, 200);
				});
			};

			await whileProcessingMessages(5000);

			const result = new Log<string>({ id: logId });
			result.open(session.peers[0].services.blocks, {
				...signKey.keypair,
				sign: async (data: Uint8Array) => await signKey.keypair.sign(data),
			});

			await result.join(log1);
			await result.join(log2);

			expect(buffer1.length).toEqual(amount);
			expect(buffer2.length).toEqual(amount);
			expect(result.length).toEqual(amount * 2);
			expect(log1.length).toEqual(amount);
			expect(log2.length).toEqual(amount);
			expect(
				await Promise.all(
					[0, 1, 2, 3, 9, 10].map(async (i) =>
						(await result.toArray())[i].payload.getValue()
					)
				)
			).toEqual(["A1", "B1", "A2", "B2", "B5", "A6"]);
		});
	});
});
