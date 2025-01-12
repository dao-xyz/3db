import { field, variant } from "@dao-xyz/borsh";
import { SearchRequest } from "@peerbit/document-interface";
import { Sort } from "@peerbit/indexer-interface";
import { Program } from "@peerbit/program";
import { TestSession } from "@peerbit/test-utils";
import { waitForResolved } from "@peerbit/time";
import { expect } from "chai";
import { v4 as uuid } from "uuid";
import {
	type CustomDocumentDomain,
	createDocumentDomainFromProperty,
} from "../src/domain.js";
import { Documents, type SetupOptions } from "../src/program.js";

class Document {
	@field({ type: "string" })
	id: string;

	@field({ type: "u32" })
	property: number;

	constructor(properties: { id?: string; property: number }) {
		this.id = properties.id || uuid();
		this.property = properties.property;
	}
}

@variant("StoreWithCustomDomain")
export class StoreWithCustomDomain extends Program {
	@field({ type: Documents })
	docs: Documents<Document, Document, CustomDocumentDomain<"u64">>;

	constructor(properties?: {
		docs?: Documents<Document, Document, CustomDocumentDomain<"u64">>;
	}) {
		super();
		this.docs =
			properties?.docs ||
			new Documents<Document, Document, CustomDocumentDomain<"u64">>();
	}

	async open(
		args?: Partial<
			SetupOptions<Document, Document, CustomDocumentDomain<"u64">>
		>,
	): Promise<void> {
		return this.docs.open({
			...(args || {}),
			domain: createDocumentDomainFromProperty({
				resolution: "u64",
				property: "property",
			}),
			type: Document,
		});
	}
}

describe("domain", () => {
	let session: TestSession;
	let store: StoreWithCustomDomain, store2: StoreWithCustomDomain;

	before(async () => {
		session = await TestSession.connected(2);
	});

	after(async () => {
		await session.stop();
	});

	beforeEach(async () => {
		store = await session.peers[0].open(new StoreWithCustomDomain(), {
			args: {
				replicate: {
					normalized: false,
					factor: 1,
					offset: 1,
					strict: true,
				},
			},
		});
		store2 = await session.peers[1].open(store.clone(), {
			args: {
				replicate: {
					normalized: false,
					offset: 2,
					factor: 2,
					strict: true,
				},
			},
		});

		await store.docs.put(new Document({ id: "1", property: 1 }));
		await store2.docs.put(new Document({ id: "2", property: 2 }));
		await store2.docs.put(new Document({ id: "3", property: 3 }));

		await waitForResolved(async () => {
			expect(await store.docs.index.getSize()).to.equal(1);
			expect(await store2.docs.index.getSize()).to.equal(2);
		});

		await store.docs.log.waitForReplicator(store2.docs.node.identity.publicKey);
		await store2.docs.log.waitForReplicator(store.docs.node.identity.publicKey);
	});

	afterEach(async () => {
		await store.close();
		await store2.close();
	});

	it("custom domain", async () => {
		// test querying with the same domain but different peers and assert results are correct
		const resultsWithRemoteRightDomain = await store.docs.index.search(
			new SearchRequest(),
			{
				remote: {
					domain: {
						from: 2n,
						to: 3n,
					},
					eager: true,
				},
			},
		);

		expect(resultsWithRemoteRightDomain).to.have.length(3);

		const resultsWhenRemoteDoesNotHaveRightDomain =
			await store.docs.index.search(new SearchRequest(), {
				remote: {
					domain: {
						from: 4n,
						to: 5n,
					},
				},
			});

		expect(resultsWhenRemoteDoesNotHaveRightDomain).to.have.length(1); // only the loal result
		expect(resultsWhenRemoteDoesNotHaveRightDomain[0].id).to.equal("1");
	});

	it("will join with multiple segments when not sorting by mergeable property", async () => {
		expect(
			(await store.docs.log.getMyReplicationSegments()).map((x) =>
				[x.start1, x.end1].map(Number),
			),
		).to.deep.equal([[1, 2]]);
		const resultsWithRemoteRightDomain = await store.docs.index.search(
			new SearchRequest(),
			{
				remote: {
					domain: {
						from: 0n,
						to: 5n,
					},
					eager: true,
					replicate: true,
				},
			},
		);

		expect(resultsWithRemoteRightDomain).to.have.length(3);
		expect(
			(await store.docs.log.getMyReplicationSegments()).map((x) =>
				[x.start1, x.end1].map(Number),
			),
		).to.deep.equal([
			[1, 2],
			[2, 3],
			[3, 4],
		]);
	});

	it("will join by separate segments when not sorting by non mergeable property", async () => {
		expect(
			(await store.docs.log.getMyReplicationSegments()).map((x) =>
				[x.start1, x.end1].map(Number),
			),
		).to.deep.equal([[1, 2]]);
		const resultsWithRemoteRightDomain = await store.docs.index.search(
			new SearchRequest({ sort: [new Sort({ key: ["property"] })] }),
			{
				remote: {
					domain: {
						from: 0n,
						to: 5n,
					},
					eager: true,
					replicate: true,
				},
			},
		);

		expect(resultsWithRemoteRightDomain).to.have.length(3);
		expect(
			(await store.docs.log.getMyReplicationSegments()).map((x) =>
				[x.start1, x.end1].map(Number),
			),
		).to.deep.equal([
			[1, 2],
			[2, 4],
		]);
	});
});
