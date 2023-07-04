import { DirectSub } from "@peerbit/pubsub";
import { Peerbit } from "peerbit";

export const create = (directory: string, domain?: string) => {
	return Peerbit.create({
		libp2p: {
			addresses: {
				announce: domain
					? [`/dns4/${domain}/tcp/8001`, `/dns4/${domain}/tcp/8002/ws`]
					: undefined,
				listen: ["/ip4/127.0.0.1/tcp/8001", "/ip4/127.0.0.1/tcp/8002/ws"],
			},
			connectionManager: {
				maxConnections: Infinity,
				minConnections: 0,
			},
			services: {
				pubsub: (c) => new DirectSub(c, { canRelayMessage: true }),
			},
		},
		directory,
	});
};
