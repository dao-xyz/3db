import { field, variant } from "@dao-xyz/borsh";
import { AppendOptions, CanAppend, Change, Entry } from "@peerbit/log";
import { SharedLog, SharedLogOptions } from "@peerbit/shared-log";
import { SignatureWithKey } from "@peerbit/crypto";
import { Program, ProgramEvents } from "@peerbit/program";
import { RPCOptions, CanRequest, RPC } from "@peerbit/rpc";
import { logger as loggerFn } from "@peerbit/logger";
import { StringOperation, StringIndex, encoding } from "./string-index.js";
import {
	RangeMetadata,
	RangeMetadatas,
	StringMatch,
	StringQueryRequest,
	StringResult,
} from "./query.js";
import { CustomEvent } from "@libp2p/interfaces/events";

import { Range } from "./range.js";

const logger = loggerFn({ module: "string" });

export const STRING_STORE_TYPE = "string_store";
const findAllOccurrences = (str: string, substr: string): number[] => {
	str = str.toLowerCase();

	const result: number[] = [];

	let idx = str.indexOf(substr);

	while (idx !== -1) {
		result.push(idx);
		idx = str.indexOf(substr, idx + 1);
	}
	return result;
};

export type StringStoreOptions = {
	canRead?: (key: SignatureWithKey) => Promise<boolean>;
};

export interface StringEvents {
	change: CustomEvent<Change<StringOperation>>;
}

type Args = {
	canRead?: CanRequest;
	canWrite?: CanAppend<StringOperation>;
	log?: SharedLogOptions;
};

@variant("dstring")
export class DString extends Program<Args, StringEvents & ProgramEvents> {
	@field({ type: SharedLog })
	_log: SharedLog<StringOperation>;

	@field({ type: RPC })
	query: RPC<StringQueryRequest, StringResult>;

	@field({ type: StringIndex })
	_index: StringIndex;

	_optionCanAppend?: CanAppend<StringOperation>;

	constructor(properties: {
		id?: Uint8Array;
		query?: RPC<StringQueryRequest, StringResult>;
	}) {
		super();
		this.query = properties.query || new RPC();
		this._log = new SharedLog({ id: properties.id });
		this._index = new StringIndex();
	}

	async open(options?: Args) {
		this._optionCanAppend = options?.canWrite;
		await this._index.open(this._log.log);

		await this._log.open({
			encoding,
			replicas: {
				min: 0xffffffff, // assume a document can not be sharded?
			},
			canAppend: this.canWrite.bind(this),
			onChange: async (change) => {
				await this._index.updateIndex(change);
				this.events.dispatchEvent(
					new CustomEvent("change", {
						detail: change,
					})
				);
			},
		});

		await this.query.open({
			...options,
			topic: this._log.log.idString + "/" + "dstring",
			canRequest: options?.canRead,
			responseHandler: this.queryHandler.bind(this),
			queryType: StringQueryRequest,
			responseType: StringResult,
		});
	}

	async canWrite(entry: Entry<StringOperation>): Promise<boolean> {
		if (!(await this._canAppend(entry))) {
			return false;
		}
		if (this._optionCanAppend && !(await this._optionCanAppend(entry))) {
			return false;
		}
		return true;
	}

	async _canAppend(entry: Entry<StringOperation>): Promise<boolean> {
		if (this._log.log.length === 0 || entry.next.length === 0) {
			return true;
		} else {
			for (const next of entry.next) {
				if (this._log.log.has(next)) {
					return true;
				}
			}
		}
		return false;
	}

	async add(
		value: string,
		index: Range,
		options?: AppendOptions<StringOperation>
	) {
		return this._log.append(
			new StringOperation({
				index,
				value,
			}),
			{
				...options,
				meta: { ...options?.meta, next: await this._log.log.getHeads() },
			}
		);
	}

	async del(index: Range, options?: AppendOptions<StringOperation>) {
		return this.add("", index, options);
	}

	async queryHandler(
		query: StringQueryRequest
	): Promise<StringResult | undefined> {
		logger.debug("Recieved query");
		if (query instanceof StringQueryRequest == false) {
			logger.debug("Recieved query which is not a StringQueryRequest");
			return;
		}
		const stringQuery = query as StringQueryRequest;

		const content = this._index.string;
		const relaventQueries = stringQuery.query.filter(
			(x) => x instanceof StringMatch
		) as StringMatch[];
		if (relaventQueries.length == 0) {
			logger.debug("Responding with all");
			return new StringResult({
				string: content,
			});
		}
		const ranges = relaventQueries
			.map((query) => {
				const occurances = findAllOccurrences(
					query.preprocess(content),
					query.preprocess(query.value)
				);
				return occurances.map((ix) => {
					return new RangeMetadata({
						offset: BigInt(ix),
						length: BigInt(query.value.length),
					});
				});
			})
			.flat(1);

		if (ranges.length == 0) {
			logger.debug("Could not find any matches");
			return;
		}

		return new StringResult({
			string: content,
			metadatas: new RangeMetadatas({
				metadatas: ranges,
			}),
		});
	}

	async getValue(options?: {
		remote: {
			callback: (string: string) => any;
			queryOptions: RPCOptions<StringResult>;
		};
	}): Promise<string | undefined> {
		if (options?.remote) {
			const counter: Map<string, number> = new Map();
			const responses = await this.query.request(
				new StringQueryRequest({
					query: [],
				}),
				options.remote.queryOptions
			);
			for (const response of responses) {
				options?.remote.callback &&
					options?.remote.callback(response.response.string);
				counter.set(
					response.response.string,
					(counter.get(response.response.string) || 0) + 1
				);
			}

			let max = -1;
			let ret: string | undefined = undefined;
			counter.forEach((v, k) => {
				if (max < v) {
					max = v;
					ret = k;
				}
			});
			return ret;
		} else {
			return this._index.string;
		}
	}
}
