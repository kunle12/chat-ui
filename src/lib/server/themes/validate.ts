import { parse, walk } from "css-tree";

/**
 * Structural CSS validation for external themes (THEMES.md §8.2/§10, log
 * tasks P5-04/P5-05).
 *
 * Uses a real CSS parser (css-tree) — regex validation cannot catch nested
 * violations or encoded at-rules. Rules:
 *  - token blocks: unlayered, scoped to :root[data-theme="<id>"]
 *  - structural overrides: inside @layer components, same scoping
 *  - rejected: @import/@property/@font-face/@keyframes, !important,
 *    url() (external theme CSS may not make any request; font loading goes
 *    through the fonts/ API route), html/body selectors, display:none
 *  - theme.json token values are validated by the per-token grammar in
 *    types.ts (P5-05)
 */

export interface ValidationIssue {
	rule: string;
	message: string;
}

export function validateThemeCss(css: string, themeId: string): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const scope = `[data-theme="${themeId}"]`;
	let layerDepth = 0;

	try {
		const ast = parse(css, { parseValue: false, parseAtrulePrelude: false, positions: false });

		walk(ast, {
			atrule(node: { name: string }) {
				const name = node.name.toLowerCase();
				if (name === "layer") layerDepth++;
				if (["import", "property", "font-face", "keyframes"].includes(name)) {
					issues.push({
						rule: `@${name}`,
						message: `@${name} at-rules are rejected (global at-rules leak across themes)`,
					});
				}
			},
			rule: {
				enter(node: {
					prelude: { value: string } | null;
					block: {
						children: {
							toArray: () => Array<{
								type: string;
								property?: string;
								value?: { value: string };
								important?: boolean;
							}>;
						};
					} | null;
				}) {
					const selector = node.prelude?.value ?? "";
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

					const children = node.block?.children?.toArray() ?? [];
					const layerActive = layerDepth > 0;
					for (const child of children) {
						if (child.type !== "Declaration") continue;
						const prop = child.property ?? "";
						const value = child.value?.value ?? "";

						if (child.important) {
							issues.push({ rule: "!important", message: "!important is rejected (§5.1)" });
						}
						if (/url\s*\(/i.test(value)) {
							issues.push({
								rule: "url()",
								message: `url() is rejected in external theme CSS: ${value.slice(0, 60)}`,
							});
						}
						if (prop === "display" && /none/i.test(value)) {
							issues.push({
								rule: "display:none",
								message:
									"display:none on content elements is rejected (hide chrome via chrome flags)",
							});
						}
						// Structural (non-token) declarations outside @layer components
						// would beat every layered rule (§5.1).
						if (!layerActive && !prop.startsWith("--") && prop.length > 0) {
							issues.push({
								rule: "unlayered-structural",
								message: `declaration "${prop}" outside @layer components (§5.1: only token blocks may be unlayered)`,
							});
						}
					}
				},
				leave(node: { name: string }) {
					if (node.name?.toLowerCase() === "layer") layerDepth--;
				},
			} as never,
		});
	} catch (err) {
		issues.push({
			rule: "parse",
			message: `CSS failed to parse: ${err instanceof Error ? err.message : "unknown error"}`,
		});
	}

	return issues;
}
