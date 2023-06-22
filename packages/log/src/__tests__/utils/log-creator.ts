import { Ed25519Keypair, randomBytes } from "@peerbit/crypto";
import { Blocks } from "@peerbit/blocks-interface";
import { Log } from "../../log.js";
import { Timestamp } from "../../clock.js";

export class LogCreator {
	static async createLogWithSixteenEntries(
		store: Blocks,
		signKeys: Ed25519Keypair[]
	) {
		const expectedData = [
			"entryA1",
			"entryB1",
			"entryA2",
			"entryB2",
			"entryA3",
			"entryB3",
			"entryA4",
			"entryB4",
			"entryA5",
			"entryB5",
			"entryA6",
			"entryC0",
			"entryA7",
			"entryA8",
			"entryA9",
			"entryA10",
		];

		const create = async (): Promise<Log<string>> => {
			const id = randomBytes(32);
			const logA = new Log<string>({ id });
			await logA.open(store, {
				...signKeys[0],
				sign: (data) => signKeys[0].sign(data),
			});
			const logB = new Log<string>({ id });
			await logB.open(store, {
				...signKeys[1],
				sign: (data) => signKeys[1].sign(data),
			});
			const log3 = new Log<string>({ id });
			await log3.open(store, {
				...signKeys[2],
				sign: (data) => signKeys[2].sign(data),
			});
			const log4 = new Log<string>({ id });
			await log4.open(store, {
				...signKeys[3],
				sign: (data) => signKeys[3].sign(data),
			});
			for (let i = 1; i <= 5; i++) {
				await logA.append("entryA" + i);
				await logB.append("entryB" + i);
			}

			await log3.join(logA);
			await log3.join(logB);
			for (let i = 6; i <= 10; i++) {
				await logA.append("entryA" + i);
			}

			await log4.join(log3);
			await log4.append("entryC0", {
				timestamp: new Timestamp({
					wallTime: (await logA.toArray())[5].metadata.clock.timestamp.wallTime,
					logical:
						(await logA.toArray())[5].metadata.clock.timestamp.logical + 1,
				}),
			});
			await log4.join(logA);
			expect(
				(await log4.toArray()).map((h) => h.payload.getValue())
			).toStrictEqual(expectedData);
			return log4;
		};

		return { log: await create(), expectedData: expectedData };
	}

	static async createLogWithTwoHundredEntries(
		store: Blocks,
		signKeys: Ed25519Keypair[]
	) {
		const amount = 100;

		const expectedData: string[] = [];
		const id = randomBytes(32);

		const create = async (): Promise<Log<string>> => {
			const logA = new Log<string>({ id });
			await logA.open(store, {
				...signKeys[0],
				sign: (data) => signKeys[0].sign(data),
			});
			const logB = new Log<string>({ id });
			await logB.open(store, {
				...signKeys[1],
				sign: (data) => signKeys[1].sign(data),
			});
			for (let i = 1; i <= amount; i++) {
				await logA.append("entryA" + i);
				await logB.join(logA);
				await logB.append("entryB" + i);
				await logA.join(logB);
				expectedData.push("entryA" + i);
				expectedData.push("entryB" + i);
			}
			return logA;
		};

		const log = await create();
		return { log: log, expectedData: expectedData };
	}
}
