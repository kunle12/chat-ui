# Multi-theme implementation log

Execution tracker for the plan in [`THEMES.md`](./THEMES.md). Design decisions live in
`THEMES.md`; this file records **state**: what is done, in progress, blocked, or deferred,
with evidence and commits.

|                |                                                 |
| -------------- | ----------------------------------------------- |
| Status         | **Not started**                                 |
| Branch         | `feature/multi-theme`                           |
| Design         | [`THEMES.md`](./THEMES.md) (proposal, reviewed) |
| Baseline       | `8ef4361d` (docs only; no theme code yet)       |
| Target release | next minor                                      |
| Last updated   | 2026-11-22 (design + critical review)           |
| Owner          | _assign a code agent/engineer per phase_        |

---

## 1. How to use this log (agent protocol)

1. Work top-down through the current **phase** checklist. Take the first unchecked task.
2. Mark it `IN PROGRESS` in the **Progress dashboard** with date + owner before you start.
3. Implement it; keep the change scoped to that task. Design changes go to `THEMES.md`
   first, then this log records the deviation.
4. Run the task's targeted verification (unit file, `npm run check`, `npm run lint`, a
   per-theme screenshot — **never the full suite**; see the warning in `CLAUDE.md`).
   Record the command and result in §7.
5. On completion: check the box, add the commit hash, note any deviation.
6. Finish a phase only when its **Acceptance** line holds and the log is updated in the same
   commit as the final task.

Commit convention: conventional commits (`feat(themes): …`, `fix(themes): …`,
`docs(themes): …`), one logical change per commit, log update included in that commit.

Status values: `TODO` · `IN PROGRESS` · `BLOCKED` · `DEFERRED` · `DONE`.

---

## 2. Progress dashboard

| Phase | Scope                                        | Status | Progress | Owner | Started | Completed |
| ----- | -------------------------------------------- | ------ | -------- | ----- | ------- | --------- |
| P0    | Contract, layering contract, primitive hooks | TODO   | 0 / 8    | —     | —       | —         |
| P1    | Runtime, SSR, persistence, picker            | TODO   | 0 / 9    | —     | —       | —         |
| P2    | LCARS under the contract                     | TODO   | 0 / 8    | —     | —       | —         |
| P3    | Classic theme                                | TODO   | 0 / 6    | —     | —       | —         |
| P4    | Office theme                                 | TODO   | 0 / 8    | —     | —       | —         |
| P5    | External plugin loader                       | TODO   | 0 / 8    | —     | —       | —         |
| P6    | Tests, previews, docs                        | TODO   | 0 / 8    | —     | —       | —         |

Update the counts as tasks complete. A phase is `DONE` only when its acceptance criteria are
recorded as passing in §7.

---

## 3. Phase 0 — Contract, layering & hooks (1–1.5 d)

**Acceptance:** app visually identical; no theme CSS relies on unlayered structural rules;
hooks exist for every shape the target themes must change; CI guards the Tailwind
variable-emission assumption.

- [ ] **P0-01** Create `src/lib/themes/types.ts`: manifest schema (`apiVersion`, id regex,
      modes, chrome, labels, tokens, css, fonts, preview), token types, per-token value
      grammar (§6.2.1 of `THEMES.md`).
- [ ] **P0-02** Encode the required-token list as data (one source used by types, validator,
      wiring test and docs).
- [ ] **P0-03** Regression test for Tailwind output: static utilities emit
      `var(--color-*)` **and** `/opacity` emits the `@supports color-mix(in oklab,
var(--color-*))` branch (compile a fixture with the installed Tailwind API).
- [ ] **P0-04** Rename `.lcars-*` primitives to `.ui-*` (aliases kept for one release) across
      the 14 affected files (208 occurrences).
- [ ] **P0-05** Add hooks: `.ui-bubble`, `.ui-msg-card`, `.ui-page`, `.ui-composer`,
      `.ui-header`, `.ui-scroll` (selectors may be empty initially; they must exist in
      markup so themes can target them).
