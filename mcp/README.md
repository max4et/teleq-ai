# teleq-mcp

Let Claude (or any MCP client) put things on your TV through the [TeleQ](https://teleq.online) app:
large text cards, slides, pictures, video and small HTML dashboards. It talks to the TV over your
home Wi‑Fi; nothing goes through a cloud server.

```
Claude Code / Claude Desktop / Cursor / Gemini CLI ──stdio──▶ teleq-mcp ──HTTP POST /mcp──▶ TeleQ on the TV
```

`teleq-mcp` is a thin bridge: the TV itself is the MCP server and decides what an assistant may do.
It has no dependencies besides Node.js.

For Claude on the web or phone, and for ChatGPT, use the cloud connector
`https://relay.teleq.online/mcp` instead (see <https://teleq.online/ai/>).

## Requirements

* TeleQ open on an Android TV.
* A computer on the **same Wi‑Fi** as the TV, with Node.js 18.17 or newer.

## Install and link

1. On the TV: TeleQ → **Linked devices** → **Link an assistant**. A 9‑digit code appears (valid for 5 minutes).
2. On the computer:

   ```bash
   npx teleq-mcp pair
   ```

   It looks for TeleQ on your network, asks for the code and stores a key for this TV in your user
   folder (owner-only file). The TV keeps only a hash of the key. Options:

   * `--host 192.168.1.20` — skip the search and use this address (`--host 192.168.1.20:8766` for another port);
   * `--name "Claude on my laptop"` — how the assistant is listed on the TV.

3. Add it to your client:

   | Client | How |
   |---|---|
   | Claude Code | `claude mcp add teleq -- npx -y teleq-mcp` |
   | Claude Desktop | `"teleq": { "command": "npx", "args": ["-y", "teleq-mcp"] }` under `mcpServers` in `claude_desktop_config.json`, then restart |
   | Cursor | the same JSON in `~/.cursor/mcp.json` (`mcpServers`) |
   | VS Code | `"teleq": { "type": "stdio", "command": "npx", "args": ["-y", "teleq-mcp"] }` under `servers` in `.vscode/mcp.json` |
   | Gemini CLI | the same JSON in `~/.gemini/settings.json` (`mcpServers`) |

Then ask: “show tonight's recipe on the TV”, “make a 5-slide presentation about the Moon and check that
everything fits”, “play this stream on the TV, then pause it”.

## Commands

| Command | What it does |
|---|---|
| `npx teleq-mcp pair [--host <ip[:port]>] [--name <label>]` | Link this computer with the code shown on the TV. |
| `npx teleq-mcp status` | Show the linked TV, whether it answers right now, and where the config lives. |
| `npx teleq-mcp unlink` | Forget the TV on this computer. To also revoke the key, choose **Unlink** next to it on the TV. |
| `npx teleq-mcp` (or `serve`) | Run as an MCP server over stdio. This is what the client starts; you don't run it by hand. |

## Environment variables

| Variable | Meaning |
|---|---|
| `TELEQ_CONFIG_DIR` | Where the key (`tv.json`) and the tool cache (`cache.json`) are kept. Default: `$XDG_CONFIG_HOME/teleq`, `%APPDATA%\teleq` on Windows, else `~/.config/teleq`. Handy for linking two TVs: run each server with its own directory. |
| `XDG_CONFIG_HOME`, `APPDATA` | Used for the default above. |

## How it behaves

* **The TV moved to a new address** (DHCP): when a call fails, the bridge searches the local /24 again,
  prefers a TV with the same name and saves the new address.
* **The TV is off**: `initialize` and `tools/list` are answered from the last description the TV sent,
  so the client starts normally; tool calls return a readable error ("Can't reach the TV…").
* **Unlinked on the TV**: calls return "This TV no longer trusts this computer"; run `pair` again.
* **Limits** are enforced on the TV: 30 calls a minute per assistant, public `https://` links only
  (nothing on your home network, no YouTube), HTML pages run in a sandbox without network access.
  While an assistant's content is up the TV shows who put it there, and **Back** on the remote stops it.

## Troubleshooting

| Symptom | What to do |
|---|---|
| `No TV found` during `pair` | TeleQ must be open on the TV and both devices on the same Wi‑Fi (not a guest network, no VPN on the computer). Pass the TV's address with `--host`; it is shown in TeleQ on the TV under the QR code. |
| `Wrong code` / `Too many wrong codes` | Codes last 5 minutes; 5 wrong tries burn the code and pause entry for 30 s. Open **Link an assistant** again for a fresh one. |
| The client lists no TeleQ tools | Run `npx teleq-mcp status`. If it says "Not linked", run `pair`. Check the client's MCP log for `teleq-mcp:` lines (they go to stderr). |
| `Can't reach the TV` on every call | The TV is asleep or TeleQ is closed. TeleQ can't be woken from the computer. |
| Corporate or mesh Wi‑Fi blocks device-to-device traffic | Use the cloud connector (`https://relay.teleq.online/mcp`) instead. |
| Start over | `npx teleq-mcp unlink`, unlink it on the TV too, then `pair`. |

## Development

```bash
npm test                 # node --test, no dependencies
node bin/teleq-mcp.mjs pair --host 192.168.1.20
claude mcp add teleq-dev -- node "$PWD/bin/teleq-mcp.mjs"
```

License: MIT.
