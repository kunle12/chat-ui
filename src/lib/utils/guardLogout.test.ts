import { describe, expect, it, vi } from "vitest";

import { GUARD_LOGOUT_CHANNEL, GUARD_LOGIN_PATH, startGuardLogoutListener } from "./guardLogout";

function createFakeChannel() {
	let handler: ((event: MessageEvent) => void) | null = null;
	const close = vi.fn();
	return {
		channel: {
			get onmessage() {
				return handler;
			},
			set onmessage(value: ((event: MessageEvent) => void) | null) {
				handler = value;
			},
			close,
		},
		close,
		emit(data: unknown) {
			handler?.(new MessageEvent("message", { data }));
		},
		hasHandler: () => handler !== null,
	};
}

describe("startGuardLogoutListener", () => {
	it("subscribes on the guard channel and redirects on a logout message", () => {
		const fake = createFakeChannel();
		const redirect = vi.fn();
		const names: string[] = [];

		startGuardLogoutListener({
			createChannel: (name) => {
				names.push(name);
				return fake.channel;
			},
			redirect,
			pathname: () => "/",
		});

		expect(names).toEqual([GUARD_LOGOUT_CHANNEL]);
		fake.emit({ type: "logout" });
		expect(redirect).toHaveBeenCalledWith(GUARD_LOGIN_PATH);
	});

	it("ignores other message types and malformed payloads", () => {
		const fake = createFakeChannel();
		const redirect = vi.fn();
		startGuardLogoutListener({
			createChannel: () => fake.channel,
			redirect,
			pathname: () => "/",
		});

		fake.emit({ type: "theme-change" });
		fake.emit({});
		fake.emit(null);
		fake.emit("logout");
		expect(redirect).not.toHaveBeenCalled();
	});

	it("does not redirect a tab that is already on the login page", () => {
		const fake = createFakeChannel();
		const redirect = vi.fn();
		startGuardLogoutListener({
			createChannel: () => fake.channel,
			redirect,
			pathname: () => GUARD_LOGIN_PATH,
		});

		fake.emit({ type: "logout" });
		expect(redirect).not.toHaveBeenCalled();
	});

	it("unsubscribes and closes the channel on cleanup", () => {
		const fake = createFakeChannel();
		const redirect = vi.fn();
		const stop = startGuardLogoutListener({
			createChannel: () => fake.channel,
			redirect,
			pathname: () => "/",
		});

		stop();
		expect(fake.close).toHaveBeenCalledOnce();
		expect(fake.hasHandler()).toBe(false);
		fake.emit({ type: "logout" });
		expect(redirect).not.toHaveBeenCalled();
	});

	it("degrades to a no-op when BroadcastChannel is unavailable", () => {
		expect(() => startGuardLogoutListener({ createChannel: () => null })()).not.toThrow();
		expect(() =>
			startGuardLogoutListener({
				createChannel: () => {
					throw new Error("unsupported");
				},
			})()
		).not.toThrow();
	});
});
