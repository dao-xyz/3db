import { TestSession } from "../session.js";

it("connect", async () => {
	const session = await TestSession.connected(3);
	await session.stop();
});
