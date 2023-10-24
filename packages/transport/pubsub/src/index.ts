import type { PeerId as Libp2pPeerId } from "@libp2p/interface/peer-id";
import { logger as logFn } from "@peerbit/logger";
import {
	AcknowledgeDelivery,
	DataMessage,
	DeliveryMode,
	MessageHeader,
	SeekDelivery,
	SilentDelivery
} from "@peerbit/stream-interface";
import {
	DirectStream,
	DirectStreamComponents,
	DirectStreamOptions,
	PeerStreams
} from "@peerbit/stream";
import { CodeError } from "@libp2p/interface/errors";
import {
	PubSubMessage,
	Subscribe,
	PubSubData,
	toUint8Array,
	Unsubscribe,
	GetSubscribers,
	Subscription,
	UnsubcriptionEvent,
	SubscriptionEvent,
	PubSub,
	DataEvent,
	SubscriptionData
} from "@peerbit/pubsub-interface";
import { getPublicKeyFromPeerId, PublicSignKey } from "@peerbit/crypto";
import { CustomEvent } from "@libp2p/interface/events";
import { PubSubEvents } from "@peerbit/pubsub-interface";

export const logger = logFn({ module: "lazysub", level: "warn" });

export interface PeerStreamsInit {
	id: Libp2pPeerId;
	protocol: string;
}

export type DirectSubOptions = {
	aggregate: boolean; // if true, we will collect topic/subscriber info for all traffic
};

export type DirectSubComponents = DirectStreamComponents;

export type PeerId = Libp2pPeerId | PublicSignKey;

export class DirectSub extends DirectStream<PubSubEvents> implements PubSub {
	public topics: Map<string, Map<string, SubscriptionData>>; // topic -> peers --> Uint8Array subscription metadata (the latest received)
	public peerToTopic: Map<string, Set<string>>; // peer -> topics
	public topicsToPeers: Map<string, Set<string>>; // topic -> peers
	public subscriptions: Map<string, { counter: number }>; // topic -> subscription ids
	public lastSubscriptionMessages: Map<string, Map<string, DataMessage>> =
		new Map();

	constructor(components: DirectSubComponents, props?: DirectStreamOptions) {
		super(components, ["/lazysub/0.0.0"], props);
		this.subscriptions = new Map();
		this.topics = new Map();
		this.topicsToPeers = new Map();
		this.peerToTopic = new Map();
	}

	stop() {
		this.subscriptions.clear();
		this.topics.clear();
		this.peerToTopic.clear();
		this.topicsToPeers.clear();
		return super.stop();
	}

	private initializeTopic(topic: string) {
		this.topics.get(topic) || this.topics.set(topic, new Map());
		this.topicsToPeers.get(topic) || this.topicsToPeers.set(topic, new Set());
	}

	private initializePeer(publicKey: PublicSignKey) {
		this.peerToTopic.get(publicKey.hashcode()) ||
			this.peerToTopic.set(publicKey.hashcode(), new Set());
	}

	/**
	 * Subscribes to a given topic.
	 */
	/**
	 * @param topic,
	 * @param options.data, metadata associated with the subscription, shared with peers
	 * @param options.tick, ms between the anouncements of subscribption to peers
	 */
	async subscribe(topic: string | string[]) {
		if (!this.started) {
			throw new Error("Pubsub has not started");
		}

		topic = typeof topic === "string" ? [topic] : topic;

		const newTopicsForTopicData: string[] = [];
		for (const t of topic) {
			const prev = this.subscriptions.get(t);
			if (prev) {
				prev.counter += 1;
			} else {
				this.subscriptions.set(t, {
					counter: 1
				});

				newTopicsForTopicData.push(t);
				this.listenForSubscribers(t);
			}
		}

		if (newTopicsForTopicData.length > 0) {
			const message = new DataMessage({
				data: toUint8Array(
					new Subscribe({
						subscriptions: newTopicsForTopicData.map((x) => new Subscription(x))
					}).bytes()
				),
				deliveryMode: new SeekDelivery(2)
			});

			await this.publishMessage(this.publicKey, await message.sign(this.sign));
		}
	}

