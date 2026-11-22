import { browser } from "$app/environment";
import { DEFAULT_THEME_ID, isBuiltinThemeId, resolveManifest, resolveMode } from "./registry";
import type { ThemeManifest, ThemeMode, ThemeModePreference } from "./types";

/**
 * Theme runtime (THEMES.md §9.3, log task P1-01).
 *
 * Svelte 5 runes module. Holds the active theme id and mode preference,
 * applies `<html data-theme class="dark">`, and persists the choice to
 * localStorage + cookie (sync) and — through the `persist` hook installed by
 * `+layout.svelte` — to the account settings (debounced, via the existing
 * settings store POST).
 */

const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year, SameSite=Lax (THEMES.md §9.2)

interface ThemeRuntimeState {
	/** Active theme id — always a registered (or default) id. */
	id: string;
	/** The preference as the user expressed it (`system` stays `system`). */
	preference: ThemeModePreference | undefined;
	/** Resolved concrete mode after theme coercion. */
	mode: ThemeMode;
	manifest: ThemeManifest;
}

function initialState(): ThemeRuntimeState {
	return {
		id: DEFAULT_THEME_ID,
		preference: undefined,
		mode: "dark",
		manifest: resolveManifest(DEFAULT_THEME_ID),
	};
}

const state = $state<ThemeRuntimeState>(initialState());

export interface ThemeStateSnapshot {
	id: string;
	preference: ThemeModePreference | undefined;
	mode: ThemeMode;
}

type ThemeStateListener = (snapshot: ThemeStateSnapshot) => void;
const themeListeners = new Set<ThemeStateListener>();

/**
 * Subscribe to applied theme changes (used by the legacy `switchTheme`
 * adapter for iframe panes and the sidebar toggle icon).
 */
export function subscribeToThemeState(listener: ThemeStateListener): () => void {
	themeListeners.add(listener);
	// Fire immediately, matching the old subscribeToTheme contract.
	listener({ id: state.id, preference: state.preference, mode: state.mode });
	return () => themeListeners.delete(listener);
}

function notifyThemeListeners(): void {
	const snapshot = { id: state.id, preference: state.preference, mode: state.mode };
	for (const listener of themeListeners) listener(snapshot);
}

type PersistHook = (id: string, preference: ThemeModePreference | undefined) => void;
let persistToSettings: PersistHook | undefined;

/**
 * Called from `+layout.svelte` with the SSR-resolved values before anything
 * renders, so the runtime state matches the server-rendered chrome from the
 * first frame and settings changes flow into the debounced store save.
 */
export function initThemeRuntime(input: {
	id: string;
	preference: ThemeModePreference | undefined;
	mode: ThemeMode;
	manifest: ThemeManifest;
	persist?: PersistHook;
}): void {
	state.id = input.id;
	state.preference = input.preference;
	state.mode = input.mode;
	state.manifest = input.manifest;
	persistToSettings = input.persist;
}

export function getActiveTheme(): Readonly<ThemeRuntimeState> {
	return state;
}

function writeThemeCookies(id: string, preference: ThemeModePreference | undefined): void {
	if (!browser) return;
	// Best-effort only: private-mode browsers reject writes; the account
	// settings remain the source of truth and the next SSR pass re-mirrors.
	try {
		const base = `Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
		document.cookie = `ui-theme=${encodeURIComponent(id)}; ${base}`;
		if (preference) document.cookie = `ui-mode=${preference}; ${base}`;
	} catch {
		// ignore — cookie write failures must never break theme switching
	}
}

function applyAttributes(id: string, mode: ThemeMode): void {
	if (!browser) return;
	const html = document.documentElement;
	html.dataset.theme = id;
	html.classList.toggle("dark", mode === "dark");
	updateMetaThemeColor(mode);
}

function updateMetaThemeColor(mode: ThemeMode): void {
	// Reads the theme's declared color when the token exists (Phase 2 wires
	// --ui-theme-color); falls back to the LCARS values used before themes.
	const meta = document.querySelector('meta[name="theme-color"]');
	if (!meta) return;
	const html = document.documentElement;
	const token = getComputedStyle(html).getPropertyValue("--ui-theme-color").trim();
	const fallback = mode === "dark" ? "#0E0F12" : "#F2ECE3";
	meta.setAttribute("content", token || fallback);
}

export interface SetThemeOptions {
	/** Skip persistence (used by the SSR reconciliation path). */
	skipPersist?: boolean;
}

/** Load an external theme stylesheet and wait for it to apply (P5-06). */
async function loadExternalStylesheet(id: string): Promise<boolean> {
	try {
		const res = await fetch(`${base}/api/v2/themes/${id}/theme.css`);
		if (!res.ok) return false;
		const existing = document.getElementById(`theme-css-${id}`);
		if (existing) return true;
		const link = document.createElement("link");
		link.id = `theme-css-${id}`;
		link.rel = "stylesheet";
		link.href = `${base}/api/v2/themes/${id}/theme.css`;
		document.head.appendChild(link);
		await new Promise<boolean>((resolve) => {
			link.onload = () => resolve(true);
			link.onerror = () => resolve(false);
		});
		return true;
	} catch {
		return false;
	}
}

import { base } from "$app/paths";

/**
 * Switch the active theme and/or mode preference. Applies synchronously
 * (no flash), mirrors to localStorage + cookie, and — when a persist hook is
 * installed — schedules the account-settings save. External themes await
 * their stylesheet before applying (P5-06).
 */
export async function setTheme(
	id: string,
	preference: ThemeModePreference | undefined,
	options: SetThemeOptions = {}
): Promise<void> {
	const manifest = resolveManifest(id);
	const prefersDark = browser ? window.matchMedia("(prefers-color-scheme: dark)").matches : true;
	const { mode } = resolveMode(manifest, preference, prefersDark);

	// External theme: load the stylesheet before applying, so the new theme
	// never paints unstyled (THEMES.md §9.4, log task P5-06). Built-in token
	// blocks are already in the bundle. On failure revert to the current theme.
	if (browser && !isBuiltinThemeId(manifest.id) && !options.skipPersist) {
		const loaded = await loadExternalStylesheet(manifest.id);
		if (!loaded) {
			console.error(`Theme "${manifest.id}" failed to load — keeping the current theme`);
			return;
		}
	}

	state.id = manifest.id;
	state.preference = preference;
	state.mode = mode;
	state.manifest = manifest;

	applyAttributes(manifest.id, mode);

	if (!options.skipPersist && browser) {
		try {
			localStorage.setItem("ui-theme", manifest.id);
			if (preference) localStorage.setItem("ui-mode", preference);
		} catch {
			// private-mode write failure: cookie + settings still carry the choice
		}
		writeThemeCookies(manifest.id, preference);
		persistToSettings?.(manifest.id, preference);
	}

	notifyThemeListeners();
}

/** Change only the mode within the active theme. */
export function setMode(preference: ThemeModePreference): void {
	setTheme(state.id, preference);
}

/**
 * Re-apply the current theme's attributes without persisting — used after
 * hydration when the server rendered a stale/default theme (the documented
 * one-frame correction on a brand-new device).
 */
export function reconcileFromServer(id: string, preference: ThemeModePreference | undefined): void {
	setTheme(id, preference, { skipPersist: true });
}
