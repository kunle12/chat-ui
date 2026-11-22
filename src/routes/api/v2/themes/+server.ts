import { readExternalManifests } from "$lib/server/themes/loader";

/**
 * External theme list (THEMES.md §9.4, log task P5-01). Metadata only — no
 * tokens/css. 404 is never returned here; an unset THEMES_DIR yields an empty
 * list (built-ins are served from the isomorphic registry).
 */
export const GET = async () => {
	const themes = readExternalManifests().map((m) => ({
		id: m.id,
		name: m.name,
		version: m.version,
		description: m.description,
		modes: m.modes,
	}));
	return new Response(JSON.stringify(themes), {
		headers: {
			"content-type": "application/json",
			"cache-control": "public, max-age=3600, stale-while-revalidate=86400",
		},
	});
};
