// MCP stdio <-> TeleQ TV. Newline-delimited JSON-RPC in, the same out; every message is forwarded
// to POST /mcp on the TV. The bridge holds no tool logic of its own: the TV is the MCP server.
import fs from 'node:fs';
import { DEFAULT_PORT, discover, isPrivateIPv4, probe } from './tv.mjs';
import { loadCache, saveCache } from './config.mjs';

/** What TeleQ offers (tools/ai/catalog.mjs), for clients that start before this computer ever reached the TV. */
const CATALOG = JSON.parse(fs.readFileSync(new URL('./catalog.json', import.meta.url), 'utf8'));
const CACHED = { initialize: 'initialize', 'tools/list': 'tools', 'prompts/list': 'prompts' };

const UNREACHABLE =
  "Can't reach the TV. Open the TeleQ app on it (same Wi-Fi as this computer) and try again.";
const REVOKED =
  'This TV no longer trusts this computer (it was unlinked). Run "npx teleq-mcp pair" to link it again.';

function rpcError(id, code, message) {
  return JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

/** An older TV answers a tool it doesn't have with a JSON-RPC "Unknown tool" error. */
function olderTv(reply) {
  return typeof reply?.error?.message === 'string' && reply.error.message.startsWith('Unknown tool:');
}

const updateTv = (tool) =>
  `This TV runs an older version of TeleQ that doesn't have "${tool}". Ask the user to update TeleQ on the TV (Google Play), or use the tools listed by tv_status.`;

function toolError(id, text) {
  return JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } });
}

/**
 * [config] is the saved { host, port, key, tvName }; [onConfig] is called when the TV moved to a new
 * address so the caller can persist it. Returns an async function: one input line in, one output
 * line (or null when nothing should be written) out.
 */
export function createBridge({ config, onConfig = () => {}, configDir, rediscover = discover, timeoutMs = 20000 }) {
  let current = { ...config };

  async function post(body) {
    return fetch(`http://${current.host}:${current.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${current.key}` },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  /** The TV may have a new DHCP address: find it again, preferring the one with the same name. */
  async function relocate() {
    const found = await rediscover();
    const match = found.find((t) => t.tvName && t.tvName === current.tvName) ?? (found.length === 1 ? found[0] : null);
    if (!match) return false;
    current = { ...current, host: match.host, port: match.port };
    onConfig(current);
    return true;
  }

  async function send(line, msg) {
    try {
      return await post(line);
    } catch {
      if (!(await relocate())) return null;
      try {
        return await post(line);
      } catch {
        return null;
      }
    }
  }

  /** The TV's last answer to initialize / tools/list / prompts/list, else what TeleQ offers in general. */
  function fromCache(msg) {
    const key = CACHED[msg.method];
    if (!key) return null;
    const hit = loadCache(configDir)[key] ?? CATALOG[key];
    if (!hit) return null;
    const result = msg.method === 'initialize' && typeof msg.params?.protocolVersion === 'string'
      ? { ...hit, protocolVersion: hit.protocolVersion ?? msg.params.protocolVersion }
      : hit;
    return JSON.stringify({ jsonrpc: '2.0', id: msg.id, result });
  }

  return async function handleLine(line) {
    if (!line.trim()) return null;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return rpcError(null, -32700, 'Parse error');
    }
    const isRequest = msg && typeof msg === 'object' && msg.id !== undefined && msg.id !== null && typeof msg.method === 'string';

    const res = await send(line, msg);
    if (!res) {
      if (!isRequest) return null;
      return fromCache(msg) ?? (msg.method === 'tools/call' ? toolError(msg.id, UNREACHABLE) : rpcError(msg.id, -32000, UNREACHABLE));
    }
    if (res.status === 202) return null;
    if (res.status === 401) {
      if (!isRequest) return null;
      return msg.method === 'tools/call' ? toolError(msg.id, REVOKED) : rpcError(msg.id, -32001, REVOKED);
    }
    if (res.status === 429) {
      if (!isRequest) return null;
      return msg.method === 'tools/call'
        ? toolError(msg.id, 'The TV is rate limiting requests. Wait a few seconds and try again.')
        : rpcError(msg.id, -32002, 'Rate limited by the TV');
    }
    const text = await res.text();
    if (isRequest && res.ok) {
      let reply;
      try {
        reply = JSON.parse(text);
      } catch {
        // Not JSON: pass it through untouched.
      }
      if (reply?.result && CACHED[msg.method]) {
        const cache = loadCache(configDir);
        cache[CACHED[msg.method]] = reply.result;
        saveCache(cache, configDir);
      }
      if (msg.method === 'tools/call' && olderTv(reply)) return toolError(msg.id, updateTv(String(msg.params?.name ?? 'that tool').slice(0, 64)));
      // A TV from before prompts: "Method not found" for prompts/list means none.
      if (msg.method === 'prompts/list' && reply?.error?.code === -32601) {
        return JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { prompts: [] } });
      }
    }
    return res.ok ? text : isRequest ? rpcError(msg.id, -32003, `The TV answered HTTP ${res.status}`) : null;
  };
}

