// Finding and talking to the TV. No dependencies: Node's own fetch and os.
import os from 'node:os';

export const DEFAULT_PORT = 8765;
const PORT_FALLBACKS = Array.from({ length: 10 }, (_, i) => DEFAULT_PORT + 1 + i);

/** True when [host] is an RFC 1918 / link-local IPv4 literal: the only addresses we ever talk to. */
export function isPrivateIPv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/** GET /health; resolves to { tvName } when [host]:[port] is a TeleQ TV, else null. */
export async function probe(host, port, timeoutMs = 1500) {
  try {
    const res = await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const body = await res.json();
    if (body?.status !== 'ok' || typeof body.protocolVersion !== 'number') return null;
    return { tvName: typeof body.tvName === 'string' ? body.tvName : null };
  } catch {
    return null;
  }
}

/** Every other address of each local /24 (the home network), without our own. */
export function localCandidates(interfaces = os.networkInterfaces()) {
  const out = new Set();
  for (const addrs of Object.values(interfaces)) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal || !isPrivateIPv4(a.address)) continue;
      const base = a.address.split('.').slice(0, 3).join('.');
      for (let i = 1; i <= 254; i++) {
        const host = `${base}.${i}`;
        if (host !== a.address) out.add(host);
      }
    }
  }
  return [...out];
}

async function sweep(hosts, ports, concurrency, timeoutMs) {
  const jobs = hosts.flatMap((host) => ports.map((port) => ({ host, port })));
  const found = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (next < jobs.length) {
        const { host, port } = jobs[next++];
        const info = await probe(host, port, timeoutMs);
        if (info) found.push({ host, port, tvName: info.tvName });
      }
    }),
  );
  return found;
}

/**
 * Looks for TVs on the local network: the default port everywhere first (a few seconds), the
 * fallback ports only when nothing answered.
 */
export async function discover({ hosts = localCandidates(), ports, concurrency = 64, timeoutMs = 800 } = {}) {
  if (ports) return sweep(hosts, ports, concurrency, timeoutMs);
  const first = await sweep(hosts, [DEFAULT_PORT], concurrency, timeoutMs);
  return first.length ? first : sweep(hosts, PORT_FALLBACKS, concurrency, timeoutMs);
}

/** Links this computer with the code shown on the TV. Throws Error with a user-facing message. */
export async function pairWithCode({ host, port }, code, name) {
  let res;
  try {
    res = await fetch(`http://${host}:${port}/agent/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ protocolVersion: 1, code: String(code).replace(/\D/g, ''), name }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error(`Can't reach the TV at ${host}:${port}. Is TeleQ open on it, on the same Wi-Fi?`);
  }
  const body = await res.json().catch(() => ({}));
  if (res.ok && body.success && body.key) return { key: body.key, tvName: body.tvName ?? null };
  if (res.status === 429) throw new Error('Too many wrong codes. Wait half a minute and try again.');
  if (res.status === 401) {
    throw new Error(`${body.message ?? 'Wrong code'}. On the TV, open "AI assistants" and choose "Link an assistant" for a fresh code.`);
  }
  throw new Error(body.message ?? `The TV refused the request (HTTP ${res.status}).`);
}
