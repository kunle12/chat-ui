/**
 * Cross-tab logout for the guard (kunle_workspace SSO).
 *
 * The guard console posts `{ type: "logout" }` on the `kunle-guard`
 * BroadcastChannel. Every tab of this origin that listens here navigates to the
 * guard login. A tab cannot be closed by another tab, so this is the closest
 * honest behaviour.
 *
 * The channel name is mirrored in kunle_workspace `web/src/app.html`,
 * `web/src/lib/logout.ts` and `deploy/guard-logout.js` — keep them in sync.
 */
export const GUARD_LOGOUT_CHANNEL = "kunle-guard";
export const GUARD_LOGIN_PATH = "/login";

type GuardLogoutChannel = {
	onmessage: ((event: MessageEvent) => void) | null;
	close: () => void;
};

export interface GuardLogoutOptions {
	/** Test seam: defaults to the browser's BroadcastChannel. */
	createChannel?: (name: string) => GuardLogoutChannel | null;
	/** Test seam: defaults to `window.location.replace`. */
	redirect?: (path: string) => void;
	/** Test seam: defaults to `window.location.pathname`. */
	pathname?: () => string;
}

/**
 * Listen for the guard's cross-tab logout signal. Returns a cleanup function;
 * call it when the owning component is destroyed.
 */
export function startGuardLogoutListener(options: GuardLogoutOptions = {}): () => void {
	const createChannel =
		options.createChannel ??
		((name: string): GuardLogoutChannel | null => {
			if (typeof BroadcastChannel === "undefined") return null;
			return new BroadcastChannel(name);
		});
	const redirect = options.redirect ?? ((path: string) => window.location.replace(path));
	const pathname = options.pathname ?? (() => window.location.pathname);

	let channel: GuardLogoutChannel | null;
	try {
		channel = createChannel(GUARD_LOGOUT_CHANNEL);
	} catch {
		// No BroadcastChannel: the guard still gates the next request.
		return () => {};
	}
	if (!channel) return () => {};

	channel.onmessage = (event: MessageEvent) => {
		const data = event.data as { type?: unknown } | null | undefined;
		if (data?.type !== "logout") return;
		if (pathname() === GUARD_LOGIN_PATH) return;
		redirect(GUARD_LOGIN_PATH);
	};

	return () => {
		channel.onmessage = null;
		channel.close();
	};
}
