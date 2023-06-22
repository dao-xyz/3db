import { LSession } from "../session.js";
import { waitFor } from "@peerbit/time";

describe("session", () => {
	let session: LSession;
	beforeAll(async () => {
		session = await LSession.connected(3);
	});

	afterAll(async () => {
		await session.stop();
	});
	it("pubsub", async () => {
		let result: any = undefined;
		session.peers[0].services.pubsub.subscribe("x");
		session.peers[1].services.pubsub.subscribe("x");

		await session.peers[2].services.pubsub.subscribe("x");
		session.peers[2].services.pubsub.addEventListener("data", (evt) => {
			result = evt.detail;
		});
		await waitFor(
			() => session.peers[0].services.pubsub.getSubscribers("x")?.size === 1
		);
		await waitFor(
			() => session.peers[1].services.pubsub.getSubscribers("x")?.size === 1
		);

		session.peers[0].services.pubsub.publish(new Uint8Array([1, 2, 3]), {
			topics: ["x"],
		});
		await waitFor(() => !!result);
	});
});
