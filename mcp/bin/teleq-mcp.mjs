#!/usr/bin/env node
import readline from 'node:readline/promises';
import os from 'node:os';
import { createAutoBridge, serve } from '../src/bridge.mjs';
import { configDir, deleteConfig, loadConfig, saveConfig } from '../src/config.mjs';
import { DEFAULT_PORT, discover, isPrivateIPv4, pairWithCode, probe } from '../src/tv.mjs';

const clientName = () => (process.env.TELEQ_CLIENT_NAME || `Claude on ${os.hostname().replace(/\.local$/, '')}`).slice(0, 60);

const HELP = `teleq-mcp: let Claude put things on your TV

  npx teleq-mcp pair [--host <tv-ip>] [--name <label>]   link this computer with the code on the TV
  npx teleq-mcp status                                   show the linked TV and whether it answers
  npx teleq-mcp unlink                                   forget the TV on this computer
  npx teleq-mcp                                          run as an MCP server over stdio (what Claude starts);
                                                         without a linked TV it offers a link_tv tool

On the TV: open TeleQ -> "AI assistants" -> "Link an assistant" to get a code.
`;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function pair() {
  const log = (s) => process.stderr.write(s + '\n');
  let target;
  const host = arg('host');
  if (host) {
    if (!isPrivateIPv4(host)) throw new Error('--host must be the TV\'s address on your home network (like 192.168.1.20).');
    const [h, p] = host.split(':');
    target = { host: h, port: Number(p) || DEFAULT_PORT };
    if (!(await probe(target.host, target.port))) throw new Error(`No TeleQ TV answered at ${host}.`);
  } else {
    log('Looking for TVs on your network…');
    const found = await discover();
    if (found.length === 0) {
      throw new Error('No TV found. Open TeleQ on the TV (same Wi-Fi), or pass its address with --host 192.168.x.x');
    }
    if (found.length === 1) target = found[0];
    else {
      found.forEach((t, i) => log(`  ${i + 1}) ${t.tvName ?? 'TV'}  ${t.host}`));
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      const n = Number(await rl.question('Which one? '));
      rl.close();
      target = found[n - 1];
      if (!target) throw new Error('No such TV.');
    }
  }
  log(`Found ${target.tvName ?? 'a TV'} at ${target.host}.`);
  log('On the TV: TeleQ -> AI assistants -> Link an assistant. Type the code it shows.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const code = await rl.question('Code: ');
  rl.close();
  const name = arg('name') ?? clientName();
  const { key, tvName } = await pairWithCode(target, code, name);
  saveConfig({ host: target.host, port: target.port, key, tvName: tvName ?? target.tvName });
  log(`Linked with ${tvName ?? 'the TV'} as "${name}". Claude can use it now.`);
}

async function status() {
  const cfg = loadConfig();
  if (!cfg) {
    console.log('Not linked. Run: npx teleq-mcp pair');
    return;
  }
  const info = await probe(cfg.host, cfg.port);
  console.log(`${cfg.tvName ?? 'TV'} at ${cfg.host}:${cfg.port}: ${info ? 'reachable' : 'not reachable (switched off, or it moved: it is searched for again when Claude starts)'}`);
  console.log(`config: ${configDir()}`);
}

async function run() {
  // Works without a linked TV too: the assistant then offers link_tv (the Claude Desktop extension relies on it).
  const bridge = createAutoBridge({
    configDir: configDir(),
    deps: { loadConfig, saveConfig, discover, probe, pairWithCode, name: clientName },
  });
  await serve(bridge);
}

const cmd = process.argv[2];
try {
  if (cmd === 'pair') await pair();
  else if (cmd === 'status') await status();
  else if (cmd === 'unlink') {
    deleteConfig();
    console.log('Forgot the TV on this computer. To also revoke the key, unlink it in TeleQ on the TV (AI assistants).');
  } else if (cmd === '--help' || cmd === '-h' || cmd === 'help') process.stdout.write(HELP);
  else if (cmd === undefined || cmd === 'serve') await run();
  else {
    process.stderr.write(HELP);
    process.exitCode = 2;
  }
} catch (e) {
  process.stderr.write(`teleq-mcp: ${e.message}\n`);
  process.exitCode = 1;
}
