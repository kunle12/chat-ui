import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("$lib/server/config", () => ({
	config: { TRUSTED_EMAIL_HEADER: "X-Auth-User" },
}));

import { handleFetchRequest } from "./fetch";

function makeEvent(
	originalUrl: string,
	originalHeaders: Record<string, string> = {}
): Parameters<typeof handleFetchRequest>[0]["event"] {
	const url = new URL(originalUrl);
	return {
		url,
		request: new Request(url, { headers: originalHeaders }),
	} as Parameters<typeof handleFetchRequest>[0]["event"];
}

function makeInternalRequest(eventUrl: string, headers: Record<string, string> = {}) {
	return new Request(new URL(eventUrl), { headers });
}

describe("handleFetchRequest: trusted identity header forwarding", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("re-attaches the proxy identity header to same-origin internal fetches", async () => {
		const event = makeEvent("https://chat.example/chat/", {
			"x-auth-user": "wang.xun@gmail.com",
			cookie: "hf-chat=abc",
		});
		const internal = makeInternalRequest("https://chat.example/chat/api/v2/conversations?p=0");

		let seen: Request | undefined;
		const response = await handleFetchRequest({
			event,
			request: internal,
			fetch: async (req) => {
				seen = req as Request;
				return new Response("ok");
			},
		});

		expect(response.status).toBe(200);
		expect(seen?.headers.get("X-Auth-User")).toBe("wang.xun@gmail.com");
	});

	it("does not forward the identity header to external hosts", async () => {
		const event = makeEvent("https://chat.example/chat/", {
			"x-auth-user": "wang.xun@gmail.com",
		});
		const external = makeInternalRequest("https://huggingface.co/api/whoami-v2");

		let seen: Request | undefined;
		await handleFetchRequest({
			event,
			request: external,
			fetch: async (req) => {
				seen = req as Request;
				return new Response("ok");
			},
		});

		expect(seen?.headers.get("X-Auth-User")).toBeNull();
	});

	it("leaves the request untouched when the original request carries no identity header", async () => {
		const event = makeEvent("https://chat.example/chat/");
		const internal = makeInternalRequest("https://chat.example/chat/api/v2/conversations?p=0");

		let seen: Request | undefined;
		await handleFetchRequest({
			event,
			request: internal,
			fetch: async (req) => {
				seen = req as Request;
				return new Response("ok");
			},
		});

		expect(seen?.headers.get("X-Auth-User")).toBeNull();
	});

	it("keeps forwarding cookies for same-host internal fetches (existing behaviour)", async () => {
		const event = makeEvent("http://127.0.0.1:3000/chat/", { cookie: "hf-chat=abc" });
		const internal = makeInternalRequest("http://127.0.0.1:3000/chat/api/v2/conversations?p=0");

		let seen: Request | undefined;
		await handleFetchRequest({
			event,
			request: internal,
			fetch: async (req) => {
				seen = req as Request;
				return new Response("ok");
			},
		});

		expect(seen?.headers.get("cookie")).toBe("hf-chat=abc");
	});
});
