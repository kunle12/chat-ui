# Multi-theme architecture — design & implementation plan

Status: **proposal** · Author: engineering · Target release: next minor

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
   properties) plus a small set of **structural primitives** (`.ui-*` classes). Themes are
   data: token values + optional scoped CSS.
2. **Exploit Tailwind v4's CSS variables.** Every theme also overrides the `--color-gray-*`
   ramp. Because `bg-gray-100`, `text-gray-500`, `border-gray-200`, … compile to
   `var(--color-gray-*)`, a short scoped block re-skins ~3,000 existing utility usages in
   the codebase **without touching components**. This is the bridge that makes multi-theme
   affordable now; semantic tokens are the long-term replacement.
3. **Themes scope to `data-theme="<id>"` on `<html>`** and combine orthogonally with the
   existing `.dark` mode class. `data-theme` picks the theme, `.dark` picks light/dark.
4. **Built-ins are bundled** (`src/lib/themes/<id>/`), **external themes are portable plugins**
   (`THEMES_DIR` on the server, discovered via an API, validated, lazily loaded).
5. **User selection** is persisted in user settings (synced across devices) and mirrored to
   a cookie + `localStorage` so the correct theme is applied **before first paint**.
6. Target effort: **~6–9 engineering days** for the three themes + plugin loader + tests,
   most of it in the one-time tokenization of surfaces the neutral ramp can't reach.

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

| Layer                    | Where                                                                                                         | Notes                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Tailwind config / tokens | `src/styles/main.css`                                                                                         | `@theme` LCARS accents, `@theme inline` semantic colors, warm `gray-*` remap, `.lcars-*` primitives in `@layer components` |
| Mode                     | `.dark` class; `src/app.html` bootstrap; `src/lib/switchTheme.ts`                                             | dark is the default; preference in `localStorage.theme` (`light`/`dark`/`system`)                                          |
| Fonts                    | `src/styles/fonts/*.woff2` + `@font-face`                                                                     | bundled by Vite                                                                                                            |
| Chrome                   | `+layout.svelte` screen panel + status strip; `ChatWindow` panel header; `NavMenu`; `MobileNav`               | LCARS structure is baked into markup                                                                                       |
| Hard-coded colors        | 111 `.svelte` files, **2,996** neutral utilities, **484** non-neutral utilities, **203** arbitrary hex colors | the migration surface                                                                                                      |
| Settings                 | `src/lib/types/Settings.ts`, `settingsValidation.ts`, `/api/v2/user/settings`, `stores/settings.ts`           | established pattern to add a synced field                                                                                  |

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
│  [data-theme="classic"] { --ui-…; --color-gray-…; }                  │
│  [data-theme="classic"].dark { --ui-… }                              │
│  [data-theme="classic"] .ui-panel { border-radius: 12px; … }         │
└───────────────▲──────────────────────────────────────────────────────┘
                │ theme.json + theme.css (built-in bundle or external)
