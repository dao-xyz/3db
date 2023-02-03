import { Peerbit } from "../peer";
import { EventStore } from "./utils/stores/event-store";
import { v4 as uuid } from "uuid";
import { LSession } from "@dao-xyz/peerbit-test-utils";
import { delay, waitFor } from "@dao-xyz/peerbit-time";
import { PermissionedEventStore } from "./utils/stores/test-store";
import { ObserverType } from "@dao-xyz/peerbit-program";

describe(`leaders`, function () {
	let session: LSession;
	let client1: Peerbit,
		client2: Peerbit,
		client3: Peerbit,
		db1: EventStore<string>,
		db2: EventStore<string>,
		db3: EventStore<string>;

	beforeAll(async () => {
		session = await LSession.connected(3);
	});

	afterAll(async () => {
		await session.stop();
	});

	beforeEach(async () => {
		client1 = await Peerbit.create({ libp2p: session.peers[0] });
		client2 = await Peerbit.create({ libp2p: session.peers[1] });
		client3 = await Peerbit.create({ libp2p: session.peers[2] });
	});

	afterEach(async () => {
		if (db1) await db1.drop();
		if (db2) await db2.drop();
		if (db3) await db3.drop();
		if (client1) await client1.stop();
		if (client2) await client2.stop();
		if (client3) await client3.stop();
	});

	it("will use trusted network for filtering", async () => {
		const program = await client1.open(
			// dont trust client 3
			new PermissionedEventStore({
				trusted: [
					client1.id,
					client1.identity.publicKey,
					client2.id,
					client2.identity.publicKey,
				],
			})
		);

		// Subscription evnet is sent before I open, so I don't save the subscription?
		// but this should requrest subscribers?
		const _program2 = await client2.open<PermissionedEventStore>(
			program.address!
		);

		await waitFor(
			() => client1.getReplicators(program.address!.toString())?.length === 1
		);
		await waitFor(
			() => client2.getReplicators(program.address!.toString())?.length === 1
		);

		// now find 3 leaders from the network with 2 trusted participants (should return 2 leaders if trust control works correctly)
		const leadersFrom1 = await client1.findLeaders(
			program.address.toString(),
			"",
			3
		);
		const leadersFrom2 = await client2.findLeaders(
			program.address.toString(),
			"",
			3
		);
		expect(leadersFrom1).toEqual(leadersFrom2);
		expect(leadersFrom1).toHaveLength(2);
		expect(leadersFrom1).toContainAllValues([
			client1.idKeyHash,
			client2.idKeyHash,
		]);
	});

	it("select leaders for one or two peers", async () => {
		// TODO fix test timeout, isLeader is too slow as we need to wait for peers
		// perhaps do an event based get peers using the pubsub peers api

		db1 = await client1.open(
			new EventStore<string>({ id: "replication-tests" })
		);

		const isLeaderAOneLeader = await client1.isLeader(
			db1.address!.toString(),
			123,
			1
		);
		expect(isLeaderAOneLeader);
		const isLeaderATwoLeader = await client1.isLeader(
			db1.address!.toString(),
			123,
			2
		);
		expect(isLeaderATwoLeader);

		db2 = await client2.open<EventStore<string>>(db1.address!);

		await waitFor(
			() => client1.getReplicators(db1.address!.toString())?.length === 1
		);
		await waitFor(
			() => client2.getReplicators(db1.address!.toString())?.length === 1
		);

		// leader rotation is kind of random, so we do a sequence of tests
		for (let slot = 0; slot < 3; slot++) {
			// One leader
			const isLeaderAOneLeader = await client1.isLeader(
				db1.address!.toString(),
				slot,
				1
			);
			const isLeaderBOneLeader = await client2.isLeader(
				db1.address!.toString(),
				slot,
				1
			);
			expect([isLeaderAOneLeader, isLeaderBOneLeader]).toContainAllValues([
				false,
				true,
			]);

			// Two leaders
			const isLeaderATwoLeaders = await client1.isLeader(
				db1.address!.toString(),
				slot,
				2
			);
			const isLeaderBTwoLeaders = await client2.isLeader(
				db1.address!.toString(),
				slot,
				2
			);

			expect([isLeaderATwoLeaders, isLeaderBTwoLeaders]).toContainAllValues([
				true,
				true,
			]);
		}
	});

	it("leader are selected from 1 replicating peer", async () => {
		// TODO fix test timeout, isLeader is too slow as we need to wait for peers
		// perhaps do an event based get peers using the pubsub peers api

		const topic = uuid();
		db1 = await client1.open(
			new EventStore<string>({ id: "replication-tests" }),
			{
				role: new ObserverType(),
			}
		);
		db2 = await client2.open<EventStore<string>>(db1.address!);

		await delay(5000); // some delay so that if peers are to replicate, they would have had time to notify each other

		// One leader
		const slot = 0;

		// Two leaders, but only one will be leader since only one is replicating
		const isLeaderA = await client1.isLeader(db1.address!.toString(), slot, 2);
		const isLeaderB = await client2.isLeader(db1.address!.toString(), slot, 2);

		expect(!isLeaderA); // because replicate is false
		expect(isLeaderB);
	});

	it("leader are selected from 2 replicating peers", async () => {
		// TODO fix test timeout, isLeader is too slow as we need to wait for peers
		// perhaps do an event based get peers using the pubsub peers api

		db1 = await client1.open(
			new EventStore<string>({ id: "replication-tests" }),
			{
				role: new ObserverType(),
			}
		);
		db2 = await client2.open<EventStore<string>>(db1.address!);
		db3 = await client3.open<EventStore<string>>(db1.address!);

		await waitFor(
			() => client2.getReplicators(db1.address!.toString())?.length === 1
		);
		await waitFor(
			() => client3.getReplicators(db1.address!.toString())?.length === 1
		);

		// One leader
		const slot = 0;

		// Two leaders, but only one will be leader since only one is replicating
		const isLeaderA = await client1.isLeader(db1.address!.toString(), slot, 3);
		const isLeaderB = await client2.isLeader(db1.address!.toString(), slot, 3);
		const isLeaderC = await client3.isLeader(db1.address!.toString(), slot, 3);

		expect(!isLeaderA); // because replicate is false
		expect(isLeaderB);
		expect(isLeaderC);
	});

	it("select leaders for three peers", async () => {
		// TODO fix test timeout, isLeader is too slow as we need to wait for peers
		// perhaps do an event based get peers using the pubsub peers api

		db1 = await client1.open(
			new EventStore<string>({ id: "replication-tests" })
		);
		db2 = await client2.open<EventStore<string>>(db1.address!);
		db3 = await client3.open<EventStore<string>>(db1.address!);

		await waitFor(
			() => client1.getReplicators(db1.address!.toString())?.length === 2
		);
		await waitFor(
			() => client2.getReplicators(db1.address!.toString())?.length === 2
		);
		await waitFor(
			() => client3.getReplicators(db1.address!.toString())?.length === 2
		);

		// One leader
		const slot = 0;

		const isLeaderAOneLeader = await client1.isLeader(
			db1.address!.toString(),
			slot,
			1
		);
		const isLeaderBOneLeader = await client2.isLeader(
			db1.address!.toString(),
			slot,
			1
		);
		const isLeaderCOneLeader = await client3.isLeader(
			db1.address!.toString(),
			slot,
			1
		);
		expect([
			isLeaderAOneLeader,
			isLeaderBOneLeader,
			isLeaderCOneLeader,
		]).toContainValues([false, false, true]);

		// Two leaders
		const isLeaderATwoLeaders = await client1.isLeader(
			db1.address!.toString(),
			slot,
			2
		);
		const isLeaderBTwoLeaders = await client2.isLeader(
			db1.address!.toString(),
			slot,
			2
		);
		const isLeaderCTwoLeaders = await client3.isLeader(
			db1.address!.toString(),
			slot,
			2
		);
		expect([
			isLeaderATwoLeaders,
			isLeaderBTwoLeaders,
			isLeaderCTwoLeaders,
		]).toContainValues([false, true, true]);

		// Three leders
		const isLeaderAThreeLeaders = await client1.isLeader(
			db1.address!.toString(),
			slot,
			3
		);
		const isLeaderBThreeLeaders = await client2.isLeader(
			db1.address!.toString(),
			slot,
			3
		);
		const isLeaderCThreeLeaders = await client3.isLeader(
			db1.address!.toString(),
			slot,
			3
		);
		expect([
			isLeaderAThreeLeaders,
			isLeaderBThreeLeaders,
			isLeaderCThreeLeaders,
		]).toContainValues([true, true, true]);
	});
});
