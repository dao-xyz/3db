import { Cache } from "@dao-xyz/cache";
import { Entry } from "./entry.js";
import { deserialize } from "@dao-xyz/borsh";
import { logger } from "./logger.js";
import { Blocks } from "@peerbit/blocks-interface";

export class EntryIndex<T> {
	_cache: Cache<Entry<T> | null>;
	_store: Blocks;
	_init: (entry: Entry<T>) => void;
	_index: Set<string>;

	constructor(properties: {
		store: Blocks;
		init: (entry: Entry<T>) => void;
		cache: Cache<Entry<T>>;
	}) {
		this._cache = properties.cache;
		this._store = properties.store;
		this._init = properties.init;
		this._index = new Set();
	}

	async set(v: Entry<T>, toMultihash = true) {
		if (toMultihash) {
			const existingHash = v.hash;
			v.hash = undefined as any;
			try {
				const hash = await Entry.toMultihash(this._store, v);
				v.hash = existingHash;
				if (v.hash === undefined) {
					v.hash = hash; // can happen if you sync entries that you load directly from ipfs
				} else if (existingHash !== v.hash) {
					logger.error("Head hash didn't match the contents");
					throw new Error("Head hash didn't match the contents");
				}
			} catch (error) {
				logger.error(error);
				throw error;
			}
		}
		this._cache.add(v.hash, v);
		this._index.add(v.hash);
	}

	async get(
		k: string,
		options?: { replicate?: boolean; timeout?: number }
	): Promise<Entry<T> | undefined> {
		if (this._index.has(k)) {
			let mem = this._cache.get(k);
			if (mem === undefined) {
				mem = await this.getFromStore(k, options);
				if (mem) {
					this._init(mem);
					mem.hash = k;
				}
				this._cache.add(k, mem);
			}
			return mem ? mem : undefined;
		}
		return undefined;
	}

	private async getFromStore(
		k: string,
		options?: { replicate?: boolean; timeout?: number }
	): Promise<Entry<T> | null> {
		const value = await this._store.get(k, options);
		return value ? deserialize(value, Entry) : null;
	}

	async delete(k: string) {
		this._cache.del(k);
		this._index.delete(k);
		return this._store.rm(k);
	}
}