┌───────────────┴──────────────────────────────────────────────────────┐
│  Theme runtime                                                       │
│  registry → active theme → apply(data-theme, .dark) → persist        │
│  settings (DB) ⇄ cookie + localStorage (first-paint mirror)          │
└──────────────────────────────────────────────────────────────────────┘
```

Resolution order for a given property:

1. Base primitives (`@layer components`, token-driven defaults).
2. Theme token block (`[data-theme]`, unlayered, later in the cascade).
3. Theme structural overrides (`[data-theme] .ui-*`, unlayered).
4. Component utilities still win (Tailwind's utilities layer comes after components).
5. Mode-specific token values via `[data-theme].dark`.

---

## 6. The token contract (v1)

All tokens are CSS custom properties on the `<html>` element. A theme **must** define every
**required** token for every mode it declares. Missing values fall back to `lcars` via
`var(--ui-x, var(--ui-x-fallback))`? No — simpler: load order guarantees `:root` has LCARS
values, so a theme that omits a token inherits the default. The validator still warns.

### 6.1 Required tokens

| Group   | Token                                                        | Purpose                                                                |
| ------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Surface | `--ui-bg`                                                    | app backdrop (behind panels)                                           |
|         | `--ui-surface`                                               | panels, sidebar, cards                                                 |
|         | `--ui-surface-raised`                                        | menus, popovers, modals                                                |
|         | `--ui-surface-sunken`                                        | inputs, composer, code blocks                                          |
|         | `--ui-screen`                                                | chat/document canvas                                                   |
|         | `--ui-screen-image`                                          | optional gradient/pattern for the canvas (`none` default)              |
|         | `--ui-border` / `--ui-border-strong`                         | dividers, focus-adjacent edges                                         |
|         | `--ui-overlay`                                               | modal scrim                                                            |
| Text    | `--ui-text` / `--ui-text-muted` / `--ui-text-faint`          | three-level hierarchy                                                  |
|         | `--ui-text-inverse`                                          | text on accent fills                                                   |
|         | `--ui-link`                                                  | links and citations                                                    |
| Actions | `--ui-accent` / `--ui-accent-hover` / `--ui-accent-text`     | primary action                                                         |
|         | `--ui-danger` / `--ui-danger-text`                           | destructive                                                            |
|         | `--ui-warning` / `--ui-warning-text`                         | waiting/standby                                                        |
|         | `--ui-success` / `--ui-success-text`                         | ready                                                                  |
|         | `--ui-info` / `--ui-info-text`                               | neutral notices                                                        |
| Chat    | `--ui-bubble-user-bg` / `--ui-bubble-user-text`              | user message                                                           |
|         | `--ui-bubble-assistant-bg` / `--ui-bubble-assistant-text`    | assistant message                                                      |
|         | `--ui-code-bg` / `--ui-code-text`                            | inline code / code blocks                                              |
| Type    | `--ui-font-sans` / `--ui-font-display` / `--ui-font-mono`    | type stacks                                                            |
|         | `--ui-font-size-base`                                        | 14px–16px per theme                                                    |
|         | `--ui-label-tracking` / `--ui-label-transform`               | metadata labels (`0.2em`/`uppercase` for LCARS, `0`/`none` for Office) |
| Shape   | `--ui-radius-sm` / `-md` / `-lg` / `-xl` / `-pill`           | 2px (Office) … 9999px (LCARS)                                          |
|         | `--ui-border-width`                                          | 1px–2px                                                                |
| Depth   | `--ui-shadow-sm` / `-md` / `-lg`                             | elevation                                                              |
|         | `--ui-focus-ring` / `--ui-focus-ring-offset`                 | focus treatment                                                        |
| Motion  | `--ui-motion-fast` / `--ui-motion-base` / `--ui-motion-ease` | transitions                                                            |
| Density | `--ui-control-height` / `--ui-gutter`                        | 28px (Office) … 40px (LCARS)                                           |

### 6.2 Optional tokens

`--ui-topbar-bg`, `--ui-statusbar-bg`, `--ui-statusbar-text`, `--ui-sidebar-bg`,
`--ui-scrollbar-thumb`, `--ui-logo-filter` (e.g. `invert(1)` for dark-on-dark logos),
`--ui-beacon-bg`, `--ui-screen-border`.

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
every existing utility without component changes:

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
in light mode and `gray-800/900` in dark mode, so a single mapping is correct.

> Verification task P0.1: assert in a unit test that a built stylesheet contains
> `background-color:var(--color-gray-100)` (guards against a future Tailwind inlining
> change). If Tailwind ever inlines values, the fallback is the semantic migration in §12.

---

## 7. Structural primitives (the plugin API)

Rename the current `.lcars-*` component classes to a theme-neutral `.ui-*` API (mechanical
`sed`, ~60 usages). Keep `.lcars-*` as deprecated aliases for one release; Tailwind classes
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

**Chrome features** are configuration, not CSS, because they decide _whether markup renders_:

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
(no HTML/Markdown), rendered through the existing components with safe defaults.

---

## 8. Theme package format

```
themes/<id>/
├── theme.json          # manifest: metadata, modes, tokens (optional if theme.css does it), chrome, labels
├── theme.css           # scoped variables + primitive overrides (optional for token-only themes)
├── preview-light.webp  # optional 1200×750 picker preview
├── preview-dark.webp
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

