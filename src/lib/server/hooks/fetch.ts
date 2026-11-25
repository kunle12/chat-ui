import type { HandleFetch } from "@sveltejs/kit";
import { isHostLocalhost } from "$lib/server/isURLLocal";
import { config } from "$lib/server/config";

type HandleFetchInput = Parameters<HandleFetch>[0];

export async function handleFetchRequest({
	event,
	request,
	fetch,
}: HandleFetchInput): Promise<Response> {
	const requestUrl = new URL(request.url);
	const headers = new Headers(request.headers);
	let modified = false;

	if (isHostLocalhost(requestUrl.hostname)) {
		const cookieHeader = event.request.headers.get("cookie");
		if (cookieHeader) {
			headers.set("cookie", cookieHeader);
			modified = true;
		}
	}

	// Reverse-proxy identity (e.g. the kunle_workspace guard's X-Auth-User):
	// SvelteKit's internal event.fetch only forwards cookies and authorization,
	// so a load-time fetch to our own API would authenticate as an anonymous
	// session (empty conversations on page 0) while the browser's own fetches
	// carry the identity header injected by the proxy. Re-attach it for
	// same-origin internal requests so SSR sees the same user as the client.
	// External fetches never receive it.
	const trustedEmailHeader = config.TRUSTED_EMAIL_HEADER;
	if (trustedEmailHeader && requestUrl.origin === event.url.origin) {
		const identity = event.request.headers.get(trustedEmailHeader);
		if (identity) {
			headers.set(trustedEmailHeader, identity);
			modified = true;
		}
	}

	return modified ? fetch(new Request(request, { headers })) : fetch(request);
}