	/**
	 *
	 * @param topic
	 * @param force
	 * @returns true unsubscribed completely
	 */
	async unsubscribe(
		topic: string,
		options?: { force: boolean; data: Uint8Array }
	) {
		if (!this.started) {
			throw new Error("Pubsub is not started");
		}

		const subscriptions = this.subscriptions.get(topic);

		logger.debug(
			`unsubscribe from ${topic} - am subscribed with subscriptions ${subscriptions}`
		);

		if (subscriptions?.counter && subscriptions?.counter >= 0) {
			subscriptions.counter -= 1;
		}

		const peersOnTopic = this.topicsToPeers.get(topic);
		if (peersOnTopic) {
			for (const peer of peersOnTopic) {
				this.lastSubscriptionMessages.delete(peer);
			}
		}
		if (!subscriptions?.counter || options?.force) {
			this.subscriptions.delete(topic);
			this.topics.delete(topic);
			this.topicsToPeers.delete(topic);

			await this.publishMessage(
				this.publicKey,
				await new DataMessage({
					data: toUint8Array(new Unsubscribe({ topics: [topic] }).bytes()),
					deliveryMode: new SilentDelivery(2)
				}).sign(this.sign)
			);
			return true;
		}
		return false;
	}

	getSubscribers(topic: string): PublicSignKey[] | undefined {
		const remote = this.topics.get(topic.toString());

		if (!remote) {
			return undefined;
		}
		const ret: PublicSignKey[] = [];
		for (const v of remote.values()) {
			ret.push(v.publicKey);
		}
		if (this.subscriptions.get(topic)) {
			ret.push(this.publicKey);
		}
		return ret;
	}

	listenForSubscribers(topic: string) {
		this.initializeTopic(topic);
	}

	async requestSubscribers(
		topic: string | string[],
		from?: PublicSignKey
	): Promise<void> {
		if (!this.started) {
			throw new CodeError("not started yet", "ERR_NOT_STARTED_YET");
		}

		if (topic == null) {
			throw new CodeError("topic is required", "ERR_NOT_VALID_TOPIC");
		}

		if (topic.length === 0) {
			return;
		}

		const topics = typeof topic === "string" ? [topic] : topic;
		for (const topic of topics) {
			this.listenForSubscribers(topic);
		}

		return this.publishMessage(
			this.publicKey,
			await new DataMessage({
				header: new MessageHeader({ to: from ? [from.hashcode()] : [] }),
				data: toUint8Array(new GetSubscribers({ topics }).bytes()),
				deliveryMode: new SeekDelivery(2)
			}).sign(this.sign)
		);
	}

	getPeersOnTopics(topics: string[]): Set<string> {
		const newPeers: Set<string> = new Set();
		if (topics?.length) {
			for (const topic of topics) {
				const peersOnTopic = this.topicsToPeers.get(topic.toString());
				if (peersOnTopic) {
					peersOnTopic.forEach((peer) => {
						newPeers.add(peer);
					});
				}
			}
		}
		return newPeers;
	}

	/* getStreamsWithTopics(topics: string[], otherPeers?: string[]): PeerStreams[] {
		const peers = this.getNeighboursWithTopics(topics, otherPeers);
		return [...this.peers.values()].filter((s) =>
			peers.has(s.publicKey.hashcode())
		);
	} */

	async publish(
		data: Uint8Array,
		options:
			| {
					topics?: string[];
					to?: (string | PeerId)[];
					strict?: false;
					mode?: DeliveryMode | undefined;
			  }
			| {
					topics: string[];
					to: (string | PeerId)[];
					strict: true;
					mode?: DeliveryMode | undefined;
			  }
	): Promise<Uint8Array> {
		if (!this.started) {
			throw new Error("Not started");
		}

		const topics =
			(options as { topics: string[] }).topics?.map((x) => x.toString()) || [];
		const tos =
			options?.to?.map((x) =>
				x instanceof PublicSignKey
					? x.hashcode()
					: typeof x === "string"
					? x
					: getPublicKeyFromPeerId(x).hashcode()
			) || this.getPeersOnTopics(topics);

		// Embedd topic info before the data so that peers/relays can also use topic info to route messages efficiently
		const dataMessage = new PubSubData({
			topics: topics.map((x) => x.toString()),
			data,
			strict: options.strict
		});

		const bytes = dataMessage.bytes();

		const message = await this.createMessage(bytes, { ...options, to: tos });

		if (this.emitSelf && data) {
			super.dispatchEvent(
				new CustomEvent("data", {
					detail: new DataEvent(dataMessage, message)
				})
			);
		}

		// send to all the other peers
		await this.publishMessage(this.publicKey, message, undefined);

		return message.id;
	}