- Every rule must be scoped under `:root[data-theme="<id>"]` or
  `:root[data-theme="<id>"].dark` (validator enforces this for external themes).
- No `@import`, no `url()` except `./fonts/*.woff2` and `./preview-*.webp`.
- No `position: fixed` on app-level elements, no `html`/`body` selectors, no `display: none`
  on core content (hide _chrome_ through `chrome` flags instead).
- Prefer tokens over literals; literals are allowed, `!important` is rejected by the
  validator (the escape hatch is the unlayered cascade, which is already stronger than
  utilities-by-layer for token blocks).
- Must define every required token for every declared mode (validator warns/fails).

### 8.3 Fonts and licensing

- Bundled fonts (Saira, IBM Plex Mono) stay with the `lcars` theme assets.
- `classic` uses the system stack (no fonts to bundle).
- `office` should use **Selawik** (MIT, metric-compatible with Segoe UI) and **Carlito**
  (OFL, metric-compatible with Calibri) as redistributable fallbacks, with `"Segoe UI"`
  and `"Calibri"` listed first so Windows users get the genuine faces. Do not redistribute
  Microsoft fonts.

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

Three sources, resolved in this order:

1. **Server, from a cookie** (preferred). `hooks.server.ts` already uses
   `transformPageChunk` for `%gaId%`; add a `%themeAttrs%` placeholder in `app.html` and
   replace it with `data-theme="…" class="dark"` derived from the `ui-theme` / `ui-mode`
   cookies, falling back to `PUBLIC_DEFAULT_THEME` + dark.
2. **Inline script in `app.html`** (covers cached/absent cookies and anonymous users) reading
   `localStorage.ui-theme` / `ui-mode`, applying attributes before `%sveltekit.head%`.
3. **Account settings** after hydration: if `settings.uiTheme` differs, apply it, rewrite the
   cookie/localStorage, and (in dev) log a one-line reconciliation note.

```html
<!-- app.html -->
<html lang="en" %themeAttrs%></html>
```

```ts
// hooks.server.ts
transformPageChunk: ({ html }) =>
  html
    .replace("%gaId%", "")
    .replace("%themeAttrs%", themeAttrsFromCookies(event.cookies)),
```

Svelte components read the active theme from a store seeded by the same attributes, so no
markup throws on an unknown theme.

### 9.3 Selection and persistence

- `Settings.uiTheme: string` (default `DEFAULT_SETTINGS.uiTheme ?? config.PUBLIC_DEFAULT_THEME ?? "lcars"`).
- `Settings.uiThemeMode?: "light" | "dark" | "system"` (optional; keeps mode synced too).
- Client `setTheme(id)`: apply attributes synchronously → `localStorage` + cookie → debounced
  `POST /api/v2/user/settings` (merged `instantSet`, same as other preferences) → optimistic
  UI update.
- Validation: unknown ids fall back to the default; theme availability is checked against the
  registry (built-ins ∪ discovered external themes).
- Deep link `?theme=office` applies for the session and is stripped from the URL (same
  pattern as `?model=` in `+layout.svelte`).

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
- The loader links the stylesheet once, waits for `load`, then sets `data-theme`; a failed
  load keeps the previous theme and surfaces a toast.
- Cache-Control: `public, max-age=3600, stale-while-revalidate=86400`; ETag from file mtime.
- CSP: same-origin `<link>` works with `style-src 'self'`; if inline token `<style>` is used
  for user themes, it needs a nonce or the `'unsafe-inline'` exception the app already has
  for component styles.

---

## 10. Security model

| Source                            | Trust            | Rules                                                                                                                                                               |
| --------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Built-in (`src/lib/themes`)       | app code         | full CSS + component variants                                                                                                                                       |
| Operator-installed (`THEMES_DIR`) | same as app code | full scoped CSS, validated; documented that CSS runs in the app origin                                                                                              |
| User-uploaded (future, opt-in)    | untrusted        | **token-only JSON** validated by zod (colors, fonts from a fixed list, radii, shadows, motion), no CSS, no URLs; rendered as a scoped `<style>` with escaped values |