- [ ] **P0-06** Add the raw-color ratchet script + committed baseline
      (`npm run check:theme-colors`), with the exact counting commands in the script.
- [ ] **P0-07** Capture the pre-change screenshot baseline (home, conversation, settings;
      dark/light; 1440×900 + 390×844) for parity checks in P2.
- [ ] **P0-08** Wire `THEMES_IMPLEMENTATION_LOG.md` into `THEMES.md`/`CLAUDE.md` (this file).

**Acceptance evidence:** _fill in with commit + verification entries._

---

## 4. Phase 1 — Runtime, SSR, persistence, picker (2–2.5 d)

**Acceptance:** SSR HTML already has the right chrome; first paint correct with cookies and
with `localStorage` only; external-theme SSR includes its stylesheet; unknown ids coerce
safely; legacy light-mode preference survives.

- [ ] **P1-01** `src/lib/themes/registry.ts` + `themes.svelte.ts`: built-in registry
      (isomorphic manifests), availability, active theme/mode, `apply()`, `setTheme()`,
      failure fallback.
- [ ] **P1-02** `Settings.uiTheme` + `uiThemeMode` in `types/Settings.ts`, `DEFAULT_SETTINGS`,
      `settingsValidation.ts`; unknown-id **coercion** (never a 400) on read and write.
- [ ] **P1-03** Update both settings endpoints and the client store
      (`${base}/settings`), `SettingsResponse` (`+layout.ts`), `SettingsStore`
      (`stores/settings.ts`).
- [ ] **P1-04** New `+layout.server.ts`: resolve settings theme + external manifest metadata,
      write `ui-theme`/`ui-mode` cookies; `+layout.ts` merges `uiTheme`, `uiThemeMode`,
      `themeMeta` into data.
- [ ] **P1-05** `+layout.svelte` renders chrome/labels from theme metadata during SSR.
- [ ] **P1-06** `handle.ts`: add `%themeAttrs%` + `%themeAssets%` to `app.html`, replace both
      in the single guarded replacer, validate cookie id against the registry
      (no attribute injection); `hooks.server.ts` `building` branch replaces both;
      build-time assertion for surviving `%…%` placeholders.
- [ ] **P1-07** `app.html` pre-paint bootstrap: read `ui-theme`/`ui-mode`, migrate
      `localStorage.theme`, `%sveltekit.nonce%`; `PUBLIC_DEFAULT_THEME` fallback.
- [ ] **P1-08** Settings → Appearance picker (gallery + previews, mode control, reset,
      instant apply, optimistic update); `?theme=` deep link stripped like `?model=`.
- [ ] **P1-09** Tests: id/mode resolution, coercion, cookie validation, SSR attribute parity,
      legacy-key migration, static-build placeholder assertion.

---

## 5. Phase 2 — LCARS under the contract (1.5 d)

**Acceptance:** pixel-comparable screenshots; wiring test proves every required token affects
at least one rule; no palette literals outside LCARS defaults.

- [ ] **P2-01** Move LCARS values into `src/lib/themes/lcars/theme.css`, scoped to
      `:root[data-theme="lcars"]` + `.dark`.
- [ ] **P2-02** Remove `.dark { --lcars-* }`; make `--lcars-*` aliases of `--ui-*`.
- [ ] **P2-03** Rename 147 `*-lcars-*` color utilities to `*-ui-*` across 14 files.
- [ ] **P2-04** Wire `::selection`, focus ring (split tokens), `scrollbar-custom`,
      `--ui-overlay` in `Modal`, prose/prose-invert mapping.
- [ ] **P2-05** Wire syntax highlighting (`highlight-js.css`), `::highlight`, router
      shimmer, paper citations.
- [ ] **P2-06** `meta theme-color` + manifests read `--ui-theme-color` (build-script or
      runtime).
- [ ] **P2-07** Add the token-wiring test (required token ⇒ at least one rule consumer).
- [ ] **P2-08** Screenshot parity check against P0-07; document any accepted diff.

