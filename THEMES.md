# Multi-theme architecture — design & implementation plan

Status: **proposal** · Author: engineering · Target release: next minor

> Execution tracking (phase checklists, decisions, verification):
> [`THEMES_IMPLEMENTATION_LOG.md`](./THEMES_IMPLEMENTATION_LOG.md). Update the log in the same
> commit as the work it describes.

This document specifies how chat-ui moves from a single hard-coded LCARS look to a
**portable, user-selectable theme system**, and lays out the implementation plan for the
first three themes:

| id        | label   | basis                                                               |
| --------- | ------- | ------------------------------------------------------------------- |
| `lcars`   | LCARS   | the current UI (default)                                            |
| `classic` | Classic | the original chat-ui look, before the LCARS redesign                |
| `office`  | Office  | closely mimics Microsoft Word (ribbon/document/status-bar language) |

`office` is the internal id; the UI label avoids the Word trademark.

---

## 1. TL;DR

1. **Do not fork components per theme.** Introduce a **semantic token contract** (CSS custom
   properties) plus a set of **structural primitives** (`.ui-*` classes) with hooks for every
   shape a theme must change. Themes are data — token values plus scoped CSS — and the three
   **built-in** themes additionally ship small structural variants (welcome/intro/chrome) that
   plugins cannot.
2. **Exploit Tailwind v4's CSS variables.** Every theme also overrides the `--color-gray-*`
   ramp. Because `bg-gray-100`, `text-gray-500`, `border-gray-200`, … compile to
   `var(--color-gray-*)`, a short scoped block re-skins ~3,000 existing utility usages in
   the codebase **without touching components** (verified against Tailwind 4.3.3). This is
   the bridge that makes multi-theme affordable now; semantic tokens are the long-term
   replacement.
3. **Themes scope to `data-theme="<id>"` on `<html>`** and combine orthogonally with the
   existing `.dark` mode class. `data-theme` picks the theme, `.dark` picks light/dark.
   **Layering is normative:** token blocks are unlayered, structural overrides live in
   `@layer components`, utilities keep winning (§5.1).
4. **Built-ins are bundled** (`src/lib/themes/<id>/`), **external themes are portable plugins**
   (`THEMES_DIR` on the server, discovered via an API, validated with a real CSS parser,
   SSR-linked so they never flash).
5. **The theme is part of SSR data**: `+layout.ts` returns it so the first HTML has the right
   chrome; a cookie + `localStorage` mirror sets `<html data-theme class="dark">` before
   first paint.
6. Target effort: **~10–13 engineering days** for the three themes + plugin loader + tests.
   The structural variants (`classic`, `office`) and the non-neutral color sweep dominate;
   the neutral ramp is the cheap part.

---

## 2. Goals and non-goals

### Goals

- Users can pick a theme in Settings → Appearance; choice follows the account across devices.
- Three built-in themes: `lcars` (default), `classic`, `office`.
- Themes are **portable**: a theme is a folder (`theme.json` + `theme.css` + optional fonts
  and previews) that can be dropped into a server directory, with no client rebuild.
- Themes must not be able to break the app layout, leak styles into other themes, or execute
  script. Third-party CSS is operator-installed and validated; **user-uploaded themes are
  token-only** (safe by construction).
- No flash of the wrong theme on load, including on first visit and after sign-in.
- A theme missing a token or a mode degrades gracefully (documented fallbacks), never blank.
- Keep the current LCARS look pixel-comparable for existing users.

### Non-goals (for this iteration)

- Arbitrary user-authored CSS or HTML themes from the web UI.
- Re-theming transactional emails, OG images, or the docs site.
- Runtime hot-reload of theme files without reload (a reload is acceptable).
- Per-organization or per-conversation themes (per-user only).
- Dark-mode auto-derivation for themes that only ship one mode (themes declare modes).

---

## 3. Current state (baseline `d845a237`)

| Layer                    | Where                                                                                                                                                                 | Notes                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Tailwind config / tokens | `src/styles/main.css`                                                                                                                                                 | `@theme` LCARS accents, `@theme inline` semantic colors, warm `gray-*` remap, `.lcars-*` primitives in `@layer components` |
| Mode                     | `.dark` class; `src/app.html` bootstrap; `src/lib/switchTheme.ts`                                                                                                     | dark is the default; preference in `localStorage.theme` (`light`/`dark`/`system`)                                          |
| Fonts                    | `src/styles/fonts/*.woff2` + `@font-face`                                                                                                                             | bundled by Vite                                                                                                            |
| Chrome                   | `+layout.svelte` screen panel + status strip; `ChatWindow` panel header; `NavMenu`; `MobileNav`                                                                       | LCARS structure is baked into markup                                                                                       |
| Hard-coded colors        | 111 `.svelte` files, **~3,100** neutral utilities, **~491** non-neutral utilities, **~212** arbitrary hex colors; 14 files use `lcars-*` tokens (147 color utilities) | the migration surface                                                                                                      |
| Settings                 | `src/lib/types/Settings.ts`, `settingsValidation.ts`, `/api/v2/user/settings`, `stores/settings.ts`                                                                   | established pattern to add a synced field                                                                                  |

Pain points:

- One theme is compiled in; changing it means editing components or `main.css`.
- LCARS structure (capsules, status strip, access-panel modal) is unconditional markup.
- Mode and theme are conflated in `switchTheme.ts` (`light|dark|system` only).

---

## 4. Alternatives considered

| Option                                                                                    | Why rejected                                                                                        |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Separate component tree per theme (`if theme === …` around every view)                    | Duplicates 100+ components; every feature lands 3×; guaranteed drift.                               |
| Tailwind `data-theme` variants for every utility (`bg-gray-100 data-[theme=office]:bg-…`) | Explodes class strings and CSS size; unmaintainable.                                                |
| One global CSS override file per theme (unscoped)                                         | Leaks between themes; no portability; ordering fights with utilities.                               |
| `light-dark()` only                                                                       | Solves mode, not multiple themes.                                                                   |
| PostCSS plugin that rewrites every utility to a semantic variable at build time           | Large build-time machinery; still needs the token contract; harder to debug.                        |
| CSS-in-JS / runtime style engine (e.g., vanilla-extract, Panda)                           | Rewrites the entire styling stack for a feature that is fundamentally "swap tokens + a few shapes". |

**Chosen:** semantic token contract + scoped theme CSS + primitive class API, with the
Tailwind neutral-ramp override as the pragmatic bridge. This is the standard approach used
by products with plugin themes (VS Code, WordPress, Grafana) — tokens first, a constrained
CSS surface second.

---

## 5. Architecture overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  Components (Svelte)                                                 │
│  · semantic tokens via utilities (bg-surface, text-muted, …)         │
│  · structural primitives (.ui-panel, .ui-screen, .ui-btn, …)         │
│  · chrome features (status strip, header readout) from theme config  │
└───────────────▲──────────────────────────────────────────────────────┘
                │ CSS variables + primitive rules
┌───────────────┴──────────────────────────────────────────────────────┐
│  Theme layer (scoped)                                                │
│  [data-theme="classic"] { --ui-…; --color-gray-…; }      (unlayered)   │
│  [data-theme="classic"].dark { --ui-… }                  (unlayered)   │
│  @layer components { [data-theme] .ui-panel { … } }                    │
└───────────────▲──────────────────────────────────────────────────────┘
                │ theme.json + theme.css (built-in bundle or external)
┌───────────────┴──────────────────────────────────────────────────────┐
│  Theme runtime                                                       │
│  registry → active theme → apply(data-theme, .dark) → persist        │
│  settings (DB) ⇄ cookie + localStorage (first-paint mirror)          │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.1 CSS layering contract (normative)

Unlayered declarations beat **every** `@layer`. Tailwind v4 emits `theme`, `base`,
`components` and `utilities` layers, so theme CSS is split into two kinds:

| Kind                                          | Where                                                                                 | Why                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Token values** (`--ui-*`, `--color-gray-*`) | **unlayered**, scoped to `:root[data-theme="<id>"]` / `:root[data-theme="<id>"].dark` | No utility declares these custom properties, so unlayered is safe and guarantees the override beats `@layer theme`'s `:root`. |
| **Structural overrides** (`.ui-panel { … }`)  | **`@layer components`**, scoped                                                       | Component utilities (`rounded-*`, `bg-*`, `border-*`) must keep winning, as they do today.                                    |