Because CSS can exfiltrate data (`url()` requests) and overlay UI, user-authored CSS is
**not** enabled by default. Token-only themes cannot read data or inject layout, so they are
safe to allow behind a future flag (`ENABLE_USER_THEMES=false` today).

---

## 11. Target themes

### 11.1 `lcars` — current UI (default)

- **Tokens:** the values shipping today in `src/styles/main.css` (`--lcars-*` become
  `--ui-*`; keep aliases), warm neutral ramp.
- **Type:** Saira / Saira Extra Condensed / IBM Plex Mono; labels uppercase with `0.2em`
  tracking; display uppercase.
- **Shape:** pill caps, 22px screen, 18px bubbles, beacon orb.
- **Chrome:** full status strip, chat header readout, access-panel welcome, LCARS intro.
- **Work:** rename primitives to `.ui-*`, move tokens under `:root[data-theme="lcars"]`,
  replace hard-coded palette literals with tokens where they still exist, keep visual parity.

### 11.2 `classic` — the original look

- **Palette:** stock Tailwind neutrals (`#fafafa … #000000`), white/dark-900 app surfaces,
  blue-600 focus/accent (as before the redesign).
- **Type:** system stack (no bundled fonts). No mono metadata, no uppercase labels.
- **Shape:** `rounded-xl`/`2xl` as in the original (`--ui-radius-md: 0.75rem`), solid borders,
  original send button (black circle in light, white/60 in dark).
- **Messages:** restore the original treatment — assistant card with `from-gray-50` gradient
  and `border-gray-100`; user message as plain text (no bubble) — via primitive overrides and
  `structure: "classic"` built-in variants.
- **Chrome:** status strip hidden, chat header hidden (title lives in the page), sidebar
  `bg-linear-to-l from-gray-50` + rounded-right panel, welcome modal and intro from the
  pre-LCARS markup (built-in variant).
- **Work:** smallest theme — ramp + primitive overrides + a few component variants that are
  already in git history (`git show 9f6b0d7b:<file>`).

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
  (`--ui-control-height: 28px`), square focus outline (`--ui-focus-ring: 2px solid #2b579a`).
- **Layout language:**
  - Top area reads like the title bar + ribbon: brand capsule becomes a flat band; primary
    actions are ribbon-style flat buttons with a 1px bottom accent when active.
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
- **Work:** mostly tokens + primitive overrides; `structure: "office"` adds the document-page
  wrapper class (`ui-screen--document`) and the Office welcome variant. Selawik/Carlito
  fonts (MIT/OFL) bundled under the theme.

---

## 12. Component migration plan

### 12.1 Inventory

- 111 `.svelte` files contain neutral color utilities (2,996 occurrences).
- 484 non-neutral color utilities (blue/purple/green/red/amber…).
- 203 arbitrary hex color utilities (`bg-[#…]`), concentrated in ML Intern/review UI.

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
├── builtin/
│   ├── lcars/{theme.json,theme.css,fonts/,preview-*.webp}
│   ├── classic/{theme.json,theme.css,preview-*.webp}
│   └── office/{theme.json,theme.css,fonts/,preview-*.webp}
└── __tests__/themes.spec.ts
src/styles/
├── main.css                # contract defaults (LCARS), primitives (ui-*), neutral baseline
└── themes.css              # imports built-in theme CSS in a fixed order (after main.css)
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

### Phase 0 — Contract & guardrails (0.5 day)

- Write `src/lib/themes/types.ts` (schemas above) and the required-token list as data.
- Verify Tailwind emits `var(--color-gray-*)`; add the regression test.
- Rename `.lcars-*` → `.ui-*` with aliases; sweep ~60 usages; `npm run check` + screenshots.
- **Acceptance:** app visually identical; tests green; no `.lcars-*` usages outside aliases.

### Phase 1 — Runtime, persistence, picker (1.5–2 days)

- `themes.svelte.ts`: registry, apply, cookie/localStorage, SQL settings field, migration.
- `app.html` `%themeAttrs%` + `hooks.server.ts` replacement + client bootstrap.
- Settings → Appearance gallery (cards with previews, mode segmented control, "Default"
  reset), instant apply, `instantSet` persistence, cross-device reconcile.
