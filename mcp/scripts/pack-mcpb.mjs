#!/usr/bin/env node
// Builds mcpb/teleq.mcpb (Claude Desktop extension): manifest + icon + the bridge itself (no dependencies).
//   npm run pack:mcpb
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const mcp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const build = path.join(mcp, 'mcpb/build')
const out = path.join(mcp, 'mcpb/teleq.mcpb')
fs.rmSync(build, { recursive: true, force: true })
fs.mkdirSync(path.join(build, 'server'), { recursive: true })
for (const f of ['manifest.json', 'icon.png']) fs.copyFileSync(path.join(mcp, 'mcpb', f), path.join(build, f))
for (const f of ['bin', 'src', 'package.json', 'README.md', 'LICENSE']) {
  fs.cpSync(path.join(mcp, f), path.join(build, 'server', f), { recursive: true })
}
const pkg = JSON.parse(fs.readFileSync(path.join(mcp, 'package.json'), 'utf8'))
const manifest = JSON.parse(fs.readFileSync(path.join(build, 'manifest.json'), 'utf8'))
if (manifest.version !== pkg.version) throw new Error(`manifest ${manifest.version} != package ${pkg.version}: run node tools/ai/generate.mjs`)
const mcpb = (...args) => execFileSync('npx', ['-y', '@anthropic-ai/mcpb@2', ...args], { stdio: 'inherit', cwd: mcp })
mcpb('validate', path.join(build, 'manifest.json'))
mcpb('pack', build, out)
fs.rmSync(build, { recursive: true, force: true })
// The site serves it at https://teleq.online/download/teleq.mcpb (shipped with relay/ops/deploy.sh).
// Only in the main repository: the public teleq-ai copy has no site/.
const site = path.resolve(mcp, '../site/download/teleq.mcpb')
if (fs.existsSync(path.resolve(mcp, '../site'))) {
  fs.mkdirSync(path.dirname(site), { recursive: true })
  fs.copyFileSync(out, site)
  console.log(`copied to ${path.relative(process.cwd(), site)}`)
}
console.log(`\n${path.relative(process.cwd(), out)} is ready: double-click it to install in Claude Desktop.`)
