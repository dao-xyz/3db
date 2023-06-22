import { Log } from "../log.js";
import { BlockStore, MemoryLevelBlockStore } from "@peerbit/blocks";
import { waitFor } from "@peerbit/time";
import { signKey } from "./fixtures/privateKey.js";

describe("Append trim", function () {
	let store: BlockStore;

	beforeAll(async () => {
		store = new MemoryLevelBlockStore();
		await store.start();
	});

	afterAll(async () => {
		await store.stop();
	});

	let log: Log<string>;
	beforeEach(async () => {
		log = new Log<string>();
		await log.open(store, {
			...signKey,
			sign: async (data: Uint8Array) => await signKey.sign(data),
		});
	});

	it("cut back to max oplog length", async () => {
		const log = new Log<string>();
		await log.open(
			store,
			{
				...signKey,
				sign: async (data: Uint8Array) => await signKey.sign(data),
			},
			{
				trim: {
					type: "length",
					from: 1,
					to: 1,
					filter: { canTrim: () => true },
				},
			}
		);
		await log.append("hello1");
		await log.trim();
		await log.append("hello2");
		await log.trim();
		await log.append("hello3");
		await log.trim();
		expect(log.length).toEqual(1);
		expect((await log.toArray())[0].payload.getValue()).toEqual("hello3");
	});

	it("respect canTrim for length type", async () => {
		let canTrimInvocations = 0;
		const e1 = await log.append("hello1", { nexts: [] }); // set nexts [] so all get unique gids
		const e2 = await log.append("hello2", { nexts: [] }); // set nexts [] so all get unique gids
		const e3 = await log.append("hello3", { nexts: [] }); // set nexts [] so all get unique gids
		await log.trim({
			type: "length",
			from: 2,
			to: 2,
			filter: {
				canTrim: (gid) => {
					canTrimInvocations += 1;
					return Promise.resolve(gid !== e1.entry.gid);
				},
			},
		});
		expect(log.length).toEqual(2);
		expect((await log.toArray())[0].payload.getValue()).toEqual("hello1");
		expect((await log.toArray())[1].payload.getValue()).toEqual("hello3");
		expect(canTrimInvocations).toEqual(2);
	});

	it("not recheck untrimmable gid", async () => {
		let canTrimInvocations = 0;
		const e1 = await log.append("hello1");
		const e2 = await log.append("hello2");
		const e3 = await log.append("hello3");
		await log.trim({
			type: "length",
			from: 2,
			to: 2,
			filter: {
				canTrim: (gid) => {
					canTrimInvocations += 1;
					return Promise.resolve(false);
				},
			},
		});
		expect(log.length).toEqual(3);
		expect(canTrimInvocations).toEqual(1);
	});

	it("cut back to cut length", async () => {
		const log = new Log<string>();
		await log.open(
			store,
			{
				...signKey,
				sign: async (data: Uint8Array) => await signKey.sign(data),
			},
			{ trim: { type: "length", from: 3, to: 1 } } // when length > 3 cut back to 1
		);
		const { entry: a1 } = await log.append("hello1");
		const { entry: a2 } = await log.append("hello2");
		expect(await log.trim()).toHaveLength(0);
		expect(await log.storage.get(a1.hash)).toBeDefined();
		expect(await log.storage.get(a2.hash)).toBeDefined();
		expect(log.length).toEqual(2);
		const { entry: a3, removed } = await log.append("hello3");
		expect(removed.map((x) => x.hash)).toContainAllValues([a1.hash, a2.hash]);
		expect(log.length).toEqual(1);
		await (log.storage as MemoryLevelBlockStore).idle();
		expect(await log.storage.get(a1.hash)).toBeUndefined();
		expect(await log.storage.get(a2.hash)).toBeUndefined();
		expect(await log.storage.get(a3.hash)).toBeDefined();
		expect((await log.toArray())[0].payload.getValue()).toEqual("hello3");
	});

	it("trimming and concurrency", async () => {
		/**
		 * In this test we test, that even if the commits are concurrent the output is determenistic if we are trimming
		 */
		let canTrimInvocations = 0;
		const log = new Log<string>();
		await log.open(
			store,
			{
				...signKey,
				sign: async (data: Uint8Array) => await signKey.sign(data),
			},
			{
				trim: {
					type: "length",
					from: 1,
					to: 1,
					filter: {
						canTrim: () => {
							canTrimInvocations += 1;
							return true;
						},
					},
				},
			} // when length > 3 cut back to 1
		);
		let size = 3;
		let promises: Promise<any>[] = [];
		for (let i = 0; i < size; i++) {
			promises.push(log.append("hello" + i));
		}
		await Promise.all(promises);
		expect(canTrimInvocations).toBeLessThan(size); // even though concurrently trimming is sync
		expect(log.length).toEqual(1);
		expect((await log.toArray())[0].payload.getValue()).toEqual(
			"hello" + String(size - 1)
		);
	});

	it("cut back to bytelength", async () => {
		const log = new Log<string>();
		await log.open(
			store,
			{
				...signKey,
				sign: async (data: Uint8Array) => await signKey.sign(data),
			},
			{
				trim: { type: "bytelength", to: 15, filter: { canTrim: () => true } },
			} // bytelength is 15 so for every new helloX we hav eto delete the previous helloY
		);
		const { entry: a1, removed: r1 } = await log.append("hello1");
		expect(r1).toHaveLength(0);
		expect(await log.storage.get(a1.hash)).toBeDefined();
		expect((await log.toArray()).map((x) => x.payload.getValue())).toEqual([
			"hello1",
		]);
		const { entry: a2, removed: r2 } = await log.append("hello2");
		expect(r2.map((x) => x.hash)).toContainAllValues([a1.hash]);
		expect(await log.storage.get(a2.hash)).toBeDefined();
		expect((await log.toArray()).map((x) => x.payload.getValue())).toEqual([
			"hello2",
		]);
		const { entry: a3, removed: r3 } = await log.append("hello3");
		expect(r3.map((x) => x.hash)).toContainAllValues([a2.hash]);
		expect(await log.storage.get(a3.hash)).toBeDefined();
		expect((await log.toArray()).map((x) => x.payload.getValue())).toEqual([
			"hello3",
		]);
		const { entry: a4, removed: r4 } = await log.append("hello4");
		expect(r4.map((x) => x.hash)).toContainAllValues([a3.hash]);
		expect((await log.toArray()).map((x) => x.payload.getValue())).toEqual([
			"hello4",
		]);
		await (log.storage as MemoryLevelBlockStore).idle();
		expect(await log.storage.get(a1.hash)).toBeUndefined();
		expect(await log.storage.get(a2.hash)).toBeUndefined();
		expect(await log.storage.get(a3.hash)).toBeUndefined();
		expect(await log.storage.get(a4.hash)).toBeDefined();
	});

	it("trim to time", async () => {
		const maxAge = 3000;
		const log = new Log<string>();
		await log.open(
			store,
			{
				...signKey,
				sign: async (data: Uint8Array) => await signKey.sign(data),
			},
			{
				trim: { type: "time", maxAge },
			} // bytelength is 15 so for every new helloX we hav eto delete the previous helloY
		);

		let t0 = +new Date();
		const { entry: a1, removed: r1 } = await log.append("hello1");
		expect(r1).toHaveLength(0);
		expect(await log.storage.get(a1.hash)).toBeDefined();
		expect((await log.toArray()).map((x) => x.payload.getValue())).toEqual([
			"hello1",
		]);
		const { entry: a2, removed: r2 } = await log.append("hello2");
		expect(r2.map((x) => x.hash)).toContainAllValues([]);

		await waitFor(() => +new Date() - t0 > maxAge);
		const { entry: a3, removed: r3 } = await log.append("hello2");
		expect(r3.map((x) => x.hash)).toContainAllValues([a1.hash, a2.hash]);
	});

	describe("cache", () => {
		it("not recheck gid in cache", async () => {
			let canTrimInvocations = 0;
			const e1 = await log.append("hello1", { nexts: [] }); // nexts: [] means unique gid
			const e2 = await log.append("hello2", { nexts: [] }); // nexts: [] means unique gid
			const e3 = await log.append("hello3", { nexts: [] }); // nexts: [] means unique gid
			const canTrim = (gid) => {
				canTrimInvocations += 1;
				return Promise.resolve(gid !== e1.entry.gid); // can not trim
			};
			const cacheId = () => "";
			await log.trim({
				type: "length",
				from: 2,
				to: 2,
				filter: {
					canTrim,
					cacheId,
				},
			});
			expect(log.length).toEqual(2);
			expect(canTrimInvocations).toEqual(2); // checks e1 then e2 (e2 we can delete)

			await log.trim({
				type: "length",
				from: 1,
				to: 1,
				filter: {
					canTrim,
					cacheId,
				},
			});

			expect(log.length).toEqual(1);
			expect(canTrimInvocations).toEqual(3); // Will start at e3 (and not loop around because tail and head is the same)
		});

		it("ignores invalid trim cache", async () => {
			let canTrimInvocations = 0;
			const e1 = await log.append("hello1", { nexts: [] }); // nexts: [] means unique gid
			const e2 = await log.append("hello2", { nexts: [] }); // nexts: [] means unique gid
			const e3 = await log.append("hello3", { nexts: [] }); // nexts: [] means unique gid
			const e4 = await log.append("hello4", { nexts: [] }); // nexts: [] means unique gid
			const canTrim = (gid) => {
				canTrimInvocations += 1;
				return Promise.resolve(gid !== e1.entry.gid); // can not trim
			};

			const cacheId = () => "";

			await log.trim({
				type: "length",
				from: 3,
				to: 3,
				filter: {
					canTrim,
					cacheId,
				},
			});

			expect(canTrimInvocations).toEqual(2); // checks e1 then e2 (e2 we can delete)
			await log.delete(e3.entry); // e3 is also cached as the next node to trim
			await log.trim({
				type: "length",
				from: 1,
				to: 1,
				filter: {
					canTrim,
					cacheId,
				},
			});

			expect(log.length).toEqual(1);
			expect(canTrimInvocations).toEqual(3); // Will start at e4 because e3 is cache is gone
		});

		it("uses trim cache cross sessions", async () => {
			let canTrimInvocations: string[] = [];
			const e1 = await log.append("hello1", { nexts: [] }); // nexts: [] means unique gid
			const e2 = await log.append("hello2", { nexts: [] }); // nexts: [] means unique gid
			const e3 = await log.append("hello3", { nexts: [] }); // nexts: [] means unique gid
			const canTrim = (gid) => {
				canTrimInvocations.push(gid);
				return Promise.resolve(false); // can not trim
			};

			const cacheId = () => "id";

			await log.trim({
				type: "length",
				from: 0,
				to: 0,
				filter: {
					canTrim,
					cacheId,
				},
			});

			expect(canTrimInvocations).toEqual([
				e1.entry.gid,
				e2.entry.gid,
				e3.entry.gid,
			]); // checks e1, e2, e3
			canTrimInvocations = [];
			await log.trim({
				type: "length",
				from: 0,
				to: 0,
				filter: {
					canTrim,
					cacheId,
				},
			});

			expect(canTrimInvocations).toEqual([]); // no more checks since nothing has changed

			const e4 = await log.append("hello4", { nexts: [] }); // nexts: [] means unique gid
			const result = await log.trim({
				type: "length",
				from: 0,
				to: 0,
				filter: {
					canTrim,
					cacheId,
				},
			});
			expect(canTrimInvocations).toEqual([e3.entry.gid, e4.entry.gid]); // starts at e1 then e2, but ignored because of cache
		});

		it("can first when new entries are added", async () => {
			let canTrimInvocations: string[] = [];
			let trimmableGids = new Set();

			const canTrim = (gid) => {
				canTrimInvocations.push(gid);
				return trimmableGids.has(gid);
			};

			const e1 = await log.append("hello1", { nexts: [] }); // nexts: [] means unique gid

			trimmableGids.add(e1.entry.gid);

			const cacheId = () => "id";
			expect((await log.values.toArray()).map((x) => x.hash)).toEqual([
				e1.entry.hash,
			]);
			await log.trim({
				type: "length",
				from: 0,
				to: 0,
				filter: {
					canTrim,
					cacheId,
				},
			});

			expect(canTrimInvocations).toEqual([e1.entry.gid]); // checks e1
			expect((await log.values.toArray()).map((x) => x.hash)).toEqual([]);

			canTrimInvocations = [];
			const e2 = await log.append("hello2", { nexts: [] }); // nexts: [] means unique gid
			trimmableGids.add(e2.entry.gid);
			expect((await log.values.toArray()).map((x) => x.hash)).toEqual([
				e2.entry.hash,
			]);
			await log.trim({
				type: "length",
				from: 0,
				to: 0,
				filter: {
					canTrim,
					cacheId,
				},
			});
			expect(canTrimInvocations).toEqual([e2.entry.gid]); // e1 checked again (?), e2 checked and trimmed
			expect((await log.values.toArray()).map((x) => x.hash)).toEqual([]);

			canTrimInvocations = [];
			const e3 = await log.append("hello3", { nexts: [] }); // nexts: [] means unique gid
			expect((await log.values.toArray()).map((x) => x.hash)).toEqual([
				e3.entry.hash,
			]);
			trimmableGids.add(e3.entry.gid);
			await log.trim({
				type: "length",
				from: 0,
				to: 0,
				filter: {
					canTrim,
					cacheId,
				},
			});
			expect(canTrimInvocations).toEqual([e3.entry.gid]);
			expect((await log.values.toArray()).map((x) => x.hash)).toEqual([]);
		});

		it("can trim later new entries are added", async () => {
			let canTrimInvocations: string[] = [];
			let trimmableGids = new Set();
			const e1 = await log.append("hello1", { nexts: [] }); // nexts: [] means unique gid
			const canTrim = (gid) => {
				canTrimInvocations.push(gid);
				return trimmableGids.has(gid);
			};

			const cacheId = () => "id";
			await log.trim({
				type: "length",
				from: 0,
				to: 0,
				filter: {
					canTrim,
					cacheId,
				},
			});

			expect(canTrimInvocations).toEqual([e1.entry.gid]); // checks e1

			canTrimInvocations = [];
			const e2 = await log.append("hello2", { nexts: [] }); // nexts: [] means unique gid
			await log.trim({
				type: "length",
				from: 0,
				to: 0,
				filter: {
					canTrim,
					cacheId,
				},
			});
			expect(canTrimInvocations).toEqual([e1.entry.gid, e2.entry.gid]); // e1 checked again (?), e2 checked and trimmed
			expect((await log.values.toArray()).map((x) => x.hash)).toEqual([
				e1.entry.hash,
				e2.entry.hash,
			]);

			canTrimInvocations = [];
			const e3 = await log.append("hello3", { nexts: [] }); // nexts: [] means unique gid
			expect((await log.values.toArray()).map((x) => x.hash)).toEqual([
				e1.entry.hash,
				e2.entry.hash,
				e3.entry.hash,
			]);
			trimmableGids.add(e3.entry.gid);
			await log.trim({
				type: "length",
				from: 0,
				to: 0,
				filter: {
					canTrim,
					cacheId,
				},
			});
			expect(canTrimInvocations).toEqual([e2.entry.gid, e3.entry.gid]);
			expect((await log.values.toArray()).map((x) => x.hash)).toEqual([
				e1.entry.hash,
				e2.entry.hash,
			]);

			canTrimInvocations = [];
			const e4 = await log.append("hello3", { nexts: [] }); // nexts: [] means unique gid
			expect((await log.values.toArray()).map((x) => x.hash)).toEqual([
				e1.entry.hash,
				e2.entry.hash,
				e4.entry.hash,
			]);
			trimmableGids.add(e4.entry.gid);
			await log.trim({
				type: "length",
				from: 0,
				to: 0,
				filter: {
					canTrim,
					cacheId,
				},
			});
			expect(canTrimInvocations).toEqual([e2.entry.gid, e4.entry.gid]);
			expect((await log.values.toArray()).map((x) => x.hash)).toEqual([
				e1.entry.hash,
				e2.entry.hash,
			]);
		});

		it("drops cache if canTrim function changes", async () => {
			let canTrimInvocations = 0;
			const e1 = await log.append("hello1", { nexts: [] }); // nexts: [] means unique gid
			const e2 = await log.append("hello2", { nexts: [] }); // nexts: [] means unique gid
			const e3 = await log.append("hello3", { nexts: [] }); // nexts: [] means unique gid
			await log.trim({
				type: "length",
				from: 0,
				to: 0,
				filter: {
					canTrim: (gid) => {
						canTrimInvocations += 1;
						return Promise.resolve(false); // can not trim
					},
				},
			});
			expect(canTrimInvocations).toEqual(3); // checks e1 then e2 (e2 we can delete)
			await log.trim({
				type: "length",
				from: 0,
				to: 0,
				filter: {
					canTrim: (gid) => {
						canTrimInvocations += 1;
						return Promise.resolve(false); // can not trim
					},
				},
			});

			expect(canTrimInvocations).toEqual(6);
		});

		it("changing cacheId will reset cache", async () => {
			let canTrimInvocations = 0;
			const e1 = await log.append("hello1", { nexts: [] }); // nexts: [] means unique gid
			const e2 = await log.append("hello2", { nexts: [] }); // nexts: [] means unique gid
			const e3 = await log.append("hello3", { nexts: [] }); // nexts: [] means unique gid

			let trimGid: string | undefined = undefined;
			const canTrim = (gid) => {
				canTrimInvocations += 1;
				return Promise.resolve(gid === trimGid); // can not trim
			};
			await log.trim({
				type: "length",
				from: 0,
				to: 0,
				filter: {
					canTrim,
					cacheId: () => "a",
				},
			});

			trimGid = e1.entry.gid;
			expect(canTrimInvocations).toEqual(3);
			expect(log.length).toEqual(3);

			await log.trim({
				type: "length",
				from: 0,
				to: 0,
				filter: {
					canTrim,
					cacheId: () => "a",
				},
			});

			expect(canTrimInvocations).toEqual(3);
			expect(log.length).toEqual(3);
			await log.trim({
				type: "length",
				from: 0,
				to: 0,
				filter: {
					canTrim,
					cacheId: () => "b",
				},
			});
			expect(log.length).toEqual(2);
			expect(canTrimInvocations).toEqual(6); // cache resets, so will go through all entries
		});
	});
});
