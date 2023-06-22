import { EventStore } from "./utils/stores/event-store";
import { LSession } from "@peerbit/test-utils";
import { delay, waitFor, waitForResolved } from "@peerbit/time";
import { PermissionedEventStore } from "./utils/stores/test-store";
import { DirectSub } from "@peerbit/pubsub";
import { DirectBlock } from "@peerbit/blocks";
import { getPublicKeyFromPeerId } from "@peerbit/crypto";
import { Observer } from "../role";

describe(`leaders`, function () {
	let session: LSession;
	let db1: EventStore<string>, db2: EventStore<string>, db3: EventStore<string>;

	beforeAll(async () => {
		session = await LSession.connected(3, {
			libp2p: {
				services: {
					blocks: (c) => new DirectBlock(c),
					pubsub: (c) =>
						new DirectSub(c, {
							canRelayMessage: true,
							connectionManager: { autoDial: false },
						}),
				},
			},
		});
	});

	afterAll(async () => {
		await session.stop();
	});

	beforeEach(async () => {});

	afterEach(async () => {
		if (db1) await db1.drop();
		if (db2) await db2.drop();
		if (db3) await db3.drop();
	});

	it("will use trusted network for filtering", async () => {
		const program =
			// dont trust client 3
			await new PermissionedEventStore({
				trusted: [session.peers[0].peerId, session.peers[1].peerId],
			}).open(session.peers[0]);

		// Subscription evnet is sent before I open, so I don't save the subscription?
		// but this should requrest subscribers?
		const program2 = await PermissionedEventStore.open(
			program.address!,
			session.peers[1]
		);

		await waitFor(() => program.store.log.getReplicatorsSorted()?.length === 2);
		await waitFor(
			() => program2.store.log.getReplicatorsSorted()?.length === 2
		);

		// now find 3 leaders from the network with 2 trusted participants (should return 2 leaders if trust control works correctly)
		const leadersFrom1 = await program.store.log.findLeaders("", 3);
		const leadersFrom2 = await program2.store.log.findLeaders("", 3);
		expect(leadersFrom1).toEqual(leadersFrom2);
		expect(leadersFrom1).toHaveLength(2);
		expect(leadersFrom1).toContainAllValues([
			getPublicKeyFromPeerId(session.peers[0].peerId).hashcode(),
			getPublicKeyFromPeerId(session.peers[1].peerId).hashcode(),
		]);
	});

	it("select leaders for one or two peers", async () => {
		// TODO fix test timeout, isLeader is too slow as we need to wait for peers
		// perhaps do an event based get peers using the pubsub peers api

		db1 = await new EventStore<string>().open(session.peers[0]);
		const isLeaderAOneLeader = await db1.log.isLeader(123, 1);
		expect(isLeaderAOneLeader);
		const isLeaderATwoLeader = await db1.log.isLeader(123, 2);
		expect(isLeaderATwoLeader);

		db2 = (await EventStore.open(
			db1.address!,
			session.peers[1]
		)) as EventStore<string>;

		await waitForResolved(() =>
			expect(db1.log.getReplicatorsSorted()).toHaveLength(2)
		);
		await waitForResolved(() =>
			expect(db2.log.getReplicatorsSorted()).toHaveLength(2)
		);

		// leader rotation is kind of random, so we do a sequence of tests
		for (let slot = 0; slot < 3; slot++) {
			// One leader
			const isLeaderAOneLeader = await db1.log.isLeader(slot, 1);
			const isLeaderBOneLeader = await db2.log.isLeader(slot, 1);
			expect([isLeaderAOneLeader, isLeaderBOneLeader]).toContainAllValues([
				false,
				true,
			]);

			// Two leaders
			const isLeaderATwoLeaders = await db1.log.isLeader(slot, 2);
			const isLeaderBTwoLeaders = await db2.log.isLeader(slot, 2);

			expect([isLeaderATwoLeaders, isLeaderBTwoLeaders]).toContainAllValues([
				true,
				true,
			]);
		}
	});

	it("leader are selected from 1 replicating peer", async () => {
		// TODO fix test timeout, isLeader is too slow as we need to wait for peers
		// perhaps do an event based get peers using the pubsub peers api

		const store = await new EventStore<string>();
		await store.setup({ role: new Observer() });
		db1 = await store.open(session.peers[0]);
		db2 = (await EventStore.open(
			db1.address!,
			session.peers[1]
		)) as EventStore<string>;

		await delay(5000); // some delay so that if peers are to replicate, they would have had time to notify each other

		// One leader
		const slot = 0;

		// Two leaders, but only one will be leader since only one is replicating
		const isLeaderA = await db1.log.isLeader(slot, 2);
		const isLeaderB = await db2.log.isLeader(slot, 2);

		expect(!isLeaderA); // because replicate is false
		expect(isLeaderB);
	});

	it("leader are selected from 2 replicating peers", async () => {
		// TODO fix test timeout, isLeader is too slow as we need to wait for peers
		// perhaps do an event based get peers using the pubsub peers api

		const store = await new EventStore<string>();
		await store.setup({ role: new Observer() });
		db1 = await store.open(session.peers[0]);

		db2 = (await EventStore.open(
			db1.address!,
			session.peers[1]
		)) as EventStore<string>;
		db3 = (await EventStore.open(
			db1.address!,
			session.peers[2]
		)) as EventStore<string>;

		await waitFor(() => db2.log.getReplicatorsSorted()?.length === 2);
		await waitFor(() => db3.log.getReplicatorsSorted()?.length === 2);

		// One leader
		const slot = 0;

		// Two leaders, but only one will be leader since only one is replicating
		const isLeaderA = await db1.log.isLeader(slot, 3);
		const isLeaderB = await db2.log.isLeader(slot, 3);
		const isLeaderC = await db3.log.isLeader(slot, 3);

		expect(!isLeaderA); // because replicate is false
		expect(isLeaderB);
		expect(isLeaderC);
	});

	it("select leaders for three peers", async () => {
		// TODO fix test timeout, isLeader is too slow as we need to wait for peers
		// perhaps do an event based get peers using the pubsub peers api

		db1 = await new EventStore<string>().open(session.peers[0]);
		db2 = (await EventStore.open(
			db1.address!,
			session.peers[1]
		)) as EventStore<string>;
		db3 = (await EventStore.open(
			db1.address!,
			session.peers[2]
		)) as EventStore<string>;

		await waitForResolved(() =>
			expect(db1.log.getReplicatorsSorted()).toHaveLength(3)
		);
		await waitForResolved(() =>
			expect(db2.log.getReplicatorsSorted()).toHaveLength(3)
		);
		await waitForResolved(() =>
			expect(db3.log.getReplicatorsSorted()).toHaveLength(3)
		);

		// One leader
		const slot = 0;

		const isLeaderAOneLeader = await db1.log.isLeader(slot, 1);
		const isLeaderBOneLeader = await db2.log.isLeader(slot, 1);
		const isLeaderCOneLeader = await db3.log.isLeader(slot, 1);
		expect([
			isLeaderAOneLeader,
			isLeaderBOneLeader,
			isLeaderCOneLeader,
		]).toContainValues([false, false, true]);

		// Two leaders
		const isLeaderATwoLeaders = await db1.log.isLeader(slot, 2);
		const isLeaderBTwoLeaders = await db2.log.isLeader(slot, 2);
		const isLeaderCTwoLeaders = await db3.log.isLeader(slot, 2);
		expect([
			isLeaderATwoLeaders,
			isLeaderBTwoLeaders,
			isLeaderCTwoLeaders,
		]).toContainValues([false, true, true]);

		// Three leders
		const isLeaderAThreeLeaders = await db1.log.isLeader(slot, 3);
		const isLeaderBThreeLeaders = await db2.log.isLeader(slot, 3);
		const isLeaderCThreeLeaders = await db3.log.isLeader(slot, 3);
		expect([
			isLeaderAThreeLeaders,
			isLeaderBThreeLeaders,
			isLeaderCThreeLeaders,
		]).toContainValues([true, true, true]);
	});
	it("evenly distributed", async () => {
		db1 = await new EventStore<string>().open(session.peers[0]);
		db2 = (await EventStore.open(
			db1.address!,
			session.peers[1]
		)) as EventStore<string>;
		db3 = (await EventStore.open(
			db1.address!,
			session.peers[2]
		)) as EventStore<string>;

		await waitForResolved(() =>
			expect(db1.log.getReplicatorsSorted()).toHaveLength(3)
		);
		await waitForResolved(() =>
			expect(db2.log.getReplicatorsSorted()).toHaveLength(3)
		);
		await waitForResolved(() =>
			expect(db3.log.getReplicatorsSorted()).toHaveLength(3)
		);

		let a = 0,
			b = 0,
			c = 0;
		const count = 10000;
		for (let i = 0; i < count; i++) {
			a += (await db1.log.isLeader(String(i), 2)) ? 1 : 0;
			b += (await db2.log.isLeader(String(i), 2)) ? 1 : 0;
			c += (await db3.log.isLeader(String(i), 2)) ? 1 : 0;
		}

		const from = count * 0.6;
		const to = count * 0.8;
		expect(a > from).toBeTrue();
		expect(a < to).toBeTrue();
		expect(b > from).toBeTrue();
		expect(b < to).toBeTrue();
		expect(c > from).toBeTrue();
		expect(c < to).toBeTrue();
	});

	it("leader always defined", async () => {
		db1 = await new EventStore<string>().open(session.peers[0]);
		db2 = (await EventStore.open(
			db1.address!,
			session.peers[1]
		)) as EventStore<string>;
		db3 = (await EventStore.open(
			db1.address!,
			session.peers[2]
		)) as EventStore<string>;

		await waitForResolved(() =>
			expect(db1.log.getReplicatorsSorted()).toHaveLength(3)
		);
		await waitForResolved(() =>
			expect(db2.log.getReplicatorsSorted()).toHaveLength(3)
		);
		await waitForResolved(() =>
			expect(db3.log.getReplicatorsSorted()).toHaveLength(3)
		);

		for (let i = 0; i < 100; i++) {
			const leaders: Set<string | undefined> = new Set(
				await db1.log.findLeaders(String(i), 3)
			);
			expect(leaders.has(undefined)).toBeFalse();
			expect(leaders.size).toEqual(3);
		}
	});

	describe("get replicators sorted", () => {
		const checkSorted = (strings: string[]) => {
			const sorted = [...strings].sort((a, b) => a.localeCompare(b));
			expect(sorted).toEqual(strings);
		};
		it("can handle peers leaving and joining", async () => {
			db1 = await new EventStore<string>().open(session.peers[0]);
			db2 = (await EventStore.open(
				db1.address!,
				session.peers[1]
			)) as EventStore<string>;

			await waitForResolved(() =>
				expect(db1.log.getReplicatorsSorted()).toHaveLength(2)
			);

			await waitForResolved(() =>
				expect(db2.log.getReplicatorsSorted()).toHaveLength(2)
			);

			db3 = (await EventStore.open(
				db1.address!,
				session.peers[2]
			)) as EventStore<string>;

			await waitForResolved(() =>
				expect(db3.log.getReplicatorsSorted()).toHaveLength(3)
			);

			await db2.close();

			await waitForResolved(() =>
				expect(db1.log.getReplicatorsSorted()).toHaveLength(2)
			);

			expect(db1.log.getReplicatorsSorted()).toContainAllValues([
				getPublicKeyFromPeerId(session.peers[0].peerId).hashcode(),
				getPublicKeyFromPeerId(session.peers[2].peerId).hashcode(),
			]);

			expect(db2.log.getReplicatorsSorted()).toBeUndefined();

			expect(db3.log.getReplicatorsSorted()).toContainAllValues([
				getPublicKeyFromPeerId(session.peers[0].peerId).hashcode(),
				getPublicKeyFromPeerId(session.peers[2].peerId).hashcode(),
			]);

			await waitForResolved(() =>
				expect(db1.log.getReplicatorsSorted()).toHaveLength(2)
			);
			await waitForResolved(() =>
				expect(db3.log.getReplicatorsSorted()).toHaveLength(2)
			);
			///	await waitFor(() => db3.log.getReplicatorsSorted()?.length === 2);

			db2 = (await EventStore.open(
				db1.address!,
				session.peers[1]
			)) as EventStore<string>;

			await waitForResolved(() =>
				expect(db1.log.getReplicatorsSorted()).toHaveLength(3)
			);
			await waitForResolved(() =>
				expect(db2.log.getReplicatorsSorted()).toHaveLength(3)
			);
			await waitForResolved(() =>
				expect(db3.log.getReplicatorsSorted()).toHaveLength(3)
			);

			expect(db1.log.getReplicatorsSorted()).toContainAllValues([
				getPublicKeyFromPeerId(session.peers[0].peerId).hashcode(),
				getPublicKeyFromPeerId(session.peers[1].peerId).hashcode(),
				getPublicKeyFromPeerId(session.peers[2].peerId).hashcode(),
			]);
			expect(db2.log.getReplicatorsSorted()).toContainAllValues([
				getPublicKeyFromPeerId(session.peers[0].peerId).hashcode(),
				getPublicKeyFromPeerId(session.peers[1].peerId).hashcode(),
				getPublicKeyFromPeerId(session.peers[2].peerId).hashcode(),
			]);
			expect(db3.log.getReplicatorsSorted()).toContainAllValues([
				getPublicKeyFromPeerId(session.peers[0].peerId).hashcode(),
				getPublicKeyFromPeerId(session.peers[1].peerId).hashcode(),
				getPublicKeyFromPeerId(session.peers[2].peerId).hashcode(),
			]);

			checkSorted(db1.log.getReplicatorsSorted()!);
			checkSorted(db2.log.getReplicatorsSorted()!);
			checkSorted(db3.log.getReplicatorsSorted()!);
		});
	});
});
