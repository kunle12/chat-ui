import { z } from "zod";

/**
 * Theme contract v1 — see THEMES.md §6 (token contract), §8 (package format)
 * and §6.2.1 (per-token value grammar).
 *
 * This module is the single source of truth for:
 *  - the manifest schema (`themeManifestSchema`, zod)
 *  - the required-token list (`REQUIRED_TOKENS`) — consumed by the validator,
 *    the token-wiring test and the docs
 *  - the per-token value grammar (`TOKEN_GRAMMAR` / `validateTokenValue`)
 */

export const THEME_ID_REGEX = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const THEME_VERSION_REGEX = /^\d+\.\d+\.\d+$/;

export type ThemeMode = "light" | "dark";
export const THEME_MODES: readonly ThemeMode[] = ["light", "dark"];

/** What the user picks; `system` resolves against `prefers-color-scheme`. */
export type ThemeModePreference = ThemeMode | "system";

/* -------------------------------------------------------------------------- */
/* Chrome + labels (§7 "Chrome features")                                      */
/* -------------------------------------------------------------------------- */

export const themeChromeSchema = z
	.object({
		statusStrip: z.enum(["full", "compact", "hidden"]).default("full"),
		chatHeader: z.enum(["readout", "minimal", "hidden"]).default("readout"),
		sidebar: z.enum(["rail", "plain"]).default("rail"),
		/**
		 * Built-in themes only: selects the bundled structural variant
		 * (§11). External themes may not set it — the registry rejects the
		 * manifest when `structure` is present on a non-built-in theme.
		 */
		structure: z.enum(["lcars", "classic", "office"]).optional(),
	})
	.default({});

export const themeLabelsSchema = z
	.record(
		z
			.string()
			.max(80)
			// Plain strings only — no HTML/Markdown reaches the strip markup.
			// `{count}` is the sanctioned interpolation placeholder.
			.refine(
				(v) => !/[<>]/.test(v) && v.replace(/\{count\}/g, "").indexOf("{") === -1,
				"labels must be plain text (only {count} interpolation allowed)"
			)
	)
	.default({});

export type ThemeChrome = z.infer<typeof themeChromeSchema>;
export type ThemeLabels = z.infer<typeof themeLabelsSchema>;

/* -------------------------------------------------------------------------- */
/* Per-token value grammar (§6.2.1)                                            */
/* -------------------------------------------------------------------------- */

export type TokenKind =
	| "color"
	| "length"
	| "duration"
	| "easing"
	| "shadow"
	| "fontStack"
	| "screenImage"
	| "labelTransform";

/**
 * Token value grammars. These are intentionally strict: token values can end
 * up in inline `<style>` blocks for portable/user themes, so anything that can
 * make a network request (`url()`) or escape a declaration is rejected.
 *
 * - `color`: hex / rgb() / hsl() / oklch() / color-mix() / var(--ui-…) only —
 *   no `url()`, no `attr()`, no `env()`.
 * - `length`: px / rem / em / % / calc() (unitless zero allowed for
 *   border-width-style tokens).
 * - `duration`: ms / s.
 * - `easing`: named easing allowlist plus cubic-bezier() (no network surface).
 * - `shadow`: comma-separated lengths + colors; no `url()`.
 * - `fontStack`: a fixed allowlist of stack keywords, never a raw family list
 *   (raw lists are only allowed in built-in CSS, which is trusted app code).
 * - `screenImage`: `none` or a `linear-gradient(…)`.
 * - `labelTransform`: CSS text-transform keywords relevant to labels.
 */
