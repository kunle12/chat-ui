import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REQUIRED_TOKEN_NAMES } from "../types";

/**
 * Phase 2 wiring + drift tests (log tasks P2-07, P2-01).
 *
 * 1. Wiring: every required token must be consumed by at least one rule in
 *    the app CSS, by the theme runtime, or by a Tailwind utility in a
 *    component. A theme author's value must never be silently dead. Reserved
 *    exceptions are listed with the phase that will consume them.
 * 2. Completeness: the lcars theme package defines every required token for
 *    both modes (THEMES.md §6.1 — the validator's rule, applied to built-ins).
 * 3. Drift: the LCARS values in main.css `:root` (the fallback for themes
 *    that omit tokens) must equal the light block in
 *    `src/lib/themes/lcars/theme.css` — the two are deliberately separate
 *    declarations, so they are pinned to each other here.
 */

const stylesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../styles");
const SOURCES = ["main.css", "highlight-js.css", "themes.css"].map((f) =>
	readFileSync(resolve(stylesDir, f), "utf-8")
);

// Svelte components consume tokens through Tailwind utilities (bg-ui-panel →
// var(--ui-surface)); map the @theme inline names back to tokens so utility
// usage counts as a consumer.
const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
function walkSvelte(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = resolve(dir, entry);
		if (statSync(full).isDirectory()) out.push(...walkSvelte(full));
		else if (entry.endsWith(".svelte")) out.push(readFileSync(full, "utf-8"));
	}
	return out;
}
const svelteFiles = walkSvelte(srcDir);

function inlineTokenMappings(mainCss: string): Map<string, string> {
	// --color-ui-<suffix>: var(--ui-<token>) → suffix → token
	const block = mainCss.slice(mainCss.indexOf("@theme inline"));
	const mappings = new Map<string, string>();
	for (const m of block.matchAll(/--color-ui-([a-z0-9-]+)\s*:\s*var\(--ui-([a-z0-9-]+)\)/g)) {
		mappings.set(m[1], m[2]);
	}
	return mappings;
}

// The theme-color token is consumed at runtime (getComputedStyle in
// themes.svelte.ts), not via var() in a stylesheet.
const runtimeTs = readFileSync(
	resolve(dirname(fileURLToPath(import.meta.url)), "../themes.svelte.ts"),
	"utf-8"
);

function tokenConsumed(name: string, inline: Map<string, string>): boolean {
	if (SOURCES.join("\n").includes(`var(${name})`)) return true;
	// Runtime consumption (getComputedStyle("--ui-theme-color")).
	if (runtimeTs.includes(`"${name}"`)) return true;
	// Tailwind utilities in components: -ui-<suffix> maps back to the token.
	for (const [suffix, token] of inline) {
		if (token !== name) continue;
		const util = new RegExp(`(?<![a-z])ui-${suffix}(?![a-z0-9-])`);
		if (svelteFiles.some((content) => util.test(content))) return true;
	}
	return false;
}

/**
 * Tokens that are declared but deliberately not consumed yet, with the phase
 * that wires them. Keeping this list explicit (instead of weakening the test)
 * makes every unwired token a reviewed decision.
 */
const RESERVED: Readonly<Record<string, string>> = Object.freeze({
	// Density tokens only affect primitives (THEMES.md §7 coverage note);
	// office consumes both with real values in Phase 4.
	"--ui-gutter": "reserved for the office document-page gutters (P4)",
	"--ui-font-size-base": "primitives-only; raw text-* utilities unaffected (§7)",
	// Consumed by office's denser chrome in P4; LCARS has no strong-border
	// surface today.
	"--ui-border-strong": "office borders (P4)",
	"--ui-accent-hover": "office accent buttons (P4)",
	// UI-chrome links: every link today is markdown (prose), driven by
	// --ui-prose-link. --ui-link lands with a semantic link utility.
	"--ui-link": "UI-chrome links outside prose (P3/P4 chrome variants)",
	// Text-on-fill for the semantic states — consumed by the D14 sweep
	// (high-traffic non-neutral surfaces) in P4-07.
	"--ui-danger": "semantic danger surfaces (D14 sweep, P4-07)",
	"--ui-danger-text": "semantic danger surfaces (D14 sweep, P4-07)",
	"--ui-warning-text": "semantic warning surfaces (D14 sweep, P4-07)",
	"--ui-success-text": "semantic success surfaces (D14 sweep, P4-07)",
	"--ui-info": "semantic info surfaces (D14 sweep, P4-07)",
	"--ui-info-text": "semantic info surfaces (D14 sweep, P4-07)",
	// No primitive uses the small radius yet (chip uses md, screen xl).
	"--ui-radius-sm": "first primitive that wants a small radius",
});