Consequences (these are requirements, not advice):

- A theme must **never** set, unlayered, a property that components also set with a
  utility. Doing so silently kills hover/dark/opacity variants: an unlayered
  `.ui-panel { border-radius: 0 }` beats a component's `rounded-*`, and an unlayered color
  rule beats `hover:bg-*` / `dark:bg-*`. Utilities such as `bg-lcars-panel/95` on the
  conversation dropdown are _not_ on a primitive at all, so a theme cannot target them
  without a hook.
- Any shape a target theme must change but that is currently an **arbitrary utility**
  (`rounded-[22px_22px_6px_22px]`, `rounded-[18px]`, `md:rounded-[22px]`, the composer
  overlay, the inner message column) needs a **primitive hook** (`.ui-bubble`,
  `.ui-page`, `.ui-composer`, `.ui-header`, `.ui-strip`) added in Phase 0. CSS alone
  cannot restyle utilities that are not primitives.
- `!important` utilities beat all normal declarations, layered or not. Remove them from
  themeable surfaces; the theme validator rejects `!important` because it cannot help a
  theme that respects the layering contract.
- `.prose` rules in `main.css` are intentionally unlayered to beat the typography plugin.
  Theme prose overrides must therefore also be unlayered and re-state `prose-invert`
  (see §8.2).
- A custom property declared on an element shadows the `:root` token for that subtree.
  Theme tokens must therefore be declared on `:root[data-theme]`, never on a component
  root, or they will silently override the theme for part of the tree.

Resolution order, corrected:

1. `@layer theme` defaults (`:root` LCARS tokens, neutral ramp).
2. **Unlayered** scoped token blocks (`:root[data-theme]`, `:root[data-theme].dark`).
3. `@layer components`: base primitives, then theme structural overrides.
4. `@layer utilities`: component utilities (and `!important` utilities last) — they win
   over primitives by design.

---

## 6. The token contract (v1)

All tokens are CSS custom properties on the `<html>` element. A theme **must** define every
**required** token for every mode it declares. Missing values fall back to `lcars` via
`var(--ui-x, var(--ui-x-fallback))`? No — simpler: load order guarantees `:root` has LCARS
values, so a theme that omits a token inherits the default. The validator still warns.

### 6.1 Required tokens

| Group   | Token                                                                    | Purpose                                                                |
| ------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Surface | `--ui-bg`                                                                | app backdrop (behind panels)                                           |
|         | `--ui-surface`                                                           | panels, sidebar, cards                                                 |
|         | `--ui-surface-raised`                                                    | menus, popovers, modals                                                |
|         | `--ui-surface-sunken`                                                    | inputs, composer, code blocks                                          |
|         | `--ui-screen`                                                            | chat/document canvas                                                   |
|         | `--ui-screen-image`                                                      | optional gradient/pattern for the canvas (`none` default)              |
|         | `--ui-border` / `--ui-border-strong`                                     | dividers, focus-adjacent edges                                         |
|         | `--ui-overlay`                                                           | modal scrim                                                            |
| Text    | `--ui-text` / `--ui-text-muted` / `--ui-text-faint`                      | three-level hierarchy                                                  |
|         | `--ui-text-inverse`                                                      | text on accent fills                                                   |
|         | `--ui-link`                                                              | links and citations                                                    |
| Actions | `--ui-accent` / `--ui-accent-hover` / `--ui-accent-text`                 | primary action                                                         |
|         | `--ui-danger` / `--ui-danger-text`                                       | destructive                                                            |
|         | `--ui-warning` / `--ui-warning-text`                                     | waiting/standby                                                        |
|         | `--ui-success` / `--ui-success-text`                                     | ready                                                                  |
|         | `--ui-info` / `--ui-info-text`                                           | neutral notices                                                        |
| Chat    | `--ui-bubble-user-bg` / `--ui-bubble-user-text`                          | user message                                                           |
|         | `--ui-bubble-assistant-bg` / `--ui-bubble-assistant-text`                | assistant message                                                      |
|         | `--ui-code-bg` / `--ui-code-text`                                        | inline code / code blocks                                              |
| States  | `--ui-selection-bg`                                                      | `::selection` (today a hardcoded LCARS amber)                          |
|         | `--ui-scrollbar-thumb`                                                   | `scrollbar-custom` (today literal rgba)                                |
|         | `--ui-prose-body` / `-heading` / `-link` / `-code` / `-quote` / `-rule`  | markdown/prose surfaces (maps to `--tw-prose-*`)                       |
|         | `--ui-syntax-comment` / `-string` / `-keyword` / `-number` / `-function` | `highlight.js` tokens                                                  |
|         | `--ui-theme-color`                                                       | `<meta name="theme-color">` + manifests                                |
| Type    | `--ui-font-sans` / `--ui-font-display` / `--ui-font-mono`                | type stacks                                                            |
|         | `--ui-font-size-base`                                                    | 14px–16px per theme (primitives only until utilities are migrated)     |
|         | `--ui-label-tracking` / `--ui-label-transform`                           | metadata labels (`0.2em`/`uppercase` for LCARS, `0`/`none` for Office) |
| Shape   | `--ui-radius-sm` / `-md` / `-lg` / `-xl` / `-pill`                       | 2px (Office) … 9999px (LCARS)                                          |
|         | `--ui-border-width`                                                      | 1px–2px                                                                |
| Depth   | `--ui-shadow-sm` / `-md` / `-lg`                                         | elevation                                                              |
|         | `--ui-focus-ring-color` / `-width` / `-offset`                           | focus treatment (split so `outline-color` can consume it)              |
| Motion  | `--ui-motion-fast` / `--ui-motion-base` / `--ui-motion-ease`             | transitions                                                            |
| Density | `--ui-control-height` / `--ui-gutter`                                    | primitives only — raw `h-8`/`text-[13px]` utilities are unaffected     |

### 6.2 Optional tokens

`--ui-topbar-bg`, `--ui-statusbar-bg`, `--ui-statusbar-text`, `--ui-sidebar-bg`,
`--ui-scanline`, `--ui-logo-filter` (e.g. `invert(1)` for dark-on-dark logos),
`--ui-beacon-bg`, `--ui-screen-border`, `--ui-cite-bg` / `--ui-cite-text`,
`--ui-highlight-bg`, `--ui-shimmer-from` / `--ui-shimmer-to`.

### 6.2.1 Token value typing (not free-form strings)

Token-only themes are validated per token, not as `string → string`, because several tokens
accept syntax that can make network requests or override global at-rules:

| Token kind             | Grammar                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colors                 | hex / `rgb()` / `hsl()` / `oklch()` / `color-mix(…)` / `var(--ui-…)` only — **no `url()`**                                                                          |
| Lengths / radii        | `px` / `rem` / `em` / `%` / `calc(…)`                                                                                                                               |
| Shadows                | comma-separated list of lengths + colors; **no `url()`**                                                                                                            |
| Focus ring             | split into `--ui-focus-ring-color` (color), `--ui-focus-ring-width` (length), `--ui-focus-ring-offset` (length) — a shorthand cannot be consumed by `outline-color` |
| Fonts                  | a fixed allowlist of stacks (`system`, `serif`, `sans`, `mono`, `theme`), never a raw family list in user themes                                                    |
| Screen image           | `none` or `linear-gradient(…)` only                                                                                                                                 |
| Motion                 | duration (`ms`/`s`) and a named easing allowlist                                                                                                                    |
| Border width / density | unitless number or length; never `none` for required borders                                                                                                        |

`--ui-overlay`, `--ui-scrollbar-thumb`, `--ui-prose-*`, `--ui-code-*` and
`--ui-syntax-*` are wired in Phase 2 (§11.1); declaring them without wiring is detected by
the "every required token is used" test (§15).

### 6.3 Modes

- A theme declares `"modes": ["light", "dark"]`. The runtime keeps `.dark` orthogonal to
  `data-theme`; a theme's dark block is `[data-theme="<id>"].dark`.
- A single-mode theme declares one mode; if the user prefers the other, the runtime coerces
  to the supported mode and disables (or annotates) the toggle in the picker.
- `system` remains a user-level preference: it resolves to the theme's supported mode from
  `prefers-color-scheme`, or to the theme's only mode.

