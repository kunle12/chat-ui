import { error } from "@sveltejs/kit";
import { readExternalThemeFile } from "$lib/server/themes/loader";
import { sanitizeThemeId } from "$lib/themes/registry";
import type { RequestHandler } from "./$types";

const MODES = new Set(["light", "dark"]);

/** External theme preview image (THEMES.md §9.4). */
export const GET: RequestHandler = async ({ params }) => {
	const safeId = sanitizeThemeId(params.id);
	const mode = params.mode;
	if (!safeId || !MODES.has(mode)) error(404, "Preview not found");

	const data = readExternalThemeFile(safeId, `preview-${mode}.webp`);
	if (!data) error(404, "Preview not found");

	return new Response(new Uint8Array(data.content).buffer as ArrayBuffer, {
		headers: {
			"content-type": data.type,
			"cache-control": "public, max-age=3600, stale-while-revalidate=86400",
		},
	});
};
