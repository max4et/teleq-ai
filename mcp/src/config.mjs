import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function configDir(env = process.env) {
  if (env.TELEQ_CONFIG_DIR) return env.TELEQ_CONFIG_DIR;
  const base = env.XDG_CONFIG_HOME || (process.platform === 'win32' && env.APPDATA) || path.join(os.homedir(), '.config');
  return path.join(base, 'teleq');
}

export function loadConfig(dir = configDir()) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'tv.json'), 'utf8'));
    return cfg && typeof cfg.key === 'string' && typeof cfg.host === 'string' ? cfg : null;
  } catch {
    return null;
  }
}

/** The key is a credential for the TV: owner-only file, owner-only directory. */
export function saveConfig(cfg, dir = configDir()) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'tv.json');
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export function deleteConfig(dir = configDir()) {
  fs.rmSync(path.join(dir, 'tv.json'), { force: true });
  fs.rmSync(path.join(dir, 'cache.json'), { force: true });
}

/** Last `initialize` / `tools/list` results, so Claude can start while the TV is switched off. */
export function loadCache(dir = configDir()) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'cache.json'), 'utf8')) ?? {};
  } catch {
    return {};
  }
}

export function saveCache(cache, dir = configDir()) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'cache.json'), JSON.stringify(cache), { mode: 0o600 });
  } catch {
    // The cache is a convenience only.
  }
}
