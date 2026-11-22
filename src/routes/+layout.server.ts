import { building } from "$app/environment";
import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { defaultThemeId } from "$lib/server/settingsValidation";
import {
	coerceThemeId,
	resolveChrome,
	resolveLabel,
	resolveManifest,
	resolveMode,
} from "$lib/themes/registry";
import type { ThemeManifest, ThemeModePreference } from "$lib/themes/types";
import type { LayoutServerLoad } from "./$types";

const THEME_COOKIE_OPTIONS = {
	path: "/",
	maxAge: 60 * 60 * 24 * 365,
	sameSite: "lax",
} as const;

/**
 * Server-side theme resolution (THEMES.md §9.2a, log task P1-04).
 *
 * The account settings are the truth for the chrome rendered during SSR; the
 * `ui-theme`/`ui-mode` cookies are the mirror `handle.ts` reads to stamp
 * `<html>` attributes. Writing them here means a user signing in on a new
 * device gets correct attributes from the *second* request on; the first
 * request renders the default tokens under the account's chrome and the
 * client reconciles after hydration (the documented one-frame correction).
 *
 * During `building` (static adapter) there is no database — return defaults.
 */
export const load: LayoutServerLoad = async ({ locals, cookies }) => {
	if (building) {
		const manifest = resolveManifest(defaultThemeId());
		return {
			uiTheme: manifest.id,
			uiThemeMode: undefined as ThemeModePreference | undefined,
			themeMeta: {
				id: manifest.id,
				name: manifest.name,
				modes: manifest.modes,
				chrome: resolveChrome(manifest),
				labels: themeLabels(manifest),
			},
		};
	}

	const settings = await collections.settings.findOne(authCondition(locals), {
		projection: { uiTheme: 1, uiThemeMode: 1 },
	});

	// Account settings win over the cookie: the cookie is a mirror, and this
	// load is exactly where a stale mirror gets corrected.
	const accountTheme = settings?.uiTheme;
	const accountMode = settings?.uiThemeMode;
	const fallback = defaultThemeId();
	const id = coerceThemeId(accountTheme ?? cookies.get("ui-theme"), [], fallback);
	const preference = accountMode ?? cookieMode(cookies.get("ui-mode"));

	const manifest = resolveManifest(id);
	// Server-side `prefersDark` is unknowable; dark is the documented best
	// effort and the pre-paint bootstrap corrects `system` on light-OS clients.
	resolveMode(manifest, preference, true);

	// Mirror the account choice into the cookie so handle.ts stamps the right
	// attributes on every subsequent request. Only write what we actually
	// resolved from the account; an anonymous visitor's cookie stays untouched.
	if (accountTheme || accountMode) {
		cookies.set("ui-theme", id, THEME_COOKIE_OPTIONS);
		if (accountMode) cookies.set("ui-mode", accountMode, THEME_COOKIE_OPTIONS);
	}

	return {
		uiTheme: id,
		uiThemeMode: preference,
		themeMeta: {
			id: manifest.id,
			name: manifest.name,
			modes: manifest.modes,
			chrome: resolveChrome(manifest),
			labels: themeLabels(manifest),
		},
	};
};

function cookieMode(raw: string | undefined): ThemeModePreference | undefined {
	return raw === "light" || raw === "dark" || raw === "system" ? raw : undefined;
}

/** Labels with LCARS fallbacks applied, so components read plain strings. */
function themeLabels(manifest: ThemeManifest): Record<string, string> {
	const keys = [
		"modelsReady",
		"modelsWaiting",
		"streaming",
		"idle",
		"models",
		"modelsOne",
		"mcp",
		"mcpOff",
	] as const;
	return Object.fromEntries(keys.map((key) => [key, resolveLabel(manifest, key)]));
}