---

## 6. Phase 3 — Classic theme (2–3 d)

**Acceptance:** matches pre-LCARS screenshots (`git show 9f6b0d7b:<file>`); light/dark; no
LCARS chrome or accent leakage.

- [ ] **P3-01** `classic/theme.json` + ramp (stock Tailwind neutrals) + tokens/fonts
      (system stack), `chrome: { statusStrip: hidden, chatHeader: hidden }`.
- [ ] **P3-02** Primitive overrides in `@layer components` (panel/screen/btn/chip/bubble).
- [ ] **P3-03** `structure: "classic"` variants in `+layout.svelte`, `ChatWindow.svelte`,
      `ChatMessage.svelte`, `NavMenu.svelte`, `MobileNav.svelte`.
- [ ] **P3-04** Variants in `WelcomeModal.svelte`, `ChatIntroduction.svelte`,
      `ModelsUnavailable.svelte`, `settings/(nav)/+layout.svelte`.
- [ ] **P3-05** Move status-strip/labels copy into theme config (no hardcoded LCARS strings).
- [ ] **P3-06** Light/dark screenshots vs. the pre-LCARS commit; document accepted diffs.

---

## 7. Phase 4 — Office theme (1.5–2 d)

**Acceptance:** side-by-side review against Word (Windows + web), light/dark; no purple/raw
accent leakage on migrated surfaces; iframe pane limitation documented.

- [ ] **P4-01** `office/theme.json` + light/dark tokens; 2px radii, dense primitives;
      sentence-case labels.
- [ ] **P4-02** Bundle Selawik + Carlito (OFL 1.1) with `LICENSE`/`OFL.txt`;
      `"Segoe UI"`/`"Calibri"` first in the stacks.
- [ ] **P4-03** Document-page canvas: `.ui-page` wrapper around the message column; adjust
      composer placement (inside page or floating comment box).
- [ ] **P4-04** Navigation-pane sidebar + title/ribbon-style top area.
- [ ] **P4-05** Status bar via `.ui-strip` (`--ui-statusbar-*`), real data labels.
- [ ] **P4-06** Options-dialog settings layout overrides.
- [ ] **P4-07** Semantic sweep of the high-traffic non-neutral surfaces (tool chips,
      danger/success, overlay) or record the de-scope decision (D9).
- [ ] **P4-08** Document iframe pane behavior (`__theme` param) and final Office review.

---

## 8. Phase 5 — External plugin loader (1.5–2 d)

**Acceptance:** a folder in `THEMES_DIR` is selectable with **no flash**; malformed,
unscoped or global-at-rule themes are rejected with clear errors; traversal attempts 404;
user-theme uploads remain disabled.

- [ ] **P5-01** `THEMES_DIR` config + list/manifest routes (metadata only, 404 when unset).
- [ ] **P5-02** `theme.css` + `fonts/:file` + `preview-:mode` routes; strict id regex +
      `fs.realpath` prefix check; caching/ETag.
- [ ] **P5-03** Promote a CSS parser (`css-tree`/`postcss`) to an explicit devDependency.
- [ ] **P5-04** Structural validation: scoped selectors, `@layer components` for structure,
      reject `@import`/`@property`/`@font-face`/`@keyframes`/`!important`/remote `url()`.
- [ ] **P5-05** Token grammar validation for token-only themes (per-token types, no `url()`).
- [ ] **P5-06** SSR `<link rel=preload as=style>` + stylesheet emission for a cookie-selected
      external theme; loader waits for `load` only on mid-session selection; failure/revert
      toast.
- [ ] **P5-07** `scripts/validate-themes.ts` (license-file presence when fonts bundled) + CI.
- [ ] **P5-08** Theme-author docs (package layout, allowed CSS, token grammar, licensing).

---

## 9. Phase 6 — Tests, previews, docs (1 d)

**Acceptance:** CI runs unit + wiring + contrast + no-flash + static-build checks; previews
committed; docs updated and linked.

