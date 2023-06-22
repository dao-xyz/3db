import { Peerbit as IPeerbit } from "@peerbit/interface";
import { DString } from "@peerbit/string";
import { LSession } from "@peerbit/test-utils";
import { Ed25519Keypair } from "@peerbit/crypto";
import http from "http";
import { client, startServer } from "../api.js";
import { jest } from "@jest/globals";
import { PermissionedString } from "peerbit-node-test-lib";
import { Address } from "@peerbit/program";

describe("libp2p only", () => {
	let session: LSession, server: http.Server;
	jest.setTimeout(60 * 1000);

	beforeAll(async () => {
		session = await LSession.connected(1);
	});

	beforeEach(async () => {
		session.peers[0].services.pubsub.subscribe("1", {
			data: new Uint8Array([1]),
		});
		session.peers[0].services.pubsub.subscribe("2", {
			data: new Uint8Array([2]),
		});
		session.peers[0].services.pubsub.subscribe("3", {
			data: new Uint8Array([3]),
		});
		server = await startServer(session.peers[0], 7676);
	});
	afterEach(() => {
		server.close();
	});

	afterAll(async () => {
		await session.stop();
	});

	it("use cli as libp2p cli", async () => {
		const c = await client("http://localhost:" + 7676);
		expect(await c.peer.id.get()).toBeDefined()
	});
});

describe("server", () => {
	let session: LSession, peer: IPeerbit, address: Address, server: http.Server;
	let db: PermissionedString;

	beforeAll(async () => {
		session = await LSession.connected(1, { directory: "./peerbit/" + +new Date() });
		peer = session.peers[0]
	});

	beforeEach(async () => {
		db = await new PermissionedString({ trusted: [] }).open(peer)
		address = db.address!;
		server = await startServer(peer);
	});
	afterEach(async () => {
		server.close();
		await db.close();
		await peer.stop();
	});

	afterAll(async () => {
		await session.stop();
	});

	describe("client", () => {
		it("id", async () => {
			const c = await client();
			expect(await c.peer.id.get()).toEqual(peer.peerId.toString());
		});
		it("addresses", async () => {
			const c = await client();
			expect((await c.peer.addresses.get()).map((x) => x.toString())).toEqual(
				(await peer.getMultiaddrs()).map((x) => x.toString())
			);
		});
	});

	/*  TODO feat

	it("topics", async () => {
		const c = await client();
		expect(await c.topics.get(true)).toEqual([address.toString()]);
	});

	it("program", async () => {
		const c = await client();
		const program = new PermissionedString({
			store: new DString({}),
			trusted: [],
		});
		const address = await c.program.put(program);
		const programInstance = await c.program.get(address);
		expect(programInstance).toBeInstanceOf(PermissionedString);
	});
	it("library", async () => {
		const c = await client();
		await c.library.put("peerbit-node-test-lib");
	}); */

	/*  TODO add network functionality
	
	it("network", async () => {
		const c = await client();
		const program = new PermissionedString({
			store: new DString({}),
			trusted: [peer.identity.publicKey],
		});
		program.setupIndices();
		const address = await c.program.put(program, "topic");
		expect(await c.program.get(address)).toBeInstanceOf(PermissionedString);
		expect(await c.network.peers.get(address)).toHaveLength(0);
		const pk = (await Ed25519Keypair.create()).publicKey;
		await c.network.peer.put(address, pk);
		const peers = await c.network.peers.get(address);
		expect(peers).toHaveLength(1);
		expect(
			(peers?.[0] as IdentityRelation).from.equals(
				peer.identity.publicKey
			)
		);
		expect((peers?.[0] as IdentityRelation).to.equals(pk));
	}); */
});
