import { building } from "$app/environment";
import type { Handle, HandleServerError, ServerInit, HandleFetch } from "@sveltejs/kit";
import { initServer } from "$lib/server/hooks/init";
import { handleRequest } from "$lib/server/hooks/handle";
import { handleServerError } from "$lib/server/hooks/error";
import { handleFetchRequest } from "$lib/server/hooks/fetch";
import { BOOTSTRAP_SCRIPT } from "$lib/themes/bootstrap";
import { serverDefaultThemeId } from "$lib/themes/server";

export const init: ServerInit = async () => {
	if (building) return;
	return initServer();
};

export const handle: Handle = async (input) => {
	if (building) {
		// During static build, still replace %gaId% placeholder with empty string
		// to prevent the GA script from loading with an invalid ID
		return input.resolve(input.event, {
			transformPageChunk: ({ html }) => {
				let out = html.replace("%gaId%", "");
				// Default theme, no external assets (THEMES.md §9.2b): the static
				// build has no cookies and no registry runtime.
				out = out.replace("%themeAttrs%", `data-theme="${serverDefaultThemeId()}" class="dark"`);
				out = out.replace("%themeAssets%", "");
				out = out.replace("%themeBootstrapScript%", BOOTSTRAP_SCRIPT);
				// Build-time assertion: a surviving placeholder would render as
				// literal text (or break the <html> tag) in the shipped fallback.
				if (out.includes("%theme")) {
					throw new Error(
						`Static build: unreplaced theme placeholder in page template: ${out.match(/%theme[A-Za-z]*%/g)?.join(", ")}`
					);
				}
				return out;
			},
		});
	}
	return handleRequest(input);
};

export const handleError: HandleServerError = async (input) => {
	if (building) throw input.error;
	return handleServerError(input);
};

export const handleFetch: HandleFetch = async (input) => {
	if (building) return input.fetch(input.request);
	return handleFetchRequest(input);
};