### 6.4 The neutral-ramp bridge (important)

Tailwind v4 utilities reference theme variables (`bg-gray-100` → `var(--color-gray-100)`),
and `@theme` declares them in a layer. Therefore an **unlayered, scoped** override re-themes
every existing static utility without component changes. Verified against the installed
Tailwind 4.3.3: `.bg-gray-100 { background-color: var(--color-gray-100) }` and
`.border-gray-200 { border-color: var(--color-gray-200) }`.

```css
/* themes/classic.css — unlayered so it beats @layer theme regardless of specificity */
:root[data-theme="classic"] {
	--color-gray-50: #fafafa;
	--color-gray-100: #f5f5f5;
	--color-gray-200: #e5e5e5;
	--color-gray-300: #d4d4d4;
	--color-gray-400: #a3a3a3;
	--color-gray-500: #737373;
	--color-gray-600: #454545;
	--color-gray-700: #2e2e2e;
	--color-gray-800: #1a1a1a;
	--color-gray-900: #0a0a0a;
	--color-gray-950: #000000;
}
```

One ramp serves both modes, exactly like stock Tailwind: components choose `gray-50/100`
in light mode and `gray-800/900` in dark mode, so a single mapping is correct. (Spot-checked
against real pairings; no un-paired violation found.)

**Opacity modifier caveat.** `/opacity` utilities compile to a build-time fallback plus a
`@supports` branch:

```css
.bg-gray-500\/10 {
	background-color: color-mix(in srgb, #737373 10%, transparent); /* build-time hex */
	@supports (color: color-mix(in lab, red, red)) {
		background-color: color-mix(in oklab, var(--color-gray-500) 10%, transparent);
	}
}
```

On engines without `color-mix`, the fallback keeps the LCARS hex, so `/opacity` surfaces do
not re-theme. This affects a small number of usages today; migrate themeable translucent
surfaces to semantic alpha tokens in Phase 2 rather than relying on the modifier.

> Verification task P0.1 must assert the `@supports` branch
> (`color-mix(in oklab, var(--color-gray-100)`), not just the plain var rule. If Tailwind
> ever stops emitting variables, the fallback is the semantic migration in §12.

**`@theme inline` note.** `@theme inline` utilities compile to the raw variable
(`.bg-lcars-panel { background: var(--lcars-panel) }`), so overriding `--lcars-panel` works
but overriding `--color-lcars-panel` does not. Phase 2 removes the `lcars`/`ui` split
entirely (§11.1).

---

## 7. Structural primitives (the plugin API)

Rename the current `.lcars-*` component classes to a theme-neutral `.ui-*` API (mechanical
`sed`, 208 occurrences across 14 files, 147 of them color utilities). Keep `.lcars-*` as
deprecated aliases for one release; Tailwind classes
were authored here, so churn is low.

| Primitive                         | LCARS default                            | Office override (example)                                            |
| --------------------------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| `.ui-shell`                       | paper backdrop, 14px inset               | app chrome `--ui-bg`, no inset                                       |
| `.ui-screen`                      | gradient canvas, radius 22px, inner glow | document page: white, 2px radius, drop shadow, gray canvas around it |
| `.ui-panel`                       | cream/dark panel, 1px edge               | flat `#faf9f8`, 1px `#e1dfdd`, 2px radius                            |
| `.ui-cap-r` / `.ui-cap-up`        | pill caps (status strip, capsules)       | square segments (status bar)                                         |
| `.ui-label` / `.ui-kicker`        | mono, uppercase, wide tracking           | Segoe UI, 11–12px, no tracking                                       |
| `.ui-display`                     | Saira Extra Condensed, uppercase         | Segoe UI Semibold, sentence case                                     |
| `.ui-btn`                         | pill, mono uppercase                     | 2px radius, 14px Segoe UI, accent fill                               |
| `.ui-chip`                        | asymmetric lilac chip                    | light gray rectangle, 2px radius                                     |
| `.ui-led`                         | glowing dot                              | 8px circle or status icon                                            |
| `.ui-beacon`                      | radial amber orb                         | circle with accent fill                                              |
| `.ui-strip` / `.ui-strip-segment` | capsule status bar                       | Word status bar (`--ui-statusbar-bg`)                                |
| `.ui-composer-fade`               | canvas gradient fade                     | canvas flat fade                                                     |

**New hooks required in Phase 0** (today these shapes are arbitrary utilities, which theme
CSS in `@layer components` cannot override):

| Hook           | Wraps today's markup                                                                                                      | Needed by                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `.ui-bubble`   | user message shape + colors (`ChatMessage` user `<p>`, `rounded-[22px_22px_6px_22px] bg-lcars-user-bubble`)               | `classic` (plain text), `office` (comment block)  |
| `.ui-msg-card` | assistant message card (`ChatMessage` assistant container, `rounded-[18px] border-lcars-panel-edge/60 bg-lcars-panel/40`) | all three                                         |
| `.ui-page`     | the inner message column (`ChatWindow` `@container mx-auto … max-w-3xl xl:max-w-4xl`)                                     | `office` document page                            |
| `.ui-composer` | the composer form (`ChatWindow` `lcars-panel … max-w-4xl`)                                                                | all three                                         |
| `.ui-header`   | the chat panel header (`ChatWindow` header row)                                                                           | `classic` (hidden), `office` (title bar)          |
| `.ui-screen`   | already exists, but must move to the wrapper that owns the canvas background                                              | `office`                                          |
| `.ui-scroll`   | the messages scroll container (`scrollbar-custom … overflow-y-auto`)                                                      | scrollbar/selection wiring, `office` page margins |

**Coverage reality.** Only 14 of ~150 `.svelte` files reference any `lcars-*` token today
(147 of the 208 occurrences are _color_ utilities; the rest are the primitives). The token
contract therefore governs the primitive API and the semantic utilities we add; it does
**not** retroactively control raw `h-8`, `text-[13px]`, `rounded-lg` utilities. Claims like
"Office sets `--ui-control-height: 28px`" only come true for elements using `.ui-btn` /
`.ui-chip` / the new hooks, unless those utilities are migrated (§12). The design must not
pretend density/type tokens change raw utilities.

**Chrome features** are configuration, not CSS, because they decide _whether markup renders_.
They are resolved during SSR: built-in theme metadata is isomorphic (`+layout.ts`), external
manifests are read by the new `+layout.server.ts`, so the first HTML already contains the
right chrome — not client-only:

```jsonc
"chrome": {
  "statusStrip": "full",      // "full" | "compact" | "hidden"
  "chatHeader": "readout",    // "readout" | "minimal" | "hidden"
  "sidebar": "rail",          // "rail" | "plain"
  "structure": "lcars"        // built-in only: "lcars" | "classic" | "office"
},
"labels": {
  "systemReady": "Hull integrity nominal",
  "systemWaiting": "Awaiting model server",
  "streaming": "Warp 1 · streaming",
  "idle": "Impulse · ready",
  "models": "{count} models online",
  "mcp": "{count} mcp"
}
```

`structure` is only honored for built-ins (they ship component variants, see §11). External
plugins use the generic structure and can only restyle it. `labels` are plain strings only
(no HTML/Markdown). They replace the currently hardcoded strip copy
(`+layout.svelte`, "Hull integrity nominal" / "Warp 1 · streaming"), so non-LCARS themes get
neutral wording without editing markup.

---

## 8. Theme package format

```
themes/<id>/
├── theme.json          # manifest: metadata, modes, tokens (optional if theme.css does it), chrome, labels
├── theme.css           # scoped variables + primitive overrides (optional for token-only themes)
├── preview-light.webp  # optional 1200×750 picker preview
├── preview-dark.webp
├── LICENSE.txt / OFL.txt   # required when fonts are bundled
└── fonts/              # optional self-hosted woff2 (same-origin only)
```

### 8.1 Manifest schema (zod)

```ts
export const themeManifestSchema = z.object({
	apiVersion: z.literal(1),
	id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
	name: z.string().min(1).max(60),
	version: z.string().regex(/^\d+\.\d+\.\d+$/),
	description: z.string().max(280).optional(),
	author: z.string().max(120).optional(),
	license: z.string().max(60).optional(),
	homepage: z.string().url().optional(),
	modes: z.array(z.enum(["light", "dark"])).min(1),
	chrome: themeChromeSchema.default({}),
	labels: z.record(z.string().max(80)).default({}),
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
```

