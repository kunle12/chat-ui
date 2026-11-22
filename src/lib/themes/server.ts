import type { Cookies } from "@sveltejs/kit";
import { config } from "$lib/server/config";
import { DEFAULT_THEME_ID, isKnownThemeId, sanitizeThemeId } from "./registry";

/**
 * Server-side theme attribute helpers (THEMES.md §9.2b, Appendix C; log task
 * P1-06). Shared by `handle.ts` (runtime) and `hooks.server.ts` (static
 * build), so both paths stamp `<html>` identically.
 */

const MODES = new Set(["light", "dark", "system"]);

export function cookieModePreference(raw: string | undefined): string | undefined {
	return raw && MODES.has(raw) ? raw : undefined;
}

/**
 * The operator-configured default theme id. Falls back to `lcars` (decision
 * D11) when PUBLIC_DEFAULT_THEME is unset or names an unknown theme.
 */
export function serverDefaultThemeId(): string {
	const configured = sanitizeThemeId(config.get("PUBLIC_DEFAULT_THEME"));
	return configured && isKnownThemeId(configured) ? configured : DEFAULT_THEME_ID;
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
	const id = requested && isKnownThemeId(requested) ? requested : serverDefaultThemeId();
	const mode = cookieModePreference(cookies.get("ui-mode"));
	const dark = mode !== "light";
	return `data-theme="${id}"${dark ? ' class="dark"' : ""}`;
}