- [ ] **P6-01** `themes.spec.ts`: schema, grammar, id/mode, completeness, coercion, labels.
- [ ] **P6-02** Contrast test per theme × mode (WCAG 4.5 / 3) with a small sRGB helper.
- [ ] **P6-03** Wiring test (every required token consumed).
- [ ] **P6-04** Playwright matrix → screenshots + picker previews (`scripts/theme-previews.ts`,
      capped workers).
- [ ] **P6-05** No-flash test (JS on/off, external-theme SSR `<link>` present).
- [ ] **P6-06** Ratchet in CI + static-build placeholder assertion.
- [ ] **P6-07** Update `README.md`, `CLAUDE.md`, `CODEBASE_SUMMARY.md`, `THEMES.md`
      (status/decisions) and this log.
- [ ] **P6-08** Final acceptance walk-through; mark Definition of Done.

---

## 10. Definition of Done (mirrors `THEMES.md`)

- [ ] `data-theme` runtime, cookie/localStorage/DB persistence, no first-paint flash; SSR
      chrome matches the account theme; external-theme SSR includes its stylesheet.
- [ ] Layering contract enforced; hooks for every themed shape; no `!important` on themeable
      surfaces.
- [ ] `lcars`, `classic`, `office` selectable and visually reviewed, light + dark,
      desktop + mobile.
- [ ] Theme picker with previews; unknown ids coerce safely.
- [ ] External themes load from `THEMES_DIR` with parser validation, caching, clear failures;
      token-only user themes remain off.
- [ ] Token wiring + contrast + matrix tests in CI; raw-color ratchet in place.
- [ ] Legacy `localStorage.theme` migrated; static builds contain no placeholders.
- [ ] Docs updated (`README`, `CLAUDE`, `CODEBASE_SUMMARY`, `THEMES`, this log).

---

## 11. Decision log (ADR-lite)

Append-only. Design rationale for D1–D6 is in `THEMES.md`; implementation decisions are
recorded here as they are made.

| ID  | Date       | Decision                                                                         | Rationale                                                                      | Status      |
| --- | ---------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------- |
| D1  | 2026-11-22 | Token contract + `.ui-*` primitives + per-theme neutral ramp; no component forks | Only sustainable way to theme ~150 components; verified Tailwind var emission  | Accepted    |
| D2  | 2026-11-22 | Built-ins may ship structural variants; plugins are CSS/token only               | Restoring the pre-LCARS look needs markup variants; plugins must not ship HTML | Accepted    |
| D3  | 2026-11-22 | Theme id/mode flow through route data; cookie only for `<html>` attrs            | Avoid SSR/hydration chrome mismatch                                            | Accepted    |
| D4  | 2026-11-22 | External themes are SSR-linked when selected                                     | Prevent FOUC on every cold load                                                | Accepted    |
| D5  | 2026-11-22 | User-uploaded themes are token-only (flag off)                                   | CSS can exfiltrate/overlay; tokens are safe with a typed grammar               | Accepted    |
| D6  | 2026-11-22 | Office fonts: Selawik + Carlito (both OFL 1.1), licenses bundled                 | Redistributable Segoe/Calibri metric equivalents                               | Accepted    |
| D7  | —          | Office display name: "Office" vs "Document"                                      | Trademark caution                                                              | **Pending** |
| D8  | —          | Sync `uiThemeMode` server-side                                                   | Cross-device consistency vs. extra writes                                      | **Pending** |
| D9  | —          | Non-neutral color sweep in scope for this release vs. de-scoped                  | Office/classic acceptance depends on it                                        | **Pending** |
| D10 | —          | Sidebar toggle cycles light↔dark vs. light→dark→system                           | Existing users never reach `system` from the toggle today                      | **Pending** |
| D11 | —          | Default theme for new users (`lcars` vs `classic`)                               | Product call; `PUBLIC_DEFAULT_THEME` exists either way                         | **Pending** |

Template for new entries:

```
| D12 | YYYY-MM-DD | <decision> | <why> | Accepted |
```

