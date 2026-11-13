# TeleQ for AI assistants

Let Claude, ChatGPT, Gemini CLI, Cursor or VS Code put things on your TV through the
[TeleQ](https://teleq.online) app: slides, recipes, scoreboards, dashboards, photos and video — and see
what the TV shows so the assistant can fix its own layout. Set-up for every client:
**https://teleq.online/ai/**

| What | Where |
|---|---|
| `teleq-mcp` — MCP server over your home Wi‑Fi (npm: [teleq-mcp](https://www.npmjs.com/package/teleq-mcp)) | [`mcp/`](mcp/) |
| Claude Code plugin (MCP server, `teleq-tv` skill, `/tv-show`, `/tv-present`) | [`plugins/teleq/`](plugins/teleq/) |
| Gemini CLI extension | [`gemini-extension.json`](gemini-extension.json), [`GEMINI.md`](GEMINI.md) |
| Claude Desktop extension | [teleq.online/download/teleq.mcpb](https://teleq.online/download/teleq.mcpb) (manifest in [`mcp/mcpb/`](mcp/mcpb/)) |
| MCP Registry entry `io.github.max4et/teleq` | [`mcp/server.json`](mcp/server.json) |
| Cloud connector for claude.ai and ChatGPT | `https://relay.teleq.online/mcp` (OAuth) |

## Install

**Claude Code**

```
/plugin marketplace add max4et/teleq-ai
/plugin install teleq@teleq
```

**Gemini CLI**

```
gemini extensions install https://github.com/max4et/teleq-ai
```

**Anything else that speaks MCP** (Claude Desktop, Cursor, VS Code…): `npx -y teleq-mcp`, linked once with
`npx teleq-mcp pair` or by asking the assistant to "link the TV". Details: [`mcp/README.md`](mcp/README.md).

## Safety

Linking needs a code shown on the TV; the TV shows which assistant put content up and Back on the remote
stops it; each assistant can be unlinked, or denied screen snapshots, on the TV. Assistants can only load
public `https://` links, and their HTML runs in a sandbox without network access.

---

This repository is generated from TeleQ's main (private) repository by `tools/ai/export-public.mjs`.
Issues and pull requests are welcome here; changes are carried over by hand. Support: support@teleq.online.
License: MIT.