/** Wires [handleLine] to a pair of streams. Resolves when stdin ends. */
export async function serve(handleLine, input = process.stdin, output = process.stdout) {
  let buffer = '';
  const pending = new Set();
  const write = (s) => s && output.write(s + '\n');
  const run = (line) => {
    const p = handleLine(line).then(write, (e) => write(rpcError(null, -32603, String(e?.message ?? e))));
    pending.add(p);
    p.finally(() => pending.delete(p));
  };
  input.setEncoding('utf8');
  for await (const chunk of input) {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      run(line);
    }
  }
  if (buffer.trim()) run(buffer);
  await Promise.allSettled([...pending]);
}

export { probe };

// ---- linking from inside the assistant (Claude Desktop extension, no terminal) ----

export const LINK_TV_TOOL = {
  name: 'link_tv',
  title: 'Link a TV',
  description:
    'Link this computer with a TV running TeleQ on the same Wi-Fi. Ask the user to open TeleQ on the TV, choose Linked devices → Link an assistant, and read you the 9-digit code. Only needed once per TV (or after it was unlinked).',
  inputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'The 9-digit code shown on the TV.' },
      tv_address: { type: 'string', description: "Optional: the TV's address on the home network (like 192.168.1.20), when several TVs are found." },
    },
    required: ['code'],
    additionalProperties: false,
  },
  annotations: { title: 'Link a TV', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
};

const NOT_LINKED =
  'No TV is linked yet. Ask the user to open TeleQ on the TV → Linked devices → Link an assistant, then call link_tv with the 9-digit code.';

const json = (id, result) => JSON.stringify({ jsonrpc: '2.0', id, result });
const text = (id, t, isError = false) => json(id, { content: [{ type: 'text', text: t }], isError });

/**
 * The bridge as the client starts it: works whether or not a TV is linked, and offers link_tv either way.
 * [deps] are injectable for tests: loadConfig/saveConfig, discover, probe, pairWithCode, name.
 */
export function createAutoBridge({ configDir, deps, defaultHost = process.env.TELEQ_TV_HOST }) {
  let inner = null;
  const config = () => deps.loadConfig(configDir);
  const ensure = () => {
    const cfg = config();
    if (cfg && (!inner || inner.key !== cfg.key)) {
      inner = { key: cfg.key, handle: createBridge({ config: cfg, configDir, onConfig: (c) => deps.saveConfig(c, configDir), rediscover: deps.discover }) };
    }
    return inner;
  };

  async function linkTv(id, args) {
    const code = String(args?.code ?? '').replace(/\D/g, '');
    if (code.length !== 9) return text(id, 'The code has 9 digits. Ask the user for the code shown on the TV.', true);
    let target;
    const address = String(args?.tv_address ?? defaultHost ?? '').trim();
    if (address) {
      const [host, p] = address.split(':');
      if (!isPrivateIPv4(host)) return text(id, 'tv_address must be the TV\'s address on the home network, like 192.168.1.20.', true);
      const port = Number(p) || DEFAULT_PORT;
      const info = await deps.probe(host, port);
      if (!info) return text(id, `No TeleQ TV answered at ${address}. Is TeleQ open on it?`, true);
      target = { host, port, tvName: info.tvName };
    } else {
      const found = await deps.discover();
      if (found.length === 0) return text(id, "No TV found on this network. TeleQ must be open on the TV, on the same Wi-Fi as this computer (not a guest network). You can also pass tv_address.", true);
      if (found.length > 1) {
        return text(id, `Several TVs found: ${found.map((t) => `${t.tvName ?? 'TV'} (${t.host})`).join(', ')}. Call link_tv again with tv_address set to the one showing the code.`, true);
      }
      target = found[0];
    }
    try {
      const { key, tvName } = await deps.pairWithCode(target, code, deps.name());
      deps.saveConfig({ host: target.host, port: target.port, key, tvName: tvName ?? target.tvName }, configDir);
      inner = null;
      return text(id, `Linked with ${tvName ?? target.tvName ?? 'the TV'}. You can use the TV tools now (start with tv_status).`);
    } catch (e) {
      return text(id, e.message, true);
    }
  }

  return async function handleLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return line.trim() ? rpcError(null, -32700, 'Parse error') : null;
    }
    const isRequest = msg && msg.id !== undefined && msg.id !== null && typeof msg.method === 'string';
    if (isRequest && msg.method === 'tools/call' && msg.params?.name === 'link_tv') return linkTv(msg.id, msg.params.arguments);
    const linked = ensure();
    if (linked) {
      const out = await linked.handle(line);
      if (out && isRequest && msg.method === 'tools/list') {
        try {
          const reply = JSON.parse(out);
          if (Array.isArray(reply.result?.tools) && !reply.result.tools.some((t) => t.name === 'link_tv')) reply.result.tools.push(LINK_TV_TOOL);
          return JSON.stringify(reply);
        } catch {
          return out;
        }
      }
      return out;
    }
    // Not linked: describe what TeleQ offers, and point every tool call at link_tv.
    if (!isRequest) return null;
    switch (msg.method) {
      case 'initialize':
        return json(msg.id, {
          ...CATALOG.initialize,
          protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2025-06-18',
          instructions: `${CATALOG.initialize.instructions} ${NOT_LINKED}`,
        });
      case 'ping': return json(msg.id, {});
      case 'tools/list': return json(msg.id, { tools: [...CATALOG.tools.tools, LINK_TV_TOOL] });
      case 'prompts/list': return json(msg.id, CATALOG.prompts);
      case 'tools/call': return text(msg.id, NOT_LINKED, true);
      default: return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  };
}
