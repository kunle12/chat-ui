import { sanitizeThemeId } from "./registry";

/**
 * First-paint theme resolution (THEMES.md §9.2b, Appendix C; log task P1-07).
 *
 * Two sources decide the `<html>` attributes before paint:
 *  1. the server, via the `ui-theme`/`ui-mode` cookies baked into
 *     `%themeAttrs%` — already on `<html>` when this script runs;
 *  2. `localStorage` (`ui-theme`/`ui-mode`), for anonymous visitors and
 *     cookie-less first visits, migrating the legacy `localStorage.theme`
 *     key so an existing light-mode user does not flip to dark on upgrade.
 *
 * `resolveFirstPaint` is the pure spec; `BOOTSTRAP_SCRIPT` is the same logic
 * as an inline string (app.html cannot import modules). `themes.spec.ts` runs
 * both against identical scenarios to pin them together — edit them as a pair.
 */

export interface FirstPaintInput {
	/** `data-theme` the server rendered from the cookie (or the default). */
	serverTheme: string;
	/** Whether the server rendered `.dark` (best effort; `system` renders dark). */
	serverDark: boolean;
	/** `ui-theme` cookie value, when the browser has one (readable, not httpOnly). */
	cookieTheme?: string | null;
	/** `ui-mode` cookie value, when the browser has one. */
	cookieMode?: string | null;
	/** Theme id from `localStorage.ui-theme`. */
	storedTheme?: string | null;
	/** Mode preference from `localStorage.ui-mode`. */
	storedMode?: string | null;
	/** Legacy `localStorage.theme` value (light/dark/system). */
	legacyMode?: string | null;
	/** `matchMedia("(prefers-color-scheme: dark)").matches`. */
	prefersDark: boolean;
}

export interface FirstPaintResult {
	theme: string;
	dark: boolean;
	/** True when the legacy `theme` key was migrated into `ui-mode`. */
	migratedLegacy: boolean;
}

const MODE_VALUES = new Set(["light", "dark", "system"]);

function normalizeMode(raw: string | null | undefined): string | null {
	return raw && MODE_VALUES.has(raw) ? raw : null;
}

export function resolveFirstPaint(input: FirstPaintInput): FirstPaintResult {
	const storedTheme = sanitizeThemeId(input.storedTheme ?? undefined);
	const storedMode = normalizeMode(input.storedMode ?? undefined);
	const legacyMode = normalizeMode(input.legacyMode ?? undefined);

	// Legacy migration: copy `theme` into `ui-mode` once, preserving the
	// user's explicit light/dark/system choice across the upgrade.
	const migratedLegacy = legacyMode !== null && !storedMode;

	// Theme: the cookie (already applied server-side) is the account truth.
	// Without it, a stored localStorage theme wins over the server default —
	// this is the anonymous returning visitor.
	const hasCookieTheme = Boolean(input.cookieTheme);
	let theme = input.serverTheme;
	if (storedTheme && !hasCookieTheme) {
		theme = storedTheme;
	}

	// Mode: cookie value first (server already rendered its best effort —
	// `system` renders dark and this script corrects it on a light OS), then
	// the migrated/localStorage value, then the server's rendering.
	const mode = normalizeMode(input.cookieMode ?? undefined) ?? storedMode ?? legacyMode;
	let dark = input.serverDark;
	if (mode === "system") dark = input.prefersDark;
	else if (mode === "light") dark = false;
	else if (mode === "dark") dark = true;

	return { theme, dark, migratedLegacy };
}

// `cookieMode`/`cookieTheme` come from document.cookie in the browser; the
// server path never reads them (it already applied the cookie server-side).

/**
 * Inline pre-paint bootstrap. Injected into app.html through
 * `%themeBootstrapScript%` (handle.ts / hooks.server.ts) so the logic lives in
 * one tested place instead of a hand-copied <script> tag.
 *
 * The body mirrors `resolveFirstPaint` — the spec test executes this string
 * against the same scenarios to catch drift.
 */
export const BOOTSTRAP_SCRIPT = `
(function () {
	try {
		var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

		// Legacy migration: theme -> ui-mode (one-time).
		var legacy = localStorage.getItem("theme");
		var storedMode = localStorage.getItem("ui-mode");
		if (legacy && !storedMode && (legacy === "light" || legacy === "dark" || legacy === "system")) {
			localStorage.setItem("ui-mode", legacy);
			storedMode = legacy;
		}

		// Cookie mirror: ui-theme / ui-mode are readable (not httpOnly).
		var cookies = document.cookie.split("; ");
		var cookieTheme = null;
		var cookieMode = null;
		for (var i = 0; i < cookies.length; i++) {
			var eq = cookies[i].indexOf("=");
			if (eq === -1) continue;
			var name = cookies[i].slice(0, eq);
			if (name === "ui-theme") cookieTheme = cookies[i].slice(eq + 1);
			else if (name === "ui-mode") cookieMode = cookies[i].slice(eq + 1);
		}

		var html = document.documentElement;
		var serverTheme = html.dataset.theme || "";
		var serverDark = html.classList.contains("dark");

		var theme = serverTheme;
		var storedTheme = localStorage.getItem("ui-theme");
		if (storedTheme && /^[a-z0-9][a-z0-9-]{0,31}$/.test(storedTheme) && !cookieTheme) {
			theme = storedTheme;
		}
		if (theme && theme !== html.dataset.theme) html.dataset.theme = theme;

		var mode = (cookieMode && ["light","dark","system"].includes(cookieMode))
			? cookieMode
			: (storedMode && ["light","dark","system"].includes(storedMode) ? storedMode : null);
		var dark = serverDark;
		if (mode === "system") dark = prefersDark;
		else if (mode === "light") dark = false;
		else if (mode === "dark") dark = true;

		html.classList.toggle("dark", dark);

		var meta = document.querySelector('meta[name="theme-color"]');
		if (meta) meta.setAttribute("content", dark ? "#0E0F12" : "#F2ECE3");
	} catch (e) {}
})();
`;
