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

| Feature | Description |
|---------|-------------|
| Chat UI | Message streaming, file uploads, voice input (Whisper) |
| MCP | Model Context Protocol integration for tool calling |
| Omni Router | Smart model routing via Arch-Router |
| Auth | OpenID Connect (HF, Google, etc.) |
| Sharing | Public conversation sharing via hash |

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

## Commands

```bash
npm run dev      # Dev server (localhost:5173)
npm run build    # Production build
npm run check    # TypeScript validation
npm run lint     # Format + lint check
npm run test     # Run all tests
```

## Environment

Key variables in `.env`:
- `OPENAI_BASE_URL` - API endpoint
- `OPENAI_API_KEY` - API key
- `MONGODB_URL` - Optional (falls back to in-memory)
- `LLM_ROUTER_*` - Router config
- `MCP_SERVERS` - Pre-configured MCP servers
