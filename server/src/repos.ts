import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const STUDIO_DIR = path.resolve(here, '..', '..');
// default: the folder that holds the folder that holds openspec-studio (e.g. ~/repo)
export const ROOT = path.resolve(process.env.REPOS_ROOT || path.join(STUDIO_DIR, '..', '..'));
export const DATA_DIR = path.resolve(process.env.STUDIO_DATA || path.join(os.homedir(), '.openspec-studio'));
fs.mkdirSync(DATA_DIR, { recursive: true });

/** true if `target` is `base` or inside it (lexically). */
export function within(base: string, target: string): boolean {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolve `target` inside `base`, following symlinks of the existing part of the
 * path, so `base/link -> /etc` cannot be used to escape. Returns null on escape.
 */
export function safeResolve(base: string, target: string): string | null {
  const realBase = fs.realpathSync(base);
  const abs = path.resolve(base, target);
  if (!within(path.resolve(base), abs)) return null;
  // walk up to the deepest existing ancestor and realpath it
  let probe = abs;
  const rest: string[] = [];
  while (!fs.existsSync(probe)) {
    rest.unshift(path.basename(probe));
    const parent = path.dirname(probe);
    if (parent === probe) return null;
    probe = parent;
  }
  const real = path.join(fs.realpathSync(probe), ...rest);
  return within(realBase, real) ? real : null;
}

const SKIP = new Set(['node_modules', 'dist', 'build', 'target', 'vendor', '.cache', 'venv', '__pycache__']);
const MAX_DEPTH = Number(process.env.REPO_SCAN_DEPTH || 4);

let cache: { at: number; list: string[] } | null = null;

/** A repo is a directory with `.git` or `openspec/`. Nested repos are not scanned. */
export function findRepos(force = false): string[] {
  if (!force && cache && Date.now() - cache.at < 30_000) return cache.list;
  const out: string[] = [];
  const visit = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const isRepo = entries.some((e) => e.isDirectory() && (e.name === '.git' || e.name === 'openspec'));
    if (isRepo && dir !== ROOT) { out.push(path.relative(ROOT, dir)); return; }
    if (depth >= MAX_DEPTH) return;
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)) visit(path.join(dir, e.name), depth + 1);
    }
  };
  visit(ROOT, 0);
  out.sort((a, b) => a.localeCompare(b));
  cache = { at: Date.now(), list: out };
  return out;
}

/** Map a client-supplied repo name to an absolute directory, or null. */
export function repoPath(name: unknown): string | null {
  if (typeof name !== 'string' || !name || path.isAbsolute(name)) return null;
  const p = safeResolve(ROOT, name);
  if (!p || p === fs.realpathSync(ROOT)) return null;
  try { return fs.statSync(p).isDirectory() ? p : null; } catch { return null; }
}

export const hasOpenSpec = (abs: string) => fs.existsSync(path.join(abs, 'openspec'));
