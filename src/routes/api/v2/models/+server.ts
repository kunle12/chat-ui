import type { RequestHandler } from "@sveltejs/kit";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { serializeModelSummary } from "$lib/server/api/utils/serializeModel";
import type { GETModelsResponse } from "$lib/server/api/types";

// Models are refreshed on the server (see $lib/server/models.ts) and served
// here. A short max-age keeps the browser re-fetching on navigation so a
// change in the available set is reflected quickly.
const MODELS_CACHE_HEADERS = { "Cache-Control": "private, max-age=5" };

export const GET: RequestHandler = async () => {
	try {
		const { models } = await import("$lib/server/models");
		return superjsonResponse(
			models
				.filter((m) => m.unlisted == false)
				.map(serializeModelSummary) satisfies GETModelsResponse,
			{ headers: MODELS_CACHE_HEADERS }
		);
	} catch {
		return superjsonResponse([] as GETModelsResponse);
	}
};
