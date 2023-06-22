import {
	deserialize,
	field,
	fixedArray,
	option,
	variant,
	vec,
} from "@dao-xyz/borsh";
import { Documents, DocumentsChange, SetupOptions } from "../document-store";
import {
	IntegerCompare,
	StringMatch,
	Compare,
	MissingField,
	And,
	SearchRequest,
	StringMatchMethod,
	Or,
	ByteMatchQuery,
	BoolQuery,
	Sort,
	SortDirection,
} from "../query.js";
import { LSession, createStore } from "@peerbit/test-utils";
import { Log } from "@peerbit/log";
import {
	X25519Keypair,
	X25519PublicKey,
	randomBytes,
	sha256Base64,
	toBase64,
} from "@peerbit/crypto";
import { v4 as uuid } from "uuid";
import { Observer, Replicator } from "@peerbit/shared-log";
import { delay, waitFor, waitForResolved } from "@peerbit/time";
import { DocumentIndex } from "../document-index.js";
import { waitForPeers as waitForPeersStreams } from "@peerbit/stream";
import { Program } from "@peerbit/program";
import pDefer, { DeferredPromise } from "p-defer";
BigInt.prototype["toJSON"] = function () {
	return this.toString();
};

@variant("document")
class Document {
	@field({ type: Uint8Array })
	id: Uint8Array;

	@field({ type: option("string") })
	name?: string;

	@field({ type: option("u64") })
	number?: bigint;

	@field({ type: option(vec("string")) })
	tags?: string[];

	@field({ type: option("bool") })
	bool?: boolean;

	@field({ type: option(Uint8Array) })
	data?: Uint8Array;

	constructor(opts: Document) {
		this.id = opts.id;
		this.name = opts.name;
		this.number = opts.number;
		this.tags = opts.tags;
		this.bool = opts.bool;
		this.data = opts.data;
	}
}

@variant("test_documents")
class TestStore extends Program {
	@field({ type: Uint8Array })
	id: Uint8Array;

	@field({ type: Documents })
	docs: Documents<Document>;

	constructor(properties: { docs: Documents<Document> }) {
		super();

		this.id = randomBytes(32);
		this.docs = properties.docs;
	}

	async setup(options?: Partial<SetupOptions<Document>>): Promise<void> {
		await this.docs.setup({ ...options, type: Document, index: { key: "id" } });
	}
}

const bigIntSort = <T extends number | bigint>(a: T, b: T): number =>
	a > b ? 1 : 0 || -(a < b);

