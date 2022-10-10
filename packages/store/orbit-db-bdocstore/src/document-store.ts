import { DeleteOperation, DocumentIndex, IndexedValue, Operation, PutAllOperation, PutOperation } from './document-index'
import pMap from 'p-map'
import { Constructor, deserialize, field, serialize, variant } from '@dao-xyz/borsh';
import { asString } from './utils.js';
import { DocumentQueryRequest, FieldQuery, FieldStringMatchQuery, QueryRequestV0, Result, ResultWithSource, SortDirection, FieldByteMatchQuery, FieldBigIntCompareQuery, Compare, Query, MemoryCompareQuery } from '@dao-xyz/query-protocol';
import { BinaryPayload } from '@dao-xyz/bpayload';
import { arraysEqual } from '@dao-xyz/borsh-utils';
import { AccessController, Store, IInitializationOptions, Address, load } from '@dao-xyz/orbit-db-store';
import { QueryStore } from '@dao-xyz/orbit-db-query-store';
import { BORSH_ENCODING, Encoding, Identity, Payload } from '@dao-xyz/ipfs-log';
import { IPFS } from 'ipfs-core-types';
const replaceAll = (str: string, search: any, replacement: any) => str.toString().split(search).join(replacement)
/* 
export const BINARY_DOCUMENT_STORE_TYPE = 'bdoc_store';

export type DocumentStoreOptions<T> = IQueryStoreOptions<Operation> & { indexBy?: string, clazz: Constructor<T> };
export type IBinaryDocumentStoreOptions<T> = IQueryStoreOptions<Operation> & { indexBy?: string, clazz: Constructor<T> };

@variant([0, 0])
export class BinaryDocumentStoreOptions<T extends BinaryPayload> extends BStoreOptions<BinaryDocumentStore<T>> {

  @field({ type: 'string' })
  indexBy: string;

  @field({ type: 'string' })
  objectType: string;

  constructor(opts: {
    indexBy: string;
    objectType: string;

  }) {
    super();
    if (opts) {
      Object.assign(this, opts);
    }
  }
  async newStore(address: string, orbitDB: OrbitDB, options: IBinaryDocumentStoreOptions<T>): Promise<BinaryDocumentStore<T>> {
    let clazz = options.typeMap[this.objectType];
    if (!clazz) {
      throw new Error(`Undefined type: ${this.objectType}`);
    }
    return orbitDB.open(address, {
      ...options, ...{
        clazz,  indexBy: this.indexBy
      }
    } as DocumentStoreOptions<T>)
  }


  get identifier(): string {
    return BINARY_DOCUMENT_STORE_TYPE
  }
} */

/* export interface Typed {
  addTypes: (typeMap: { [name: string]: Constructor<any> }) => void
}
 */

/* const _encoding = {
  decoder: (bytes: Uint8Array) => deserialize(bytes, Operation),
  encoder: (data: any) => serialize(data)
} */

@variant([0, 0])
export class BinaryDocumentStore<T extends BinaryPayload> extends QueryStore<Operation<T>>/*  implements Typed */ {

  @field({ type: 'string' })
  indexBy: string;

  @field({ type: 'string' })
  objectType: string;

  _clazz?: Constructor<T>;

  _index: DocumentIndex<T>;


  constructor(properties: {
    name?: string,
    indexBy: string,
    objectType: string,
    accessController?: AccessController<Operation<T>>,
    queryRegion?: string,
    clazz?: Constructor<T>
  }) {
    super(properties)
    if (properties) {
      this.indexBy = properties.indexBy;
      this.objectType = properties.objectType;
      this._clazz = properties.clazz;
    }
    this._index = new DocumentIndex();
  }

  /*  addTypes(_typeMap: { [name: string]: Constructor<any>; }) {
     throw new Error("Not implemented");
   } */

  async init(ipfs: IPFS, identity: Identity, options: IInitializationOptions<Operation<T>>) {
    if (!this._clazz) {
      if (!options.typeMap)
        throw new Error("Class not set, " + this.objectType)
      else {
        const clazz = options.typeMap[this.objectType];
        if (!clazz) {
          throw new Error("Class not set in typemap, " + this.objectType)
        }
        this._clazz = clazz;
      }
    }

    this._index.init(this._clazz);
    return await super.init(ipfs, identity, { ...options, encoding: BORSH_ENCODING(Operation), onUpdate: this._index.updateIndex.bind(this._index) })
  }

  /* get encoding(): Encoding<Operation<T>> {
    return;
  } */

  public get(key: any, caseSensitive = false): IndexedValue<T>[] {
    key = key.toString()
    const terms = key.split(' ')
    key = terms.length > 1 ? replaceAll(key, '.', ' ').toLowerCase() : key.toLowerCase()

    const search = (e: string) => {
      if (terms.length > 1) {
        return replaceAll(e, '.', ' ').toLowerCase().indexOf(key) !== -1
      }
      return e.toLowerCase().indexOf(key) !== -1
    }
    const mapper = (e: string) => this._index.get(e)
    const filter = (e: string) => caseSensitive
      ? e.indexOf(key) !== -1
      : search(e)

    const keys = Object.keys(this._index._index);
    return keys.filter(filter)
      .map(mapper)
  }

  _queryDocuments(filter: ((doc: IndexedValue<T>) => boolean)): IndexedValue<T>[] {
    // Whether we return the full operation data or just the db value
    return Object.keys(this._index._index)
      .map((e) => this._index.get(e))
      .filter((doc) => filter(doc))
  }