const COLOR_VALUE =
	/^(#[0-9a-fA-F]{3,8}|transparent|currentcolor|(rgba?|hsla?|oklch|oklab|lab|lch|hwb|color-mix|color)\([^();]*\]|(rgba?|hsla?|oklch|oklab|lab|lch|hwb|color-mix|color)\((?:[^();]|\([^()]*\))*\)|var\(--[a-zA-Z0-9-]+\))$/i;
const LENGTH_VALUE =
	/^(0(?:\.0+)?|[-+]?(?:\d*\.\d+|\d+)(?:px|rem|em|%|vw|vh)|calc\((?:[^()]|\([^()]*\))*\))$/i;
const DURATION_VALUE = /^[-+]?(?:\d*\.\d+|\d+)(?:ms|s)$/i;
const EASING_VALUE =
	/^(linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end|cubic-bezier\((?:[^()]|\([^()]*\))*\))$/i;
const SHADOW_ITEM = /^(?:[-+\d.,\s()#a-zA-Z%]|var\(--[a-zA-Z0-9-]+\))+$/i;
const FONT_STACKS = ["system", "serif", "sans", "mono", "theme"] as const;
const LABEL_TRANSFORMS = ["none", "uppercase", "lowercase", "capitalize"] as const;

export const TOKEN_GRAMMAR: Record<TokenKind, { test: (value: string) => boolean; hint: string }> =
	{
		color: {
			test: (v) => COLOR_VALUE.test(v.trim()) && !/url\(/i.test(v),
			hint: "hex, rgb(), hsl(), oklch(), color-mix(), var(--ui-…) or transparent — no url()",
		},
		length: {
			test: (v) => LENGTH_VALUE.test(v.trim()),
			hint: "a px/rem/em/%/vw/vh length or calc()",
		},
		duration: {
			test: (v) => DURATION_VALUE.test(v.trim()),
			hint: "a duration in ms or s",
		},
		easing: {
			test: (v) => EASING_VALUE.test(v.trim()),
			hint: "a named easing or cubic-bezier()",
		},
		shadow: {
			test: (v) =>
				!/url\(/i.test(v) &&
				v
					.split(/,(?![^(]*\))/)
					.map((part) => part.trim())
					.every((part) => SHADOW_ITEM.test(part)),
			hint: "comma-separated lengths and colors — no url()",
		},
		fontStack: {
			test: (v) => (FONT_STACKS as readonly string[]).includes(v.trim()),
			hint: `one of: ${FONT_STACKS.join(", ")}`,
		},
		screenImage: {
			test: (v) =>
				v.trim() === "none" || /^linear-gradient\((?:[^()]|\([^()]*\))*\)$/i.test(v.trim()),
			hint: "`none` or a linear-gradient(…)",
		},
		labelTransform: {
			test: (v) => (LABEL_TRANSFORMS as readonly string[]).includes(v.trim()),
			hint: `one of: ${LABEL_TRANSFORMS.join(", ")}`,
		},
	};

export function validateTokenValue(kind: TokenKind, value: string): boolean {
	return TOKEN_GRAMMAR[kind].test(value);
}

/* -------------------------------------------------------------------------- */
/* Required tokens (§6.1)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every required token with its grammar kind. Themes must define each of
 * these for every mode they declare; omitted values inherit the LCARS
 * defaults from `:root` (documented fallback), and the validator warns.
 */
export const REQUIRED_TOKENS: Readonly<Record<string, TokenKind>> = Object.freeze({
	// Surface
	"--ui-bg": "color",
	"--ui-surface": "color",
	"--ui-surface-raised": "color",
	"--ui-surface-sunken": "color",
	"--ui-screen": "color",
	"--ui-overlay": "color",
	"--ui-border": "color",
	"--ui-border-strong": "color",
	// Text
	"--ui-text": "color",
	"--ui-text-muted": "color",
	"--ui-text-faint": "color",
	"--ui-text-inverse": "color",
	"--ui-link": "color",
	// Actions
	"--ui-accent": "color",
	"--ui-accent-hover": "color",
	"--ui-accent-text": "color",
	"--ui-danger": "color",
	"--ui-danger-text": "color",
	"--ui-warning": "color",
	"--ui-warning-text": "color",
	"--ui-success": "color",
	"--ui-success-text": "color",
	"--ui-info": "color",
	"--ui-info-text": "color",
	// Chat
	"--ui-bubble-user-bg": "color",
	"--ui-bubble-user-text": "color",
	"--ui-bubble-assistant-bg": "color",
	"--ui-bubble-assistant-text": "color",
	"--ui-code-bg": "color",
	"--ui-code-text": "color",
	// States
	"--ui-selection-bg": "color",
	"--ui-scrollbar-thumb": "color",
	"--ui-prose-body": "color",
	"--ui-prose-heading": "color",
	"--ui-prose-link": "color",
	"--ui-prose-code": "color",
	"--ui-prose-quote": "color",
	"--ui-prose-rule": "color",
	"--ui-syntax-comment": "color",
	"--ui-syntax-string": "color",
	"--ui-syntax-keyword": "color",
	"--ui-syntax-number": "color",
	"--ui-syntax-function": "color",
	"--ui-theme-color": "color",
	// Type
	"--ui-font-sans": "fontStack",
	"--ui-font-display": "fontStack",
	"--ui-font-mono": "fontStack",
	"--ui-font-size-base": "length",
	"--ui-label-tracking": "length",
	"--ui-label-transform": "labelTransform",
	// Shape
	"--ui-radius-sm": "length",
	"--ui-radius-md": "length",
	"--ui-radius-lg": "length",
	"--ui-radius-xl": "length",
	"--ui-radius-pill": "length",
	"--ui-border-width": "length",
	// Depth
	"--ui-shadow-sm": "shadow",
	"--ui-shadow-md": "shadow",
	"--ui-shadow-lg": "shadow",
	"--ui-focus-ring-color": "color",
	"--ui-focus-ring-width": "length",
	"--ui-focus-ring-offset": "length",
	// Motion
	"--ui-motion-fast": "duration",
	"--ui-motion-base": "duration",
	"--ui-motion-ease": "easing",
	// Density
	"--ui-control-height": "length",
	"--ui-gutter": "length",
});

export const REQUIRED_TOKEN_NAMES: readonly string[] = Object.keys(REQUIRED_TOKENS);

/** Optional tokens (§6.2) — declared by themes that use them, wired in Phase 2. */
export const OPTIONAL_TOKEN_NAMES: readonly string[] = Object.freeze([
	"--ui-screen-image",
	"--ui-accent-ink",
	"--ui-topbar-bg",
	"--ui-statusbar-bg",
	"--ui-statusbar-text",
	"--ui-sidebar-bg",
	"--ui-scanline",
	"--ui-logo-filter",
	"--ui-beacon-bg",
	"--ui-screen-border",
	"--ui-cite-bg",
	"--ui-cite-text",
	"--ui-highlight-bg",
	"--ui-shimmer-from",
	"--ui-shimmer-to",
]);

/** `true` for names like `--ui-bg`; rejects anything that is not a `--ui-*` token. */
export function isUiTokenName(name: string): boolean {
	return /^--ui-[a-z0-9-]+$/.test(name);
}

/**
 * Validate a token map for one mode: unknown token names are rejected (they
 * would be silently dead), known names are checked against their grammar.
 * Returns a list of human-readable problems.
 */
export function validateTokenMap(tokens: Record<string, string>): string[] {
	const problems: string[] = [];
	for (const [name, value] of Object.entries(tokens)) {
		if (!isUiTokenName(name)) {
			problems.push(`${name}: not a --ui-* token name`);
			continue;
		}
		const kind = REQUIRED_TOKENS[name];
		if (!kind) {
			// Optional tokens are allowed but currently unwired — flag them so an
			// author does not expect an effect before Phase 2 wiring lands.
			if (!OPTIONAL_TOKEN_NAMES.includes(name)) {
				problems.push(`${name}: unknown token`);
			}
			continue;
		}
		if (!validateTokenValue(kind, value)) {
			problems.push(`${name}: ${value} is not ${TOKEN_GRAMMAR[kind].hint}`);
		}
	}
	return problems;
}

/** Missing required tokens for a set of declared modes (per-mode maps). */
export function missingRequiredTokens(
	modes: readonly ThemeMode[],
	byMode: Record<ThemeMode, Record<string, string>>
): Record<ThemeMode, string[]> {
	const result = {} as Record<ThemeMode, string[]>;
	for (const mode of modes) {
		const have = byMode[mode] ?? {};
		result[mode] = REQUIRED_TOKEN_NAMES.filter((name) => !(name in have));
	}
	return result;
}

/* -------------------------------------------------------------------------- */
/* Manifest schema (§8.1)                                                      */
/* -------------------------------------------------------------------------- */

export const themeManifestSchema = z.object({
	apiVersion: z.literal(1),
	id: z.string().regex(THEME_ID_REGEX),
	name: z.string().min(1).max(60),
	version: z.string().regex(THEME_VERSION_REGEX),
	description: z.string().max(280).optional(),
	author: z.string().max(120).optional(),
	license: z.string().max(60).optional(),
	homepage: z.string().url().optional(),
	modes: z.array(z.enum(["light", "dark"])).min(1),
	chrome: themeChromeSchema.default({}),
	labels: themeLabelsSchema.default({}),
	/** token-only themes (safe for user upload) carry values inline */
	tokens: z
		.object({
			light: z.record(z.string(), z.string()).default({}),
			dark: z.record(z.string(), z.string()).default({}),
		})
		.optional(),
	/** structural CSS only for operator-installed themes */
	css: z.literal("theme.css").optional(),
	fonts: z
		.array(z.string().regex(/^[a-z0-9._-]+\.woff2$/i))
		.max(8)
		.optional(),
	preview: z.object({ light: z.string().optional(), dark: z.string().optional() }).optional(),
});

export type ThemeManifest = z.infer<typeof themeManifestSchema>;

/**
 * Built-in manifests additionally declare the structural variant they ship
 * component code for (§7: `structure` is ignored for external themes).
 */
export function builtinStructure(manifest: ThemeManifest): NonNullable<ThemeChrome["structure"]> {
	return manifest.chrome.structure ?? "lcars";
}
