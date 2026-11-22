/**
 * Offline external-theme validation (THEMES.md §9.4, log P5-04/05/07).
 *
 * Usage: node --experimental-strip-types scripts/validate-themes.ts <dir>
 *
 * Validates every theme in the given directory:
 *  - manifest schema + external-theme rules (no structure field)
 *  - token grammar (no url())
 *  - CSS structure (css-tree: scoped selectors, no global at-rules, etc.)
 *  - font files exist + license file when fonts are bundled
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { themeManifestSchema, validateTokenValue, THEME_ID_REGEX } from "../src/lib/themes/types";
import { validateThemeCss } from "../src/lib/server/themes/validate";

const dir = process.argv[2];
if (!dir || !existsSync(dir)) {
	console.error("Usage: node --experimental-strip-types scripts/validate-themes.ts <dir>");
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
	let manifest: ReturnType<typeof themeManifestSchema.parse> | null = null;
	try {
		manifest = themeManifestSchema.parse(
			JSON.parse(readFileSync(join(themePath, "theme.json"), "utf-8"))
		);
	} catch (err) {
		const issues = err instanceof Error ? err.message : String(err);
		console.log(`  ✗ manifest invalid: ${issues}`);
		failed = true;
		continue;
	}
	const m = manifest;

	// External themes may not ship structural variants (decision D2).
	if (m.chrome?.structure) {
		errors.push("manifest.chrome.structure: external themes may not set structure");
	}

	// Token grammar
	if (m.tokens) {
		for (const mode of ["light", "dark"] as const) {
			for (const [name, value] of Object.entries(m.tokens[mode] ?? {})) {
				if (value.includes("url(")) {
					errors.push(`tokens.${mode}.${name}: url() is rejected`);
				}
				if (
					!validateTokenValue("color", value) &&
					!validateTokenValue("length", value) &&
					!validateTokenValue("duration", value) &&
					!validateTokenValue("shadow", value) &&
					!validateTokenValue("easing", value) &&
					!validateTokenValue("screenImage", value) &&
					!validateTokenValue("labelTransform", value) &&
					!validateTokenValue("fontStack", value)
				) {
					errors.push(`tokens.${mode}.${name}: value does not match any token grammar`);
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
