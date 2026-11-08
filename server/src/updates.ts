// "A newer Studio is out": the version on the npm registry, checked at most once a
// day. The request carries nothing but the package name; the answer is cached in
// the data folder. STUDIO_NO_UPDATE_CHECK=1 turns it off (offline, air-gapped).

import fs from 'node:fs';
import path from 'node:path';
import type { UpdateInfo } from '../../shared/protocol.ts';
import { DATA_DIR, STUDIO_DIR, STUDIO_VERSION } from './repos.ts';

const REGISTRY = 'https://registry.npmjs.org/openspec-studio/latest';
const CACHE = path.join(DATA_DIR, 'update-check.json');
const DAY = 24 * 60 * 60 * 1000;

export const updateCheckDisabled = () => /^(1|true|yes)$/i.test(process.env.STUDIO_NO_UPDATE_CHECK ?? '');

/** Installed from npm (lives in node_modules) or run from a git clone. */
export const INSTALL: UpdateInfo['install'] = STUDIO_DIR.split(/[\\/]/).includes('node_modules') ? 'npm' : 'clone';

/** a > b for plain x.y.z versions; a pre-release (x.y.z-…) never counts as newer. */
export function isNewer(a: string, b: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(a)) return false;
  const pa = a.split('.').map(Number), pb = b.split(/[.-]/).slice(0, 3).map((x) => Number(x) || 0);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return false;
}

interface Cache { checkedAt: number; latest: string | null }
const readCache = (): Cache | null => { try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { return null; } };

let inflight: Promise<string | null> | null = null;

/** The latest published version, from the cache when it is less than a day old. */
export async function latestVersion(now = Date.now(), fetcher: typeof fetch = fetch): Promise<string | null> {
  const c = readCache();
  if (c && now - c.checkedAt < DAY && now >= c.checkedAt) return c.latest;
  inflight ??= (async () => {
    let latest: string | null = c?.latest ?? null;
    try {
      const r = await fetcher(REGISTRY, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
      if (r.ok) {
        const v = (await r.json() as { version?: unknown }).version;
        if (typeof v === 'string') latest = v;
      }
    } catch { /* offline or blocked: try again tomorrow */ }
    try { fs.writeFileSync(CACHE, JSON.stringify({ checkedAt: now, latest } satisfies Cache)); } catch { /* read-only data dir */ }
    return latest;
  })().finally(() => { inflight = null; });
  return inflight;
}

export async function updateInfo(): Promise<UpdateInfo> {
  const base = { current: STUDIO_VERSION, install: INSTALL, command: updateCommand(INSTALL) };
  if (updateCheckDisabled()) return { ...base, latest: null, newer: false, disabled: true };
  const latest = await latestVersion();
  return { ...base, latest, newer: !!latest && isNewer(latest, STUDIO_VERSION), disabled: false };
}

/** The command that updates this install. */
export const updateCommand = (install: UpdateInfo['install']) =>
  install === 'npm' ? 'npm install -g openspec-studio@latest' : 'git pull && npm install && npm run build';
