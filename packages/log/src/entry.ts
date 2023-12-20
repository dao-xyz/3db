import { HLC, LamportClock as Clock, Timestamp } from "./clock.js";
import {
	variant,
	field,
	serialize,
	deserialize,
	option,
	vec,
	fixedArray
} from "@dao-xyz/borsh";

import {
	DecryptedThing,
	MaybeEncrypted,
	PublicSignKey,
	X25519PublicKey,
	SignatureWithKey,
	AccessError,
	Ed25519PublicKey,
	sha256Base64,
	randomBytes,
	Identity,
	X25519Keypair
} from "@peerbit/crypto";
import { verify } from "@peerbit/crypto";
import { compare, equals } from "@peerbit/uint8arrays";
import { Encoding, NO_ENCODING } from "./encoding.js";
import { logger } from "./logger.js";
import { Blocks } from "@peerbit/blocks-interface";
import { Keychain } from "@peerbit/keychain";
export type MaybeEncryptionPublicKey =
	| X25519PublicKey
	| X25519PublicKey[]
	| Ed25519PublicKey
	| Ed25519PublicKey[]
	| undefined;

const isMaybeEryptionPublicKey = (o: any) => {
	if (!o) {
		return true;
	}
	if (o instanceof X25519PublicKey || o instanceof Ed25519PublicKey) {
		return true;
	}
	if (Array.isArray(o)) {
		return true; // assume entries are either X25519PublicKey or Ed25519PublicKey
	}
	return false;
};

export type EncryptionTemplateMaybeEncrypted = EntryEncryptionTemplate<
	MaybeEncryptionPublicKey,
	MaybeEncryptionPublicKey,
	MaybeEncryptionPublicKey | { [key: string]: MaybeEncryptionPublicKey } // signature either all signature encrypted by same key, or each individually
>;
export interface EntryEncryption {
	receiver: EncryptionTemplateMaybeEncrypted;
	keypair: X25519Keypair;
}

function arrayToHex(arr: Uint8Array): string {
	return [...new Uint8Array(arr)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export function toBufferLE(num: bigint, width: number): Uint8Array {
	const hex = num.toString(16);
	const padded = hex.padStart(width * 2, "0").slice(0, width * 2);
	const arr = padded.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16));
	if (!arr) {
		throw new Error("Unexpected");
	}
	const buffer = Uint8Array.from(arr);
	buffer.reverse();
	return buffer;
}

export function toBigIntLE(buf: Uint8Array): bigint {
	const reversed = buf.reverse();
	const hex = arrayToHex(reversed);
	if (hex.length === 0) {
		return BigInt(0);
	}
	return BigInt(`0x${hex}`);
}

export type CanAppend<T> = (canAppend: Entry<T>) => Promise<boolean> | boolean;

@variant(0)
export class Payload<T> {
	@field({ type: Uint8Array })
	data: Uint8Array;

	encoding: Encoding<T>;

	private _value?: T;

	constructor(props: { data: Uint8Array; value?: T; encoding: Encoding<T> }) {
		this.data = props.data;
		this._value = props.value;
		this.encoding = props?.encoding;
	}

	equals(other: Payload<T>): boolean {
		return equals(this.data, other.data);
	}

	get isDecoded(): boolean {
		return this._value != null;
	}

	get value(): T {
		if (this._value == null) {
			throw new Error("Value not decoded. Invoke: .getValue once");
		}
		return this._value;
	}
	getValue(encoding: Encoding<T> = this.encoding || NO_ENCODING): T {
		if (this._value != undefined) {
			return this._value;
		}
		return encoding.decoder(this.data);
	}
}

export interface EntryEncryptionTemplate<A, B, C> {
	meta: A;
	payload: B;
	signatures: C;
}

export enum EntryType {
	APPEND = 0, // Add more data
	CUT = 1 // Delete or Create tombstone ... delete all nexts, i
}

@variant(0)
export class Meta {
	@field({ type: Clock })
	clock: Clock;

	@field({ type: "string" })
	gid: string; // graph id

	@field({ type: vec("string") })
	next: string[];

	@field({ type: "u8" })
	type: EntryType;

