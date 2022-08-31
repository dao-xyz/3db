import { Constructor, field, option, variant, vec } from "@dao-xyz/borsh";
import { MultipleQueriesType, Query } from "./query-interface";

export enum SortDirection {
    Ascending = 0,
    Descending = 1
}

export class FieldSort {

    @field({ type: vec('string') })
    fieldPath: string[]

    @field({ type: 'u8' })
    direction: SortDirection

    constructor(opts: {
        fieldPath: string[],
        direction: SortDirection
    }) {
        if (opts) {
            Object.assign(this, opts);
        }
    }
}


@variant(1)
export class FieldQuery extends Query {

    public apply(doc: any): boolean {
        throw new Error("Not implemented")
    }
}

@variant(0)
export class FieldFilterQuery extends FieldQuery {

    @field({ type: 'string' })
    key: string

    @field({ type: vec('u8') })
    value: Uint8Array

    constructor(opts?: FieldFilterQuery) {
        super();
        if (opts) {
            Object.assign(this, opts)
        }
    }

    public apply(doc: any): boolean {
        return doc[this.key] === this.value
    }
}

@variant(1)
export class FieldStringMatchQuery extends FieldQuery {

    @field({ type: 'string' })
    key: string

    @field({ type: 'string' })
    value: string

    constructor(opts?: {
        key: string
        value: string
    }) {
        super();
        if (opts) {
            Object.assign(this, opts)
        }
    }

    public apply(doc: any): boolean {
        return (doc[this.key] as string).toLowerCase().indexOf(this.value.toLowerCase()) != -1;
    }
}
export enum Compare {
    Equal = 0,
    Greater = 1,
    GreaterOrEqual = 2,
    Less = 3,
    LessOrEqual = 4
}

@variant(2)
export class FieldBigIntCompareQuery extends FieldQuery {

    @field({ type: 'u8' })
    compare: Compare

    @field({ type: 'string' })
    key: string

    @field({ type: 'u64' })
    value: bigint


    constructor(opts?: {
        key: string
        value: bigint,
        compare: Compare
    }) {
        super();
        if (opts) {
            Object.assign(this, opts)
        }
    }

    apply(doc: any): boolean {
        let value: bigint | number = doc[this.key];
        if (typeof value !== 'bigint') {
            value = BigInt(value)
        }
        switch (this.compare) {
            case Compare.Equal:
                return value === this.value;
            case Compare.Greater:
                return value > this.value;
            case Compare.GreaterOrEqual:
                return value >= this.value;
            case Compare.Less:
                return value < this.value;
            case Compare.LessOrEqual:
                return value <= this.value;
            default:
                console.warn("Unexpected compare");
                return false;
        }
    }
}



@variant(3)
export class ClassCompareQuery extends FieldQuery {

    @field({ type: 'string' })
    value: string

    constructor(opts?: {
        value: string
    }) {
        super();
        if (opts) {
            this.value = opts.value;
        }
    }

    apply(doc: Constructor<any>): boolean {
        return doc.constructor.name === this.value
    }
}





@variant(0)
export class DocumentQueryRequest extends MultipleQueriesType {

    @field({ type: option('u64') })
    offset: bigint | undefined;

    @field({ type: option('u64') })
    size: bigint | undefined;

    @field({ type: option(FieldSort) })
    sort: FieldSort | undefined;

    constructor(props?: {
        offset?: bigint
        size?: bigint
        queries: Query[]
        sort?: FieldSort

    }) {
        super({
            queries: props?.queries
        });

        if (props) {
            this.offset = props.offset;
            this.size = props.size;
            this.sort = props.sort;
        }
    }

}