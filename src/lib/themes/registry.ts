import {
	themeManifestSchema,
	type ThemeChrome,
	type ThemeManifest,
	type ThemeMode,
	type ThemeModePreference,
} from "./types";
import { THEME_ID_REGEX } from "./types";

/**
 * Isomorphic theme registry (THEMES.md §9, log task P1-01).
 *
 * Built-in manifests live here so both the server (SSR chrome, cookie
 * validation) and the client (picker, runtime) agree without an API call.
 * External themes (THEMES_DIR) are discovered server-side in Phase 5 and
 * merged into the resolution helpers via `extraThemes`.
 */

export const DEFAULT_THEME_ID = "lcars";

/**
 * LCARS strip copy, kept byte-identical to the strings that were hardcoded in
 * `+layout.svelte` so the default theme stays pixel-comparable (Phase 2
 * acceptance). Themes that omit a label fall back to these.
 */
export const LCARS_DEFAULT_LABELS: Readonly<Record<string, string>> = Object.freeze({
	modelsReady: "Hull integrity nominal",
	modelsWaiting: "Awaiting model server",
	streaming: "Warp 1 · streaming",
	idle: "Impulse · ready",
	models: "{count} models online",
	modelsOne: "1 model online",
	mcp: "{count} mcp",
	mcpOff: "mcp off",
});

const lcarsManifest: ThemeManifest = themeManifestSchema.parse({
	apiVersion: 1,
	id: "lcars",
	name: "LCARS",
	version: "1.0.0",
	description: "The current chat-ui look: warm paper, pill capsules, amber beacon.",
	modes: ["light", "dark"],
	chrome: {
		statusStrip: "full",
		chatHeader: "readout",
		sidebar: "rail",
		structure: "lcars",
	},
	// Omitted keys fall back to LCARS_DEFAULT_LABELS; the explicit entries are
	// documentation of the LCARS voice (all of them match the defaults).
	labels: {},
});

const classicManifest: ThemeManifest = themeManifestSchema.parse({
	apiVersion: 1,
	id: "classic",
	name: "Classic",
	version: "1.0.0",
	description: "The original chat-ui look: stock neutrals, plain panels, no chrome.",
	modes: ["light", "dark"],
	chrome: {
		statusStrip: "hidden",
		chatHeader: "hidden",
		sidebar: "plain",
		structure: "classic",
	},
});

/**
 * classic/office land here as their phases (P3-01/P4-01) create their
 * manifests; the registry code is written against the full set from the start.
 */
export const BUILTIN_THEMES: readonly ThemeManifest[] = [lcarsManifest, classicManifest];

const builtinById: ReadonlyMap<string, ThemeManifest> = new Map(
	BUILTIN_THEMES.map((theme) => [theme.id, theme])
);

export function isBuiltinThemeId(id: string): boolean {
	return builtinById.has(id);
}

export function getBuiltinManifest(id: string): ThemeManifest | undefined {
	return builtinById.get(id);
}

export function listBuiltinThemes(): readonly ThemeManifest[] {
	return BUILTIN_THEMES;
}

/**
 * A theme id is only safe to interpolate into HTML or a filesystem path if it
 * matches the strict id grammar. Returns null for anything else — callers
 * must treat null as "not a theme", never echo the input back.
 */
export function sanitizeThemeId(raw: string | undefined | null): string | null {
	if (!raw) return null;
	return THEME_ID_REGEX.test(raw) ? raw : null;
}

/**
 * Resolve a requested theme id to a manifest, coercing unknown /
 * no-longer-installed ids to the fallback (default: the built-in default —
 * never an error, a removed theme must not block anything). `extraThemes`
 * carries server-discovered external manifests (Phase 5).
 */
export function resolveManifest(
	requested: string | undefined | null,
	extraThemes: readonly ThemeManifest[] = [],
	fallbackId: string = DEFAULT_THEME_ID
): ThemeManifest {
	const id = sanitizeThemeId(requested);
	if (id) {
		const external = extraThemes.find((theme) => theme.id === id);
		if (external) return external;
		const builtin = builtinById.get(id);
		if (builtin) return builtin;
	}
	const fallback =
		extraThemes.find((theme) => theme.id === fallbackId) ?? builtinById.get(fallbackId);
	if (fallback) return fallback;
	// The configured fallback is not installed (e.g. PUBLIC_DEFAULT_THEME names
	// a removed theme): degrade to the built-in default instead of 500-ing
	// every page render. Only a corrupted registry can still throw here.
	const lastResort = builtinById.get(DEFAULT_THEME_ID);
	if (!lastResort) {
		throw new Error(`Fallback theme "${fallbackId}" is missing from the registry`);
	}
	return lastResort;
}

/** Same coercion as `resolveManifest`, but returns the id only. */
export function coerceThemeId(
	requested: string | undefined | null,
	extraThemes: readonly ThemeManifest[] = [],
	fallbackId: string = DEFAULT_THEME_ID
): string {
	return resolveManifest(requested, extraThemes, fallbackId).id;
}

export function isKnownThemeId(id: string, extraThemes: readonly ThemeManifest[] = []): boolean {
	return builtinById.has(id) || extraThemes.some((theme) => theme.id === id);
}

/**
 * Resolve the user's mode preference against a theme's declared modes.
 * `system` follows the OS; a preference the theme does not support coerces to
 * the theme's only mode (THEMES.md §6.3).
 */
export function resolveMode(
	manifest: ThemeManifest,
	preference: ThemeModePreference | undefined,
	prefersDark: boolean
): { mode: ThemeMode; coerced: boolean } {
	if (manifest.modes.length === 1) {
		return { mode: manifest.modes[0], coerced: preference !== manifest.modes[0] };
	}
	if (preference === "light" || preference === "dark") {
		return { mode: preference, coerced: false };
	}
	if (preference === "system") {
		return { mode: prefersDark ? "dark" : "light", coerced: false };
	}
	// Unset: the app ships dark-first (LCARS), so absence of a preference
	// resolves to dark — matching the pre-theme behavior.
	return { mode: "dark", coerced: false };
}

export function resolveChrome(manifest: ThemeManifest): ThemeChrome {
	return manifest.chrome;
}

/** Labels with `{count}` interpolation and LCARS fallbacks. */
export function resolveLabel(
	manifest: ThemeManifest,
	key: string,
	params?: { count?: number }
): string {
	const template = manifest.labels[key] ?? LCARS_DEFAULT_LABELS[key] ?? "";
	// Interpolate only on request: the SSR label resolution must return the raw
	// template so the client can fill in the live count per render.
	return params === undefined ? template : template.replace(/\{count\}/g, String(params.count));
}
