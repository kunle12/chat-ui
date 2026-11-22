/**
 * Raw-color ratchet (THEMES.md §12.4, log task P0-06).
 *
 * Counts raw color utilities in .svelte files and fails if any category grew
 * beyond the committed baseline in scripts/theme-color-baseline.json. The
 * numbers shrink as surfaces migrate to `--ui-*` semantic tokens; when a
 * category shrinks, lower the baseline in the same commit.
 *
 * Run: npm run check:theme-colors
 *
 * The exact counting commands (reproduce manually with):
 *
 *   neutral:     grep -roE '(bg|text|border|from|via|to|ring)-(white|black|gray-[0-9]+)(/[0-9]+)?' src --include='*.svelte' | wc -l
 *   nonNeutral:  grep -roE '(bg|text|border|from|via|to|ring)-(blue|purple|green|red|amber|yellow|orange|pink|rose|violet|indigo|sky|teal|emerald|lime|cyan|fuchsia|slate|zinc|stone|neutral)-[0-9]+(/[0-9]+)?' src --include='*.svelte' | wc -l
 *   arbitraryHex: grep -roE '(bg|text|border|from|via|to|ring|outline|decoration|accent|caret|fill|stroke|shadow|ring-offset)-\[#' src --include='*.svelte' | wc -l
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../src", import.meta.url).pathname;
const BASELINE = JSON.parse(
	readFileSync(new URL("./theme-color-baseline.json", import.meta.url), "utf-8")
) as { neutral: number; nonNeutral: number; arbitraryHex: number };

const PATTERNS: Record<keyof typeof BASELINE, RegExp> = {
	neutral: /\b(?:bg|text|border|from|via|to|ring)-(?:white|black|gray-\d+)(?:\/\d+)?\b/g,
	nonNeutral:
		/\b(?:bg|text|border|from|via|to|ring)-(?:blue|purple|green|red|amber|yellow|orange|pink|rose|violet|indigo|sky|teal|emerald|lime|cyan|fuchsia|slate|zinc|stone|neutral)-\d+(?:\/\d+)?\b/g,
	arbitraryHex:
		/\b(?:bg|text|border|from|via|to|ring|outline|decoration|accent|caret|fill|stroke|shadow|ring-offset)-\[#/g,
};

function walkSvelte(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const stat = statSync(full);
		if (stat.isDirectory()) out.push(...walkSvelte(full));
		else if (entry.endsWith(".svelte")) out.push(full);
	}
	return out;
}

const files = walkSvelte(SRC);
const counts = { neutral: 0, nonNeutral: 0, arbitraryHex: 0 } as Record<
	keyof typeof BASELINE,
	number
>;

for (const file of files) {
	const content = readFileSync(file, "utf-8");
	for (const [name, regex] of Object.entries(PATTERNS)) {
		counts[name as keyof typeof BASELINE] += (content.match(regex) ?? []).length;
	}
}

let failed = false;
const report: string[] = [];
for (const name of Object.keys(PATTERNS) as (keyof typeof BASELINE)[]) {
	const current = counts[name];
	const base = BASELINE[name];
	const delta = current - base;
	const mark = delta > 0 ? "FAIL" : delta < 0 ? "improved" : "ok";
	report.push(
		`  ${name.padEnd(12)} ${String(current).padStart(5)} / baseline ${String(base).padStart(5)}  (${delta >= 0 ? "+" : ""}${delta})  ${mark}`
	);
	if (delta > 0) failed = true;
	else if (delta < 0)
		report.push(
			`    → lower "${name}" in scripts/theme-color-baseline.json to lock in the improvement`
		);
}

console.log(`theme-color ratchet over ${files.length} .svelte files:`);
console.log(report.join("\n"));

if (failed) {
	console.error(
		"\nRaw color utilities increased — use --ui-* semantic tokens instead (THEMES.md §12.3)."
	);
	process.exit(1);
}
