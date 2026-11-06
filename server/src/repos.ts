import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const STUDIO_DIR = path.resolve(here, '..', '..');
/** The studio's version, from the root package.json (sent to agents as clientInfo). */
export const STUDIO_VERSION: string = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(STUDIO_DIR, 'package.json'), 'utf8')).version ?? '0.0.0'; } catch { return '0.0.0'; }
})();
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

export const hasOpenSpec = (abs: string) => fs.existsSync(path.join(abs, 'openspec'));
