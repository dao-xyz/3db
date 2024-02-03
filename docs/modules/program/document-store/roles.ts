/// [imports]
import { field, variant, option } from "@dao-xyz/borsh";
import { Program } from "@peerbit/program";
import { Peerbit } from "peerbit";
import { v4 as uuid } from "uuid";

import { Documents, RoleOptions } from "@peerbit/document";
import { sha256Sync } from "@peerbit/crypto";

@variant(0) // version 0
export class Post {
	@field({ type: "string" })
	id: string;

	@field({ type: "string" })
	message: string;
	constructor(message: string) {
		this.id = uuid();
		this.message = message;
	}
}

/// [definition]
type ChannelArgs = { role?: RoleOptions };
@variant("channel")
export class Channel extends Program<ChannelArgs> {
	// Documents<?> provide document store functionality around posts

	@field({ type: Documents })
	posts: Documents<Post>;

	constructor() {
		super();
		this.posts = new Documents({
			id: sha256Sync(new TextEncoder().encode("posts"))
		});
	}

	async open(properties?: ChannelArgs): Promise<void> {
		await this.posts.open({
			type: Post,
			role: properties?.role
		});
	}
}
/// [definition]

const peer = await Peerbit.create();

/// [set-role]

// Given the Channel class definition where we have a role argument,
// we can pass a role when opening
const channel = await peer.open(new Channel(), {
	args: {
		role: {
			type: "replicator" // by default
		}
	}
});

// If we choose a replication factor of 1,
// then all entries will be synced to our database
// this can be useful for real-time applications, like games
await channel.posts.updateRole({
	type: "replicator", // by default,
	factor: 1
});

// We can choose to limit our role depending on how much storage
// or CPU we want to use
await channel.posts.updateRole({
	type: "replicator", // by default,
	limits: {
		cpu: {
			max: 0.5 // try to stay below 50% utilization
		},
		storage: 1e8 // only use 100mb at most
	}
});

// Or we can become observers and just be able to perform searches
await channel.posts.updateRole({
	type: "observer"
});
/// [set-role]

await peer.stop();
