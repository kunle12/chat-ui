import type { RequestHandler } from "@sveltejs/kit";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { modelsReady } from "$lib/server/models";

// Reports whether the model upstream has answered at least once. Lets the UI
// distinguish "waiting for the server to come up" from "server up but no models".
// no-cache so the browser revalidates on every poll.
const STATUS_CACHE_HEADERS = { "Cache-Control": "no-cache" };

export const GET: RequestHandler = async () => {
	return superjsonResponse({ ready: modelsReady }, { headers: STATUS_CACHE_HEADERS });
};
