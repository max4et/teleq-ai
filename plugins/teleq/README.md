# TeleQ plugin for Claude Code

Lets Claude put things on your Android TV through the [TeleQ](https://teleq.online) app.

* **MCP server** `teleq` (`npx -y teleq-mcp`, over your home Wi-Fi). Link once: `npx teleq-mcp pair`, or
  just ask Claude to "link the TV": it calls `link_tv` with the code TeleQ shows under
  Linked devices → Link an assistant.
* **Skill** `teleq-tv`: when to use the TV, 10-foot design rules, presenting with slides, checking with
  `screen_snapshot`, not interrupting what people watch.
* **Commands** `/tv-show <what>` and `/tv-present <topic>`.

Install:

```
/plugin marketplace add max4et/teleq-ai
/plugin install teleq@teleq
```

Away from home Wi-Fi, use the cloud connector instead of the local server:
`claude mcp add --transport http teleq https://relay.teleq.online/mcp`.

`skills/teleq-tv/SKILL.md`, `.mcp.json` and `.claude-plugin/plugin.json` are generated in TeleQ's main
repository (`tools/ai/`) and copied to the public repository https://github.com/max4et/teleq-ai.
