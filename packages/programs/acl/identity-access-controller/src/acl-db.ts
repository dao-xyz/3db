import { field, variant } from "@dao-xyz/borsh";
import {
	Documents,
	TransactionContext,
	PutOperation,
	DeleteOperation
} from "@peerbit/document";
import {
	getPathGenerator,
	TrustedNetwork,
	getFromByTo,
	IdentityGraph,
	createIdentityGraphStore
} from "@peerbit/trusted-network";
import { Access, AccessType } from "./access";
import { PublicSignKey, sha256Sync } from "@peerbit/crypto";
import { Program } from "@peerbit/program";
import { PeerId } from "@libp2p/interface";
import { concat } from "uint8arrays";
import { RoleOptions } from "@peerbit/shared-log";

@variant("identity_acl")
export class IdentityAccessController extends Program {
	@field({ type: Documents })
	access: Documents<Access>;

	@field({ type: IdentityGraph })
	identityGraphController: IdentityGraph;

	@field({ type: TrustedNetwork })
	trustedNetwork: TrustedNetwork;

	constructor(opts: {
		id?: Uint8Array;
		rootTrust: PublicSignKey | PeerId;
		trustedNetwork?: TrustedNetwork;
	}) {
		super();
		if (!opts.trustedNetwork && !opts.rootTrust) {
			throw new Error("Expecting either TrustedNetwork or rootTrust");
		}
		this.access = new Documents({
			id: opts.id && sha256Sync(concat([opts.id, new Uint8Array([0])]))
		});

		this.trustedNetwork = opts.trustedNetwork
			? opts.trustedNetwork
			: new TrustedNetwork({
					id: opts.id && sha256Sync(concat([opts.id, new Uint8Array([1])])),
					rootTrust: opts.rootTrust
				});
		this.identityGraphController = new IdentityGraph({
			relationGraph: createIdentityGraphStore(
				opts.id && sha256Sync(concat([opts.id, new Uint8Array([2])]))
			)
		});
	}

	// allow anyone write to the ACL db, but assume entry is invalid until a verifier verifies
	// can append will be anyone who has peformed some proof of work

	// or

	// custom can append

	async canRead(_obj: any, s: PublicSignKey | undefined): Promise<boolean> {
		// TODO, improve, caching etc

		if (!s) {
			return false;
		}

		// Check whether it is trusted by trust web
		if (await this.trustedNetwork.isTrusted(s)) {
			return true;
		}

		// Else check whether its trusted by this access controller
		const canReadCheck = async (key: PublicSignKey) => {
			for (const value of this.access.index.index.values()) {
				const access = value.value;
				if (access instanceof Access) {
					if (
						access.accessTypes.find(
							(x) => x === AccessType.Any || x === AccessType.Read
						) !== undefined
					) {
						// check condition
						if (await access.accessCondition.allowed(key)) {
							return true;
						}
						continue;
					}
				}
			}
		};

		if (await canReadCheck(s)) {
			return true;
		}
		for await (const trustedByKey of getPathGenerator(
			s,
			this.identityGraphController.relationGraph,
			getFromByTo
		)) {
			if (await canReadCheck(trustedByKey.from)) {
				return true;
			}
		}

		return false;
	}

	async canPerform(
		_operation: PutOperation<any> | DeleteOperation, // TODO types
		context: TransactionContext<Access>
	): Promise<boolean> {
		// TODO, improve, caching etc

		// Check whether it is trusted by trust web
		const canPerformByKey = async (key: PublicSignKey): Promise<boolean> => {
			if (await this.trustedNetwork.isTrusted(key)) {
				return true;
			}
			// Else check whether its trusted by this access controller
			const canPerformCheck = async (key: PublicSignKey) => {
				for (const value of this.access.index.index.values()) {
					const access = value.value;
					if (access instanceof Access) {
						if (
							access.accessTypes.find(
								(x) => x === AccessType.Any || x === AccessType.Write
							) !== undefined
						) {
							// check condition
							if (await access.accessCondition.allowed(key)) {
								return true;
							}
							continue;
						}
					}
				}
			};
			if (await canPerformCheck(key)) {
				return true;
			}
			for await (const trustedByKey of getPathGenerator(
				key,
				this.identityGraphController.relationGraph,
				getFromByTo
			)) {
				if (await canPerformCheck(trustedByKey.from)) {
					return true;
				}
			}

			return false;
		};

		for (const key of await context.entry.getPublicKeys()) {
			if (await canPerformByKey(key)) {
				return true;
			}
		}
		return false;
	}

	async open(properties?: { role?: RoleOptions }) {
		await this.identityGraphController.open({
			role: properties?.role || { type: "replicator", factor: 1 },
			canRead: this.canRead.bind(this)
		});
		await this.access.open({
			role: properties?.role || { type: "replicator", factor: 1 },
			type: Access,
			canPerform: this.canPerform.bind(this),
			index: {
				canRead: this.canRead.bind(this)
			}
		});
		await this.trustedNetwork.open(properties);
	}
}