	private deletePeerFromTopic(topic: string, publicKeyHash: string) {
		const peers = this.topics.get(topic);
		let change: SubscriptionData | undefined = undefined;
		if (peers) {
			change = peers.get(publicKeyHash);
		}

		this.topics.get(topic)?.delete(publicKeyHash);

		this.peerToTopic.get(publicKeyHash)?.delete(topic);
		if (!this.peerToTopic.get(publicKeyHash)?.size) {
			this.peerToTopic.delete(publicKeyHash);
		}

		this.topicsToPeers.get(topic)?.delete(publicKeyHash);

		return change;
	}

	public async onPeerReachable(publicKey: PublicSignKey) {
		// Aggregate subscribers for my topics through this new peer because if we don't do this we might end up with a situtation where
		// we act as a relay and relay messages for a topic, but don't forward it to this new peer because we never learned about their subscriptions
		/* await this.requestSubscribers([...this.topics.keys()], publicKey); */

		const resp = super.onPeerReachable(publicKey);

		const stream = this.peers.get(publicKey.hashcode());
		if (stream && this.subscriptions.size > 0) {
			// is new neighbour
			// tell the peer about all topics we subscribe to
			this.publishMessage(
				this.publicKey,
				await new DataMessage({
					data: toUint8Array(
						new Subscribe({
							subscriptions: [...this.subscriptions.entries()].map(
								(v) => new Subscription(v[0])
							)
						}).bytes()
					),
					deliveryMode: new SeekDelivery(2)
				}).sign(this.sign)
			),
				[stream];
		}

		return resp;
	}

	public onPeerUnreachable(publicKeyHash: string) {
		super.onPeerUnreachable(publicKeyHash);

		const peerTopics = this.peerToTopic.get(publicKeyHash);

		const changed: Subscription[] = [];
		if (peerTopics) {
			for (const topic of peerTopics) {
				const change = this.deletePeerFromTopic(topic, publicKeyHash);
				if (change) {
					changed.push(new Subscription(topic));
				}
			}
		}
		this.lastSubscriptionMessages.delete(publicKeyHash);

		if (changed.length > 0) {
			this.dispatchEvent(
				new CustomEvent<UnsubcriptionEvent>("unsubscribe", {
					detail: new UnsubcriptionEvent(
						this.peerKeyHashToPublicKey.get(publicKeyHash)!,
						changed
					)
				})
			);
		}
	}

	private subscriptionMessageIsLatest(
		message: DataMessage,
		pubsubMessage: Subscribe | Unsubscribe
	) {
		const subscriber = message.header.signatures!.signatures[0].publicKey!;
		const subscriberKey = subscriber.hashcode(); // Assume first signature is the one who is signing

		for (const topic of pubsubMessage.topics) {
			const lastTimestamp = this.lastSubscriptionMessages
				.get(subscriberKey)
				?.get(topic)?.header.timetamp;
			if (lastTimestamp != null && lastTimestamp > message.header.timetamp) {
				return false; // message is old
			}
		}

		for (const topic of pubsubMessage.topics) {
			if (!this.lastSubscriptionMessages.has(subscriberKey)) {
				this.lastSubscriptionMessages.set(subscriberKey, new Map());
			}
			this.lastSubscriptionMessages.get(subscriberKey)?.set(topic, message);
		}
		return true;
	}

