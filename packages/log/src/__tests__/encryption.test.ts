import { Log } from "../log.js";
import { Ed25519Keypair, X25519Keypair } from "@peerbit/crypto";
import { BlockStore, AnyBlockStore } from "@peerbit/blocks";
import { signKey, signKey2 } from "./fixtures/privateKey.js";
import { AnyStore, createStore } from "@peerbit/any-store";
import { JSON_ENCODING } from "./utils/encoding.js";
import { DefaultKeychain } from "@peerbit/keychain";

const last = <T>(arr: T[]): T => {
	return arr[arr.length - 1];
};

const createKeychain = async (...keys: (Ed25519Keypair | X25519Keypair)[]) => {
	const keychain = new DefaultKeychain();
	for (const key of keys) {
		await keychain.import({ keypair: key });
	}
	return keychain;
};

describe("encryption", function () {
	let store: BlockStore;

	afterEach(async () => {
		await store.stop();
	});

	describe("join", () => {
		let log1: Log<string>, log2: Log<string>;
		let receiverKey: X25519Keypair;

		beforeEach(async () => {
			store = new AnyBlockStore();
			await store.start();

			const senderKey = await X25519Keypair.create();
			receiverKey = await X25519Keypair.create();
			const logOptions = {
				encoding: JSON_ENCODING,
				keychain: await createKeychain(signKey, senderKey, receiverKey)
			};

			log1 = new Log();
			await log1.open(store, signKey, logOptions);
			log2 = new Log();
			await log2.open(store, signKey2, logOptions);
		});

		it("can encrypt signatures with particular receiver", async () => {
			// dummy signer
			const extraSigner = await Ed25519Keypair.create();
			const extraSigner2 = await Ed25519Keypair.create();

			await log2.append("helloA1", {
				encryption: {
					keypair: await X25519Keypair.create(),
					receiver: {
						meta: undefined,
						signatures: {
							[await log2.identity.publicKey.hashcode()]: receiverKey.publicKey, // receiver 1
							[await extraSigner.publicKey.hashcode()]: [
								receiverKey.publicKey,
								(await X25519Keypair.create()).publicKey
							], // receiver 1 again and 1 unknown receiver
							[await extraSigner2.publicKey.hashcode()]: (
								await X25519Keypair.create()
							).publicKey // unknown receiver
						},
						payload: receiverKey.publicKey
					}
				},
				signers: [
					log2.identity.sign.bind(log2.identity),
					extraSigner.sign.bind(extraSigner),
					extraSigner2.sign.bind(extraSigner2)
				]
			});

			// Remove decrypted caches of the log2 values
			(await log2.toArray()).forEach((value) => {
				value._meta.clear();
				value._payload.clear();
				value._signatures!.signatures.forEach((signature) => signature.clear());
			});

			await log1.join(log2);
			expect(log1.length).toEqual(1);
			const item = last(await log1.toArray());
			expect((await item.getNext()).length).toEqual(0);
			expect(
				(await item.getSignatures()).map((x) => x.publicKey.hashcode())
			).toContainAllValues([
				extraSigner.publicKey.hashcode(),
				log2.identity.publicKey.hashcode()
			]);
		});

		it("joins encrypted identities only with knowledge of id and clock", async () => {
			await log1.append("helloA1", {
				encryption: {
					keypair: await X25519Keypair.create(),
					receiver: {
						meta: undefined,
						signatures: receiverKey.publicKey,
						payload: receiverKey.publicKey
					}
				}
			});
			await log1.append("helloA2", {
				encryption: {
					keypair: await X25519Keypair.create(),
					receiver: {
						meta: undefined,
						signatures: receiverKey.publicKey,
						payload: receiverKey.publicKey
					}
				}
			});
			await log2.append("helloB1", {
				encryption: {
					keypair: await X25519Keypair.create(),

					receiver: {
						meta: undefined,
						signatures: receiverKey.publicKey,
						payload: receiverKey.publicKey
					}
				}
			});
			await log2.append("helloB2", {
				encryption: {
					keypair: await X25519Keypair.create(),

					receiver: {
						meta: undefined,
						signatures: receiverKey.publicKey,
						payload: receiverKey.publicKey
					}
				}
			});

			// Remove decrypted caches of the log2 values
			(await log2.toArray()).forEach((value) => {
				value._meta.clear();
				value._payload.clear();
				value._signatures!.signatures.forEach((signature) => signature.clear());
			});

			await log1.join(log2);
			expect(log1.length).toEqual(4);
			const item = last(await log1.toArray());
			expect((await item.getNext()).length).toEqual(1);
		});
	});

	describe("load", () => {
		let cache: AnyStore, level: AnyStore, log: Log<any>;
		afterEach(async () => {
			await log?.close();
			await cache?.close();
			await level?.close();
		});

		it("loads encrypted entries", async () => {
			level = createStore(
				"./tmp/log/encryption/load/loads-encrypted-entries/" + +new Date()
			);
			store = new AnyBlockStore(await level.sublevel("blocks"));
			await store.start();

			const encryptioKey = await X25519Keypair.create();
			const signingKey = await Ed25519Keypair.create();

			log = new Log();
			cache = await level.sublevel("cache");

			const logOptions = {
				keychain: await createKeychain(signingKey, encryptioKey),
				cache,
				encoding: JSON_ENCODING
			};
			await log.open(store, signKey, logOptions);

			await log.append("helloA1", {
				encryption: {
					keypair: encryptioKey,
					receiver: {
						meta: encryptioKey.publicKey,
						signatures: encryptioKey.publicKey,
						payload: encryptioKey.publicKey
					}
				}
			});
			expect(log.length).toEqual(1);
			await log.close();
			log = new Log();
			await log.open(store, signKey, logOptions);
			expect(log.headsIndex.headsCache).toBeDefined();
			expect(log.length).toEqual(0);
			await log.load();
			expect(log.length).toEqual(1);
		});
	});
});