Tokens from `theme.json` are written into a scoped `<style>` at load; `theme.css` is linked.
Both paths produce the same effective rules. `apiVersion` gates breaking changes.

### 8.2 CSS rules for theme authors

- **Token blocks** (`--ui-*`, `--color-*`) must be unlayered and scoped under
  `:root[data-theme="<id>"]` / `:root[data-theme="<id>"].dark` (validator enforces the
  selector prefix for external themes).
- **Structural overrides** must be inside `@layer components`, scoped to the same prefix.
  Unlayered structural rules would beat component utilities and are rejected by the
  validator. Only primitives may be restyled; arbitrary utilities cannot be targeted.
- `.prose` overrides are the one exception: `.prose` in `main.css` is unlayered, so theme
  prose rules must also be unlayered and must re-state `prose-invert` values for dark mode.
- No `@import`, `@property`, `@font-face`, `@keyframes` (global at-rules leak into every
  theme and are rejected), and no `url()` except the theme's own `./fonts/*.woff2`.
  Reject `!important` entirely.
- No `html`/`body` selectors, no `display: none` on core content, and no layout-changing
  positioning (`position: fixed/sticky` on app-level elements) — hide _chrome_ through the
  `chrome` flags instead. Note the validator can only _warn_ about positioning; it cannot
  prove layout safety. Operator-installed CSS is trusted at the same level as app code.
- Prefer tokens over literals. Must define every required token for every declared mode
  (validator fails).

### 8.3 Fonts and licensing

- Bundled fonts (Saira, IBM Plex Mono) stay with the `lcars` theme assets.
- `classic` uses the system stack (no fonts to bundle).
- `office` should use **Selawik** and **Carlito** as redistributable fallbacks, with
  `"Segoe UI"` and `"Calibri"` listed first so Windows users get the genuine faces. Do not
  redistribute Microsoft fonts.
  - Selawik is licensed under the **SIL Open Font License 1.1** (verified against
    `microsoft/Selawik` — not MIT), reserved font name "Selawik".
  - Carlito is OFL 1.1.
- Any theme that bundles fonts must ship the corresponding `LICENSE`/`OFL.txt` file in its
  package; `scripts/validate-themes.ts` fails if fonts are present without a license file,
  and the picker links to it. The manifest's `license` field is descriptive only, not proof.

---

## 9. Runtime

### 9.1 Attributes

```html
<html lang="en" data-theme="office" class="dark"></html>
```

- `data-theme` → theme id (default from `PUBLIC_DEFAULT_THEME`, else `lcars`).
- `.dark` → mode (unchanged semantics).
- `data-theme-mode="light|dark"` may be added for CSS that needs the resolved mode without
  relying on `.dark` (optional).

### 9.2 First paint (no flash)

### 9.2 Theme in SSR, and first paint

Two different problems, two different mechanisms:

**(a) Markup/chrome must be server-correct.** The theme id and mode are part of the route
data. Built-in manifests are isomorphic and resolve in `+layout.ts`; external manifests are
read server-side by a new `+layout.server.ts`, which returns `uiTheme`, `uiThemeMode` and the
resolved `chrome`/`labels` metadata (and writes the theme cookie). `+layout.svelte` therefore
renders the right chrome during SSR — a returning `classic`/external-theme user gets HTML
without the LCARS header/strip on the first response, with no post-hydration layout shift or
hydration mismatch.

**(b) The `<html>` attributes must be right before first paint.** Three sources:

1. **Cookie, server-side** (preferred). `src/lib/server/hooks/handle.ts` owns the single
   `transformPageChunk` (the `%gaId%` replacement lives there, _not_ in `hooks.server.ts`).
   Add `%themeAttrs%` (and `%themeAssets%` for external CSS, see §9.4) to `app.html` and
   replace both in the same guarded replacer. Validate the cookie value against the theme
   registry before interpolation — never trust it (attribute injection).
2. **Inline script** in `app.html`, before `%sveltekit.head%`, for anonymous users and
   cookie-less first visits: reads `localStorage.ui-theme` / `ui-mode`, **migrating the
   legacy `localStorage.theme` key** (light/dark/system) so an existing light-mode user does
   not flip to dark on upgrade.
3. **Settings reconciliation** after hydration: if the account theme differs (new device),
   apply it, write the cookie/localStorage and log once. This is the only case with a visible
   one-frame correction; write the cookie during a server-side layout load (new
   `+layout.server.ts` reading the same settings) so every subsequent request is correct.

Cookie writing is centralized: the theme picker, `GET/POST /settings` (which already run
server-side), and the login callback all set `ui-theme`/`ui-mode` (`SameSite=Lax; Path=/;
Max-Age=1y`).

```html
<!-- app.html -->
<html lang="en" %themeAttrs%>
	<!-- %themeAssets%: SSR <link rel="stylesheet"> for an external active theme -->
</html>
```

```ts
// src/lib/server/hooks/handle.ts (single replacer, beside %gaId%)
const attrs = themeAttrsFromCookie(event.cookies); // sanitizeThemeId + registry membership
const assets = externalThemeLink(attrs.id); // <link rel=preload + stylesheet> or ""
html.replace("%themeAttrs%", attrs.markup).replace("%themeAssets%", assets);
```

Static builds (`npm run build:static`) must replace both placeholders in the `building`
branch of `hooks.server.ts` too (default theme, no assets), and a build-time assertion must
fail if any `%…%` placeholder survives in the output.

### 9.3 Selection and persistence

- `Settings.uiTheme: string` (default `DEFAULT_SETTINGS.uiTheme ?? config.PUBLIC_DEFAULT_THEME ?? "lcars"`).
- `Settings.uiThemeMode?: "light" | "dark" | "system"` (optional; keeps mode synced too).
- Client `setTheme(id)`: apply attributes synchronously → `localStorage` + cookie → debounced
  POST to the **existing settings route, `${base}/settings`** (also implemented at
  `/api/v2/user/settings`; both share `settingsValidation.ts`) → optimistic UI update.
- Validation: the schema accepts any syntactically valid id, then **coerces unknown or
  no-longer-installed ids to the default** on both read and write (log once). It must never
  `error(400)` the whole payload because a theme was removed — that would block saving every
  other setting.
- Deep link `?theme=office` applies for the session and is stripped from the URL (same
  pattern as `?model=` in `+layout.svelte`).
- The sidebar toggle changes **mode within the active theme**. Today `switchTheme()` only
  cycles light↔dark; `system` is reachable only from settings. Decide explicitly whether the
  toggle should cycle `light → dark → system` (documented behavior change) or stay a two-way
  toggle.

### 9.4 External theme API

```
GET /api/v2/themes                         → metadata only (no tokens/css), cached + ETag
GET /api/v2/themes/:id                     → manifest (validated)
GET /api/v2/themes/:id/theme.css           → text/css (scoped validation, cached)
GET /api/v2/themes/:id/fonts/:file.woff2   → font/woff2 (extension allowlist)
GET /api/v2/themes/:id/preview-:mode.webp  → image/webp
```

- Directory from `THEMES_DIR` (unset → built-ins only; the route answers 404).
- Path traversal protection: strict id regex + `fs.realpath` prefix check.
- **No flash for external themes:** when the cookie/settings name an external theme, the SSR
  response must emit `<link rel="preload" as="style">` + `<link rel="stylesheet">` in the
  head in the same `transformPageChunk` pass. Otherwise the first paint would show LCARS
  tokens under a foreign `data-theme` and repaint when the lazy link arrives. The
  "link → wait for `load` → apply" sequence is only for _picking_ a theme mid-session; it
  must revert on failure and toast.
- Cache-Control: `public, max-age=3600, stale-while-revalidate=86400`; ETag from file mtime.
- CSP: the app currently configures only `frame-ancestors`, so there is no `style-src` /
  `script-src` restriction today. The design must not rely on that: use same-origin
  `<link>` for external CSS, and `%sveltekit.nonce%` for any inline token `<style>` /
  bootstrap script so tightening CSP later does not break themes.

---

## 10. Security model

