import { error } from "@sveltejs/kit";
import { readExternalThemeFile } from "$lib/server/themes/loader";
import { sanitizeThemeId } from "$lib/themes/registry";
import type { RequestHandler } from "./$types";

/** Validated external theme CSS (THEMES.md §9.4). */
export const GET: RequestHandler = async ({ params }) => {
	const safeId = sanitizeThemeId(params.id);
	const file = safeId ? readExternalThemeFile(safeId, "theme.css") : null;
	if (!file) error(404, "Theme CSS not found");

	return new Response(new Uint8Array(file.content).buffer as ArrayBuffer, {
		headers: {
			"content-type": file.type,
			"cache-control": "public, max-age=3600, stale-while-revalidate=86400",
		},
	});
};
