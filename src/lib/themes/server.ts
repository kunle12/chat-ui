import type { Cookies } from "@sveltejs/kit";
import { config } from "$lib/server/config";
import { readExternalManifests } from "$lib/server/themes/loader";
import { DEFAULT_THEME_ID, isKnownThemeId, sanitizeThemeId } from "./registry";
import type { ThemeManifest } from "./types";

const MODES = new Set(["light", "dark", "system"]);

export function cookieModePreference(raw: string | undefined): string | undefined {
	return raw && MODES.has(raw) ? raw : undefined;
}

/** The operator-configured default theme id (falls back to `lcars`). */
export function serverDefaultThemeId(): string {
	return config.get("PUBLIC_DEFAULT_THEME") || DEFAULT_THEME_ID;
}

/** Built-in + external manifests, for resolution in cookie/attr helpers. */
function allManifests(): ThemeManifest[] {
	return [...readExternalManifests()];
}

/**
 * `<html>` attribute markup from the theme cookies. Only registry-known,
 * grammar-valid ids may be interpolated — a hostile cookie degrades to the
 * default theme, never reaches the attribute.
 *
 * Mode is best effort server-side: `system` renders dark and the pre-paint
 * bootstrap corrects it on a light-OS client before anything paints.
 */
export function cookieThemeAttrs(cookies: Cookies): string {
	const requested = sanitizeThemeId(cookies.get("ui-theme"));
	const known = requested && isKnownThemeId(requested, allManifests());
	const id = known ? requested : serverDefaultThemeId();
	const mode = cookieModePreference(cookies.get("ui-mode"));
	const dark = mode !== "light";
	return `data-theme="${id}"${dark ? ' class="dark"' : ""}`;
}