| Source                            | Trust            | Rules                                                                                                                                                                                                          |
| --------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Built-in (`src/lib/themes`)       | app code         | full CSS + component variants                                                                                                                                                                                  |
| Operator-installed (`THEMES_DIR`) | same as app code | scoped CSS validated for structure; **documented as trusted** — it can restyle anything in the app's DOM (including layout), though not execute script or make cross-origin requests beyond the font allowlist |
| User-uploaded (future, opt-in)    | untrusted        | **token-only JSON** with a per-token value grammar (§6.2.1): no CSS, no `url()`, no fonts, no at-rules; rendered as a nonce'd scoped `<style>` with escaped values                                             |

Honest guarantees:

- **No theme executes JavaScript.** CSS cannot run script; the loader never evaluates theme
  content.
- **External CSS cannot reach other origins** if `url()` is restricted to the theme's own
  `fonts/*.woff2` (validated by a real CSS parser, not regex). A `url()` in a token value is
  the classic exfiltration vector and is rejected by the token grammar.
- **Global at-rules are rejected** (`@property`, `@font-face`, `@keyframes`, `@import`):
  they are not scoped by selectors and would leak into every theme / redefine animations.
- **Selector scoping is enforced** for structural rules (`:root[data-theme="<id>"]` prefix,
  `@layer components`), but it cannot prove layout safety: a scoped rule can still set
  `position: fixed`. Treat operator CSS as trusted code, and keep user themes token-only.
- Validation must use a real parser. `css-tree` (or `postcss`) is currently only a
  _transitive_ dependency of Vite/Tailwind — promote it to an explicit devDependency so a
  Vite upgrade cannot silently remove the validator. `scripts/validate-themes.ts` runs it at
  install/CI time; the runtime loader re-validates cached manifests.
- Token-only themes cannot read data or inject layout, so they are safe to allow behind a
  future flag (`ENABLE_USER_THEMES=false` today). Their values are still length-limited and
  parsed by the per-token grammar.

---

## 11. Target themes

### 11.1 `lcars` — current UI (default)

- **Tokens:** the values shipping today in `src/styles/main.css` (`--lcars-*` become
  `--ui-*`), warm neutral ramp.
- **Type:** Saira / Saira Extra Condensed / IBM Plex Mono; labels uppercase with `0.2em`
  tracking; display uppercase.
- **Shape:** pill caps, 22px screen, 18px bubbles, beacon orb.
- **Chrome:** full status strip, chat header readout, access-panel welcome, LCARS intro.
- **Work:**
  - Rename primitives to `.ui-*` and move tokens under `:root[data-theme="lcars"]`.
  - **Remove the `.dark { --lcars-* }` block** and make `--lcars-*` a single alias of
    `--ui-*`; otherwise the dark-mode literals shadow the aliases and `office` dark keeps
    LCARS colors.
  - **Rename the 147 `*-lcars-*` color utilities to `*-ui-*`** across 14 files (mechanical
    `sed`). Without this, `classic`/`office` still paint LCARS amber/peach chrome, because
    the ramp only covers `gray-*`, not `lcars-*`.
  - Wire the new tokens: `::selection`, `:focus-visible` (split ring tokens),
    `scrollbar-custom`, `.prose`/`prose-invert`, `highlight-js.css`, `::highlight`,
    router shimmer and paper citations. Remove the raw `rgba()`/hex literals in those rules.
  - Keep visual parity via the screenshot matrix.

### 11.2 `classic` — the original look

- **Palette:** stock Tailwind neutrals (`#fafafa … #000000`), white/dark-900 app surfaces,
  blue-600 focus/accent (as before the redesign).
- **Type:** system stack (no bundled fonts). No mono metadata, no uppercase labels.
- **Shape:** `rounded-xl`/`2xl` as in the original (`--ui-radius-md: 0.75rem`), solid borders,
  original send button (black circle in light, white/60 in dark).
- **Messages:** assistant card with `from-gray-50` gradient and `border-gray-100`; user
  message as plain text (no bubble) — via the `.ui-msg-card` / `.ui-bubble` hooks and
  `structure: "classic"` built-in variants.
- **Chrome:** status strip hidden, chat header hidden (title lives in the page), sidebar
  `bg-linear-to-l from-gray-50` + rounded-right panel, welcome modal and intro from the
  pre-LCARS markup (built-in variant).
- **Work:** ramp + primitive overrides + **structural variants in ~8 components**. The LCARS
  redesign (`d845a237`) rewrote 32 files; restoring the original look in one tree means
  `structure === "classic"` branches (or extracted variant wrappers) in:
  `+layout.svelte`, `ChatWindow.svelte`, `ChatMessage.svelte`, `NavMenu.svelte`,
  `MobileNav.svelte`, `WelcomeModal.svelte`, `ChatIntroduction.svelte`,
  `ModelsUnavailable.svelte`, plus `settings/(nav)/+layout.svelte`. Source is in git
  (`git show 9f6b0d7b:<file>`). **Estimate: 2–3 days**, not 0.5–1.

### 11.3 `office` — Word-like

- **Palette (light):** app chrome `#f3f2f1`, canvas `#ffffff`, navigation pane `#faf9f8`,
  text `#323130`, muted `#605e5c`, borders `#e1dfdd` / `#c8c6c4`, accent `#2b579a`,
  hover `#106ebe`, selected `#deecf9`, success `#107c10`, warning `#797673`/`#fce100`,
  danger `#a4262c`.
- **Palette (dark):** chrome `#201f1e`, canvas `#252423`, pane `#2b2a29`, text `#f3f2f1`,
  muted `#c8c6c4`, borders `#3b3a39`, accent `#479ef5`.
- **Type:** `"Segoe UI", Selawik, system-ui, sans-serif`; 13–14px base; **sentence case**,
  no letter-spacing (`--ui-label-transform: none`, `--ui-label-tracking: 0`).
- **Shape:** 2px radii (`--ui-radius-*: 2px`, `--ui-pill: 2px`), 1px borders, dense controls
  (`--ui-control-height: 28px` — applies to `.ui-btn`/`.ui-chip` and the new hooks only),
  split focus tokens (`--ui-focus-ring-color: #2b579a`, width `2px`).
- **Layout language:**
  - Top area reads like the title bar + ribbon: the brand capsule becomes a flat band;
    primary actions are ribbon-style flat buttons with a 1px bottom accent when active.
  - Sidebar reads like Word's navigation pane: 13px rows, selected row `#deecf9` with a 3px
    `#2b579a` left bar, subtle `#edebe9` hover, no pills.
  - Chat canvas becomes a **document page**: white rectangle (max ~820px) with
    `0 1px 3px rgba(0,0,0,.12)` shadow on the gray canvas; messages read as document
    paragraphs; user turns get Word "comment" styling (light blue `#deecf9` block with a
    `#2b579a` left rule); code blocks as gray `#f3f2f1` panels with 1px border.
  - Composer reads like the comment box: rectangular, 2px radius, 1px `#c8c6c4` border,
    `#2b579a` 2px focus, send = solid blue square with an arrow.
  - Bottom strip becomes the **Word status bar**: 11px Segoe UI on `#f3f2f1`, left-aligned
    zones (models, mode, MCP), right-aligned "ready/streaming" state; `chrome.statusStrip:
"full"` reused, no new component.
  - Settings page becomes an Options-dialog layout: left rail list, grouped rows with
    checkbox-style toggles, blue primary buttons, `#f3f2f1` section headers.
- **Structural work (not just tokens):** the document page requires markup hooks that do not
  exist today. `ChatWindow`'s messages column is `@container mx-auto … max-w-3xl` with **no
  class hook**, and the composer is a sibling absolute overlay. Phase 0 adds
  `.ui-page`/`.ui-scroll`/`.ui-composer`; Phase 4 wraps the message column in `.ui-page`
  (or accepts a floating comment-box composer) and adds the Office welcome variant.
  **Estimate: 1.5–2 days.**
- **Iframe panes:** `WorkflowPane`/`TrackioPane` currently pass only `__theme=dark|light` to
  embedded content. Either pass the resolved theme as well or accept that Space/Trackio
  panes keep their own theme (document the limitation).
- **Fonts:** Selawik + Carlito (both OFL 1.1), with their license files bundled.

### 11.4 Non-neutral colors are part of this release (or explicitly out of scope)