	async onDataMessage(
		from: PublicSignKey,
		stream: PeerStreams,
		message: DataMessage,
		seenBefore: number
	) {
		if (!message.data) {
			return super.onDataMessage(from, stream, message, seenBefore);
		}

		const pubsubMessage = PubSubMessage.from(message.data);
		if (pubsubMessage instanceof PubSubData) {
			/**
			 * See if we know more subscribers of the message topics. If so, add aditional end receivers of the message
			 */

			const isFromSelf = this.publicKey.equals(from);
			if (!isFromSelf || this.emitSelf) {
				let isForMe: boolean;
				if (pubsubMessage.strict) {
					isForMe =
						!!pubsubMessage.topics.find((topic) =>
							this.subscriptions.has(topic)
						) && !!message.header.to.find((x) => this.publicKeyHash === x);
				} else {
					isForMe =
						!!pubsubMessage.topics.find((topic) =>
							this.subscriptions.has(topic)
						) ||
						(pubsubMessage.topics.length === 0 &&
							!!message.header.to.find((x) => this.publicKeyHash === x));
				}
				if (isForMe) {
					if ((await this.maybeVerifyMessage(message)) === false) {
						logger.warn("Recieved message that did not verify PubSubData");
						return false;
					}

					await this.acknowledgeMessage(stream, message, seenBefore);

					if (seenBefore === 0) {
						this.dispatchEvent(
							new CustomEvent("data", {
								detail: new DataEvent(pubsubMessage, message)
							})
						);
					}
				}
			}
			if (seenBefore > 0) {
				return false;
			}

			// Forward
			if (!pubsubMessage.strict) {
				const existingPeers: Set<string> = new Set(message.header.to);
				const allPeersOnTopic = this.getPeersOnTopics(pubsubMessage.topics);

				for (const existing of existingPeers) {
					allPeersOnTopic.add(existing);
				}

				allPeersOnTopic.delete(this.publicKeyHash);
				message.header.to = [...allPeersOnTopic];
			}

			// Only relay if we got additional receivers
			// or we are NOT subscribing ourselves (if we are not subscribing ourselves we are)
			// If we are not subscribing ourselves, then we don't have enough information to "stop" message propagation here
			if (
				message.header.to.length > 0 ||
				!pubsubMessage.topics.find((topic) => this.topics.has(topic)) ||
				message.deliveryMode instanceof SeekDelivery
			) {
				await this.relayMessage(from, message);
			}
		} else {
			if (!(await message.verify(true))) {
				logger.warn("Recieved message that did not verify Unsubscribe");
				return false;
			}

			if (message.header.signatures!.signatures.length === 0) {
				logger.warn("Recieved subscription message with no signers");
				return false;
			}

			await this.acknowledgeMessage(stream, message, seenBefore);

			if (seenBefore > 0) {
				return false;
			}

			if (pubsubMessage instanceof Subscribe) {
				if (pubsubMessage.subscriptions.length === 0) {
					logger.info("Recieved subscription message with no topics");
					return false;
				}

				if (!this.subscriptionMessageIsLatest(message, pubsubMessage)) {
					logger.trace("Recieved old subscription message");
					return false;
				}

				const subscriber = message.header.signatures!.signatures[0].publicKey!;
				const subscriberKey = subscriber.hashcode(); // Assume first signature is the one who is signing

				this.initializePeer(subscriber);

				const changed: Subscription[] = [];
				pubsubMessage.subscriptions.forEach((subscription) => {
					const peers = this.topics.get(subscription.topic);
					if (peers == null) {
						return;
					}

					// if no subscription data, or new subscription has data (and is newer) then overwrite it.
					// subscription where data is undefined is not intended to replace existing data
					const existingSubscription = peers.get(subscriberKey);

					if (
						!existingSubscription ||
						existingSubscription.timestamp < message.header.timetamp
					) {
						peers.set(
							subscriberKey,
							new SubscriptionData({
								timestamp: message.header.timetamp, // TODO update timestamps on all messages?
								publicKey: subscriber
							})
						);
						if (!existingSubscription) {
							changed.push(subscription);
						}
					}

					this.topicsToPeers.get(subscription.topic)?.add(subscriberKey);
					this.peerToTopic.get(subscriberKey)?.add(subscription.topic);
				});
				if (changed.length > 0) {
					this.dispatchEvent(
						new CustomEvent<SubscriptionEvent>("subscribe", {
							detail: new SubscriptionEvent(subscriber, changed)
						})
					);

					// also send back a message telling the remote whethe we are subsbscringib
					if (message instanceof SeekDelivery) {
						// only if Subscribe message is of 'seek' type we will respond with our subscriptions
						const mySubscriptions = changed
							.map((x) => {
								const subscription = this.subscriptions.get(x.topic);
								return subscription ? new Subscription(x.topic) : undefined;
							})
							.filter((x) => !!x) as Subscription[];
						if (mySubscriptions.length > 0) {
							const response = new DataMessage({
								data: toUint8Array(
									new Subscribe({
										subscriptions: mySubscriptions
									}).bytes()
								),
								deliveryMode: new AcknowledgeDelivery(2),
								header: new MessageHeader({ to: [subscriber.hashcode()] })
							});

							await this.publishMessage(
								this.publicKey,
								await response.sign(this.sign)
							);
						}
					}
				}

				// Forward
				await this.relayMessage(from, message);
			} else if (pubsubMessage instanceof Unsubscribe) {
				if (!this.subscriptionMessageIsLatest(message, pubsubMessage)) {
					logger.trace("Recieved old subscription message");
					return false;
				}

				const changed: Subscription[] = [];
				const subscriber = message.header.signatures!.signatures[0].publicKey!;
				const subscriberKey = subscriber.hashcode(); // Assume first signature is the one who is signing

				for (const unsubscription of pubsubMessage.unsubscriptions) {
					const change = this.deletePeerFromTopic(
						unsubscription.topic,
						subscriberKey
					);
					if (change) {
						changed.push(new Subscription(unsubscription.topic));
					}
				}

				if (changed.length > 0) {
					this.dispatchEvent(
						new CustomEvent<UnsubcriptionEvent>("unsubscribe", {
							detail: new UnsubcriptionEvent(subscriber, changed)
						})
					);
				}

				// Forward
				await this.relayMessage(from, message);
			} else if (pubsubMessage instanceof GetSubscribers) {
				const subscriptionsToSend: Subscription[] = [];
				for (const topic of pubsubMessage.topics) {
					const subscription = this.subscriptions.get(topic);
					if (subscription) {
						subscriptionsToSend.push(new Subscription(topic));
					}
				}

				if (subscriptionsToSend.length > 0) {
					// respond
					this.publishMessage(
						this.publicKey,
						await new DataMessage({
							data: toUint8Array(
								new Subscribe({
									subscriptions: subscriptionsToSend
								}).bytes()
							),
							deliveryMode: new SilentDelivery(2)
						}).sign(this.sign),
						[stream]
					); // send back to same stream
				}

				// Forward
				await this.relayMessage(from, message);
			}
		}
		return true;
	}
}

