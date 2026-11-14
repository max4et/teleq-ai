import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createAutoBridge, createBridge, serve } from '../src/bridge.mjs';
import { deleteConfig, loadConfig, saveConfig } from '../src/config.mjs';
import { discover, isPrivateIPv4, localCandidates, pairWithCode, probe } from '../src/tv.mjs';

const KEY = 'k'.repeat(43);
let server, port, calls, mode, dir;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teleq-test-'));
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url === '/health') return json(200, { status: 'ok', protocolVersion: 1, tvName: 'Living Room' });
      if (req.url === '/agent/pair') {
        const { code } = JSON.parse(body);
        if (code === '123456789') return json(200, { success: true, key: KEY, tvName: 'Living Room' });
        if (code === '000000000') return json(429, { error: 'TOO_MANY_ATTEMPTS', message: 'Too many' });
        return json(401, { error: 'INVALID_CODE', message: 'Wrong code (4 attempts left)' });
      }
      if (req.url === '/mcp') {
        calls.push({ auth: req.headers.authorization, body });
        if (mode === 'revoked') return json(401, { error: 'UNAUTHORIZED' });
        const msg = JSON.parse(body);
        if (msg.id === undefined) { res.writeHead(202); return res.end(); }
        if (msg.method === 'tools/list') return json(200, { jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'show_text' }] } });
        // An older TV: no prompts, and tools it doesn't know.
        if (msg.method === 'prompts/list') return json(200, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found: prompts/list' } });
        if (msg.method === 'tools/call' && msg.params?.name === 'show_slides') {
          return json(200, { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'Unknown tool: show_slides' } });
        }
        return json(200, { jsonrpc: '2.0', id: msg.id, result: { echo: msg.method } });
      }
      json(404, {});
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const reset = () => { calls = []; mode = 'ok'; };
const bridge = (extra = {}) =>
  createBridge({ config: { host: '127.0.0.1', port, key: KEY, tvName: 'Living Room' }, configDir: dir, ...extra });

test('private address check', () => {
  assert.ok(isPrivateIPv4('192.168.1.5') && isPrivateIPv4('10.0.0.1') && isPrivateIPv4('172.20.1.1'));
  assert.ok(!isPrivateIPv4('8.8.8.8') && !isPrivateIPv4('example.com') && !isPrivateIPv4('172.32.0.1'));
});

test('localCandidates sweeps the /24 of private interfaces only', () => {
  const c = localCandidates({
    en0: [{ family: 'IPv4', address: '192.168.7.20', internal: false }],
    lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    vpn: [{ family: 'IPv4', address: '8.8.4.4', internal: false }],
  });
  assert.equal(c.length, 253);
  assert.ok(c.includes('192.168.7.1') && !c.includes('192.168.7.20'));
});

test('probe and discover find a TeleQ TV, and ignore other things', async () => {
  assert.deepEqual(await probe('127.0.0.1', port), { tvName: 'Living Room' });
  assert.equal(await probe('127.0.0.1', 1), null);
  const found = await discover({ hosts: ['127.0.0.1'], ports: [port, 1] });
  assert.deepEqual(found, [{ host: '127.0.0.1', port, tvName: 'Living Room' }]);
});

test('pairWithCode: success and user-facing failures', async () => {
  const ok = await pairWithCode({ host: '127.0.0.1', port }, '123 456 789', 'Claude');
  assert.deepEqual(ok, { key: KEY, tvName: 'Living Room' });
  await assert.rejects(pairWithCode({ host: '127.0.0.1', port }, '111111111', 'x'), /Wrong code.*Link an assistant/);
  await assert.rejects(pairWithCode({ host: '127.0.0.1', port }, '000000000', 'x'), /Too many wrong codes/);
  await assert.rejects(pairWithCode({ host: '127.0.0.1', port: 1 }, '1', 'x'), /Can't reach the TV/);
});

test('forwards requests with the key and drops 202 notifications', async () => {
  reset();
  const handle = bridge();
  const out = JSON.parse(await handle('{"jsonrpc":"2.0","id":4,"method":"ping"}'));
  assert.equal(out.result.echo, 'ping');
  assert.equal(calls[0].auth, `Bearer ${KEY}`);
  assert.equal(await handle('{"jsonrpc":"2.0","method":"notifications/initialized"}'), null);
  assert.equal(await handle('   '), null);
  assert.equal(JSON.parse(await handle('{nope')).error.code, -32700);
});

test('revoked key turns into a clear tool error', async () => {
  reset();
  mode = 'revoked';
  const handle = bridge();
  const out = JSON.parse(await handle('{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"show_text"}}'));
  assert.equal(out.result.isError, true);
  assert.match(out.result.content[0].text, /pair/);
  const other = JSON.parse(await handle('{"jsonrpc":"2.0","id":6,"method":"tools/list"}'));
  assert.equal(other.error.code, -32001);
});

test('unreachable TV: cached tools list, tool errors, and relocation', async () => {
  reset();
  // Warm the cache while the TV is up.
  await bridge()('{"jsonrpc":"2.0","id":7,"method":"tools/list"}');
  const dead = createBridge({
    config: { host: '127.0.0.1', port: 1, key: KEY, tvName: 'Living Room' },
    configDir: dir,
    rediscover: async () => [],
  });
  const list = JSON.parse(await dead('{"jsonrpc":"2.0","id":8,"method":"tools/list"}'));
  assert.equal(list.result.tools[0].name, 'show_text');
  const call = JSON.parse(await dead('{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{}}'));
  assert.equal(call.result.isError, true);
  assert.match(call.result.content[0].text, /Can't reach the TV/);

  let moved = null;
  const roaming = createBridge({
    config: { host: '127.0.0.1', port: 1, key: KEY, tvName: 'Living Room' },
    configDir: dir,
    rediscover: async () => [{ host: '127.0.0.1', port, tvName: 'Living Room' }],
    onConfig: (c) => { moved = c; },
  });
  const ok = JSON.parse(await roaming('{"jsonrpc":"2.0","id":10,"method":"ping"}'));
  assert.equal(ok.result.echo, 'ping');
  assert.equal(moved.port, port);
});

test('an older TV: unknown tools become a readable "update TeleQ" tool error, missing prompts an empty list', async () => {
  reset();
  const b = bridge();
  const r = JSON.parse(await b('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"show_slides","arguments":{}}}'));
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /older version of TeleQ.*"show_slides".*update TeleQ on the TV/);
  const p = JSON.parse(await b('{"jsonrpc":"2.0","id":2,"method":"prompts/list"}'));
  assert.deepEqual(p.result, { prompts: [] });
});

test('never reached a TV: the bundled catalog answers initialize, tools/list and prompts/list', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'teleq-empty-'));
  const dead = createBridge({ config: { host: '127.0.0.1', port: 1, key: KEY }, configDir: empty, rediscover: async () => [] });
  const init = JSON.parse(await dead('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'));
  assert.equal(init.result.serverInfo.name, 'teleq-tv');
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.match(init.result.instructions, /screen_snapshot/);
  const tools = JSON.parse(await dead('{"jsonrpc":"2.0","id":2,"method":"tools/list"}')).result.tools.map((t) => t.name);
  assert.ok(tools.includes('show_slides') && tools.includes('screen_snapshot') && tools.includes('open_in_app') && tools.length === 15);
  const prompts = JSON.parse(await dead('{"jsonrpc":"2.0","id":3,"method":"prompts/list"}')).result.prompts;
  assert.equal(prompts.length, 4);
});