The ramp covers neutrals only. There are **~491 non-neutral** and **~212 arbitrary-hex**
utility usages (purple tool chips, `text-red-600`, `bg-green-500`, `bg-black/80` scrims, ML
Intern/review UI). If they are deferred, `office`/`classic` will be visibly hybrid (purple
tool chips in a blue-and-gray Word look), and Phase 4's "side-by-side review against Word"
cannot be accepted. Choose one:

- **In scope:** migrate the highest-traffic ~30 files (shell, chat, composer, tool chips,
  modal scrim, status colors, review panes) to `--ui-success/warning/danger/info/tool` in
  Phases 2–4.
- **Out of scope:** soften acceptance to "tokens + primitives + chrome only"; the hybrids are
  documented as known gaps.

The plan below assumes **in scope**, with the ratchet tracking the rest.

## 12. Component migration plan

### 12.1 Inventory (verified)

- **111** `.svelte` files contain neutral color utilities; **~3,100** occurrences including
  opacity modifiers (a plain-neutral regex counts 2,996).
- **~491** non-neutral color utilities (blue/purple/green/red/amber…).
- **~212** arbitrary hex color utilities (`bg-[#…]`), concentrated in ML Intern/review UI.
- **14** files use `lcars-*` tokens: 147 color utilities + 61 primitive usages.
- Reproduce with:
  `grep -rcoE "(bg|text|border|from|via|to|ring)-(white|black|gray-[0-9]+)(/[0-9]+)?" src --include=*.svelte`
  (and the analogous non-neutral/hex regexes); the ratchet script should commit the exact
  command so the baseline is reproducible.

### 12.2 Strategy

1. **Now (this design):** the per-theme ramp covers all neutral utilities. Ship the three
   themes with zero component edits on that surface.
2. **Next (incremental):** migrate semantic meaning to tokens, highest-value files first:
   shell (`+layout.svelte`, `NavMenu`, `MobileNav`), chat (`ChatWindow`, `ChatMessage`,
   `ChatInput`, `ChatIntroduction`), states (`ModelsUnavailable`, `WelcomeModal`, `Modal`,
   `Toast`), settings.
3. **Later:** ML Intern / review surfaces (largest hex concentration); non-neutral accent
   utilities → `--ui-success/warning/danger/info`.

### 12.3 Mapping table

| Legacy                                              | Semantic                                       |
| --------------------------------------------------- | ---------------------------------------------- |
| `bg-white dark:bg-gray-900`                         | `bg-surface`                                   |
| `bg-gray-50 dark:bg-gray-800`                       | `bg-surface-raised`                            |
| `bg-gray-100 dark:bg-gray-800`                      | `bg-surface-sunken`                            |
| `border-gray-200 dark:border-gray-700`              | `border-default`                               |
| `text-gray-800 dark:text-gray-200`                  | `text-primary`                                 |
| `text-gray-500 dark:text-gray-400`                  | `text-muted`                                   |
| `text-gray-400 dark:text-gray-500`                  | `text-faint`                                   |
| `bg-black text-white dark:bg-white dark:text-black` | `bg-accent text-accent-text`                   |
| `text-blue-600 dark:text-blue-400`                  | `text-link`                                    |
| `bg-red-500/…`                                      | `bg-danger`                                    |
| `bg-green-…`                                        | `bg-success`                                   |
| `bg-purple-…` (tools)                               | `bg-info` (or keep as a semantic "tool" token) |

### 12.4 Ratchet

Add a CI script (`npm run check:theme-colors`) that counts raw color utilities and fails if
the number grows beyond a committed baseline per directory. It shrinks as migration proceeds.

---

## 13. Repository layout

```
src/lib/themes/
├── types.ts                # manifest + token types, zod schemas
├── registry.ts             # built-ins + external discovery, availability
├── themes.svelte.ts        # runtime store: active theme, mode, apply(), setTheme()
├── lcars/{theme.json,theme.css,fonts/,preview-*.webp}
├── classic/{theme.json,theme.css,preview-*.webp}
├── office/{theme.json,theme.css,fonts/,preview-*.webp}
└── __tests__/themes.spec.ts
src/styles/
├── main.css                # contract defaults (LCARS tokens), primitives (ui-*), neutral baseline
└── themes.css              # @imports the built-in theme CSS in a fixed order; imported by
                            # +layout.svelte right after main.css.
src/routes/api/v2/themes/
├── +server.ts              # list (built-ins + external, metadata only)
└── [id]/{+server.ts,theme.css/+server.ts,fonts/[file]/+server.ts,preview-[mode]/+server.ts}
src/routes/settings/(nav)/application/Appearance.svelte   # picker (or inline section)
scripts/
├── theme-previews.ts       # Playwright matrix → preview webp
└── validate-themes.ts      # offline validation for external themes
```

---

## 14. Implementation phases

### Phase 0 — Contract, layering & hooks (1–1.5 days)

- Write `src/lib/themes/types.ts`: manifest schema, **per-token value grammar** (§6.2.1),
  required-token list, chrome/labels.
- Verify Tailwind output (static var rule **and** the `/opacity` `@supports` branch) and add
  both assertions.
- Rename `.lcars-*` primitives → `.ui-*` with aliases and add the missing hooks
  (`.ui-bubble`, `.ui-msg-card`, `.ui-page`, `.ui-composer`, `.ui-header`, `.ui-scroll`);
  mechanical sweep across 14 files.
- **Acceptance:** app visually identical; tests green; no theme CSS relies on unlayered
  structural rules; hooks exist for every shape the specs need to change.

### Phase 1 — Runtime, SSR, persistence, picker (2–2.5 days)

- `themes.svelte.ts`: registry (built-in manifests isomorphic), apply, cookie/localStorage
  (with `localStorage.theme` migration), settings field + coercion.
- `+layout.ts` returns `uiTheme`/`uiThemeMode`; `+layout.svelte` gates chrome/labels from
  theme config **server-side**; `handle.ts` replaces `%themeAttrs%` + `%themeAssets%`
  (validated against the registry); `hooks.server.ts` building branch replaces both too.
- New `+layout.server.ts` writes the theme cookie so subsequent requests are correct;
  document the one-frame correction on a brand-new device.
- Settings → Appearance gallery (previews, mode control, reset), instant apply,
  `${base}/settings` persistence.
- **Acceptance:** SSR HTML already has the right chrome; first paint correct with cookies and
  with `localStorage` only; external-theme SSR includes the stylesheet (no FOUC); unknown ids
  coerce safely; legacy light-mode preference survives the upgrade.

### Phase 2 — LCARS under the contract (1.5 days)

- Move LCARS values into `src/lib/themes/lcars/theme.css`, remove the `.dark { --lcars-* }` block,
  make `--lcars-*` a single alias, then rename the 147 `*-lcars-*` color utilities to
  `*-ui-*`.
- Wire selection, focus ring, scrollbar, overlay, prose/prose-invert, syntax highlighting,
  `::highlight`, shimmer, citations, and `meta theme-color`.
- **Acceptance:** pixel-comparable screenshots; a "token wiring" test proves every required
  token affects at least one rule; no palette literals outside LCARS defaults.

### Phase 3 — Classic (2–3 days)

- Ramp + primitive overrides + `structure: "classic"` variants in the 8–9 components listed
  in §11.2; strip labels from theme config instead of hardcoded copy.
- **Acceptance:** matches pre-LCARS screenshots (`git show 9f6b0d7b`); light/dark; no LCARS
  chrome or accent colors leak through.

### Phase 4 — Office (1.5–2 days)

- Tokens (light/dark), Selawik/Carlito (OFL) with licenses, `.ui-page` document canvas,
  navigation-pane sidebar, status bar via the existing strip, Options-style settings.
- Includes the semantic sweep for the high-traffic non-neutral surfaces (§11.4) — or an
  explicit acceptance change if deferred.
- **Acceptance:** side-by-side review against Word (Windows + web), light/dark; no purple/raw
  accent leakage on the migrated surfaces; iframe panes documented.

### Phase 5 — External plugin loader (1.5–2 days)

- `THEMES_DIR`, list/manifest/css/fonts/preview routes, validation with an explicit CSS
  parser devDependency, token grammar, caching, 404 behavior, SSR `<link>` emission.
- Loader UX (loading state, failure toast, revert).
- `scripts/validate-themes.ts` + theme-author docs.
- **Acceptance:** dropping a folder into `THEMES_DIR` and reloading makes it selectable with
  no flash; malformed/unscoped/global-at-rule themes are rejected with a clear error;
  traversal attempts 404; user-theme uploads remain disabled.