describe("token wiring (every required token has a consumer)", () => {
	it("consumes every required token in CSS, runtime or component utilities", () => {
		const inline = inlineTokenMappings(SOURCES[0]);
		const unwired = REQUIRED_TOKEN_NAMES.filter((name) => !tokenConsumed(name, inline)).filter(
			(name) => !(name in RESERVED)
		);

		expect(unwired, `tokens declared but never consumed: ${unwired.join(", ")}`).toEqual([]);
	});

	it("keeps the reserved list honest (no stale reservations)", () => {
		const inline = inlineTokenMappings(SOURCES[0]);
		for (const name of Object.keys(RESERVED)) {
			expect(tokenConsumed(name, inline), `${name} is consumed — remove it from RESERVED`).toBe(
				false
			);
		}
	});
});

describe("LCARS theme package", () => {
	const themeCss = readFileSync(
		resolve(dirname(fileURLToPath(import.meta.url)), "../lcars/theme.css"),
		"utf-8"
	);

	function extractBlock(selector: string): Record<string, string> {
		const idx = themeCss.indexOf(selector);
		expect(idx, `selector not found in lcars/theme.css: ${selector}`).toBeGreaterThan(-1);
		const open = themeCss.indexOf("{", idx);
		let depth = 1;
		let end = open + 1;
		while (depth > 0 && end < themeCss.length) {
			if (themeCss[end] === "{") depth++;
			if (themeCss[end] === "}") depth--;
			end++;
		}
		const body = themeCss.slice(open + 1, end - 1);
		const tokens: Record<string, string> = {};
		for (const m of body.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
			tokens[m[1]] = m[2].replace(/\s+/g, " ").trim();
		}
		return tokens;
	}

	it("defines every required token for both modes", () => {
		const light = extractBlock(':root[data-theme="lcars"]');
		const dark = extractBlock(':root[data-theme="lcars"].dark');
		const missing = {
			light: REQUIRED_TOKEN_NAMES.filter((n) => !(n in light)),
			dark: REQUIRED_TOKEN_NAMES.filter((n) => !(n in dark)),
		};
		expect(missing.light).toEqual([]);
		expect(missing.dark).toEqual([]);
	});

	it("pins the main.css :root fallback values to the lcars light block", () => {
		// main.css :root is the fallback for themes that omit tokens; it must
		// define EVERY required token (a missing one would break rendering for
		// themes that omit it — e.g. body font-family) and its values must BE
		// the lcars light values or the fallback semantics lie.
		const mainCss = SOURCES[0];
		const rootIdx = mainCss.indexOf(":root {\n\t/* Surface */");
		expect(rootIdx, "main.css :root token block moved — update this test").toBeGreaterThan(-1);
		const open = mainCss.indexOf("{", rootIdx);
		const close = mainCss.indexOf("\n}", open);
		const body = mainCss.slice(open + 1, close);

		const fallback: Record<string, string> = {};
		for (const m of body.matchAll(/(--ui-[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
			fallback[m[1]] = m[2].replace(/\s+/g, " ").trim();
		}

		// Fallback completeness: every required token must be declared.
		const absent = REQUIRED_TOKEN_NAMES.filter((name) => !(name in fallback));
		expect(absent, `main.css :root fallback is missing tokens: ${absent.join(", ")}`).toEqual([]);

		// Extract the light block values, resolving multi-line values the same way.
		const light = extractBlock(':root[data-theme="lcars"]');
		const mismatched = REQUIRED_TOKEN_NAMES.filter(
			(name) =>
				name in fallback &&
				name in light &&
				// Multi-line values are formatted differently between the files —
				// compare with whitespace collapsed.
				fallback[name] !== light[name]
		);
		expect(
			mismatched,
			`main.css :root fallback drifted from lcars/theme.css light block: ${mismatched.join(", ")}`
		).toEqual([]);
	});
});