export const waitForSubscribers = async (
	libp2p: { services: { pubsub: DirectSub } },
	peersToWait:
		| PeerId
		| PeerId[]
		| { peerId: Libp2pPeerId }
		| { peerId: Libp2pPeerId }[]
		| string
		| string[],
	topic: string
) => {
	const peersToWaitArr = Array.isArray(peersToWait)
		? peersToWait
		: [peersToWait];

	const peerIdsToWait: string[] = peersToWaitArr.map((peer) => {
		if (typeof peer === "string") {
			return peer;
		}
		const id: PublicSignKey | Libp2pPeerId = peer["peerId"] || peer;
		if (typeof id === "string") {
			return id;
		}
		return id instanceof PublicSignKey
			? id.hashcode()
			: getPublicKeyFromPeerId(id).hashcode();
	});

	await libp2p.services.pubsub.requestSubscribers(topic);
	return new Promise<void>((resolve, reject) => {
		let counter = 0;
		const interval = setInterval(async () => {
			counter += 1;
			if (counter > 100) {
				clearInterval(interval);
				reject(
					new Error("Failed to find expected subscribers for topic: " + topic)
				);
			}
			try {
				const peers = await libp2p.services.pubsub.topics.get(topic);
				const hasAllPeers =
					peerIdsToWait
						.map((e) => peers && peers.has(e))
						.filter((e) => e === false).length === 0;

				// FIXME: Does not fail on timeout, not easily fixable
				if (hasAllPeers) {
					clearInterval(interval);
					resolve();
				}
			} catch (e) {
				clearInterval(interval);
				reject(e);
			}
		}, 200);
	});
};
