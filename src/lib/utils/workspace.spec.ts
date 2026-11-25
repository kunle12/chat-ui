import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { returnToWorkspace } from "./workspace";

function fakeWindow(opts: { closeable: boolean }): Window & {
	location: { assign: ReturnType<typeof vi.fn> };
	close: ReturnType<typeof vi.fn>;
} {
	const win = {
		closed: false,
		// Mirror real window semantics: the close is refused for tabs that were
		// not script-opened (closeable: false), honored otherwise.
		close: vi.fn(function (this: { closed: boolean }) {
			if (opts.closeable) {
				this.closed = true;
			}
		}),
		location: { assign: vi.fn() },
		setTimeout,
	};
	return win as unknown as Window & {
		location: { assign: ReturnType<typeof vi.fn> };
		close: ReturnType<typeof vi.fn>;
	};
}

describe("returnToWorkspace", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("closes a script-spawned tab and does not navigate", () => {
		const win = fakeWindow({ closeable: true });
		returnToWorkspace("https://workspace.example", win);
		expect(win.close).toHaveBeenCalledOnce();
		vi.runAllTimers();
		expect(win.location.assign).not.toHaveBeenCalled();
	});

	it("falls back to navigating to the console when the close is refused", () => {
		const win = fakeWindow({ closeable: false });
		returnToWorkspace("https://workspace.example", win);
		expect(win.close).toHaveBeenCalledOnce();
		vi.runAllTimers();
		expect(win.location.assign).toHaveBeenCalledWith("https://workspace.example");
	});

	it("is a no-op without a configured workspace origin", () => {
		const win = fakeWindow({ closeable: false });
		returnToWorkspace("", win);
		expect(win.close).not.toHaveBeenCalled();
		vi.runAllTimers();
		expect(win.location.assign).not.toHaveBeenCalled();
	});
});