### Phase 6 — Tests, docs, previews (1 day)

- Theme matrix tests, wiring/contrast checks, preview generation, README/CLAUDE/THEMES updates.
- **Acceptance:** CI runs theme unit tests + contrast + wiring + no-flash; previews committed;
  docs linked.

**Total: 10–13 engineering days**, parallelizable once Phase 0 lands (Classic/Office are
content; Phase 5 is independent). The earlier 6–9 estimate under-counted the structural
variants and the non-neutral surfaces.

---

## 15. Testing strategy

1. **Unit (`themes.spec.ts`)**: manifest schema (valid/invalid), per-token value grammar,
   id/mode resolution, token completeness per theme/mode, fallback/coercion behavior, label
   defaults.
2. **Wiring**: every required token must be read by at least one rule in the effective
   stylesheet (a probe element per token), so a theme author's value is never silently dead.
3. **Contrast**: for each theme × mode, compute WCAG ratios for text/surface, muted/surface,
   accent-text/accent; require ≥ 4.5 (normal), ≥ 3 (large/UI). Fail CI on regressions. A
   small local sRGB/OKLab helper is needed (`culori`/`colorjs` are not dependencies).
4. **Loader security**: path traversal, unscoped structural selectors, `!important`,
   `@import`, `@property`, `@font-face`, `@keyframes`, remote `url()` (including in token
   values), font extension allowlist, license-file presence when fonts are bundled.
5. **Playwright matrix** (`scripts/theme-previews.ts`): routes `{home, conversation, settings}`
   × themes `{lcars, classic, office}` × modes `{light, dark}` × viewports `{1440×900,
390×844}`. Assertions: no horizontal overflow, composer visible and clickable, chrome
   visibility matches `chrome`, SSR markup and hydrated markup match, and the `/opacity`
   `@supports` branch references the theme variable. Screenshots become the picker previews.
6. **No-flash**: with JS enabled, assert `data-theme`/`dark` are unchanged across hydration;
   with JS disabled, assert the server attributes from the cookie; for an external theme,
   assert the stylesheet `<link>` is present in the SSR head.
7. **Ratchet**: raw color utility counts (neutral, non-neutral, hex) must not increase;
   commit the exact counting commands with the baseline.
8. **Static build**: assert no `%…%` placeholder survives `build:static`.

Memory note for this repo: run the matrix **per theme** with `--no-file-parallelism
--maxWorkers=1`, never the full suite locally (see CLAUDE.md).

---

## 16. Risks and mitigations

| Risk                                                         | Likelihood | Mitigation                                                                                                                                             |
| ------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tailwind stops emitting theme vars in utilities              | Low        | P0 asserts static **and** `/opacity` `@supports` output; fallback = semantic migration                                                                 |
| Theme CSS masks component utilities or vice versa            | Medium     | Layering contract (§5.1): tokens unlayered, structure in `@layer components`; primitives for every shape themes must change; CI probes computed values |
| SSR chrome and client theme disagree                         | Medium     | Theme id/mode in `+layout.ts` data (SSR-rendered chrome); cookie mirrored by layout server load; hydration parity test                                 |
| External theme flashes on load                               | High       | SSR emits preload + stylesheet for a cookie-selected external theme; loader only applies after `load` when picked mid-session                          |
| Third-party CSS leaks or exfiltrates                         | Medium     | Operator-only CSS (trusted) by default; real parser validation; global at-rules and `url()` rejected; user themes token-only with typed grammar        |
| Font licensing (Segoe/Calibri)                               | Medium     | Bundle Selawik + Carlito (**both OFL 1.1**); ship their license files; list genuine faces first for Windows                                            |
| Visual regressions during primitive/hook rename              | Medium     | `.lcars-*` aliases + screenshot parity in Phase 0                                                                                                      |
| Theme × feature matrix grows maintenance                     | Medium     | Contract versioning; previews regenerated by script; contrast + wiring + matrix tests                                                                  |
| Users on unknown/removed theme after upgrade                 | Medium     | Coerce to default on read/write (never 400 the settings payload); one-time toast                                                                       |
| Legacy light-mode preference lost in the `ui-mode` migration | Medium     | Migrate `localStorage.theme` in the bootstrap; explicit upgrade test                                                                                   |
| `!important` utilities defeat theme structure                | Low        | Remove `!important` from themeable surfaces; validator rejects it in theme CSS                                                                         |
| Extra CSS weight                                             | Low        | ~1–3 KB gz per built-in (token block + rules), external lazy; brotli                                                                                   |
| Strict CSP blocks inline token styles                        | Low        | Prefer `<link>` for external themes; `%sveltekit.nonce%` for inline token styles/scripts                                                               |
| `.prose`/highlight rules remain off-theme                    | Medium     | Wire prose/prose-invert, highlight-js, `::highlight`, shimmer and citations in Phase 2 (unlayered, with the documented invert trap)                    |
| `system` mode on single-mode themes feels broken             | Low        | Picker annotates supported modes; runtime coerces deterministically                                                                                    |

---

## 17. Open questions

1. Should mode also be synced server-side (`uiThemeMode`) or remain device-local? (Proposal:
   sync both — users expect it.)
2. Should new users default to `classic` (pre-LCARS) or keep `lcars`? (Proposal: keep `lcars`;
   make it configurable via `PUBLIC_DEFAULT_THEME`.)
3. Do we want per-organization themes on HuggingChat? (Out of scope; the contract allows it
   later via a settings resolver.)
4. Is a user-facing theme gallery with uploads required? (Proposal: no; token-only uploads
   behind a flag in a later release.)
5. Office naming: display "Office" (proposal) or "Document"? Avoid the Word trademark in UI.
6. Do we bundle a fourth theme (`high-contrast`) for accessibility? (Candidate follow-up.)

---

## Appendix A — `classic` theme (excerpt)

```jsonc
// src/lib/themes/classic/theme.json
{
	"apiVersion": 1,
	"id": "classic",
	"name": "Classic",
	"version": "1.0.0",
	"modes": ["light", "dark"],
	"chrome": {
		"statusStrip": "hidden",
		"chatHeader": "hidden",
		"sidebar": "plain",
		"structure": "classic",
	},
	"css": "theme.css",
}
```

```css
/* src/lib/themes/classic/theme.css (tokens unlayered; structure in @layer components) */
:root[data-theme="classic"] {
	--color-gray-50: #fafafa; /* …through 950… */
	--color-gray-950: #000000;

	--ui-bg: #ffffff;
	--ui-surface: #ffffff;
	--ui-surface-raised: #fafafa;
	--ui-surface-sunken: #f5f5f5;
	--ui-border: #e5e5e5;
	--ui-text: #0a0a0a;
	--ui-text-muted: #737373;
	--ui-accent: #000000;
	--ui-accent-text: #ffffff;

	--ui-font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
	--ui-font-display: var(--ui-font-sans);
	--ui-font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	--ui-radius-md: 0.75rem;
	--ui-radius-lg: 1rem;
	--ui-radius-pill: 9999px;
	--ui-label-transform: none;
	--ui-label-tracking: 0;
}
:root[data-theme="classic"].dark {
	--ui-bg: #0a0a0a;
	--ui-surface: #171717;
	--ui-surface-raised: #1f1f1f;
	--ui-surface-sunken: #262626;
	--ui-border: #404040;
	--ui-text: #f5f5f5;
	--ui-accent: #ffffff;
	--ui-accent-text: #0a0a0a;
}

:root[data-theme="classic"] {
	/* `--lcars-*` are aliases of `--ui-*` after Phase 2, so LCARS-named utilities
	   keep working here without leaking LCARS colors. */
	--lcars-paper: var(--ui-bg);
	--lcars-panel: var(--ui-surface);
	--lcars-ink: var(--ui-text);
	--lcars-muted: var(--ui-text-muted);
	--lcars-user-bubble: #f3e8f6;
	--lcars-user-ink: #3d2340;
}

@layer components {
	:root[data-theme="classic"] .ui-panel {
		border-radius: 0.75rem;
		background: transparent;
		border: 0;
	}
	:root[data-theme="classic"] .ui-btn {
		border-radius: 0.5rem;
		text-transform: none;
		letter-spacing: 0;
	}
	:root[data-theme="classic"] .ui-screen {
		background: transparent;
		border: 0;
		box-shadow: none;
		border-radius: 0;
	}
	:root[data-theme="classic"] .ui-bubble {
		background: transparent;
		border: 0;
		border-radius: 0;
		padding: 0;
	}
}
```

