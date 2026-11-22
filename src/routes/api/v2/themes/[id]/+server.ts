import { error } from "@sveltejs/kit";
import { readExternalManifests } from "$lib/server/themes/loader";
import { sanitizeThemeId } from "$lib/themes/registry";
import type { RequestHandler } from "./$types";

/** Validated external manifest (THEMES.md §9.4). */
export const GET: RequestHandler = async ({ params }) => {
	const safeId = sanitizeThemeId(params.id);
	const manifest = safeId ? readExternalManifests().find((m) => m.id === safeId) : undefined;
	if (!manifest) error(404, "Theme not found");

	return new Response(JSON.stringify(manifest), {
		headers: {
			"content-type": "application/json",
			"cache-control": "public, max-age=3600, stale-while-revalidate=86400",
		},
	});
};
