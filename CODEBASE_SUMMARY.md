# Chat UI - Codebase Summary

## Overview

Chat UI is a **SvelteKit-based chat interface for LLMs** that powers [HuggingChat](https://hf.co/chat). It connects to OpenAI-compatible APIs and supports multiple providers (HuggingFace, llama.cpp, Ollama, OpenRouter, etc.).

## Tech Stack

- **Frontend**: SvelteKit 2 + Svelte 5 (runes: `$state`, `$effect`)
- **Backend**: Elysia for API routes, MongoDB for persistence
- **Styling**: TailwindCSS with dark mode
- **Testing**: Vitest (client/SSR/server workspaces) + Playwright
- **Key libs**: `openai`, `zod`, `bits-ui`, `marked`, `@modelcontextprotocol/sdk`

## Key Features

| Feature     | Description                                            |
| ----------- | ------------------------------------------------------ |
| Chat UI     | Message streaming, file uploads, voice input (Whisper) |
| MCP         | Model Context Protocol integration for tool calling    |
| Omni Router | Smart model routing via Arch-Router                    |
| Auth        | OpenID Connect (HF, Google, etc.)                      |
| Sharing     | Public conversation sharing via hash                   |

## Directory Structure

```
src/
├── routes/                 # SvelteKit file-based routing
│   ├── conversation/[id]/ # Chat page + streaming
│   ├── settings/          # User settings
│   └── api/v2/            # Elysia API routes
└── lib/
    ├── components/        # Svelte components (chat/, mcp/, voice/)
    ├── server/            # Backend logic (API, textGeneration, MCP, router)
    ├── types/             # TypeScript interfaces
    └── stores/            # Svelte reactive state
```

## Text Generation Flow

1. `POST /conversation/[id]` receives user message
2. Server validates user, fetches conversation history
3. Builds message tree structure
4. Calls LLM endpoint via OpenAI client
5. Streams response back, stores in MongoDB

## Database Collections

- `conversations` - Chat sessions with messages
- `users` - OIDC-backed accounts
- `settings` - User preferences
- `sharedConversations` - Public share links
- `tools` - MCP tool definitions

## Theming (LCARS)

The UI follows the LCARS design language from the design mockups (dark by default).

- **Tokens** live in `src/styles/main.css`: LCARS accents (`lcars-peach`, `lcars-amber`,
  `lcars-lilac`, `lcars-sky`, `lcars-marigold`, `lcars-mauve`), theme-flipping semantic
  colors (`lcars-paper`, `lcars-panel`, `lcars-screen-1/2`, `lcars-ink`, `lcars-muted`,
  `lcars-dim`, `lcars-user-bubble`, `lcars-accent-ink`), and a warm-neutral `gray-*`
  remap that re-themes existing components without per-component changes.
- **Primitives** (`@layer components` in `main.css`): `.lcars-panel`, `.lcars-screen`,
  `.lcars-cap-r`/`.lcars-cap-up`, `.lcars-label`, `.lcars-kicker`, `.lcars-display`,
  `.lcars-btn`, `.lcars-chip`, `.lcars-led`, `.lcars-beacon`, `.lcars-composer-fade`.
  Utilities (e.g. `text-[0.625rem]`, `font-bold`) already override these because the
  utilities layer comes last — no `!` needed.
- **Fonts** are self-hosted from `src/styles/fonts/` (Saira, Saira Extra Condensed,
  IBM Plex Mono) and bundled by Vite — no third-party requests, base-path safe.
- **Dark by default**: an unset theme preference resolves to dark (`src/app.html`,
  `src/lib/switchTheme.ts`). The settings page still offers Light / Dark / System.
- **Status surfaces use real data**: the app frame's bottom capsules show model-server
  readiness, stream state, model count and MCP count; the chat header shows the model
  capsule and a READY / STREAMING / STANDING BY LED; `ModelsUnavailable` renders the
  rippling standby beacon.
- **Surfaces covered**: app frame + sidebar (`NavMenu`, `NavConversationItem`), mobile
  nav/drawer (`MobileNav`), chat (`ChatWindow`, `ChatMessage`, `ChatIntroduction`),
  composer (capsule + amber beacon send), welcome/access modal, settings nav and pages,
  and the empty/standby states.
- **Mobile**: the bottom status strip is hidden below 860px; the screen panel tightens
  to 18px radius with 10px insets; the sidebar becomes the existing mobile drawer.
- **Accessibility**: reduced-motion disables the beacon/LED animations; LCARS capsules
  keep their existing labels/aria attributes and ≥40px touch targets.

A multi-theme architecture (user-selectable `lcars` / `classic` / `office` themes plus a
portable theme-plugin format) is specified in [`THEMES.md`](./THEMES.md).

## Commands

```bash
npm run dev      # Dev server (localhost:5173)
npm run build    # Production build
npm run check    # TypeScript validation
npm run lint     # Format + lint check
npm run test     # Run all tests — do NOT use locally; see warning below
```

> [!WARNING]
> **Never run the full test suite on a developer machine.** All three Vitest
> workspaces at once spawn many workers, each with its own in-memory MongoDB
> (and Chromium for client tests), exhausting system RAM and crashing the
> machine. Run targeted subsets instead, e.g.
> `npx vitest run --project=server <one-file.spec.ts> --no-file-parallelism --maxWorkers=1`,
> and let CI run the full suite. See CLAUDE.md for details.

## Environment

Key variables in `.env`:

- `OPENAI_BASE_URL` - API endpoint
- `OPENAI_API_KEY` - API key
- `MONGODB_URL` - Optional (falls back to in-memory)
- `LLM_ROUTER_*` - Router config
- `MCP_SERVERS` - Pre-configured MCP servers