---

## 12. Open questions (from `THEMES.md` §17)

| #   | Question                                | Owner         | Resolution              |
| --- | --------------------------------------- | ------------- | ----------------------- |
| Q1  | Sync mode server-side?                  | product       | pending (D8)            |
| Q2  | Default theme for new users?            | product       | pending (D11)           |
| Q3  | Per-organization themes on HuggingChat? | product       | out of scope            |
| Q4  | User theme uploads required?            | product       | proposed no; flag later |
| Q5  | Office naming ("Office" vs "Document")? | product/legal | pending (D7)            |
| Q6  | Fourth high-contrast theme?             | a11y          | candidate follow-up     |

---

## 13. Verification log

Record **every** meaningful check: date, phase/task, command, result, notes. Keep the exact
commands so they are reproducible. Never run the full test suite locally (RAM exhaustion —
see `CLAUDE.md`); use targeted files with capped workers.

### 13.1 Design-time verification (pre-implementation)

| Date       | Check                                 | Command / evidence                 | Result                                                                               |
| ---------- | ------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------ |
| 2026-11-22 | Static utilities reference theme vars | Tailwind 4.3.3 compile fixture     | ✅ `.bg-gray-100 { background-color: var(--color-gray-100) }`                        |
| 2026-11-22 | `/opacity` utilities                  | same fixture                       | ✅ fallback hex + `@supports` branch using `var(--color-*)`                          |
| 2026-11-22 | `@theme inline` output                | same fixture                       | ✅ compiles to the raw variable (`var(--lcars-panel)`)                               |
| 2026-11-22 | `transformPageChunk` owner            | `src/lib/server/hooks/handle.ts`   | ✅ `handle.ts`; `hooks.server.ts` only the static-build branch                       |
| 2026-11-22 | Settings POST target                  | `src/lib/stores/settings.ts`       | ✅ `${base}/settings` (both routes share the schema)                                 |
| 2026-11-22 | CSP directives                        | `svelte.config.js`                 | ✅ only `frame-ancestors` today                                                      |
| 2026-11-22 | Selawik license                       | `microsoft/Selawik/LICENSE.txt`    | ✅ OFL 1.1 (not MIT)                                                                 |
| 2026-11-22 | Color-usage counts                    | grep commands in `THEMES.md` §12.1 | ✅ 111 files / ~3.1k neutral / ~491 non-neutral / ~212 hex / 14 files with `lcars-*` |

### 13.2 Implementation checks (append per task)

| Date | Phase/Task | Command | Result | Notes |
| ---- | ---------- | ------- | ------ | ----- |
| —    | —          | —       | —      | —     |

---

## 14. Session log

| Date       | Agent/owner          | Summary                                                                          | Commits                            |
| ---------- | -------------------- | -------------------------------------------------------------------------------- | ---------------------------------- |
| 2026-11-22 | design agent         | Multi-theme design (`THEMES.md`), critical review, hardening, implementation log | `11854a99`, `f664e1cd`, `8ef4361d` |
| —          | implementation agent | _start here: Phase 0_                                                            | —                                  |

---

## 15. Blockers & follow-ups

| ID  | Date | Item | Impact | Owner | Status |
| --- | ---- | ---- | ------ | ----- | ------ |
| —   | —    | —    | —      | —     | —      |

---

## 16. Phase hand-off checklist

Before declaring a phase complete:

- [ ] Every task in the phase checked or explicitly deferred with a decision ID.
- [ ] Acceptance criteria verified and recorded in §13 with commands/results.
- [ ] `npm run check` and `npm run lint` clean (targeted tests recorded, no full suite).
- [ ] Screenshots captured for every theme × mode × viewport touched by the phase.
- [ ] No new raw color utilities (ratchet unchanged or improved).
- [ ] `THEMES.md` updated if the design changed; decision log entry added.
- [ ] This log, phase dashboard and session log updated in the same commit.
- [ ] Commit pushed to `feature/multi-theme`.
