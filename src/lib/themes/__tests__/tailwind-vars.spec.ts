import { describe, expect, it } from "vitest";
import { compile } from "@tailwindcss/node";

/**
 * P0-03 regression test (THEMES.md §6.4 / log P0-03).
 *
 * The whole multi-theme bridge rests on two Tailwind v4 emission behaviours:
 *
 *  1. Static theme utilities compile to `var(--color-*)` — so an unlayered,
 *     scoped `--color-gray-*` override re-themes every existing neutral
 *     utility without touching components.
 *  2. `/opacity` utilities emit a build-time fallback PLUS an `@supports
 *     color-mix(in lab, …)` branch whose value uses `var(--color-*)` — so
 *     themes reach those surfaces on every engine that supports color-mix.
 *
 *  3. `@theme inline` utilities compile to the *raw* variable — overriding
 *     `--lcars-panel` works, overriding `--color-lcars-panel` does not
 *     (THEMES.md §6.4 note).
 *
 * If a Tailwind upgrade changes any of these, the neutral-ramp bridge is dead
 * and the fallback is the semantic-token migration (THEMES.md §12). This test
 * fails loudly before that can ship silently.
 */

const FIXTURE = `
@import "tailwindcss";
@theme {
	--color-gray-100: #f2eae0;
	--color-gray-200: #e5d9cc;
	--color-gray-500: #7e7080;
}
@theme inline {
	--color-ui-panel: var(--ui-panel);
}
:root {
	--ui-panel: #fbf7f1;
}
`;

async function buildOutput(candidates: string[]): Promise<string> {
	const compiler = await compile(FIXTURE, {
		base: process.cwd(),
		// Typed as optional, but the 4.3.3 implementation calls it unguarded in
		// loadStylesheet — omitting it throws `t is not a function`.
		onDependency: () => {},
	});
	return compiler.build(candidates);
}

describe("Tailwind v4 variable emission (theme bridge assumptions)", () => {
	it("emits var(--color-*) for static theme utilities", async () => {
		const css = await buildOutput(["bg-gray-100", "border-gray-200"]);
		expect(css).toMatch(/\.bg-gray-100\s*\{[^}]*background-color:\s*var\(--color-gray-100\)/);
		expect(css).toMatch(/\.border-gray-200\s*\{[^}]*border-color:\s*var\(--color-gray-200\)/);
	});

	it("emits the @supports color-mix branch using var(--color-*) for /opacity utilities", async () => {
		const css = await buildOutput(["bg-gray-500/10"]);
		// The @supports gate Tailwind emits for engines with color-mix support.
		expect(css).toMatch(/@supports\s*\(color:\s*color-mix\(in lab, red, red\)\)/);
		// Inside that gate the value must reference the theme variable, not a
		// build-time hex — this is the branch themes actually restyle.
		expect(css).toMatch(/color-mix\(in\s+oklab,\s*var\(--color-gray-500\)\s+10%,\s*transparent\)/);
		// The build-time fallback still exists for engines without color-mix.
		expect(css).toMatch(/color-mix\(in srgb,\s*#7e7080\s+10%,\s*transparent\)/);
	});

	it("compiles @theme inline utilities to the raw variable", async () => {
		const css = await buildOutput(["bg-ui-panel"]);
		// `inline` inlines the *value* — the raw var(--ui-panel) — so a theme
		// overriding --ui-panel re-themes the utility; --color-ui-panel is not
		// emitted as an intermediate variable at all.
		expect(css).toMatch(/\.bg-ui-panel\s*\{[^}]*background-color:\s*var\(--ui-panel\)/);
		expect(css).not.toMatch(/var\(--color-ui-panel\)/);
	});
});
