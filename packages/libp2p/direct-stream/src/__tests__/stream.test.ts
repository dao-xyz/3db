import { LSession } from "@dao-xyz/libp2p-test-utils";
import { waitFor, delay } from "@dao-xyz/peerbit-time";
import crypto from "crypto";
import { waitForPeers, DirectStream } from "..";
import { createLibp2p, Libp2p } from "libp2p";
import { DataMessage, Message } from "../messages";
import { PublicSignKey } from "@dao-xyz/peerbit-crypto";
import { noise } from "@dao-xyz/libp2p-noise";
import { mplex } from "@libp2p/mplex";
import { tcp } from "@libp2p/tcp";

class TestStreamImpl extends DirectStream {
	constructor(libp2p: Libp2p, id = "test/0.0.0") {
		super(libp2p, [id], {
			canRelayMessage: true,
			emitSelf: true,
		});
	}
}

describe("streams", function () {
	describe("ping", () => {
		let session: LSession, streams: TestStreamImpl[];

		beforeEach(async () => { });

		afterEach(async () => {
			streams && (await Promise.all(streams.map((s) => s.stop())));
			await session?.stop();
		});

		afterAll(async () => { });

		it("2-ping", async () => {
			// 0 and 2 not connected
			session = await LSession.connected(2);

			streams = session.peers.map((x) => new TestStreamImpl(x));
			await Promise.all(streams.map((x) => x.start()));

			await waitForPeers(...streams);

			const ping = await streams[0].ping(
				streams[0].peers.get(streams[1].publicKeyHash)!
			);
			expect(ping).toBeNumber();
		});

		it("4-ping", async () => {
			// 0 and 2 not connected
			session = await LSession.connected(4);

			streams = session.peers.map((x) => new TestStreamImpl(x));
			await Promise.all(streams.map((x) => x.start()));

			await waitForPeers(...streams);

			const ping = await streams[0].ping(
				streams[0].peers.get(streams[1].publicKeyHash)!
			);
			expect(ping).toBeNumber();
		});
	});

	describe("publish", () => {
		let session: LSession;
		let peers: {
			stream: TestStreamImpl;
			messages: Message[];
			recieved: DataMessage[];
			reachable: PublicSignKey[];
			unrechable: PublicSignKey[];
		}[];
		const data = new Uint8Array([1, 2, 3]);

		beforeAll(async () => { });

		beforeEach(async () => {
			// 0 and 2 not connected
			session = await LSession.disconnected(4);

			/* 
			┌─┐
			│0│
			└┬┘
			┌▽┐
			│1│
			└┬┘
			┌▽┐
			│2│
			└┬┘
			┌▽┐
			│3│
			└─┘
			*/

			peers = [];
			for (const peer of session.peers) {
				const stream = new TestStreamImpl(peer);
				const client: {
					stream: TestStreamImpl;
					messages: Message[];
					recieved: DataMessage[];
					reachable: PublicSignKey[];
					unrechable: PublicSignKey[];
				} = {
					messages: [],
					recieved: [],
					reachable: [],
					unrechable: [],
					stream,
				};
				peers.push(client);
				stream.addEventListener("message", (msg) => {
					client.messages.push(msg.detail);
				});
				stream.addEventListener("data", (msg) => {
					client.recieved.push(msg.detail);
				});
				stream.addEventListener("peer:reachable", (msg) => {
					client.reachable.push(msg.detail);
				});
				stream.addEventListener("peer:unreachable", (msg) => {
					client.unrechable.push(msg.detail);
				});
				await stream.start();
			}
			await session.connect([
				// behaviour seems to be more predictable if we connect after start (TODO improve startup to use existing connections in a better way)
				[session.peers[0], session.peers[1]],
				[session.peers[1], session.peers[2]],
				[session.peers[2], session.peers[3]],
			]);

			await waitForPeers(peers[0].stream, peers[1].stream);
			await waitForPeers(peers[1].stream, peers[2].stream);
			await waitForPeers(peers[2].stream, peers[3].stream);
		});

		afterEach(async () => {
			await Promise.all(peers.map((peer) => peer.stream.stop()));
			await session.stop();
		});

		afterAll(async () => { });

		it("many", async () => {
			let iterations = 300;

			for (let i = 0; i < iterations; i++) {
				const small = crypto.randomBytes(1e3); // 1kb
				peers[0].stream.publish(small);
			}
			await waitFor(() => peers[2].recieved.length === iterations, {
				delayInterval: 300,
				timeout: 30 * 1000,
			});
		});

		it("1->unknown", async () => {
			await peers[0].stream.publish(data);
			await waitFor(() => peers[1].recieved.length === 1);
			expect(new Uint8Array(peers[1].recieved[0].data)).toEqual(data);
			await waitFor(() => peers[2].recieved.length === 1);
			expect(new Uint8Array(peers[2].recieved[0].data)).toEqual(data);
			await delay(1000); // wait some more time to make sure we dont get more messages
			expect(peers[1].recieved).toHaveLength(1);
			expect(peers[2].recieved).toHaveLength(1);
		});

		it("1->2", async () => {
			await peers[0].stream.publish(data, {
				to: [peers[1].stream.libp2p.peerId],
			});
			await waitFor(() => peers[1].recieved.length === 1);
			expect(new Uint8Array(peers[1].recieved[0].data)).toEqual(data);
			await delay(1000); // wait some more time to make sure we dont get more messages
			expect(peers[1].recieved).toHaveLength(1);
			expect(peers[2].recieved).toHaveLength(0);
		});

		it("1->3", async () => {
			await peers[0].stream.publish(data, {
				to: [peers[2].stream.libp2p.peerId],
			});
			await waitFor(() => peers[2].recieved.length === 1);
			expect(new Uint8Array(peers[2].recieved[0].data)).toEqual(data);
			await delay(1000); // wait some more time to make sure we dont get more messages
			expect(peers[2].recieved).toHaveLength(1);
			expect(peers[1].recieved).toHaveLength(0);
		});

		it("1->3 10mb data", async () => {
			const bigData = crypto.randomBytes(1e7);
			await peers[0].stream.publish(bigData, {
				to: [peers[2].stream.libp2p.peerId],
			});
			await waitFor(() => peers[2].recieved.length === 1, {
				delayInterval: 10,
				timeout: 10 * 1000,
			});
			expect(new Uint8Array(peers[2].recieved[0].data)).toHaveLength(
				bigData.length
			);
			expect(peers[2].recieved).toHaveLength(1);
			expect(peers[1].recieved).toHaveLength(0);
		});
		it("publishes on direct stream, even path is longer", async () => {
			await session.connect([[session.peers[0], session.peers[2]]]);
			await waitForPeers(peers[0].stream, peers[2].stream);

			// make path 1->3 longest, to make sure we send over it directly anyways because it is a direct path
			peers[0].stream.routes.graph.setEdgeAttribute(
				peers[0].stream.routes.getLink(
					peers[0].stream.publicKeyHash,
					peers[2].stream.publicKeyHash
				),
				"weight",
				1e5
			);
			await peers[0].stream.publish(crypto.randomBytes(1e2), {
				to: [peers[2].stream.libp2p.peerId],
			});
			peers[1].messages = [];
			await waitFor(() => peers[2].recieved.length === 1, {
				delayInterval: 10,
				timeout: 10 * 1000,
			});
			expect(
				peers[1].messages.filter((x) => x instanceof DataMessage)
			).toHaveLength(0);
		});

		it("will favor shortest path", async () => {
			/* 
			┌───┐
			│0  │
			└┬─┬┘
			 │┌▽┐
			 ││1│
			 │└┬┘
			┌▽─▽┐
			│2  │
			└┬──┘
			┌▽┐  
			│3│  
			└─┘   
			*/

			await session.connect([[session.peers[0], session.peers[2]]]);

			await waitForPeers(peers[0].stream, peers[2].stream);

			// make path long
			peers[0].stream.routes.graph.setEdgeAttribute(
				peers[0].stream.routes.getLink(
					peers[0].stream.publicKeyHash,
					peers[2].stream.publicKeyHash
				),
				"weight",
				1e5
			);

			await peers[0].stream.publish(crypto.randomBytes(1e2), {
				to: [peers[3].stream.libp2p.peerId],
			});

			peers[1].messages = [];

			await waitFor(
				() =>
					peers[1].messages.filter((x) => x instanceof DataMessage).length === 1
			); // will send through peer [1] since path [0] -> [2] -> [3] directly is currently longer
			await waitFor(() => peers[3].recieved.length === 1);

			peers[1].messages = [];

			// Make [0] -> [2] path short
			peers[0].stream.routes.graph.setEdgeAttribute(
				peers[0].stream.routes.getLink(
					peers[0].stream.publicKeyHash,
					peers[2].stream.publicKeyHash
				),
				"weight",
				0
			);
			expect(
				peers[0].stream.routes.getPath(
					peers[0].stream.publicKeyHash,
					peers[2].stream.publicKeyHash
				).length
			).toEqual(2);
			await peers[0].stream.publish(crypto.randomBytes(1e2), {
				to: [peers[2].stream.libp2p.peerId],
			});
			await waitFor(() => peers[2].recieved.length === 1, {
				delayInterval: 10,
				timeout: 10 * 1000,
			});
			expect(peers[1].messages).toHaveLength(0); // no new messages for peer 2, because sending 1 -> 3 directly is now faster
			expect(peers[1].recieved).toHaveLength(0);
		});
	});

	describe("join/leave", () => {
		let session: LSession;
		let peers: {
			stream: TestStreamImpl;
			messages: Message[];
			recieved: DataMessage[];
			reachable: PublicSignKey[];
			unrechable: PublicSignKey[];
		}[];
		const data = new Uint8Array([1, 2, 3]);

		describe("4", () => {
			beforeEach(async () => {
				session = await LSession.disconnected(4);

				/* 
				┌─┐
				│3│
				└┬┘
				┌▽┐
				│0│
				└┬┘
				┌▽┐
				│1│
				└┬┘
				┌▽┐
				│2│
				└─┘
				
				 */

				peers = [];
				for (const peer of session.peers) {
					const stream = new TestStreamImpl(peer);
					const client: {
						stream: TestStreamImpl;
						messages: Message[];
						recieved: DataMessage[];
						reachable: PublicSignKey[];
						unrechable: PublicSignKey[];
					} = {
						messages: [],
						recieved: [],
						reachable: [],
						unrechable: [],
						stream,
					};
					peers.push(client);
					stream.addEventListener("message", (msg) => {
						client.messages.push(msg.detail);
					});
					stream.addEventListener("data", (msg) => {
						client.recieved.push(msg.detail);
					});
					stream.addEventListener("peer:reachable", (msg) => {
						client.reachable.push(msg.detail);
					});
					stream.addEventListener("peer:unreachable", (msg) => {
						client.unrechable.push(msg.detail);
					});
					await stream.start();
				}

				// slowly connect to that the route maps are deterministic
				await session.connect([[session.peers[0], session.peers[1]]]);
				await waitFor(() => peers[0].stream.routes.linksCount === 1);
				await waitFor(() => peers[1].stream.routes.linksCount === 1);
				await session.connect([[session.peers[1], session.peers[2]]]);
				await waitFor(() => peers[0].stream.routes.linksCount === 2);
				await waitFor(() => peers[1].stream.routes.linksCount === 2);
				await waitFor(() => peers[2].stream.routes.linksCount === 2);
				await session.connect([[session.peers[0], session.peers[3]]]);
				await waitFor(() => peers[0].stream.routes.linksCount === 3);
				await waitFor(() => peers[1].stream.routes.linksCount === 3);
				await waitFor(() => peers[2].stream.routes.linksCount === 3);
				await waitFor(() => peers[3].stream.routes.linksCount === 3);
				await waitForPeers(peers[0].stream, peers[1].stream);
				await waitForPeers(peers[1].stream, peers[2].stream);
				await waitForPeers(peers[0].stream, peers[3].stream);
				for (const peer of peers) {
					expect(peer.reachable.map((x) => x.hashcode())).toContainAllValues(
						peers
							.map((x) => x.stream.publicKeyHash)
							.filter((x) => x !== peer.stream.publicKeyHash)
					); // peer has recevied reachable event from everone
				}
			});

			afterEach(async () => {
				await Promise.all(peers.map((peer) => peer.stream.stop()));
				await session.stop();
			});

			it("will emit unreachable events on shutdown", async () => {
				/** Shut down slowly and check that all unreachable events are fired */
				await peers[0].stream.stop();
				const hasAll = (arr: PublicSignKey[], cmp: PublicSignKey[]) => {
					let a = new Set(arr.map((x) => x.hashcode()));
					let b = new Set(cmp.map((x) => x.hashcode()));
					if (
						a.size === b.size &&
						a.size === arr.length &&
						arr.length === cmp.length
					) {
						for (const key of cmp) {
							if (!arr.find((x) => x.equals(key))) {
								return false;
							}
						}
						return true;
					}
					return false;
				};
				expect(peers[0].unrechable).toHaveLength(0);
				await waitFor(() =>
					hasAll(peers[1].unrechable, [
						peers[0].stream.publicKey,
						peers[3].stream.publicKey,
					])
				);
				await peers[1].stream.stop();
				await waitFor(() =>
					hasAll(peers[2].unrechable, [
						peers[0].stream.publicKey,
						peers[1].stream.publicKey,
						peers[3].stream.publicKey,
					])
				);
				await peers[2].stream.stop();
				await waitFor(() =>
					hasAll(peers[3].unrechable, [
						peers[0].stream.publicKey,
						peers[1].stream.publicKey,
						peers[2].stream.publicKey,
					])
				);
				await peers[3].stream.stop();
			});

			it("will publish on routes", async () => {
				peers[2].recieved = [];
				peers[3].recieved = [];

				await peers[0].stream.publish(data, {
					to: [peers[2].stream.libp2p.peerId],
				});
				await waitFor(() => peers[2].recieved.length === 1);
				expect(
					peers[2].messages.find((x) => x instanceof DataMessage)
				).toBeDefined();

				await delay(1000); // some delay to allow all messages to progagate
				expect(peers[3].recieved).toHaveLength(0);
				expect(
					peers[3].messages.find((x) => x instanceof DataMessage)
				).toBeUndefined();
			});

			it("re-route new connection", async () => {
				/* 					
				┌───┐ 
				│3  │ 
				└┬─┬┘ 
				│┌▽┐ 
				││0│ 
				│└┬┘ 
				│┌▽─┐
				││1 │
				│└┬─┘
				┌▽─▽┐ 
				│2  │ 
				└───┘ 
				 */

				expect(
					peers[3].stream.routes.getPath(
						peers[3].stream.publicKeyHash,
						peers[2].stream.publicKeyHash
					)
				).toHaveLength(4);
				await session.connect([[session.peers[2], session.peers[3]]]);
				await waitFor(
					() =>
						peers[3].stream.routes.getPath(
							peers[3].stream.publicKeyHash,
							peers[2].stream.publicKeyHash
						).length === 2
				);
			});

			it("handle on drop no routes", async () => {
				expect(
					peers[3].stream.routes.getPath(
						peers[3].stream.publicKeyHash,
						peers[2].stream.publicKeyHash
					)
				).toHaveLength(4);
				expect(peers[1].stream.earlyGoodbyes.size).toEqual(2);
				expect(peers[3].stream.earlyGoodbyes.size).toEqual(1);

				await peers[0].stream.stop();
				await waitFor(() => peers[3].stream.routes.linksCount === 0); // because 1, 2 are now disconnected
				await delay(1000); // make sure nothing get readded
				expect(peers[3].stream.routes.linksCount).toEqual(0);
				expect(
					peers[3].stream.routes.getPath(
						peers[3].stream.publicKeyHash,
						peers[2].stream.publicKeyHash
					)
				).toHaveLength(0);
				expect(peers[3].stream.earlyGoodbyes.size).toEqual(0);
			});
		});

		describe("6", () => {
			/* 
			┌─┐
			│0│
			└△┘
			┌▽┐
			│1│
			└△┘
			┌▽┐
			│2│
			└─┘

			< 2 connects with 3 >

			┌─┐
			│3│
			└△┘
			┌▽┐
			│4│
			└△┘
			┌▽┐
			│5│
			└─┘ 
			*/

			beforeEach(async () => {
				session = await LSession.disconnected(6);
				await session.connect([
					[session.peers[0], session.peers[1]],
					[session.peers[1], session.peers[2]],
					[session.peers[3], session.peers[4]],
					[session.peers[4], session.peers[5]],
				]);

				peers = [];
				for (const [i, peer] of session.peers.entries()) {
					const stream = new TestStreamImpl(peer);
					const client: {
						stream: TestStreamImpl;
						messages: Message[];
						recieved: DataMessage[];
						reachable: PublicSignKey[];
						unrechable: PublicSignKey[];
					} = {
						messages: [],
						recieved: [],
						reachable: [],
						unrechable: [],
						stream,
					};
					peers.push(client);
					stream.addEventListener("message", (msg) => {
						client.messages.push(msg.detail);
					});
					stream.addEventListener("data", (msg) => {
						client.recieved.push(msg.detail);
					});
					await stream.start();
				}

				for (const peer of peers.values()) {
					await waitFor(() => peer.stream.routes.linksCount === 2);
				}

				for (let i = 0; i < 2; i++) {
					await waitForPeers(peers[i].stream, peers[i + 1].stream);
				}
				for (let i = 3; i < 5; i++) {
					await waitForPeers(peers[i].stream, peers[i + 1].stream);
				}
			});

			afterAll(async () => {
				await session.stop();
			});
			it("will replay on connect", async () => {
				for (let i = 3; i < 5; i++) {
					await waitForPeers(peers[i].stream, peers[i + 1].stream);
				}
				expect(peers[2].stream.hellosToReplay.size).toEqual(2); // these hellos will be forwarded on connect
				expect(peers[3].stream.hellosToReplay.size).toEqual(2); // these hellos will be forwarded on connect
				await session.connect([[session.peers[2], session.peers[3]]]);

				for (const peer of peers) {
					await waitFor(() => peer.stream.routes.linksCount === 5); // everyone knows everone
				}
			});
		});
	});

	describe("start/stop", () => {
		let session: LSession, stream1: TestStreamImpl, stream2: TestStreamImpl;

		beforeEach(async () => {
			session = await LSession.connected(2);
		});

		afterEach(async () => {
			await session.stop();
			await stream1?.stop();
			await stream2?.stop();
		});

		it("can restart", async () => {
			await session.connect();
			stream1 = new TestStreamImpl(session.peers[0]);
			stream2 = new TestStreamImpl(session.peers[1]);
			await stream1.start();
			await stream2.start();
			await waitForPeers(stream1, stream2);

			await stream1.stop();
			await stream2.stop();
			await delay(1000); // Some delay seems to be necessary TODO fix
			await stream1.start();
			await stream2.start();
			await waitForPeers(stream1, stream2);
		});

		it("can connect after start", async () => {
			stream1 = new TestStreamImpl(session.peers[0]);
			stream2 = new TestStreamImpl(session.peers[1]);

			await stream1.start();
			await stream2.start();

			await session.connect();
			await waitForPeers(stream1, stream2);
		});

		it("can connect before start", async () => {
			stream1 = new TestStreamImpl(session.peers[0]);
			stream2 = new TestStreamImpl(session.peers[1]);
			await session.connect();
			await delay(3000);

			await stream1.start();
			await stream2.start();
			await waitForPeers(stream1, stream2);
		});

		it("can connect with delay", async () => {
			stream1 = new TestStreamImpl(session.peers[0]);
			stream2 = new TestStreamImpl(session.peers[1]);
			stream2.start();
			await delay(3000);
			stream1.start();

			await waitForPeers(stream1, stream2);
		});
	});

	describe("multistream", () => {
		let session: LSession, stream1: TestStreamImpl, stream2: TestStreamImpl;
		let stream1b: TestStreamImpl, stream2b: TestStreamImpl;

		beforeEach(async () => {
			session = await LSession.connected(2);
		});

		afterEach(async () => {
			await session.stop();
			await stream1?.stop();
			await stream2?.stop();
		});

		it("can setup multiple streams at once", async () => {
			stream1 = new TestStreamImpl(session.peers[0]);
			stream2 = new TestStreamImpl(session.peers[1]);
			stream1b = new TestStreamImpl(session.peers[0], "alt");
			stream2b = new TestStreamImpl(session.peers[1], "alt");
			stream1.start();
			stream2.start();
			stream1b.start();
			stream2b.start();
			await waitFor(() => !!stream1.peers.size);
			await waitFor(() => !!stream2.peers.size);
			await waitFor(() => !!stream1b.peers.size);
			await waitFor(() => !!stream2b.peers.size);
		});
	});

	describe("concurrency", () => {
		let session: LSession, streamA1: TestStreamImpl, streamA2: TestStreamImpl, streamB: TestStreamImpl;

		beforeEach(async () => {
			session = await LSession.connected(2);

			const clone = await createLibp2p({
				peerId: session.peers[0].peerId,
				connectionManager: {
					autoDial: false,
				},
				addresses: {
					listen: ["/ip4/127.0.0.1/tcp/0"],
				},
				transports: [tcp()],
				connectionEncryption: [noise()],
				streamMuxers: [mplex()],
			});
			session.peers.unshift(clone)
		});

		afterEach(async () => {
			await session.stop();
			await streamA1?.stop();
			await streamA2?.stop();
			await streamB?.stop();

		});

		it("can broadcast between peers", async () => {
			streamA1 = new TestStreamImpl(session.peers[1]);
			streamA1.start()


			streamB = new TestStreamImpl(session.peers[2]);
			streamB.start()

			/* 	const broadcast = (from: TestStreamImpl, to: TestStreamImpl) => {
					const fn = from.processMessage.bind(from);
					from.processMessage = (from, msg) => {
						to.processMessageBR(from, msg)
						return fn(from, msg)
					}
				}
				await delay(5000)
	
				streamA2 = new TestStreamImpl(session.peers[1]);
				streamA2.start()
				await delay(5000)
	
	
				broadcast(streamA1, streamA2);
				broadcast(streamA2, streamA1);
	 */


			try {
				await waitFor(() => streamA1.peers.size/*  + streamA2.peers.size */ === 1);
				await waitFor(() => streamB.peers.size === 1);
			} catch (error) {
				const qwe = 123;
			}
			const t = 123;

			await delay(5000)
			const aasdbc = 123;
			streamA2 = new TestStreamImpl(session.peers[0]);
			await streamA2.start()


			await session.connect([[session.peers[0], session.peers[2]]])
			await delay(5000)
			await streamA2.stop();
			await delay(5000)

			const abc = 123;

			/* stream2 = new TestStreamImpl(session.peers[1]);
			stream1b = new TestStreamImpl(session.peers[0], "alt");
			stream2b = new TestStreamImpl(session.peers[1], "alt");
			stream1.start();
			stream2.start();
			stream1b.start();
			stream2b.start();
			await waitFor(() => !!stream1.peers.size);
			await waitFor(() => !!stream2.peers.size);
			await waitFor(() => !!stream1b.peers.size);
			await waitFor(() => !!stream2b.peers.size); */
		});
	});
});
