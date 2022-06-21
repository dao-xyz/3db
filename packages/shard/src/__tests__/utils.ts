import fs from 'mz/fs';
import { Identity } from 'orbit-db-identity-provider';
import { TypedBehaviours } from '..';
import * as IPFS from 'ipfs';
import { AnyPeer, IPFSInstanceExtended, PeerOptions } from '../node';
import { SingleDBInterface, DBInterface, RecursiveShardDBInterface } from '../interface';
import BN from 'bn.js';
import { Constructor, field, variant } from '@dao-xyz/borsh';
import { BinaryDocumentStore, BinaryDocumentStoreOptions } from '@dao-xyz/orbit-db-bdocstore';
import { BinaryFeedStoreOptions, BinaryFeedStore } from '@dao-xyz/orbit-db-bfeedstore';

import { Shard } from '../shard';
import { IPFS as IPFSInstance } from 'ipfs-core-types'
import OrbitDB from 'orbit-db';
import { v4 as uuid } from 'uuid';
import { delay } from '../utils';

import PubSub from '@dao-xyz/orbit-db-pubsub'
export const clean = (id?: string) => {
    let suffix = id ? id + '/' : '';
    try {
        fs.rmSync('./ipfs/' + suffix, { recursive: true, force: true });
        fs.rmSync('./orbitdb/' + suffix, { recursive: true, force: true });
        fs.rmSync('./orbit-db/' + suffix, { recursive: true, force: true });
        fs.rmSync('./orbit-db-stores/' + suffix, { recursive: true, force: true });
    } catch (error) {

    }
}

export class Document {
    @field({ type: 'String' })
    id: string;
    constructor(opts?: { id: string }) {
        if (opts) {
            this.id = opts.id;
        }

    }
}


const testBehaviours: TypedBehaviours = {

    typeMap: {
        [Document.name]: Document
    }
}
export const createOrbitDBInstance = (node: IPFSInstance | any, id: string, identity?: Identity) => OrbitDB.createInstance(node,
    {
        identity: identity,
        directory: './orbit-db/' + id,
        broker: PubSub
    })

export const getPeer = async (identity?: Identity, isServer: boolean = true, peerCapacity: number = 1000 * 1000 * 1000): Promise<AnyPeer> => {
    require('events').EventEmitter.prototype._maxListeners = 100;
    require('events').defaultMaxListeners = 100;


    let id = uuid();
    await clean(id);
    const peer = new AnyPeer(id);
    let options = new PeerOptions({
        behaviours: testBehaviours,
        directoryId: id,
        replicationCapacity: peerCapacity,
        isServer
    });
    let node = await createIPFSNode(false, './ipfs/' + id + '/');
    let orbitDB = await createOrbitDBInstance(node, id, identity);
    await peer.create({ options, orbitDB });
    return peer;
}
export const disconnectPeers = async (peers: AnyPeer[]): Promise<void> => {
    //await Promise.all(peers.map(peer => peer.node.libp2p.dialer.destroy()));
    await Promise.all(peers.map(peer => peer.disconnect()));
    // await Promise.all(peers.map(peer => peer.id ? clean(peer.id) : () => { }));
}

export const createIPFSNode = (local: boolean = false, repo: string = './ipfs'): Promise<IPFSInstanceExtended> => {
    // Create IPFS instance
    const ipfsOptions = local ? {
        preload: { enabled: false },
        repo: repo,
        EXPERIMENTAL: { pubsub: true },
        config: {
            Bootstrap: [],
            Addresses: { Swarm: [] }
        },
        libp2p:
        {
            autoDial: false
        }
    } : {
        relay: { enabled: false, hop: { enabled: false, active: false } },
        /*  relay: { enabled: false, hop: { enabled: false, active: false } }, */
        preload: { enabled: false },
        offline: true,
        repo: repo,
        EXPERIMENTAL: { pubsub: true },
        config: {
            Addresses: {
                Swarm: [
                    `/ip4/0.0.0.0/tcp/0`,
                    `/ip4/127.0.0.1/tcp/0/ws`
                ]
            }
        },
        libp2p:
        {
            autoDial: false
        }
    }
    return IPFS.create(ipfsOptions)

}

@variant([1, 0])
export class BinaryFeedStoreInterface extends DBInterface {

    @field({ type: SingleDBInterface })
    db: SingleDBInterface<Document, BinaryFeedStore<Document>>;

    constructor(opts?: { db: SingleDBInterface<Document, BinaryFeedStore<Document>> }) {
        super();
        if (opts) {
            Object.assign(this, opts);
        }
    }

    get initialized(): boolean {
        return !!this.db?.db && !!this.db._shard;
    }

    get loaded(): boolean {
        return this.db.loaded
    }

    close() {
        this.db.db = undefined;
    }

    async init(shard: Shard<any>): Promise<void> {
        await this.db.init(shard);
    }

    async load(): Promise<void> {
        await this.db.load();
    }
}

export const feedStoreShard = async<T>(clazz: Constructor<T>) => new Shard({
    cluster: 'x',
    shardSize: new BN(500 * 1000),
    interface: new BinaryFeedStoreInterface({
        db: new SingleDBInterface({
            name: 'feed',
            storeOptions: new BinaryFeedStoreOptions({
                objectType: clazz.name
            })
        })

    }),
})


@variant([1, 1])
export class DocumentStoreInterface<T> extends DBInterface {

    @field({ type: SingleDBInterface })
    db: SingleDBInterface<T, BinaryDocumentStore<T>>;

    constructor(opts?: { db: SingleDBInterface<T, BinaryDocumentStore<T>> }) {
        super();
        if (opts) {
            Object.assign(this, opts);
        }
    }

    get initialized(): boolean {
        return this.db.initialized;
    }

    get loaded(): boolean {
        return this.db.loaded
    }

    close() {
        this.db.close();
    }

    async init(shard: Shard<any>): Promise<void> {
        await this.db.init(shard);
    }

    async load(waitForReplicationEventsCount = 0): Promise<void> {
        await this.db.load(waitForReplicationEventsCount);
    }
}

export const documentStoreShard = async <T>(clazz: Constructor<T>, indexBy: string = 'id') => new Shard({
    cluster: 'x',
    shardSize: new BN(500 * 1000),
    interface: new DocumentStoreInterface<T>({
        db: new SingleDBInterface({
            name: 'documents',
            storeOptions: new BinaryDocumentStoreOptions<T>({
                indexBy,
                objectType: clazz.name
            })
        })
    })
})

export const shardStoreShard = async <T extends DBInterface>() => new Shard<RecursiveShardDBInterface<T>>({
    cluster: 'x',
    shardSize: new BN(500 * 1000),
    interface: new RecursiveShardDBInterface({
        db: new SingleDBInterface({
            name: 'shards',
            storeOptions: new BinaryDocumentStoreOptions<Shard<T>>({
                indexBy: 'cid',
                objectType: Shard.name
            })
        })
    })
})