	@field({ type: option(Uint8Array) })
	data?: Uint8Array; // Optional metadata

	constructor(properties?: {
		gid: string;
		clock: Clock;
		type: EntryType;
		data?: Uint8Array;
		next: string[];
	}) {
		if (properties) {
			this.gid = properties.gid;
			this.clock = properties.clock;
			this.type = properties.type;
			this.data = properties.data;
			this.next = properties.next;
		}
	}
}

@variant(0)
export class Signatures {
	@field({ type: vec(MaybeEncrypted) })
	signatures: MaybeEncrypted<SignatureWithKey>[];

	constructor(properties?: { signatures: MaybeEncrypted<SignatureWithKey>[] }) {
		if (properties) {
			this.signatures = properties.signatures;
		}
	}

	equals(other: Signatures) {
		if (this.signatures.length !== other.signatures.length) {
			return false;
		}
		for (let i = 0; i < this.signatures.length; i++) {
			if (!this.signatures[i].equals(other.signatures[i])) {
				return false;
			}
		}
		return true;
	}
}

const maybeEncrypt = <Q>(
	thing: Q,
	keypair?: X25519Keypair,
	receiver?: MaybeEncryptionPublicKey
): Promise<MaybeEncrypted<Q>> | MaybeEncrypted<Q> => {
	const receivers = receiver
		? Array.isArray(receiver)
			? receiver
			: [receiver]
		: undefined;
	if (receivers?.length && receivers?.length > 0) {
		if (!keypair) {
			throw new Error("Keypair not provided");
		}
		return new DecryptedThing<Q>({
			data: serialize(thing),
			value: thing
		}).encrypt(keypair, receivers);
	}
	return new DecryptedThing<Q>({
		data: serialize(thing),
		value: thing
	});
};

export interface ShallowEntry {
	hash: string;
	meta: {
		clock: Clock;
		data?: Uint8Array;
		gid: string;
		next: string[];
		type: EntryType;
	};
	payloadByteLength: number;
}