- **Acceptance:** switching themes survives reload, sign-in on a second browser, and first
  paint is correct (no flash) with cookies present or absent; unknown ids fall back safely.

### Phase 2 — LCARS under the contract (1 day)

- Move LCARS values into `builtin/lcars/theme.css` scoped to `data-theme="lcars"`.
- Map all `--lcars-*` to `--ui-*` (keep aliases); drive fonts/labels/radii from tokens.
- **Acceptance:** pixel-comparable screenshots (dark/light, desktop/mobile); no hard-coded
  palette in `main.css` beyond LCARS defaults.

### Phase 3 — Classic (0.5–1 day)

- Ramp + primitive overrides + `structure: "classic"` variants for welcome/intro/messages.
- **Acceptance:** matches pre-LCARS screenshots (`git show 9f6b0d7b`); works in light/dark.

### Phase 4 — Office (1–1.5 days)

- Tokens (light/dark), Selawik/Carlito fonts, document-page canvas, navigation-pane sidebar,
  status bar via the existing strip, Options-style settings.
- **Acceptance:** side-by-side review against Word (Windows + web); light and dark.

### Phase 5 — External plugin loader (1–1.5 days)

- `THEMES_DIR`, list/manifest/css/fonts/preview routes, validation, caching, 404 behavior.
- Loader UX (loading state, failure toast, revert).
- `scripts/validate-themes.ts` + docs for theme authors.
- **Acceptance:** dropping a folder into `THEMES_DIR` and reloading makes it selectable; a
  malformed/unscoped theme is rejected with a clear error; traversal attempts 404.

### Phase 6 — Tests, docs, previews (1 day)

- Theme matrix tests, contrast checks, preview generation, README/CLAUDE/THEMES updates.
- **Acceptance:** CI runs theme unit tests + contrast; previews committed; docs linked.

**Total: 6–9 engineering days**, parallelizable (Classic and Office can start once Phase 0
lands; Phase 5 is independent of the theme content).

---

## 15. Testing strategy

1. **Unit (`themes.spec.ts`)**: manifest schema (valid/invalid), id/mode resolution, token
   completeness per theme/mode, fallback behavior, label defaults.
2. **Contrast**: for each theme × mode, compute WCAG ratios for text/surface, muted/surface,
   accent-text/accent; require ≥ 4.5 (normal), ≥ 3 (large/UI). Fail CI on regressions.
3. **Loader security**: path traversal, unscoped selector rejection, `!important`, `@import`,
   remote `url()`; font extension allowlist.
4. **Playwright matrix** (`scripts/theme-shots.ts`): routes `{home, conversation, settings}` ×
   themes `{lcars, classic, office}` × modes `{light, dark}` × viewports `{1440×900, 390×844}`.
   Assertions: no horizontal overflow, composer visible and clickable, status strip visibility
   matches `chrome.statusStrip`, and a token probe element resolves each required token to a
   non-empty computed value.
5. **No-flash**: with JS enabled, assert `data-theme`/`dark` values before and after hydration
   are identical; with JS disabled, assert the server attribute (cookie path) is correct.
6. **Ratchet**: raw color utility count must not increase.

Memory note for this repo: run the matrix **per theme** with `--no-file-parallelism
--maxWorkers=1`, never the full suite locally (see CLAUDE.md).

---

## 16. Risks and mitigations

