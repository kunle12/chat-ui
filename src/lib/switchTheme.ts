import { browser } from "$app/environment";
import {
	getActiveTheme,
	setMode as runtimeSetMode,
	subscribeToThemeState,
	type ThemeStateSnapshot,
} from "$lib/themes/themes.svelte";

/**
 * Legacy theme-mode API, now an adapter over the theme runtime
 * (`$lib/themes/themes.svelte`). Kept so existing call sites (NavMenu toggle,
 * WorkflowPane/TrackioPane iframes, the settings mode select) keep working
 * while the persistence and application flows go through the runtime
 * (THEMES.md §9.3; decisions D8/D10/D13).
 */

export type ThemePreference = "light" | "dark" | "system";

type ThemeState = {
	preference: ThemePreference;
	isDark: boolean;
};

type ThemeSubscriber = (state: ThemeState) => void;

export function subscribeToTheme(subscriber: ThemeSubscriber) {
	return subscribeToThemeState((state: ThemeStateSnapshot) =>
		subscriber({
			preference: (state.preference ?? "dark") as ThemePreference,
			isDark: state.mode === "dark",
		})
	);
}

export function getThemePreference(): ThemePreference {
	const runtime = getActiveTheme();
	if (runtime.preference) return runtime.preference as ThemePreference;
	// Fall back to the legacy localStorage key (pre-runtime preference).
	if (browser) {
		const raw = localStorage.getItem("theme");
		if (raw === "light" || raw === "dark" || raw === "system") return raw;
	}
	// LCARS ships dark when the user has never chosen.
	return "dark";
}

/**
 * Explicitly set the mode preference ("light" | "dark" | "system") within the
 * active theme. Applies immediately and persists through the runtime
 * (localStorage + cookie + debounced account settings).
 */
export function setTheme(preference: ThemePreference) {
	runtimeSetMode(preference);
}

// Backward-compatible toggle used by the sidebar button (D10: stays a
// two-way light↔dark switch; `system` is reachable from Settings only).
export function switchTheme() {
	const next: ThemePreference = getActiveTheme().mode === "dark" ? "light" : "dark";
	setTheme(next);
}