@variant(0)
export class Entry<T>
	implements EntryEncryptionTemplate<Meta, Payload<T>, SignatureWithKey[]>
{
	@field({ type: MaybeEncrypted })
	_meta: MaybeEncrypted<Meta>;

	@field({ type: MaybeEncrypted })
	_payload: MaybeEncrypted<Payload<T>>;

	@field({ type: fixedArray("u8", 4) })
	_reserved?: Uint8Array;

	@field({ type: option(Signatures) })
	_signatures?: Signatures;

	@field({ type: option("string") }) // we do option because we serialize and store this in a block without the hash, to receive the hash, which we later set
	hash: string; // "zd...Foo", we'll set the hash after persisting the entry

	createdLocally?: boolean;

	private _keychain?: Keychain;
	private _encoding?: Encoding<T>;

	constructor(obj: {
		payload: MaybeEncrypted<Payload<T>>;
		signatures?: Signatures;
		meta: MaybeEncrypted<Meta>;
		reserved?: Uint8Array; // intentational type 0  (not used)h
		hash?: string;
		createdLocally?: boolean;
	}) {
		this._meta = obj.meta;
		this._payload = obj.payload;
		this._signatures = obj.signatures;
		this._reserved = new Uint8Array([0, 0, 0, 0]);
		this.createdLocally = obj.createdLocally;
	}

	init(
		props:
			| {
					keychain?: Keychain;
					encoding: Encoding<T>;
			  }
			| Entry<T>
	): Entry<T> {
		if (props instanceof Entry) {
			this._keychain = props._keychain;
			this._encoding = props._encoding;
		} else {
			this._keychain = props.keychain;
			this._encoding = props.encoding;
		}
		return this;
	}

	get encoding() {
		if (!this._encoding) {
			throw new Error("Not initialized");
		}
		return this._encoding;
	}

	get meta(): Meta {
		return this._meta.decrypted.getValue(Meta);
	}

	async getMeta(): Promise<Meta> {
		await this._meta.decrypt(this._keychain);
		return this.meta;
	}

	async getClock(): Promise<Clock> {
		return (await this.getMeta()).clock;
	}

	get gid(): string {
		return this._meta.decrypted.getValue(Meta).gid;
	}

	async getGid(): Promise<string> {
		return (await this.getMeta()).gid;
	}

	get payload(): Payload<T> {
		const payload = this._payload.decrypted.getValue(Payload);
		payload.encoding = payload.encoding || this.encoding;
		return payload;
	}

	async getPayload(): Promise<Payload<T>> {
		if (this._payload instanceof DecryptedThing) {
			return this.payload;
		}

		await this._payload.decrypt(this._keychain);
		return this.payload;
	}

	async getPayloadValue(): Promise<T> {
		const payload = await this.getPayload();
		return payload.isDecoded ? payload.value : payload.getValue(this.encoding);
	}

	get publicKeys(): PublicSignKey[] {
		return this.signatures.map((x) => x.publicKey);
	}

	async getPublicKeys(): Promise<PublicSignKey[]> {
		await this.getSignatures();
		return this.publicKeys;
	}

	get next(): string[] {
		return this.meta.next;
	}

	async getNext(): Promise<string[]> {
		return (await this.getMeta()).next;
	}

	/**
	 * Will only return signatures I can decrypt
	 * @returns signatures
	 */
	get signatures(): SignatureWithKey[] {
		const signatures = this._signatures!.signatures.filter((x) => {
			try {
				x.decrypted;
				return true;
			} catch (error) {
				return false;
			}
		}).map((x) => x.decrypted.getValue(SignatureWithKey));
		if (signatures.length === 0) {
			this._signatures?.signatures.forEach((x) => x.clear());
			throw new Error("Failed to resolve any signature");
		}
		return signatures;
	}
	/**
	 * Will only return signatures I can decrypt
	 * @returns signatures
	 */
	async getSignatures(): Promise<SignatureWithKey[]> {
		const results = await Promise.allSettled(
			this._signatures!.signatures.map((x) => x.decrypt(this._keychain))
		);

		if (logger.level === "debug" || logger.level === "trace") {
			for (const [i, result] of results.entries()) {
				if (result.status === "rejected") {
					logger.debug("Failed to decrypt signature with index: " + i);
				}
			}
		}
		return this.signatures;
	}

	/**
	 * Will only verify signatures I can decrypt
	 * @returns true if all are verified
	 */
	async verifySignatures(): Promise<boolean> {
		const signatures = await this.getSignatures();

		if (signatures.length === 0) {
			return false;
		}

		for (const signature of signatures) {
			if (!(await verify(signature, Entry.toSignable(this)))) {
				return false;
			}
		}
		return true;
	}

	static toSignable(entry: Entry<any>): Uint8Array {
		// TODO fix types
		const trimmed = new Entry({
			meta: entry._meta,
			payload: entry._payload,
			reserved: entry._reserved,
			signatures: undefined,
			hash: undefined
		});
		return serialize(trimmed);
	}

	toSignable(): Uint8Array {
		if (this._signatures) {
			throw new Error("Expected signatures to be undefined");
		}

		if (this.hash) {
			throw new Error("Expected hash to be undefined");
		}
		return Entry.toSignable(this);
	}

	equals(other: Entry<T>) {
		return (
			equals(this._reserved, other._reserved) &&
			this._meta.equals(other._meta) &&
			this._signatures!.equals(other._signatures!) &&
			this._payload.equals(other._payload)
		); // dont compare hashes because the hash is a function of the other properties
	}

	async delete(store: Blocks): Promise<void> {
		if (!this.hash) {
			throw new Error("Missing hash");
		}
		await store.rm(this.hash);
	}

	static createGid(seed?: Uint8Array): Promise<string> {
		return sha256Base64(seed || randomBytes(32));
	}

	static async create<T>(properties: {
		store: Blocks;
		data: T;
		meta?: {
			clock?: Clock;
			gid?: string;
			type?: EntryType;
			gidSeed?: Uint8Array;
			data?: Uint8Array;
			next?: Entry<T>[];
		};
		encoding?: Encoding<T>;
		canAppend?: CanAppend<T>;
		encryption?: EntryEncryption;
		identity: Identity;
		signers?: ((
			data: Uint8Array
		) => Promise<SignatureWithKey> | SignatureWithKey)[];
	}): Promise<Entry<T>> {
		if (!properties.encoding || !properties?.meta?.next) {
			properties = {
				...properties,
				meta: {
					...properties?.meta,
					next: properties.meta?.next ? properties.meta?.next : []
				},
				encoding: properties.encoding ? properties.encoding : NO_ENCODING
			};
		}

		if (!properties.encoding) {
			throw new Error("Missing encoding options");
		}

		if (properties.data == null) throw new Error("Entry requires data");
		if (properties.meta?.next == null || !Array.isArray(properties.meta.next))
			throw new Error("'next' argument is not an array");

		// Clean the next objects and convert to hashes
		const nexts = properties.meta?.next;

		const payloadToSave = new Payload<T>({
			data: properties.encoding.encoder(properties.data),
			value: properties.data,
			encoding: properties.encoding
		});

		let clock: Clock | undefined = properties.meta?.clock;
		if (!clock) {
			const hlc = new HLC();
			for (const next of nexts) {
				hlc.update(next.meta.clock.timestamp);
			}

			if (
				properties.encryption?.receiver.signatures &&
				properties.encryption?.receiver.meta
			) {
				throw new Error(
					"Signature is to be encrypted yet the clock is not, which contains the publicKey as id. Either provide a custom Clock value that is not sensitive or set the receiver (encryption target) for the clock"
				);
			}
			clock = new Clock({
				id: properties.identity.publicKey.bytes,
				timestamp: hlc.now()
			});
		} else {
			const cv = clock;
			// check if nexts, that all nexts are happening BEFORE this clock value (else clock make no sense)
			for (const n of nexts) {
				if (Timestamp.compare(n.meta.clock.timestamp, cv.timestamp) >= 0) {
					throw new Error(
						"Expecting next(s) to happen before entry, got: " +
							n.meta.clock.timestamp +
							" > " +
							cv.timestamp
					);
				}
			}
		}

		const payload = await maybeEncrypt(
			payloadToSave,
			properties.encryption?.keypair,
			properties.encryption?.receiver.payload
		);

		const nextHashes: string[] = [];
		let maxChainLength = 0n;
		let gid: string | null = null;
		if (nexts?.length > 0) {
			// take min gid as our gid
			if (properties.meta?.gid) {
				throw new Error(
					"Expecting '.meta.gid' property to be undefined if '.meta.next' is provided"
				);
			}
			for (const n of nexts) {
				if (!n.hash) {
					throw new Error("Expecting hash to be defined to next entries");
				}
				nextHashes.push(n.hash);
				gid =
					gid == null
						? n.meta.gid
						: n.meta.gid < (gid as string)
							? n.meta.gid
							: gid;
			}
		} else {
			gid =
				properties.meta?.gid ||
				(await Entry.createGid(properties.meta?.gidSeed));
		}

		maxChainLength += 1n; // include this

		const metadataEncrypted = await maybeEncrypt(
			new Meta({
				clock,
				gid: gid!,
				type: properties.meta?.type ?? EntryType.APPEND,
				data: properties.meta?.data,
				next: nextHashes
			}),
			properties.encryption?.keypair,
			properties.encryption?.receiver.meta
		);

		// Sign id, encrypted payload, clock, nexts, refs
		const entry: Entry<T> = new Entry<T>({
			payload,
			meta: metadataEncrypted,
			signatures: undefined,
			createdLocally: true
		});

		const signers = properties.signers || [
			properties.identity.sign.bind(properties.identity)
		];
		const signable = entry.toSignable();
		let signatures = await Promise.all(
			signers.map((signer) => signer(signable))
		);
		signatures = signatures.sort((a, b) => compare(a.signature, b.signature));

		const encryptedSignatures: MaybeEncrypted<SignatureWithKey>[] = [];
		const encryptAllSignaturesWithSameKey = isMaybeEryptionPublicKey(
			properties.encryption?.receiver?.signatures
		);

		for (const signature of signatures) {
			const encryptionRecievers = encryptAllSignaturesWithSameKey
				? properties.encryption?.receiver?.signatures
				: properties.encryption?.receiver?.signatures?.[
						signature.publicKey.hashcode()
					];
			const signatureEncrypted = await maybeEncrypt(
				signature,
				properties.encryption?.keypair,
				encryptionRecievers
			);
			encryptedSignatures.push(signatureEncrypted);
		}

		entry._signatures = new Signatures({
			signatures: encryptedSignatures
		});

		if (properties.canAppend && !(await properties.canAppend(entry))) {
			throw new AccessError();
		}

		// Append hash and signature
		entry.hash = await Entry.toMultihash(properties.store, entry);

		entry.init({ encoding: properties.encoding });

		return entry;
	}

	get payloadByteLength() {
		return this._payload.byteLength;
	}

	toShallow(): ShallowEntry {
		return {
			hash: this.hash,
			payloadByteLength: this._payload.byteLength,
			meta: {
				gid: this.meta.gid,
				data: this.meta.data,
				clock: this.meta.clock,
				next: this.meta.next,
				type: this.meta.type
			}
		};
	}

	/**
	 * Get the multihash of an Entry.
	 * @example
	 * const multfihash = await Entry.toMultihash(store, entry)
	 * console.log(multihash)
	 * // "Qm...Foo"
	 */
	static async toMultihash<T>(store: Blocks, entry: Entry<T>): Promise<string> {
		if (entry.hash) {
			throw new Error("Expected hash to be missing");
		}

		const result = store.put(serialize(entry));
		return result;
	}

	/**
	 * Create an Entry from a hash.
	 * @example
	 * const entry = await Entry.fromMultihash(store, "zd...Foo")
	 * console.log(entry)
	 * // { hash: "Zd...Foo", payload: "hello", next: [] }
	 */
	static async fromMultihash<T>(
		store: Blocks,
		hash: string,
		options?: { timeout?: number; replicate?: boolean }
	) {
		if (!hash) throw new Error(`Invalid hash: ${hash}`);
		const bytes = await store.get(hash, options);
		if (!bytes) {
			throw new Error("Failed to resolve block: " + hash);
		}
		const entry = deserialize(bytes, Entry);
		entry.hash = hash;
		return entry as Entry<T>;
	}

	/**
	 * Compares two entries.
	 * @param {Entry} a
	 * @param {Entry} b
	 * @returns {number} 1 if a is greater, -1 is b is greater
	 */
	static compare<T>(a: Entry<T>, b: Entry<T>) {
		const aClock = a.meta.clock;
		const bClock = b.meta.clock;
		const distance = Clock.compare(aClock, bClock);
		if (distance === 0) return aClock.id < bClock.id ? -1 : 1;
		return distance;
	}

	/**
	 * Check if an entry equals another entry.
	 * @param {Entry} a
	 * @param {Entry} b
	 * @returns {boolean}
	 */
	static isEqual<T>(a: Entry<T>, b: Entry<T>) {
		return a.hash === b.hash;
	}

	/**
	 * Check if an entry is a parent to another entry.
	 * @param {Entry} entry1 Entry to check
	 * @param {Entry} entry2 The parent Entry
	 * @returns {boolean}
	 */
	static isDirectParent<T>(entry1: Entry<T>, entry2: Entry<T>) {
		return entry2.next.indexOf(entry1.hash as any) > -1; // TODO fix types
	}

	/**
	 * Find entry's children from an Array of entries.
	 * Returns entry's children as an Array up to the last know child.
	 * @param {Entry} entry Entry for which to find the parents
	 * @param {Array<Entry<T>>} values Entries to search parents from
	 * @returns {Array<Entry<T>>}
	 */
	static findDirectChildren<T>(
		entry: Entry<T>,
		values: Entry<T>[]
	): Entry<T>[] {
		let stack: Entry<T>[] = [];
		let parent = values.find((e) => Entry.isDirectParent(entry, e));
		let prev = entry;
		while (parent) {
			stack.push(parent);
			prev = parent;
			parent = values.find((e) => Entry.isDirectParent(prev, e));
		}
		stack = stack.sort((a, b) => Clock.compare(a.meta.clock, b.meta.clock));
		return stack;
	}
}
