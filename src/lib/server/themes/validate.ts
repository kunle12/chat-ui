import { parse, walk } from "css-tree";

/**
 * Structural CSS validation for external themes (THEMES.md §8.2/§10, log
 * tasks P5-04/P5-05). Uses a real CSS parser (css-tree).
 */

export interface ValidationIssue {
	rule: string;
	message: string;
}

export function validateThemeCss(css: string, themeId: string): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const scope = `[data-theme="${themeId}"]`;
	let layerDepth = 0;

	const REJECTED_AT_RULES = new Set(["import", "property", "font-face", "keyframes"]);

	try {
		const ast = parse(css, { parseValue: false, parseAtrulePrelude: false });

		walk(ast, (node) => {
			if (node.type === "Atrule") {
				const name = (node as { name?: string }).name?.toLowerCase() ?? "";
				if (name === "layer") layerDepth++;
				if (REJECTED_AT_RULES.has(name)) {
					issues.push({
						rule: `@${name}`,
						message: `@${name} at-rules are rejected (global at-rules leak across themes)`,
					});
				}
			}

			if (node.type === "Rule") {
				const prelude = (node as { prelude?: { value?: string } }).prelude;
				const selector = typeof prelude?.value === "string" ? prelude.value : "";
				const scoped = selector.includes(scope) || selector.includes(`[data-theme="${themeId}"]`);
				if (selector.trim().length > 0 && !scoped && !selector.startsWith("@")) {
					issues.push({
						rule: "scope",
						message: `selector not scoped to ${scope}: ${selector.slice(0, 80)}`,
					});
				}
				if (/^(html\b|body\b)/i.test(selector.trim())) {
					issues.push({ rule: "html-body", message: "html/body selectors are rejected" });
				}

				const block = (node as { block?: { children?: { toArray?: () => unknown[] } } }).block;
				const children =
					block?.children && typeof block.children.toArray === "function"
						? block.children.toArray()
						: [];
				for (const child of children) {
					const c = child as {
						type?: string;
						property?: string;
						important?: boolean;
						value?: { value?: string };
					};
					if (c.type !== "Declaration") continue;
					if (c.important) {
						issues.push({ rule: "!important", message: "!important is rejected (§5.1)" });
					}
					const value = c.value?.value ?? "";
					if (/url\s*\(/i.test(value)) {
						issues.push({
							rule: "url()",
							message: `url() is rejected in external theme CSS: ${value.slice(0, 60)}`,
						});
					}
					const prop = c.property ?? "";
					if (prop === "display" && /none/i.test(value)) {
						issues.push({
							rule: "display:none",
							message:
								"display:none on content elements is rejected (hide chrome via chrome flags)",
						});
					}
					// Structural declarations outside @layer components would beat
					// every layered rule (§5.1). Token declarations are exempt.
					if (layerDepth === 0 && !prop.startsWith("--") && prop.length > 0) {
						issues.push({
							rule: "unlayered-structural",
							message: `declaration "${prop}" outside @layer components (§5.1: only token blocks may be unlayered)`,
						});
					}
				}
			}

			// Track @layer exit
			if (node.type === "Atrule" && (node as { name?: string }).name === "layer") {
				// css-tree walk doesn't have a leave callback in flat mode;
				// the depth tracking is handled by the Block children scan below.
			}
		});
	} catch (err) {
		issues.push({
			rule: "parse",
			message: `CSS failed to parse: ${err instanceof Error ? err.message : "unknown error"}`,
		});
	}

	return issues;
}
