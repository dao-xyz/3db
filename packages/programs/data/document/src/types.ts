import { field, variant } from "@dao-xyz/borsh";
import { toBase64 } from "@peerbit/crypto";
import {
	decodeUint8Array,
	encodeUint8Array,
	encodingLength
} from "uint8-varint";

export abstract class PrimitiveValue {}

@variant(0)
export class StringValue extends PrimitiveValue {
	@field({ type: "string" })
	string: string;

	constructor(string: string) {
		super();
		this.string = string;
	}
}

@variant(1)
export abstract class NumberValue extends PrimitiveValue {
	abstract get value(): number | bigint;
}

@variant(0)
export abstract class IntegerValue extends NumberValue {}

@variant(0)
export class UnsignedIntegerValue extends IntegerValue {
	@field({ type: "u32" })
	number: number;

	constructor(number: number) {
		super();
		if (
			Number.isInteger(number) === false ||
			number > 4294967295 ||
			number < 0
		) {
			throw new Error("Number is not u32");
		}
		this.number = number;
	}

	get value() {
		return this.number;
	}
}

@variant(1)
export class BigUnsignedIntegerValue extends IntegerValue {
	@field({ type: "u64" })
	number: bigint;

	constructor(number: bigint) {
		super();
		if (number > 18446744073709551615n || number < 0) {
			throw new Error("Number is not u32");
		}
		this.number = number;
	}
	get value() {
		return this.number;
	}
}

export type IndexKeyPrimitiveType = string | number | bigint;

export abstract class IndexKey {
	abstract get indexKey(): IndexKeyPrimitiveType;
}

@variant(0)
export class StringKey extends IndexKey {
	@field({ type: "string" })
	key: string;

	constructor(key: string) {
		super();
		this.key = key;
	}
	get indexKey() {
		return this.key;
	}
}

@variant(1)
export class Uint8ArrayKey extends IndexKey {
	@field({ type: Uint8Array })
	key: Uint8Array;

	constructor(key: Uint8Array) {
		super();
		this.key = key;
	}

	private _keyString: string;
	get indexKey(): string {
		return this._keyString || (this._keyString = toBase64(this.key));
	}
}

const varint53 = {
	deserialize: (reader) => {
		const number = decodeUint8Array(reader._buf, reader._offset);
		const len = encodingLength(number);
		reader._offset += len;
		return number;
	},
	serialize: (value, writer) => {
		const offset = writer.totalSize;
		writer["_writes"] = writer["_writes"].next = () =>
			encodeUint8Array(value, writer["_buf"], offset);
		writer.totalSize += encodingLength(value);
	}
};
@variant(2)
export class IntegerKey extends IndexKey {
	@field(varint53) // max value is 2^53 - 1 (9007199254740991)
	private key: number;

	constructor(key: number) {
		super();
		this.key = key;
	}

	get indexKey() {
		return this.key;
	}
}

export type Keyable = string | number | bigint | Uint8Array;

const idKeyTypes = new Set(["string", "number", "bigint"]);

export const asKey = (obj: Keyable): IndexKey => {
	if (typeof obj === "string") {
		return new StringKey(obj);
	}
	if (typeof obj === "number") {
		return new IntegerKey(obj);
	}
	if (typeof obj === "bigint") {
		if (obj <= Number.MAX_SAFE_INTEGER && obj >= 0) {
			return new IntegerKey(Number(obj));
		}
		throw new Error(
			"BigInt is not less than 2^53. Max value is 9007199254740991"
		);
	}
	if (obj instanceof Uint8Array) {
		return new Uint8ArrayKey(obj);
	}
	throw new Error(
		"Unexpected index key: " +
			typeof obj +
			", expected: string, number, bigint or Uint8Array"
	);
};

export const keyAsIndexable = (
	key: IndexKey | Keyable
): string | number | bigint => {
	if (key instanceof IndexKey) {
		return key.indexKey;
	}

	if (typeof key === "string") {
		return key;
	}

	if (typeof key === "number") {
		return key;
	}

	if (typeof key === "bigint") {
		return key;
	}

	if (key instanceof Uint8Array) {
		return toBase64(key);
	}

	throw new Error("Unexpected index key: " + typeof key);
};

export const checkKeyable = (obj: Keyable) => {
	if (obj == null) {
		throw new Error(
			`The provided key value is null or undefined, expecting string, number, bigint, or Uint8array`
		);
	}
	const type = typeof obj;

	if (type === "number") {
		if (Number.isInteger(obj) === false) {
			throw new Error(`The provided key number value is not an integer`);
		}
	}

	if (idKeyTypes.has(type) || obj instanceof Uint8Array) {
		return;
	}

	throw new Error(
		`Key is not ${[...idKeyTypes]}, provided key value type: ${typeof obj}`
	);
};