  queryHandler(query: QueryRequestV0): Promise<Result[]> {
    if (query.type instanceof DocumentQueryRequest) {
      let queries: Query[] = query.type.queries
      let results = this._queryDocuments(
        doc =>
          queries?.length > 0 ? queries.map(f => {
            if (f instanceof FieldQuery) {
              let fv: any = doc.value;
              for (let i = 0; i < f.key.length; i++) {
                fv = fv[f.key[i]];
              }

              if (f instanceof FieldStringMatchQuery) {
                if (typeof fv !== 'string')
                  return false;
                return fv.toLowerCase().indexOf(f.value.toLowerCase()) !== -1;
              }
              if (f instanceof FieldByteMatchQuery) {
                if (!Array.isArray(fv))
                  return false;
                return arraysEqual(fv, f.value)
              }
              if (f instanceof FieldBigIntCompareQuery) {
                let value: bigint | number = fv;

                if (typeof value !== 'bigint' && typeof value !== 'number') {
                  return false;
                }

                switch (f.compare) {
                  case Compare.Equal:
                    return value == f.value; // == because with want bigint == number at some cases
                  case Compare.Greater:
                    return value > f.value;
                  case Compare.GreaterOrEqual:
                    return value >= f.value;
                  case Compare.Less:
                    return value < f.value;
                  case Compare.LessOrEqual:
                    return value <= f.value;
                  default:
                    console.warn("Unexpected compare");
                    return false;
                }
              }
              return false
            }
            else if (f instanceof MemoryCompareQuery) {
              const payload = doc.entry._payload.decrypted.getValue(Payload);
              const operation = payload.getValue(this.oplog._encoding);
              if (operation instanceof PutOperation) {
                const bytes = operation.data;
                for (const compare of f.compares) {
                  const offsetn = Number(compare.offset); // TODO type check

                  for (let b = 0; b < compare.bytes.length; b++) {
                    if (bytes[offsetn + b] !== compare.bytes[b]) {
                      return false;
                    }
                  }
                }
              }
              else {
                // TODO add implementations for PutAll
                return false;
              }
              return true;
            }
            else {
              throw new Error("Unsupported query type")
            }
          }).reduce((prev, current) => prev && current) : true
      ).map(x => x.value);

      if (query.type.sort) {
        const sort = query.type.sort;
        const resolveField = (obj: T) => {
          let v = obj;
          for (let i = 0; i < sort.key.length; i++) {
            v = (v as any)[sort.key[i]]
          }
          return v
        }
        let direction = 1;
        if (query.type.sort.direction == SortDirection.Descending) {
          direction = -1;
        }
        results.sort((a, b) => {
          const af = resolveField(a)
          const bf = resolveField(b)
          if (af < bf) {
            return -direction;
          }
          else if (af > bf) {
            return direction;
          }
          return 0;
        })
      }
      // TODO check conversions
      if (query.type.offset) {
        results = results.slice(Number(query.type.offset));
      }

      if (query.type.size) {
        results = results.slice(0, Number(query.type.size));
      }
      return Promise.resolve(results.map(r => new ResultWithSource({
        source: r
      })));
    }


    // TODO diagnostics for other query types
    return Promise.resolve([]);

  }


  /* TODO  
   public batchPut(docs: T[]) {
      const mapper = (doc, idx) => {
        return this._addOperationBatch(
          {
            op: 'PUT',
            key: asString(doc[this.indexBy]),
            value: doc
          },
          true,
          idx === docs.length - 1
        )
      }
  
      return pMap(docs, mapper, { concurrency: 1 })
        .then(() => this.saveSnapshot())
    } */

  public put(doc: T, options = {}) {
    if (!(doc as any)[this.indexBy]) { throw new Error(`The provided document doesn't contain field '${this.indexBy}'`) }
    const ser = serialize(doc);
    return this._addOperation(
      new PutOperation(
        {
          key: asString((doc as any)[this.indexBy]),
          data: ser,
          value: doc

        })
      , options)
  }

  public putAll(docs: T[], options = {}) {
    if (!(Array.isArray(docs))) {
      docs = [docs]
    }
    if (!(docs.every(d => (d as any)[this.indexBy]))) { throw new Error(`The provided document doesn't contain field '${this.indexBy}'`) }
    return this._addOperation(new PutAllOperation({
      docs: docs.map((value) => new PutOperation({
        key: asString((value as any)[this.indexBy]),
        data: serialize(value),
        value
      }))
    }), options)
  }

  del(key: string, options = {}) {
    if (!this._index.get(key)) { throw new Error(`No entry with key '${key}' in the database`) }

    return this._addOperation(new DeleteOperation({
      key: asString(key)
    }), options)
  }

  public get size(): number {
    return Object.keys(this._index).length
  }
  /*   clone(newName: string): BinaryDocumentStore<T> {
      return new BinaryDocumentStore<T>({
        accessController: this.accessController.clone(newName),
        indexBy: this.indexBy,
        objectType: this.objectType,
        name: newName,
        queryRegion: this.queryRegion
      })
    }
   */
  static async load<T extends BinaryPayload>(ipfs: IPFS, address: Address, options?: {
    timeout?: number;
  }): Promise<BinaryDocumentStore<T>> {
    const instance = await load(ipfs, address, Store, options)
    if (instance instanceof BinaryDocumentStore === false) {
      throw new Error("Unexpected")
    };
    return instance as BinaryDocumentStore<T>;
  }
}