## Appendix B — External theme + loader

```jsonc
// $THEMES_DIR/solarized/theme.json
{
	"apiVersion": 1,
	"id": "solarized",
	"name": "Solarized",
	"version": "1.0.0",
	"modes": ["light", "dark"],
	"chrome": { "statusStrip": "compact", "chatHeader": "minimal" },
	"tokens": {
		"light": {
			"--ui-bg": "#fdf6e3",
			"--ui-surface": "#eee8d5",
			"--ui-text": "#073642",
			"--ui-accent": "#268bd2",
		},
		"dark": {
			"--ui-bg": "#002b36",
			"--ui-surface": "#073642",
			"--ui-text": "#eee8d5",
			"--ui-accent": "#2aa198",
		},
	},
	"css": "theme.css",
	"preview": { "light": "preview-light.webp", "dark": "preview-dark.webp" },
}
```

```ts
// src/lib/themes/themes.svelte.ts (sketch)
export async function setTheme(id: string, mode: ThemeMode) {
	const theme = await registry.resolve(id); // builtin map ∪ fetched manifests
	if (!theme) return fallbackToDefault();

	if (theme.css && !isBuiltin(id)) {
		// Mid-session switch: wait for the sheet so the new theme never paints unstyled.
		await loadStylesheet(`/api/v2/themes/${id}/theme.css?${theme.version}`); // once, cached
	}
	applyAttributes(theme, mode); // html.dataset.theme, .dark
	persist({ id, mode }); // cookie + localStorage (sync), DB (debounced)
}
// SSR path is different: handle.ts emits <link rel=preload> + <link rel=stylesheet>
// when the cookie names an external theme, so the first paint is already styled.
```

## Appendix C — First-paint bootstrap

```html
<!-- src/app.html -->
<html lang="en" %themeAttrs%>
	<!-- %themeAssets%: SSR preload + stylesheet for an external active theme -->
</html>
```

```ts
// src/lib/server/hooks/handle.ts (single replacer beside %gaId%)
const themeAttrs = (cookies: Cookies) => {
	// Only ids that exist in the registry may reach the HTML attribute.
	const requested = cookies.get("ui-theme");
	const theme = sanitizeThemeId(requested); // /^[a-z0-9][a-z0-9-]{0,31}$/ + registry.has()
	const id = theme ?? config.PUBLIC_DEFAULT_THEME ?? "lcars";
	const mode = cookies.get("ui-mode"); // "light" | "dark" | "system" | undefined
	// Best effort server-side: no media query here. "system" renders dark and the
	// pre-paint inline script corrects it on a light OS before anything paints.
	const dark = mode !== "light";
	return { markup: `data-theme="${id}"${dark ? ' class="dark"' : ""}`, id };
};
```

```html
<script nonce="%sveltekit.nonce%">
	// client fallback (runs before first paint)
	try {
		var legacy = localStorage.getItem("theme");
		var t = localStorage.getItem("ui-theme") || "%defaultTheme%";
		var m = localStorage.getItem("ui-mode") || legacy || "dark";
		if (!localStorage.getItem("ui-mode") && legacy) localStorage.setItem("ui-mode", legacy);
		var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
		var dark = m === "dark" || (m === "system" ? prefersDark : m !== "light");
		document.documentElement.dataset.theme = t;
		document.documentElement.classList.toggle("dark", dark);
	} catch (e) {}
</script>
```

The static-build branch of `hooks.server.ts` must replace `%themeAttrs%` and
`%themeAssets%` too (default theme, empty assets); a build assertion fails on any surviving
`%…%` placeholder.

## Appendix D — Settings changes

```ts
// src/lib/types/Settings.ts
export type UiThemeMode = "light" | "dark" | "system";
export interface Settings {
	// …
	/** Selected UI theme id; unknown ids are coerced to the default on read/write. */
	uiTheme?: string;
	/** Light/dark/system preference, synced across devices. */
	uiThemeMode?: UiThemeMode;
}
export const DEFAULT_SETTINGS = {
	// …
	uiTheme: undefined, // resolved from PUBLIC_DEFAULT_THEME at read time
	uiThemeMode: "system",
} satisfies SettingsEditable;
```

- `settingsValidation.ts`: `uiTheme: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/).optional()`,
  `uiThemeMode: z.enum(["light", "dark", "system"]).optional()`. Unknown-but-well-formed ids
  are accepted by the schema and **coerced to the default** by the resolver — never rejected
  with a 400 (that would block saving every other setting).
- Both settings endpoints share this schema: `GET/POST /api/v2/user/settings` and the
  **`${base}/settings` route the client store actually posts to**
  (`src/lib/stores/settings.ts`). Update both responses, `SettingsResponse` in
  `src/routes/+layout.ts`, and `SettingsStore` in `src/lib/stores/settings.ts`.
- `POST`: accept both (validated), persist.
- `stores/settings.ts`: add to `SettingsStore`; the layout seeds it from SSR data.
- Replace `switchTheme()`: the sidebar toggle changes mode **within** the active theme.
  Decide whether it cycles `light ↔ dark` (today) or `light → dark → system`; `system` is
  currently reachable only from settings, and any change to that is user-visible.
- Migration: on first load, seed `ui-mode` from the legacy `localStorage.theme` value.

## Appendix E — Preview generation

```ts
// scripts/theme-previews.ts (run manually, commit the output)
for (const theme of THEMES) {
	for (const mode of theme.modes) {
		for (const [name, viewport] of VIEWPORTS) {
			await page.goto(`/settings/application?theme=${theme.id}&mode=${mode}`);
			await page.screenshot({ path: `src/lib/themes/${theme.id}/preview-${mode}.webp` });
		}
	}
}
```

Run with capped concurrency (`--maxWorkers=1` semantics) to respect the repo's memory
constraints.

---

## Appendix F — Verified assumptions (as of writing)

Reproduced against the installed Tailwind 4.3.3 and the repository at `11854a99`:

- `.bg-gray-100 { background-color: var(--color-gray-100) }` — static theme utilities
  reference CSS variables.
- `/opacity` utilities emit a build-time hex fallback plus an `@supports` branch that uses
  `var(--color-…)`; themes only reach the latter on capable engines.
- `.bg-lcars-panel` (from `@theme inline`) compiles to `var(--lcars-panel)`.
- `transformPageChunk` lives in `src/lib/server/hooks/handle.ts`; `hooks.server.ts` only
  handles the `building` (static build) branch.
- `src/lib/stores/settings.ts` posts to `${base}/settings`; both settings routes share
  `src/lib/server/settingsValidation.ts`.
- `svelte.config.js` sets only `frame-ancestors` (no `style-src`/`script-src` today).
- Selawik is SIL OFL 1.1 (verified from `microsoft/Selawik/LICENSE.txt`); Carlito is OFL.
- The pre-LCARS neutral ramp is byte-identical to `git show 9f6b0d7b:src/styles/main.css`.
- Counts: 111 files with neutral utilities (~3,100 occurrences), ~491 non-neutral, ~212
  arbitrary hex, 14 files with `lcars-*` tokens (147 color utilities + 61 primitives).

---

## Definition of done

- [ ] `data-theme` runtime, cookie/localStorage/DB persistence, no first-paint flash; SSR
      chrome matches the account theme, external-theme SSR includes its stylesheet.
- [ ] Layering contract enforced: tokens unlayered, structure in `@layer components`, hooks
      for every shape the themes change; no `!important` on themeable surfaces.
- [ ] `lcars`, `classic`, `office` selectable and visually reviewed in light + dark, desktop + mobile.
- [ ] Theme picker in Settings → Appearance with previews; unknown ids coerce safely.
- [ ] External themes load from `THEMES_DIR` with parser-based validation, caching and clear
      failures; token-only user themes remain off.
- [ ] Token wiring + contrast + matrix tests in CI; raw-color ratchet in place.
- [ ] Legacy `localStorage.theme` preference migrated; static builds contain no placeholders.
- [ ] README, CLAUDE.md, CODEBASE_SUMMARY.md and this document updated.