test('auto bridge: unlinked it offers link_tv, links with the TV code, then forwards to the TV', async () => {
  reset();
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teleq-auto-'));
  let found = [{ host: '127.0.0.1', port, tvName: 'Living Room' }];
  const b = createAutoBridge({
    configDir: cfgDir,
    defaultHost: undefined,
    deps: { loadConfig, saveConfig, discover: async () => found, probe, pairWithCode, name: () => 'Claude Desktop (test)' },
  });
  const init = JSON.parse(await b('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'));
  assert.match(init.result.instructions, /link_tv/);
  const tools = JSON.parse(await b('{"jsonrpc":"2.0","id":2,"method":"tools/list"}')).result.tools.map((t) => t.name);
  assert.ok(tools.includes('link_tv') && tools.includes('show_slides'));
  const blocked = JSON.parse(await b('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"show_text","arguments":{"markdown":"x"}}}'));
  assert.equal(blocked.result.isError, true);
  assert.match(blocked.result.content[0].text, /link_tv/);
  assert.equal(calls.length, 0);

  const short = JSON.parse(await b('{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"link_tv","arguments":{"code":"123"}}}'));
  assert.equal(short.result.isError, true);
  found = [...found, { host: '127.0.0.2', port, tvName: 'Kitchen' }];
  const many = JSON.parse(await b('{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"link_tv","arguments":{"code":"123456789"}}}'));
  assert.match(many.result.content[0].text, /Several TVs found: Living Room \(127.0.0.1\), Kitchen/);
  const pub = JSON.parse(await b('{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"link_tv","arguments":{"code":"123456789","tv_address":"8.8.8.8"}}}'));
  assert.match(pub.result.content[0].text, /home network/);
  found = found.slice(0, 1);
  const wrong = JSON.parse(await b('{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"link_tv","arguments":{"code":"111 111 111"}}}'));
  assert.equal(wrong.result.isError, true);
  assert.match(wrong.result.content[0].text, /Wrong code/);

  const ok = JSON.parse(await b('{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"link_tv","arguments":{"code":"123 456 789"}}}'));
  assert.equal(ok.result.isError, false);
  assert.match(ok.result.content[0].text, /Linked with Living Room/);
  assert.equal(loadConfig(cfgDir).key, KEY);
  const after = JSON.parse(await b('{"jsonrpc":"2.0","id":9,"method":"tools/list"}')).result.tools.map((t) => t.name);
  assert.deepEqual(after, ['show_text', 'link_tv']); // the TV's own list, plus link_tv
  assert.equal(calls.at(-1).auth, `Bearer ${KEY}`);
});

test('serve reads lines from a stream and answers in order of completion', async () => {
  reset();
  const input = new PassThrough();
  const output = new PassThrough();
  let written = '';
  output.on('data', (d) => (written += d));
  const done = serve(bridge(), input, output);
  input.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  input.write('{"jsonrpc":"2.0","id":2,"meth');
  input.end('od":"ping"}\n');
  await done;
  const ids = written.trim().split('\n').map((l) => JSON.parse(l).id).sort();
  assert.deepEqual(ids, [1, 2]);
});

test('config is stored owner-only', () => {
  saveConfig({ host: '192.168.1.2', port: 8765, key: 'abc', tvName: 'TV' }, dir);
  assert.equal(loadConfig(dir).key, 'abc');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(dir, 'tv.json')).mode & 0o777, 0o600);
  }
  deleteConfig(dir);
  assert.equal(loadConfig(dir), null);
});