| Risk                                                               | Likelihood | Mitigation                                                                                                        |
| ------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| Tailwind stops emitting theme vars in utilities                    | Low        | P0 regression test; fallback = semantic migration plan                                                            |
| Specificity/order bugs between `data-theme`, `.dark` and utilities | Medium     | Token blocks unlayered + scoped (`:root[data-theme]`); theme CSS loaded after main.css; CI probes computed values |
| Third-party CSS leaks or exfiltrates                               | Medium     | Operator-only CSS by default, scoping validator, no remote URLs; user themes token-only                           |
| Font licensing (Segoe/Calibri)                                     | Medium     | Bundle Selawik (MIT) and Carlito (OFL); list genuine faces first for Windows                                      |
| Visual regressions during primitive rename                         | Low        | `.lcars-*` aliases + screenshot parity in Phase 0                                                                 |
| Theme × feature matrix grows maintenance                           | Medium     | Token contract versioning; previews regenerated by script; contrast + matrix tests                                |
| Users on unknown/removed theme after upgrade                       | Low        | Fallback to default + one-time toast; settings validation on GET                                                  |
| Extra CSS weight                                                   | Low        | ~8–15 KB gz per built-in, external lazy; brotli                                                                   |
| Strict CSP blocks inline token styles                              | Low        | Prefer `<link>` for external themes; nonce for inline token styles                                                |
| `system` mode on single-mode themes feels broken                   | Low        | Picker annotates supported modes; runtime coerces deterministically                                               |

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
// src/lib/themes/builtin/classic/theme.json
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
/* src/lib/themes/builtin/classic/theme.css (unlayered) */
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
		await loadStylesheet(`/api/v2/themes/${id}/theme.css?${theme.version}`); // once, cached
	}
	applyAttributes(theme, mode); // html.dataset.theme, .dark
	persist({ id, mode }); // cookie + localStorage (sync), DB (debounced)
}
```

## Appendix C — First-paint bootstrap

```html
<!-- src/app.html -->
<html lang="en" %themeAttrs%></html>
```

```ts
// src/hooks.server.ts
const themeAttrs = ({ cookies }) => {
	const theme = sanitizeThemeId(cookies.get("ui-theme")) ?? config.PUBLIC_DEFAULT_THEME ?? "lcars";
	const mode = cookies.get("ui-mode"); // "light" | "dark" | "system" | undefined
	// Best effort server-side: there is no media query here. "system" is rendered dark
	// and the pre-paint inline script corrects it on a light OS before anything paints.
	const dark = mode !== "light";
	return `data-theme="${theme}"${dark ? ' class="dark"' : ""}`;
};
```

```html
<script>
	// client fallback (runs before first paint)
	try {
		var t = localStorage.getItem("ui-theme") || "%defaultTheme%";
		var m = localStorage.getItem("ui-mode");
		var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
		var dark = m === "dark" || (m === "system" ? prefersDark : m !== "light");
		document.documentElement.dataset.theme = t;
		document.documentElement.classList.toggle("dark", dark);
	} catch (e) {}
</script>
```

## Appendix D — Settings changes

```ts
// src/lib/types/Settings.ts
export type UiThemeMode = "light" | "dark" | "system";
export interface Settings {
	// …
	/** Selected UI theme id; falls back to the configured default. */
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
  `uiThemeMode: z.enum(["light", "dark", "system"]).optional()`.
- `GET /api/v2/user/settings`: return both fields with defaults; validate against the theme
  registry server-side (fallback to default if unknown).
- `POST`: accept both (validated), persist.
- `stores/settings.ts`: add to `SettingsStore`; the layout seeds it from SSR data.
- Remove/replace `switchTheme()`: the sidebar toggle now cycles mode **within** the active
  theme (`light → dark → system`), and the picker lives in Appearance.

## Appendix E — Preview generation

```ts
// scripts/theme-previews.ts (run manually, commit the output)
for (const theme of THEMES) {
	for (const mode of theme.modes) {
		for (const [name, viewport] of VIEWPORTS) {
			await page.goto(`/settings/application?theme=${theme.id}&mode=${mode}`);
			await page.screenshot({ path: `src/lib/themes/builtin/${theme.id}/preview-${mode}.webp` });
		}
	}
}
```

Run with capped concurrency (`--maxWorkers=1` semantics) to respect the repo's memory
constraints.

---

## Definition of done

- [ ] `data-theme` runtime, cookie/localStorage/DB persistence, no first-paint flash.
- [ ] `lcars`, `classic`, `office` selectable and visually reviewed in light + dark, desktop + mobile.
- [ ] Theme picker in Settings → Appearance with previews; unknown ids fall back safely.
- [ ] External themes load from `THEMES_DIR` with validation, caching and clear failures.
- [ ] Required-token + contrast + matrix tests in CI; raw-color ratchet in place.
- [ ] README, CLAUDE.md, CODEBASE_SUMMARY.md and this document updated.
