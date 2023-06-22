import B from "benchmark";
import { field, option, variant } from "@dao-xyz/borsh";
import { Documents, SetupOptions } from "../document-store.js";
import { LSession, createStore } from "@peerbit/test-utils";
import { X25519Keypair, X25519PublicKey } from "@peerbit/crypto";
import Cache from "@dao-xyz/lazy-level";
import { AbstractLevel } from "abstract-level";
import { Program } from "@peerbit/program";
import { DocumentIndex } from "../document-index.js";
import { v4 as uuid } from "uuid";
import crypto from "crypto";
import { Replicator } from "@peerbit/shared-log";
import { Peerbit } from "@peerbit/interface";

// Run with "node --loader ts-node/esm ./src/__benchmark__/index.ts"
// put x 9,522 ops/sec ±4.61% (76 runs sampled) (prev merge store with log: put x 11,527 ops/sec ±6.09% (75 runs sampled))

@variant("document")
class Document {
	@field({ type: "string" })
	id: string;

	@field({ type: option("string") })
	name?: string;

	@field({ type: option("u64") })
	number?: bigint;

	@field({ type: Uint8Array })
	bytes: Uint8Array;

	constructor(opts: Document) {
		if (opts) {
			this.id = opts.id;
			this.name = opts.name;
			this.number = opts.number;
			this.bytes = opts.bytes;
		}
	}
}

@variant("test_documents")
class TestStore extends Program {
	@field({ type: Documents })
	docs: Documents<Document>;

	constructor(properties?: { docs: Documents<Document> }) {
		super();
		if (properties) {
			this.docs = properties.docs;
		}
	}
	async setup(options?: Partial<SetupOptions<Document>>): Promise<void> {
		await this.docs.setup({ ...options, type: Document, index: { key: "id" } });
	}
}

const cacheStores: AbstractLevel<any, string, Uint8Array>[] = [];
const peersCount = 1;
const session = await LSession.connected(peersCount);

for (let i = 0; i < peersCount; i++) {
	cacheStores.push(await createStore());
}

// Create store
const store = new TestStore({
	docs: new Documents<Document>({
		index: new DocumentIndex(),
	}),
});
const keypair = await X25519Keypair.create();

await store.setup({
	role: new Replicator(),
	trim: { type: "length", to: 100 },
});
const cache = new Cache(cacheStores[0], { batch: { interval: 100 } });
const client: Peerbit = {
	...session.peers[0],
	memory: cache,
};

await store.open(client);
await store.setup();

const resolver: Map<string, () => void> = new Map();
store.docs.events.addEventListener("change", (change) => {
	change.detail.added.forEach((doc) => {
		resolver.get(doc.id)!();
		resolver.delete(doc.id);
	});
});

const suite = new B.Suite();
suite
	.add("put", {
		fn: async (deferred) => {
			const doc = new Document({
				id: uuid(),
				name: "hello",
				number: 1n,
				bytes: crypto.randomBytes(1200),
			});
			resolver.set(doc.id, () => {
				deferred.resolve();
			});
			await store.docs.put(doc, { unique: true });
		},

		defer: true,
	})
	.on("cycle", (event: any) => {
		console.log(String(event.target));
	})
	.on("error", (err) => {
		throw err;
	})
	.on("complete", async function (this: any, ...args: any[]) {
		await store.drop();
		await session.stop();
		await cache.close();
	})
	.run();
