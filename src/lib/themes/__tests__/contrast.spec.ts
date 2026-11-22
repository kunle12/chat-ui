import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * WCAG contrast tests per theme × mode (THEMES.md §15.3, log task P6-02).
 * Values are parsed from the theme CSS files (not the runtime — the tests
 * must not depend on a browser). Requires ≥ 4.5 for normal text pairs,
 * ≥ 3 for large/UI pairs.
 */

const THEMES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function extractTokens(css: string, selector: string): Record<string, string> {
	const idx = css.indexOf(selector);
	if (idx === -1) return {};
	const open = css.indexOf("{", idx);
	let depth = 1;
	let end = open + 1;
	while (depth > 0 && end < css.length) {
		if (css[end] === "{") depth++;
		if (css[end] === "}") depth--;
		end++;
	}
	const body = css.slice(open + 1, end - 1);
	const tokens: Record<string, string> = {};
	for (const m of body.matchAll(/(--ui-[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
		tokens[m[1]] = m[2].replace(/\s+/g, " ").trim();
	}
	return tokens;
}

/** Parse a CSS color value to [r, g, b] (0-255). Supports hex + rgb() + color-mix of hexes. */
function parseColor(value: string): [number, number, number] | null {
	const v = value.trim();
	// Hex
	const hex = /^#([0-9a-fA-F]{3,8})$/.exec(v);
	if (hex) {
		const h = hex[1];
		if (h.length === 3)
			return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
		if (h.length >= 6)
			return [
				parseInt(h.slice(0, 2), 16),
				parseInt(h.slice(2, 4), 16),
				parseInt(h.slice(4, 6), 16),
			];
	}
	// rgb()/rgba()
	const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v);
	if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
	return null;
}

/** WCAG relative luminance (sRGB). */
function luminance([r, g, b]: [number, number, number]): number {
	const lin = (c: number) => {
		const s = c / 255;
		return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
	const la = luminance(a);
	const lb = luminance(b);
	const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
	return (lighter + 0.05) / (darker + 0.05);
}

/** Resolve a token value to a parsed color, following one var() indirection. */
function resolveColor(
	tokens: Record<string, string>,
	name: string,
	fallback?: [number, number, number]
): [number, number, number] | null {
	let value = tokens[name];
	if (value === undefined && fallback) return fallback;
	// One level of var() indirection (e.g. --ui-bubble-assistant-text: var(--ui-text))
	const varRef = /^var\(--ui-([a-zA-Z0-9-]+)\)$/.exec(value ?? "");
	if (varRef) value = tokens[`--ui-${varRef[1]}`] ?? "";
	// color-mix(in srgb, X pct%, transparent) — approximate by blending X with white/black
	const mix = /^color-mix\(in srgb,\s*(#\S+)\s+(\d+)%,\s*transparent\)$/.exec(value);
	if (mix) {
		const base = parseColor(mix[1]);
		if (!base) return null;
		const alpha = +mix[2] / 100;
		// Blend against the mid-gray of the mode's surface for a conservative estimate
		return base.map((c) => Math.round(c * alpha + 128 * (1 - alpha))) as [number, number, number];
	}
	return parseColor(value ?? "");
}

const THEME_IDS = ["lcars", "classic", "office"] as const;

describe("WCAG contrast per theme × mode", () => {
	for (const id of THEME_IDS) {
		const css = readFileSync(resolve(THEMES_DIR, id, "theme.css"), "utf-8");

		for (const mode of ["light", "dark"] as const) {
			const selector =
				mode === "light" ? `:root[data-theme="${id}"]` : `:root[data-theme="${id}"].dark`;
			it(`${id} ${mode}`, () => {
				const tokens = extractTokens(css, selector);
				const get = (name: string, fallback?: [number, number, number]) =>
					resolveColor(tokens, name, fallback);

				const bg = get("--ui-bg");
				const text = get("--ui-text");
				const muted = get("--ui-text-muted");
				const accent = get("--ui-accent");
				const accentText = get("--ui-accent-text");
				const surface = get("--ui-surface");

				// All source colors must parse
				expect(bg, "--ui-bg must be a parseable color").not.toBeNull();
				expect(text, "--ui-text must be a parseable color").not.toBeNull();

				if (!bg || !text || !muted || !accent || !accentText) return;

				// Normal text on background: ≥ 4.5
				const textContrast = contrast(text, bg);
				expect(
					textContrast,
					`${id} ${mode}: text on bg = ${textContrast.toFixed(2)} (need ≥ 4.5)`
				).toBeGreaterThanOrEqual(4.5);

				// Muted text on background: ≥ 4.5 (muted is still body-size)
				const mutedContrast = contrast(muted, bg);
				expect(
					mutedContrast,
					`${id} ${mode}: muted on bg = ${mutedContrast.toFixed(2)} (need ≥ 4.5)`
				).toBeGreaterThanOrEqual(4.5);

				// Accent text on accent fill: ≥ 3 (large/UI text)
				if (accentText) {
					const accentTextContrast = contrast(accentText, accent);
					expect(
						accentTextContrast,
						`${id} ${mode}: accent-text on accent = ${accentTextContrast.toFixed(2)} (need ≥ 3)`
					).toBeGreaterThanOrEqual(3);
				}

				// Text on surface: ≥ 4.5
				if (surface) {
					const surfaceContrast = contrast(text, surface);
					expect(
						surfaceContrast,
						`${id} ${mode}: text on surface = ${surfaceContrast.toFixed(2)} (need ≥ 4.5)`
					).toBeGreaterThanOrEqual(4.5);
				}
			});
		}
	}
});
