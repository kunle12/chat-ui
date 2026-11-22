import { error } from "@sveltejs/kit";
import { readExternalThemeFile } from "$lib/server/themes/loader";
import { sanitizeThemeId } from "$lib/themes/registry";
import type { RequestHandler } from "./$types";

const ALLOWED = /^[a-z0-9._-]+\.woff2$/;

/** External theme font (THEMES.md §9.4) — extension allowlist, no traversal. */
export const GET: RequestHandler = async ({ params }) => {
	const safeId = sanitizeThemeId(params.id);
	const file = params.file;
	if (!safeId || !ALLOWED.test(file)) error(404, "Font not found");

	const data = readExternalThemeFile(safeId, file);
	if (!data) error(404, "Font not found");

	return new Response(new Uint8Array(data.content).buffer as ArrayBuffer, {
		headers: {
			"content-type": data.type,
			"cache-control": "public, max-age=3600, stale-while-revalidate=86400",
		},
	});
};