describe("index", () => {
	let session: LSession;

	describe("operations", () => {
		describe("basic", () => {
			let store: TestStore;
			let store2: TestStore;

			beforeAll(async () => {
				session = await LSession.connected(2);
			});
			afterEach(async () => {
				await store?.close();
				await store2?.close();
			});

			afterAll(async () => {
				await session.stop();
			});

			it("can add and delete", async () => {
				store = new TestStore({
					docs: new Documents<Document>({
						index: new DocumentIndex(),
					}),
				});
				await store.open(session.peers[0]);
				const changes: DocumentsChange<Document>[] = [];
				store.docs.events.addEventListener("change", (evt) => {
					changes.push(evt.detail);
				});

				let doc = new Document({
					id: uuid(),
					name: "Hello world",
				});
				let doc2 = new Document({
					id: uuid(),
					name: "Hello world",
				});

				const putOperation = (await store.docs.put(doc)).entry;
				expect(store.docs.index.size).toEqual(1);

				expect(changes.length).toEqual(1);
				expect(changes[0].added).toHaveLength(1);
				expect(changes[0].added[0].id).toEqual(doc.id);
				expect(changes[0].removed).toHaveLength(0);

				const putOperation2 = (await store.docs.put(doc2)).entry;
				expect(store.docs.index.size).toEqual(2);
				expect(putOperation2.next).toContainAllValues([]); // because doc 2 is independent of doc 1

				expect(changes.length).toEqual(2);
				expect(changes[1].added).toHaveLength(1);
				expect(changes[1].added[0].id).toEqual(doc2.id);
				expect(changes[1].removed).toHaveLength(0);

				// delete 1
				const deleteOperation = (await store.docs.del(doc.id)).entry;
				expect(deleteOperation.next).toContainAllValues([putOperation.hash]); // because delete is dependent on put
				expect(store.docs.index.size).toEqual(1);

				expect(changes.length).toEqual(3);
				expect(changes[2].added).toHaveLength(0);
				expect(changes[2].removed).toHaveLength(1);
				expect(changes[2].removed[0].id).toEqual(doc.id);

				// try close and load
				await store.docs.log.log.close();
				await store.docs.log.log.load();
				await store.docs.log.log.close();
			});

			it("many chunks", async () => {
				store = new TestStore({
					docs: new Documents<Document>({
						index: new DocumentIndex(),
					}),
				});
				await store.open(session.peers[0]);
				const insertions = 100;
				const rngs: string[] = [];
				for (let i = 0; i < insertions; i++) {
					rngs.push(Buffer.from(randomBytes(1e5)).toString("base64"));
				}
				for (let i = 0; i < 20000; i++) {
					await store.docs.put(
						new Document({
							id: uuid(),
							name: rngs[i],
						}),
						{ unique: true }
					);
				}
			});

			it("delete permanently", async () => {
				store = new TestStore({
					docs: new Documents<Document>({
						index: new DocumentIndex(),
						immutable: false,
					}),
				});
				await store.open(session.peers[0]);

				let doc = new Document({
					id: uuid(),
					name: "Hello world",
				});
				let editDoc = new Document({
					id: doc.id,
					name: "Hello world 2",
				});

				const _putOperation = await store.docs.put(doc);
				expect(store.docs.index.size).toEqual(1);
				const putOperation2 = (await store.docs.put(editDoc)).entry;
				expect(store.docs.index.size).toEqual(1);
				expect(putOperation2.next).toHaveLength(1);

				// delete 1
				const deleteOperation = (await store.docs.del(doc.id)).entry;
				expect(store.docs.index.size).toEqual(0);
				expect(
					(await store.docs.log.log.values.toArray()).map((x) => x.hash)
				).toEqual([deleteOperation.hash]); // the delete operation
			});
		});

		describe("events", () => {
			let stores: TestStore[];

			beforeAll(async () => {
				session = await LSession.connected(3);
			});
			beforeEach(() => {
				stores = [];
			});
			afterEach(async () => {
				await stores.map((x) => x.close());
			});

			afterAll(async () => {
				await session.stop();
			});

			it("emits event on replication", async () => {
				const store = new TestStore({
					docs: new Documents<Document>({
						index: new DocumentIndex(),
						immutable: false,
					}),
				});
				for (const [i, peer] of session.peers.entries()) {
					if (!store.address) {
						stores.push(await store.open(peer));
					} else {
						stores.push(
							await TestStore.open(store.address, peer, {
								setup: (p) => p.setup({ sync: () => true }),
							})
						);
					}
				}
				for (const [i, store] of stores.entries()) {
					for (const [j, peer] of session.peers.entries()) {
						if (i === j) {
							continue;
						}
						await store.waitFor(peer.peerId);
					}
				}

				const resolver: Map<string, () => void> = new Map();
				let promises: Promise<any>[] = [];

				stores[2].docs.events.addEventListener("change", (evt) => {
					for (const doc of evt.detail.added) {
						resolver.get(toBase64(doc.id))!();
					}
				});

				for (let i = 0; i < 100; i++) {
					const doc = new Document({ id: randomBytes(32) });
					const defer = pDefer();
					const timeout = setTimeout(() => {
						defer.reject(new Error("Timeout"));
					}, 10000);
					resolver.set(toBase64(doc.id), () => {
						clearTimeout(timeout);
						defer.resolve();
					});
					promises.push(defer.promise);
					await store.docs.put(doc);
				}

				await Promise.all(promises);
			});
		});
		describe("indexBy", () => {
			let store: Program;
			let store2: Program;

			beforeAll(async () => {
				session = await LSession.connected(2);
			});
			afterEach(async () => {
				await store?.close();
				await store2?.close();
			});

			afterAll(async () => {
				await session.stop();
			});

			describe("string", () => {
				class SimpleDocument {
					@field({ type: "string" })
					id: string;

					@field({ type: "string" })
					value: string;

					constructor(properties: { id: string; value: string }) {
						this.id = properties.id;
						this.value = properties.value;
					}
				}

				@variant("test_index_documents")
				class TestIndexStore extends Program {
					@field({ type: Uint8Array })
					id: Uint8Array;

					@field({ type: Documents })
					docs: Documents<SimpleDocument>;

					constructor(
						properties: { docs: Documents<SimpleDocument> },
						readonly indexBy: string = "id"
					) {
						super();

						this.id = randomBytes(32);
						this.docs = properties.docs;
					}
					async setup(): Promise<void> {
						await this.docs.setup({
							type: SimpleDocument,
							index: { key: this.indexBy },
						});
					}
				}
				it("will throw error if indexBy does not exist in document", async () => {
					store = new TestIndexStore(
						{
							docs: new Documents<SimpleDocument>({
								index: new DocumentIndex(),
							}),
						},
						"__missing__"
					);

					await store.open(session.peers[0]);

					let doc = new SimpleDocument({
						id: "abc 123",
						value: "Hello world",
					});

					// put doc
					await expect(
						(store as TestIndexStore).docs.put(doc)
					).rejects.toThrowError(
						"The provided key value is null or undefined, expecting string or Uint8array"
					);
				});

				it("index by another property", async () => {
					store = new TestIndexStore(
						{
							docs: new Documents<SimpleDocument>({
								index: new DocumentIndex(),
							}),
						},
						"value"
					);

					await store.open(session.peers[0]);

					let helloWorld = "Hello world";
					let doc = new SimpleDocument({
						id: "abc 123",
						value: helloWorld,
					});

					// put doc
					await (store as TestIndexStore).docs.put(doc);

					expect(
						(await (store as TestIndexStore).docs.index.get(helloWorld))?.value
					).toEqual(helloWorld);
				});

				it("can StringQuery index", async () => {
					store = new TestIndexStore({
						docs: new Documents<SimpleDocument>(),
					});
					await store.open(session.peers[0]);

					let doc = new SimpleDocument({
						id: "abc 123",
						value: "Hello world",
					});

					await (store as TestIndexStore).docs.put(doc);

					const results = await (store as TestIndexStore).docs.index.search(
						new SearchRequest({
							query: [
								new StringMatch({
									key: "id",
									value: "123",
									caseInsensitive: false,
									method: StringMatchMethod.contains,
								}),
							],
						}),
						{ remote: { amount: 1 } }
					);
					expect(results).toHaveLength(1);
				});
			});

			describe("bytes", () => {
				class SimpleDocument {
					@field({ type: Uint8Array })
					id: Uint8Array;

					@field({ type: "string" })
					value: string;

					constructor(properties: { id: Uint8Array; value: string }) {
						this.id = properties.id;
						this.value = properties.value;
					}
				}

				@variant("test_simple_store")
				class TestSimpleStore extends Program {
					@field({ type: Uint8Array })
					id: Uint8Array;

					@field({ type: Documents })
					docs: Documents<SimpleDocument>;

					constructor(properties: { docs: Documents<SimpleDocument> }) {
						super();

						this.id = randomBytes(32);
						this.docs = properties.docs;
					}
					async setup(): Promise<void> {
						await this.docs.setup({
							type: SimpleDocument,
							index: { key: "id" },
						});
					}
				}

				it("index as Uint8array", async () => {
					store = new TestSimpleStore({
						docs: new Documents<SimpleDocument>(),
					});
					await store.open(session.peers[0]);

					const id = new Uint8Array([1, 2, 3]);
					let doc = new SimpleDocument({
						id,
						value: "Hello world",
					});

					await (store as TestSimpleStore).docs.put(doc);
					const results = await (store as TestSimpleStore).docs.index.search(
						new SearchRequest({
							query: [
								new ByteMatchQuery({
									key: "id",
									value: id,
								}),
							],
						})
					);
					expect(results).toHaveLength(1);
				});
			});
		});

		describe("index", () => {
			let store: TestStore;
			let store2: TestStore;

			beforeAll(async () => {
				session = await LSession.connected(2);
			});
			afterEach(async () => {
				await store?.close();
				await store2?.close();
			});

			afterAll(async () => {
				await session.stop();
			});

			it("trim deduplicate changes", async () => {
				store = new TestStore({
					docs: new Documents<Document>({
						index: new DocumentIndex(),
					}),
				});

				await store.setup({
					trim: { type: "length", to: 1 },
					role: new Observer(), // if we instead would do 'new Replicator()' trimming will not be done unless other peers has joined
				});
				await store.open(session.peers[0]);

				const changes: DocumentsChange<Document>[] = [];
				store.docs.events.addEventListener("change", (evt) => {
					changes.push(evt.detail);
				});

				let doc = new Document({
					id: uuid(),
					name: "Hello world",
				});

				// put doc
				await store.docs.put(doc);
				expect(store.docs.index.size).toEqual(1);
				expect(changes.length).toEqual(1);
				expect(changes[0].added).toHaveLength(1);
				expect(changes[0].added[0].id).toEqual(doc.id);
				expect(changes[0].removed).toHaveLength(0);

				// put doc again and make sure it still exist in index with trim to 1 option
				await store.docs.put(doc);
				expect(store.docs.index.size).toEqual(1);
				expect(store.docs.log.log.values.length).toEqual(1);
				expect(changes.length).toEqual(2);
				expect(changes[1].added).toHaveLength(1);
				expect(changes[1].added[0].id).toEqual(doc.id);
				expect(changes[1].removed).toHaveLength(0);
			});

			it("trim and update index", async () => {
				store = new TestStore({
					docs: new Documents<Document>({
						index: new DocumentIndex(),
						immutable: false,
					}),
				});

				await store.setup({
					trim: { type: "length", to: 10 },
					role: new Observer(), // if we instead would do 'new Replicator()' trimming will not be done unless other peers has joined
				});
				await store.open(session.peers[0]);

				for (let i = 0; i < 100; i++) {
					await store.docs.put(
						new Document({
							id: Buffer.from(String(i)),
							name: "Hello world " + String(i),
						}),
						{ nexts: [] }
					);
				}

				expect(store.docs.index.size).toEqual(10);
				expect(store.docs.log.log.values.length).toEqual(10);
				expect(store.docs.log.log.headsIndex.index.size).toEqual(10);
			});

			describe("field extractor", () => {
				let indexedNameField = "xyz";

				// We can't seem to define this class inside of the test itself (will yield error when running all tests)
				@variant("filtered_store")
				class FilteredStore extends Program {
					@field({ type: Uint8Array })
					id: Uint8Array;

					@field({ type: Documents })
					docs: Documents<Document>;

					constructor(properties: { docs: Documents<Document> }) {
						super();

						this.id = new Uint8Array(32);
						this.docs = properties.docs;
					}

					async setup(
						options?: Partial<SetupOptions<Document>>
					): Promise<void> {
						await this.docs.setup({
							...options,
							type: Document,
							index: {
								key: "id",
								fields: async (obj) => {
									return { [indexedNameField]: obj.name };
								},
							},
						});
					}
				}

				it("filters field", async () => {
					store = new FilteredStore({
						docs: new Documents<Document>(),
					});
					store.docs.log.log.id = new Uint8Array(32);

					await store.open(session.peers[0]);

					let doc = new Document({
						id: uuid(),
						name: "Hello world",
					});

					await store.docs.put(doc);

					let indexedValues = [...store.docs.index.index.values()];

					expect(indexedValues).toHaveLength(1);

					expect(indexedValues[0].value).toEqual({
						[indexedNameField]: doc.name,
					});

					await session.peers[1].services.blocks.waitFor(
						session.peers[0].peerId
					);

					store2 = (await FilteredStore.load<FilteredStore>(
						store.address!,
						session.peers[1].services.blocks
					))!;

					store2.setup({
						role: new Observer(),
					});

					expect(store2.docs.log.role).toBeInstanceOf(Observer);

					await store2.open(session.peers[1]);

					await store2.waitFor(session.peers[0].peerId);

					let results = await store2.docs.index.search(
						new SearchRequest({ query: [] })
					);
					expect(results).toHaveLength(1);
				});
			});
		});
		describe("query", () => {
			let peersCount = 3,
				stores: TestStore[] = [],
				writeStore: TestStore;

			beforeAll(async () => {
				session = await LSession.connected(peersCount);
				// Create store
				for (let i = 0; i < peersCount; i++) {
					const store =
						i > 0
							? (await TestStore.load<TestStore>(
									stores[0].address!,
									session.peers[i].services.blocks
							  ))!
							: new TestStore({
									docs: new Documents<Document>(),
							  });
					await store.setup({
						role: i === 0 ? new Replicator() : new Observer(),
					});
					await store.open(session.peers[i]);
					stores.push(store);
				}

				writeStore = stores[0];

				let doc = new Document({
					id: Buffer.from("1"),
					name: "hello",
					number: 1n,
				});

				let docEdit = new Document({
					id: Buffer.from("1"),
					name: "hello world",
					number: 1n,
					bool: true,
					data: new Uint8Array([1]),
				});

				let doc2 = new Document({
					id: Buffer.from("2"),
					name: "hello world",
					number: 4n,
				});

				let doc2Edit = new Document({
					id: Buffer.from("2"),
					name: "Hello World",
					number: 2n,
					data: new Uint8Array([2]),
				});

				let doc3 = new Document({
					id: Buffer.from("3"),
					name: "foo",
					number: 3n,
					data: new Uint8Array([3]),
				});

				let doc4 = new Document({
					id: Buffer.from("4"),
					name: undefined,
					number: undefined,
				});

				await writeStore.docs.put(doc);
				await waitFor(() => writeStore.docs.index.size === 1);
				await writeStore.docs.put(docEdit);
				await writeStore.docs.put(doc2);
				await waitFor(() => writeStore.docs.index.size === 2);
				await writeStore.docs.put(doc2Edit);
				await writeStore.docs.put(doc3);
				await writeStore.docs.put(doc4);
				await waitFor(() => writeStore.docs.index.size === 4);

				expect(stores[0].docs.log.role).toBeInstanceOf(Replicator);
				expect(stores[1].docs.log.role).toBeInstanceOf(Observer);
				await stores[1].waitFor(session.peers[0].peerId);
				await stores[0].waitFor(session.peers[1].peerId);
			});

			afterAll(async () => {
				await Promise.all(stores.map((x) => x.drop()));
				await session.stop();
			});

			it("no-args", async () => {
				let results: Document[] = await stores[0].docs.index.search(
					new SearchRequest({ query: [] })
				);
				expect(results).toHaveLength(4);
			});

			it("match locally", async () => {
				let results: Document[] = await stores[0].docs.index.search(
					new SearchRequest({
						query: [],
					}),
					{ remote: false }
				);
				expect(results).toHaveLength(4);
			});

			it("match all", async () => {
				let results: Document[] = await stores[1].docs.index.search(
					new SearchRequest({
						query: [],
					}),
					{ remote: { amount: 1 } }
				);
				expect(results).toHaveLength(4);
			});

			describe("sync", () => {
				it("can match sync", async () => {
					expect(stores[1].docs.index.size).toEqual(0);
					let canAppendEvents = 0;
					let canAppend = stores[1].docs["_optionCanAppend"]?.bind(
						stores[1].docs
					);
					let syncEvents = 0;
					let sync = stores[1].docs.index["_sync"].bind(stores[1].docs.index);
					stores[1].docs.index["_sync"] = async (r) => {
						syncEvents += 1;
						return sync(r);
					};
					stores[1].docs["_optionCanAppend"] = async (e) => {
						canAppendEvents += 1;
						return !canAppend || canAppend(e);
					};

					await stores[1].docs.index.search(
						new SearchRequest({
							query: [],
						}),
						{ remote: { amount: 1, sync: true } }
					);
					await waitFor(() => stores[1].docs.index.size === 4);
					expect(stores[1].docs.log.log.length).toEqual(6); // 4 documents where 2 have been edited once (4 + 2)
					expect(canAppendEvents).toEqual(6); // 4 documents where 2 have been edited once (4 + 2)
					expect(syncEvents).toEqual(1);

					await stores[1].docs.index.search(
						new SearchRequest({
							query: [],
						}),
						{ remote: { amount: 1, sync: true } }
					);
					await waitFor(() => syncEvents == 2);
					expect(canAppendEvents).toEqual(6); // no new checks, since all docs already added
				});
				it("will not sync already existing", async () => {});
			});

			describe("string", () => {
				it("exact", async () => {
					let responses: Document[] = await stores[1].docs.index.search(
						new SearchRequest({
							query: [
								new StringMatch({
									key: "name",
									value: "hello world",
									caseInsensitive: true,
								}),
							],
						})
					);
					expect(
						responses.map((x) => Buffer.from(x.id).toString("utf8"))
					).toContainAllValues(["1", "2"]);
				});

				it("exact-case-insensitive", async () => {
					let responses: Document[] = await stores[1].docs.index.search(
						new SearchRequest({
							query: [
								new StringMatch({
									key: "name",
									value: "Hello World",
									caseInsensitive: true,
								}),
							],
						})
					);
					expect(responses).toHaveLength(2);
					expect(
						responses.map((x) => Buffer.from(x.id).toString("utf8"))
					).toContainAllValues(["1", "2"]);
				});

				it("exact case sensitive", async () => {
					let responses: Document[] = await stores[1].docs.index.search(
						new SearchRequest({
							query: [
								new StringMatch({
									key: "name",
									value: "Hello World",
									caseInsensitive: false,
								}),
							],
						})
					);
					expect(responses).toHaveLength(1);
					expect(
						responses.map((x) => Buffer.from(x.id).toString("utf8"))
					).toContainAllValues(["2"]);
					responses = await stores[1].docs.index.search(
						new SearchRequest({
							query: [
								new StringMatch({
									key: "name",
									value: "hello world",
									caseInsensitive: false,
								}),
							],
						})
					);
					expect(
						responses.map((x) => Buffer.from(x.id).toString("utf8"))
					).toContainAllValues(["1"]);
				});
				it("prefix", async () => {
					let responses: Document[] = await stores[1].docs.index.search(
						new SearchRequest({
							query: [
								new StringMatch({
									key: "name",
									value: "hel",
									method: StringMatchMethod.prefix,
									caseInsensitive: true,
								}),
							],
						}),
						{ remote: { amount: 1 } }
					);
					expect(responses).toHaveLength(2);
					expect(
						responses.map((x) => Buffer.from(x.id).toString("utf8"))
					).toContainAllValues(["1", "2"]);
				});

				it("contains", async () => {
					let responses: Document[] = await stores[1].docs.index.search(
						new SearchRequest({
							query: [
								new StringMatch({
									key: "name",
									value: "ello",
									method: StringMatchMethod.contains,
									caseInsensitive: true,
								}),
							],
						})
					);
					expect(responses).toHaveLength(2);
					expect(
						responses.map((x) => Buffer.from(x.id).toString("utf8"))
					).toContainAllValues(["1", "2"]);
				});

				describe("arr", () => {
					let docArray1 = new Document({
						id: Buffer.from("a"),
						name: "_",
						number: undefined,
						tags: ["Hello", "World"],
					});

					let docArray2 = new Document({
						id: Buffer.from("b"),
						name: "__",
						number: undefined,
						tags: ["Hello"],
					});
					beforeEach(async () => {
						await writeStore.docs.put(docArray1);
						await writeStore.docs.put(docArray2);
					});
					afterEach(async () => {
						await writeStore.docs.del(docArray1.id);
						await writeStore.docs.del(docArray2.id);
					});
					it("arr", async () => {
						let responses: Document[] = await stores[1].docs.index.search(
							new SearchRequest({
								query: [
									new StringMatch({
										key: "tags",
										value: "world",
										method: StringMatchMethod.contains,
										caseInsensitive: true,
									}),
								],
							})
						);
						expect(responses).toHaveLength(1);
						expect(
							responses.map((x) => Buffer.from(x.id).toString("utf8"))
						).toContainAllValues(["a"]);
					});
				});
			});

			it("missing", async () => {
				let responses: Document[] = await stores[1].docs.index.search(
					new SearchRequest({
						query: [
							new MissingField({
								key: "name",
							}),
						],
					}),
					{ remote: { amount: 1 } }
				);
				expect(responses).toHaveLength(1);
				expect(
					responses.map((x) => Buffer.from(x.id).toString("utf8"))
				).toEqual(["4"]);
			});

			it("bytes", async () => {
				let responses: Document[] = await stores[1].docs.index.search(
					new SearchRequest({
						query: [
							new ByteMatchQuery({
								key: "data",
								value: Buffer.from([1]),
							}),
						],
					})
				);
				expect(responses).toHaveLength(1);
				expect(
					responses.map((x) => Buffer.from(x.id).toString("utf8"))
				).toEqual(["1"]);
			});

			it("bool", async () => {
				let responses: Document[] = await stores[1].docs.index.search(
					new SearchRequest({
						query: [
							new BoolQuery({
								key: "bool",
								value: true,
							}),
						],
					}),
					{ remote: { amount: 1 } }
				);
				expect(responses).toHaveLength(1);
				expect(
					responses.map((x) => Buffer.from(x.id).toString("utf8"))
				).toEqual(["1"]);
			});

			describe("logical", () => {
				it("and", async () => {
					let responses: Document[] = await stores[1].docs.index.search(
						new SearchRequest({
							query: [
								new And([
									new StringMatch({
										key: "name",
										value: "hello",
										caseInsensitive: true,
										method: StringMatchMethod.contains,
									}),
									new StringMatch({
										key: "name",
										value: "world",
										caseInsensitive: true,
										method: StringMatchMethod.contains,
									}),
								]),
							],
						}),
						{ remote: { amount: 1 } }
					);
					expect(responses).toHaveLength(2);
					expect(
						responses.map((x) => Buffer.from(x.id).toString("utf8"))
					).toContainAllValues(["1", "2"]);
				});

				it("or", async () => {
					let responses: Document[] = await stores[1].docs.index.search(
						new SearchRequest({
							query: [
								new Or([
									new ByteMatchQuery({
										key: "id",
										value: Buffer.from("1"),
									}),
									new ByteMatchQuery({
										key: "id",
										value: Buffer.from("2"),
									}),
								]),
							],
						}),
						{ remote: { amount: 1 } }
					);
					expect(responses).toHaveLength(2);
					expect(
						responses.map((x) => Buffer.from(x.id).toString("utf8"))
					).toContainAllValues(["1", "2"]);
				});
			});

			describe("number", () => {
				it("equal", async () => {
					let response: Document[] = await stores[1].docs.index.search(
						new SearchRequest({
							query: [
								new IntegerCompare({
									key: "number",
									compare: Compare.Equal,
									value: 2n,
								}),
							],
						}),
						{ remote: { amount: 1 } }
					);
					expect(response).toHaveLength(1);
					expect(response[0].number).toEqual(2n);
				});

				it("gt", async () => {
					let response: Document[] = await stores[1].docs.index.search(
						new SearchRequest({
							query: [
								new IntegerCompare({
									key: "number",
									compare: Compare.Greater,
									value: 2n,
								}),
							],
						}),
						{ remote: { amount: 1 } }
					);
					expect(response).toHaveLength(1);
					expect(response[0].number).toEqual(3n);
				});

				it("gte", async () => {
					let response: Document[] = await stores[1].docs.index.search(
						new SearchRequest({
							query: [
								new IntegerCompare({
									key: "number",
									compare: Compare.GreaterOrEqual,
									value: 2n,
								}),
							],
						}),
						{ remote: { amount: 1 } }
					);
					response.sort((a, b) =>
						bigIntSort(a.number as bigint, b.number as bigint)
					);
					expect(response).toHaveLength(2);
					expect(response[0].number).toEqual(2n);
					expect(response[1].number).toEqual(3n);
				});

				it("lt", async () => {
					let response: Document[] = await stores[1].docs.index.search(
						new SearchRequest({
							query: [
								new IntegerCompare({
									key: "number",
									compare: Compare.Less,
									value: 2n,
								}),
							],
						}),
						{ remote: { amount: 1 } }
					);
					expect(response).toHaveLength(1);
					expect(response[0].number).toEqual(1n);
				});

				it("lte", async () => {
					let response: Document[] = await stores[1].docs.index.search(
						new SearchRequest({
							query: [
								new IntegerCompare({
									key: "number",
									compare: Compare.LessOrEqual,
									value: 2n,
								}),
							],
						}),
						{ remote: { amount: 1 } }
					);
					response.sort((a, b) =>
						bigIntSort(a.number as bigint, b.number as bigint)
					);
					expect(response).toHaveLength(2);
					expect(response[0].number).toEqual(1n);
					expect(response[1].number).toEqual(2n);
				});
			});

			describe("concurrently", () => {
				it("can query concurrently", async () => {
					// TODO add more concurrency
					let promises: Promise<Document[]>[] = [];
					let concurrency = 100;
					for (let i = 0; i < concurrency; i++) {
						if (i % 2 === 0) {
							promises.push(
								stores[1].docs.index.search(
									new SearchRequest({
										query: [
											new IntegerCompare({
												key: "number",
												compare: Compare.GreaterOrEqual,
												value: 2n,
											}),
										],
									}),
									{ remote: { amount: 1 } }
								)
							);
						} else {
							promises.push(
								stores[1].docs.index.search(
									new SearchRequest({
										query: [
											new IntegerCompare({
												key: "number",
												compare: Compare.Less,
												value: 2n,
											}),
										],
									}),
									{ remote: { amount: 1 } }
								)
							);
						}
					}

					let results = await Promise.all(promises);
					for (let i = 0; i < concurrency; i++) {
						if (i % 2 === 0) {
							// query1
							expect(results[i]).toHaveLength(2);
							results[i].sort((a, b) => Number(a.number! - b.number!));
							expect(results[i][0].number === 2n).toBeTrue(); // Jest can't seem to output BN if error, so we do equals manually
							expect(results[i][1].number === 3n).toBeTrue(); // Jest can't seem to output BN if error, so we do equals manually
						} else {
							// query2
							expect(results[i]).toHaveLength(1);
							expect(results[i][0].number === 1n).toBeTrue();
						}
					}
				});
			});
		});

		describe("sort", () => {
			let peersCount = 3,
				stores: TestStore[] = [];

			const put = async (storeIndex: number, id: number) => {
				let doc = new Document({
					id: Buffer.from(String(id)),
					name: String(id),
					number: BigInt(id),
				});
				return stores[storeIndex].docs.put(doc);
			};

			const checkIterate = async (
				fromStoreIndex: number,
				batches: bigint[][],
				query = new IntegerCompare({
					key: "number",
					compare: Compare.GreaterOrEqual,
					value: 0n,
				})
			) => {
				await waitForResolved(async () => {
					const req = new SearchRequest({
						query: [query],
						sort: [new Sort({ direction: SortDirection.ASC, key: "number" })],
					});
					const iterator = stores[fromStoreIndex].docs.index.iterate(req);

					if (batches.length === 0) {
						// No fetches has been made, so we don't know whether we are done yetß
						expect(iterator.done()).toBeFalse();
					} else {
						for (const batch of batches) {
							expect(iterator.done()).toBeFalse();
							const next = await iterator.next(batch.length);
							expect(next.map((x) => x.number)).toEqual(batch);
						}
						expect(iterator.done()).toBeTrue();
					}
				});
			};

			beforeAll(async () => {
				session = await LSession.connected(peersCount);
			});

			beforeEach(async () => {
				// Create store
				for (let i = 0; i < peersCount; i++) {
					const store =
						i > 0
							? (await TestStore.load<TestStore>(
									stores[0].address!,
									session.peers[i].services.blocks
							  ))!
							: new TestStore({
									docs: new Documents<Document>(),
							  });
					await store.setup({
						role: new Replicator(),
						minReplicas: 1, // make sure documents only exist once
					});
					store.docs.log.append = (a, b) => {
						return store.docs.log.log.append(a, b);
						// Omit synchronization so results are always the same
					};
					await store.open(session.peers[i]);
					stores.push(store);
				}
				// Wait for ack that everone can connect to each outher through the rpc topic
				for (let i = 0; i < session.peers.length; i++) {
					await stores[i].docs.waitFor(
						...session.peers.filter((_v, ix) => ix !== i).map((x) => x.peerId)
					);
				}
			});

			afterEach(async () => {
				await Promise.all(stores.map((x) => x.drop()));
				stores = [];
			});

			afterAll(async () => {
				await session.stop();
			});

			it("empty", async () => {
				for (let i = 0; i < session.peers.length; i++) {
					await checkIterate(i, []);
				}
			});

			// TODO make sure documents are evenly distrubted before querye
			it("one peer", async () => {
				await put(0, 0);
				await put(0, 1);
				await put(0, 2);
				expect(stores[0].docs.index.size).toEqual(3);
				for (let i = 0; i < session.peers.length; i++) {
					await checkIterate(i, [[0n], [1n], [2n]]);
					await checkIterate(i, [[0n, 1n, 2n]]);
					await checkIterate(i, [[0n, 1n], [2n]]);
					await checkIterate(i, [[0n], [1n, 2n]]);
				}
			});

			it("multiple peers", async () => {
				await put(0, 0);
				await put(0, 1);
				let e2 = await put(0, 2);
				await stores[1].docs.log.log.join([e2.entry]); // some overlap
				await put(1, 3);
				await put(1, 4);
				for (let i = 0; i < session.peers.length; i++) {
					await checkIterate(i, [[0n, 1n, 2n, 3n, 4n]]);
					await checkIterate(i, [[0n], [1n, 2n, 3n, 4n]]);
				}
			});

			it("deduplication on first entry", async () => {
				let e0 = await put(0, 0);
				await put(0, 1);
				await put(0, 2);
				await stores[1].docs.log.log.join([e0.entry]); // duplication on first entry
				await put(1, 3);
				await put(0, 4);
				await checkIterate(0, [
					[0n, 1n],
					[2n, 3n, 4n],
				]);
			});

			it("concurrently-multiple peers", async () => {
				let e0 = await put(0, 0);
				await put(0, 1);
				await put(0, 2);
				await stores[1].docs.log.log.join([e0.entry]);
				await put(1, 3);
				await put(0, 4);

				let promises: Promise<any>[] = [];
				for (let i = 0; i < 1; i++) {
					promises.push(checkIterate(i, [[0n, 1n, 2n, 3n, 4n]]));
					promises.push(checkIterate(i, [[0n], [1n, 2n, 3n, 4n]]));
					promises.push(
						checkIterate(i, [
							[0n, 1n],
							[2n, 3n, 4n],
						])
					);
					promises.push(
						checkIterate(i, [
							[0n, 1n, 2n],
							[3n, 4n],
						])
					);
					promises.push(checkIterate(i, [[0n, 1n, 2n, 3n], [4n]]));
				}
				await Promise.all(promises);
			});

			it("sorts by order", async () => {
				await put(0, 0);
				await put(0, 1);
				await put(0, 2);
				{
					const iterator = await stores[0].docs.index.iterate(
						new SearchRequest({
							query: [],
							sort: [new Sort({ direction: SortDirection.ASC, key: "name" })],
						})
					);
					expect(iterator.done()).toBeFalse();
					const next = await iterator.next(3);
					expect(next.map((x) => x.name)).toEqual(["0", "1", "2"]);
					expect(iterator.done()).toBeTrue();
				}
				{
					const iterator = await stores[0].docs.index.iterate(
						new SearchRequest({
							query: [],
							sort: [new Sort({ direction: SortDirection.DESC, key: "name" })],
						})
					);
					expect(iterator.done()).toBeFalse();
					const next = await iterator.next(3);
					expect(next.map((x) => x.name)).toEqual(["2", "1", "0"]);
					expect(iterator.done()).toBeTrue();
				}
			});

			it("strings", async () => {
				await put(0, 0);
				await put(0, 1);
				await put(0, 2);

				const iterator = await stores[0].docs.index.iterate(
					new SearchRequest({
						query: [],
						sort: [new Sort({ direction: SortDirection.ASC, key: "name" })],
					})
				);
				expect(iterator.done()).toBeFalse();
				const next = await iterator.next(3);
				expect(next.map((x) => x.name)).toEqual(["0", "1", "2"]);
				expect(iterator.done()).toBeTrue();
			});

			it("uses indexed fields", async () => {
				const KEY = "ABC";
				await stores[0].docs.index.setup({
					fields: async (obj) => {
						return { [KEY]: obj.number };
					},
					canRead: () => true,
					log: stores[0].docs.log,
					sync: () => undefined as any,
					type: Document,
					indexBy: ["id"],
				});

				await put(0, 0);
				await put(0, 1);
				await put(0, 2);

				const iterator = await stores[0].docs.index.iterate(
					new SearchRequest({
						query: [],
						sort: [new Sort({ direction: SortDirection.DESC, key: KEY })],
					}),
					{
						local: true,
						remote: false,
					}
				);
				const next = await iterator.next(3);
				expect(next.map((x) => x.name)).toEqual(["2", "1", "0"]);
				expect(iterator.done()).toBeTrue();
			});

			describe("close", () => {
				it("by invoking close()", async () => {
					await put(0, 0);
					await put(0, 1);
					await put(0, 2);
					const request = new SearchRequest({
						query: [],
					});
					const iterator = await stores[1].docs.index.iterate(request);
					expect(iterator.done()).toBeFalse();
					await iterator.next(2); // fetch some, but not all
					expect(
						stores[0].docs.index["_resultsCollectQueue"].get(request.idString)
					).toHaveLength(1);
					await iterator.close();
					await waitForResolved(
						() =>
							expect(
								stores[0].docs.index["_resultsCollectQueue"].get(
									request.idString
								)
							).toBeUndefined(),
						{ timeout: 3000, delayInterval: 50 }
					);
				});

				it("end of iterator", async () => {
					await put(0, 0);
					await put(0, 1);
					await put(0, 2);
					const request = new SearchRequest({
						query: [],
					});
					const iterator = await stores[1].docs.index.iterate(request);
					expect(iterator.done()).toBeFalse();
					await iterator.next(3); // fetch some, but not all
					await waitForResolved(
						() =>
							expect(
								stores[0].docs.index["_resultsCollectQueue"].get(
									request.idString
								)
							).toBeUndefined(),
						{ timeout: 3000, delayInterval: 50 }
					);
				});

				it("end of iterator, multiple nexts", async () => {
					await put(0, 0);
					await put(0, 1);
					await put(0, 2);
					const request = new SearchRequest({
						query: [],
					});
					const iterator = await stores[1].docs.index.iterate(request);
					await iterator.next(2);
					await iterator.next(1);
					expect(iterator.done()).toBeTrue();
					await waitForResolved(
						() =>
							expect(
								stores[0].docs.index["_resultsCollectQueue"].get(
									request.idString
								)
							).toBeUndefined(),
						{ timeout: 3000, delayInterval: 50 }
					);
				});
			});

			// TODO test iterator.close() to stop pending promises

			// TODO deletion while sort

			// TODO session timeouts?
		});
	});

	describe("program as value", () => {
		@variant("subprogram")
		class SubProgram extends Program {
			@field({ type: fixedArray("u8", 32) })
			id: Uint8Array;
			@field({ type: Log })
			log: Log<any>;

			constructor() {
				super();
				this.id = randomBytes(32);
				this.log = new Log();
			}
			async setup() {
				return this.log.setup();
			}
		}

		@variant("test_program_documents")
		class TestStoreSubPrograms extends Program {
			@field({ type: Documents })
			docs: Documents<SubProgram>;

			constructor(properties: { docs: Documents<SubProgram> }) {
				super();
				if (properties) {
					this.docs = properties.docs;
				}
			}
			async setup(options?: Partial<SetupOptions<SubProgram>>): Promise<void> {
				await this.docs.setup({
					...options,
					type: SubProgram,
					index: {
						key: ["id"],
					},
				});
			}
		}

		let stores: { store: TestStoreSubPrograms; openEvents: Program[] }[];
		let peersCount = 2;

		beforeAll(async () => {
			session = await LSession.connected(peersCount);
		});
		beforeEach(async () => {
			stores = [];

			// Create store
			for (let i = 0; i < peersCount; i++) {
				if (i > 0) {
					await session.peers[i].services.blocks.waitFor(
						session.peers[0].peerId
					);
				}
				const openEvents: Program[] = [];
				const store =
					i > 0
						? (await TestStoreSubPrograms.load<TestStoreSubPrograms>(
								stores[0].store.address!,
								session.peers[i].services.blocks
						  ))!
						: new TestStoreSubPrograms({
								docs: new Documents<SubProgram>(),
						  });

				await store.setup({
					role: i === 0 ? new Replicator() : new Observer(),
					canOpen: () => true,
				});
				await store.open(session.peers[i], {
					open: async (program) => {
						openEvents.push(program);
						program.closed = false;

						// we don't init, but in real use case we would init here
						return program;
					},
				});
				stores.push({ store, openEvents });
			}
		});
		afterEach(async () => {
			await Promise.all(stores.map((x) => x.store.close()));
		});

		afterAll(async () => {
			await session.stop();
		});

		it("can open a subprogram when put", async () => {
			const subProgram = new SubProgram();
			const _result = await stores[0].store.docs.put(subProgram); // open by default, why or why not? Yes because replicate = true
			expect(stores[0].openEvents).toHaveLength(1);
			expect(stores[0].openEvents[0]).toEqual(subProgram);
		});

		it("can put after open", async () => {
			const subProgram = new SubProgram();
			await subProgram.open(session.peers[0]);
			await stores[0].store.docs.put(subProgram); // open by default, why or why not? Yes because replicate = true
			expect(stores[0].openEvents).toHaveLength(1);
			expect(stores[0].openEvents[0]).toEqual(subProgram);
		});

		// TODO test can open after put (?)

		it("will close subprogram after put", async () => {
			const subProgram = new SubProgram();
			const _result = await stores[0].store.docs.put(subProgram); // open by default, why or why not? Yes because replicate = true
			expect(stores[0].openEvents).toHaveLength(1);
			expect(stores[0].openEvents[0]).toEqual(subProgram);
			await stores[0].store.close();
			expect(subProgram.closed).toBeTrue();
		});
		it("will not close subprogram that is opened before put", async () => {
			const subProgram = new SubProgram();
			await subProgram.open(session.peers[0]);
			const _result = await stores[0].store.docs.put(subProgram); // open by default, why or why not? Yes because replicate = true
			expect(stores[0].openEvents).toHaveLength(1);
			await stores[0].store.close();
			expect(subProgram.closed).toBeFalse();
			await subProgram.close();
			expect(subProgram.closed).toBeTrue();
		});

		it("non-replicator will not open by default", async () => {
			const subProgram = new SubProgram();
			const _result = await stores[1].store.docs.put(subProgram); // open by default, why or why not? Yes because replicate = true
			expect(stores[1].openEvents).toHaveLength(0);
		});

		it("can open program when sync", async () => {
			const subProgram = new SubProgram();
			const _result = await stores[1].store.docs.put(subProgram); // open by default, why or why not? Yes because replicate = true
			await stores[0].store.docs.log.log.join(
				await stores[1].store.docs.log.log.values.toArray()
			);
			expect(stores[0].openEvents).toHaveLength(1);
			expect(stores[1].openEvents).toHaveLength(0);
		});

		it("will close on delete", async () => {
			const subProgram = new SubProgram();
			const _result = await stores[0].store.docs.put(subProgram); // open by default, why or why not? Yes because replicate = true
			expect(stores[0].openEvents).toHaveLength(1);
			expect(stores[0].openEvents[0]).toEqual(subProgram);
			await stores[0].store.docs.del(subProgram.id);
			await waitFor(() => subProgram.closed);
		});

		it("can prevent subprograms to be opened", async () => {
			stores[0].store.docs.canOpen = (_) => Promise.resolve(false);
			const subProgram = new SubProgram();
			const _result = await stores[0].store.docs.put(subProgram); // open by default, why or why not? Yes because replicate = true
			subProgram.openedByPrograms = [undefined];
			expect(subProgram.closed).toBeTrue();
			subProgram["_closed"] = false;
			subProgram["_initialized"] = true;
			expect(subProgram.closed).toBeFalse();
			expect(stores[0].openEvents).toHaveLength(0);
			await stores[0].store.docs.del(subProgram.id);
			expect(subProgram.closed).toBeFalse();
		});
	});

	describe("query distribution", () => {
		describe("distribution", () => {
			let peersCount = 3,
				stores: TestStore[] = [];
			let counters: Array<number> = [];

			beforeAll(async () => {
				session = await LSession.connected(peersCount);
				// Create store
				for (let i = 0; i < peersCount; i++) {
					const store =
						i > 0
							? (await TestStore.load<TestStore>(
									stores[0].address!,
									session.peers[i].services.blocks
							  ))!
							: new TestStore({
									docs: new Documents<Document>(),
							  });
					await store.open(session.peers[i]);
					stores.push(store);
				}

				for (let i = 0; i < stores.length; i++) {
					const fn = stores[i].docs.index.processFetchRequest.bind(
						stores[i].docs.index
					);
					stores[i].docs.index.processFetchRequest = (a) => {
						counters[i] += 1;
						return fn(a);
					};
					await stores[i].docs.waitFor(
						...session.peers.filter((_v, ix) => ix !== i).map((x) => x.peerId)
					);
				}
			});

			beforeEach(() => {
				counters = new Array(stores.length).fill(0);
			});

			afterAll(async () => {
				await Promise.all(stores.map((x) => x.drop()));
				await session.stop();
			});

			/*  TODO query all if undefined?
			
			it("query all if undefined", async () => {
				stores[0].docs.log["_replication"].replicators = () => undefined;
				await stores[0].docs.index.search(new SearchRequest({ query: [] }), {
					remote: { amount: 2 },
				});
				expect(counters[0]).toEqual(1);
				expect(counters[1]).toEqual(1);
				expect(counters[2]).toEqual(1);
			}); */

			it("all", async () => {
				stores[0].docs.log.replicators = () => [
					[stores[1].node.identity.publicKey.hashcode()],
					[stores[2].node.identity.publicKey.hashcode()],
				];
				await stores[0].docs.index.search(new SearchRequest({ query: [] }));
				expect(counters[0]).toEqual(1);
				expect(counters[1]).toEqual(1);
				expect(counters[2]).toEqual(1);
			});

			it("will always query locally", async () => {
				stores[0].docs.log.replicators = () => [];
				await stores[0].docs.index.search(new SearchRequest({ query: [] }));
				expect(counters[0]).toEqual(1);
				expect(counters[1]).toEqual(0);
				expect(counters[2]).toEqual(0);
			});

			it("one", async () => {
				stores[0].docs.log.replicators = () => [
					[stores[1].node.identity.publicKey.hashcode()],
				];
				await stores[0].docs.index.search(new SearchRequest({ query: [] }));
				expect(counters[0]).toEqual(1);
				expect(counters[1]).toEqual(1);
				expect(counters[2]).toEqual(0);
			});

			it("non-local", async () => {
				stores[0].docs.log.replicators = () => [
					[stores[1].node.identity.publicKey.hashcode()],
					[stores[2].node.identity.publicKey.hashcode()],
				];
				await stores[0].docs.index.search(new SearchRequest({ query: [] }), {
					local: false,
				});
				expect(counters[0]).toEqual(0);
				expect(counters[1]).toEqual(1);
				expect(counters[2]).toEqual(1);
			});
			it("ignore shard if I am replicator", async () => {
				stores[0].docs.log.replicators = () => [
					[
						stores[0].node.identity.publicKey.hashcode(),
						stores[1].node.identity.publicKey.hashcode(),
					],
				];
				await stores[0].docs.index.search(new SearchRequest({ query: [] }));
				expect(counters[0]).toEqual(1);
				expect(counters[1]).toEqual(0);
				expect(counters[2]).toEqual(0);
			});

			describe("errors", () => {
				let fns: any[];

				beforeEach(() => {
					fns = stores.map((x) =>
						x.docs.index.processFetchRequest.bind(x.docs.index)
					);
				});

				afterEach(() => {
					stores.forEach((x, ix) => {
						x.docs.index.processFetchRequest = fns[ix];
					});
				});

				it("will iterate on shard until response", async () => {
					stores[0].docs.log.replicators = () => [
						[
							stores[1].node.identity.publicKey.hashcode(),
							stores[2].node.identity.publicKey.hashcode(),
						],
					];

					let failedOnce = false;
					for (let i = 1; i < stores.length; i++) {
						const fn = stores[i].docs.index.processFetchRequest.bind(
							stores[1].docs.index
						);
						stores[i].docs.index.processFetchRequest = (a) => {
							if (!failedOnce) {
								failedOnce = true;
								throw new Error("Expected error");
							}
							return fn(a);
						};
					}
					let timeout = 1000;
					await stores[0].docs.index.search(new SearchRequest({ query: [] }), {
						remote: { timeout },
					});
					expect(failedOnce).toBeTrue();
					expect(counters[0]).toEqual(1);
					expect(counters[1] + counters[2]).toEqual(1);
					expect(counters[1]).not.toEqual(counters[2]);
				});

				it("will fail silently if can not reach all shards", async () => {
					stores[0].docs.log.replicators = () => [
						[
							stores[1].node.identity.publicKey.hashcode(),
							stores[2].node.identity.publicKey.hashcode(),
						],
					];
					for (let i = 1; i < stores.length; i++) {
						stores[i].docs.index.processFetchRequest = (a) => {
							throw new Error("Expected error");
						};
					}

					let timeout = 1000;

					await stores[0].docs.index.search(new SearchRequest({ query: [] }), {
						remote: { timeout },
					});
					expect(counters[0]).toEqual(1);
					expect(counters[1]).toEqual(0);
					expect(counters[2]).toEqual(0);
				});
			});
		});
	});
});
