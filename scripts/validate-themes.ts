/**
 * Offline external-theme validation (THEMES.md §9.4, log tasks P5-04/P5-05/P5-07).
 *
 * Usage: node --experimental-strip-types --no-warnings scripts/validate-themes.ts [dir]
 *
 * Validates every theme in $THEMES_DIR (or the given directory):
 *  - manifest schema (zod) + external-theme rules (no structure field)
 *  - token grammar (per-token types, no url())
 *  - CSS structure (scoped selectors, @layer components, no global at-rules,
 *    no !important, no url(), no html/body, no unlayered structural rules)
 *  - font files present when listed + license file when fonts are bundled
 *  - required-token completeness per declared mode
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	themeManifestSchema,
	missingRequiredTokens,
	THEME_ID_REGEX,
	type ThemeMode,
} from "../src/lib/themes/types";
import { validateThemeCss } from "../src/lib/server/themes/validate";

const dir = process.argv[2] ?? process.env.THEMES_DIR;
if (!dir || !existsSync(dir)) {
	console.error("Usage: node --experimental-strip-types scripts/validate-themes.ts <themes-dir>");
	console.error("  (or set THEMES_DIR)");
	process.exit(1);
}

let failed = false;

for (const id of readdirSync(dir).sort()) {
	if (!THEME_ID_REGEX.test(id)) continue;
	const themePath = join(dir, id);
	if (!statSync(themePath).isDirectory() || !existsSync(join(themePath, "theme.json"))) continue;

	console.log(`\nValidating ${id}...`);
	const errors: string[] = [];

	// Manifest schema
	const manifest = themeManifestSchema.safeParse(
		JSON.parse(readFileSync(join(themePath, "theme.json"), "utf-8"))
	);
	if (!manifest.success) {
		for (const issue of manifest.error.issues) {
			errors.push(`manifest.${issue.path.join(".")}: ${issue.message}`);
		}
		console.log(`  ✗ manifest invalid`);
		continue;
	}
	const m = manifest.data;

	// External themes may not ship structural variants (decision D2).
	if (m.chrome?.structure) {
		errors.push(`manifest.chrome.structure: external themes may not set "structure"`);
	}

	// Token grammar + completeness
	if (m.tokens) {
		for (const mode of ["light", "dark"] as const) {
			const tokens = m.tokens[mode] ?? {};
			for (const [name, value] of Object.entries(tokens)) {
				if (value.includes("url(")) {
					errors.push(`tokens.${mode}.${name}: url() is rejected`);
				}
			}
		}
		const byMode: Record<ThemeMode, Record<string, string>> = {
			light: m.tokens?.light ?? {},
			dark: m.tokens?.dark ?? {},
		};
		for (const mode of m.modes) {
			for (const name of missingRequiredTokens(m.modes, byMode)[mode]) {
				if (byMode[mode].length > 0 || mode === m.modes[0]) {
					errors.push(`tokens.${mode}: missing required token ${name}`);
				}
			}
		}
	}

	// CSS structural validation
	const cssPath = join(themePath, "theme.css");
	if (m.css && existsSync(cssPath)) {
		const css = readFileSync(cssPath, "utf-8");
		for (const issue of validateThemeCss(css, m.id)) {
			errors.push(`css [${issue.rule}]: ${issue.message}`);
		}
	}

	// Fonts: files exist + license when bundled
	if (m.fonts?.length) {
		for (const font of m.fonts) {
			if (!existsSync(join(themePath, "fonts", font))) {
				errors.push(`fonts: ${font} listed but missing`);
			}
		}
		const hasLicense = [
			"LICENSE",
			"LICENSE.txt",
			"OFL.txt",
			"OFL-Selawik.txt",
			"OFL-Carlito.txt",
		].some((name) => existsSync(join(themePath, name)));
		if (!hasLicense) {
			errors.push("fonts: license file required when fonts are bundled");
		}
	}

	if (errors.length) {
		failed = true;
		for (const err of errors) console.log(`  ✗ ${err}`);
	} else {
		console.log(`  ✓ ${m.name} v${m.version} (${m.modes.join(", ")})`);
	}
}

process.exit(failed ? 1 : 0);
