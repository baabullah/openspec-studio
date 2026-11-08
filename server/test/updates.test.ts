import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DATA_DIR } from '../src/repos.ts';
import { INSTALL, isNewer, latestVersion, updateCommand } from '../src/updates.ts';

const CACHE = path.join(DATA_DIR, 'update-check.json');
const reply = (version: unknown, ok = true) => {
  const calls: string[] = [];
  const f = (async (url: string) => { calls.push(url); return { ok, json: async () => ({ version }) }; }) as unknown as typeof fetch;
  return { f, calls };
};

describe('update check', () => {
  beforeEach(() => fs.rmSync(CACHE, { force: true }));

  it('compares plain versions; pre-releases are never offered', () => {
    expect(isNewer('0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('1.0.0', '0.99.0')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.1.0', '0.2.0')).toBe(false);
    expect(isNewer('0.2.0-beta.1', '0.1.0')).toBe(false);
    expect(isNewer('0.2.0', '0.2.0-beta.1')).toBe(false); // same x.y.z: not offered as an update
  });

  it('asks the registry at most once a day', async () => {
    const day = 24 * 60 * 60 * 1000;
    const a = reply('0.3.0');
    expect(await latestVersion(1_000, a.f)).toBe('0.3.0');
    expect(a.calls).toEqual(['https://registry.npmjs.org/openspec-studio/latest']);
    const b = reply('0.4.0');
    expect(await latestVersion(1_000 + day - 1, b.f)).toBe('0.3.0');
    expect(b.calls).toHaveLength(0);
    expect(await latestVersion(1_000 + day, b.f)).toBe('0.4.0');
    expect(b.calls).toHaveLength(1);
  });

  it('keeps the last known version when the registry fails, and waits a day before retrying', async () => {
    const day = 24 * 60 * 60 * 1000;
    await latestVersion(0, reply('0.3.0').f);
    const failing = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await latestVersion(day, failing)).toBe('0.3.0');
    const c = reply('0.5.0');
    expect(await latestVersion(day + 10, c.f)).toBe('0.3.0');
    expect(c.calls).toHaveLength(0);
  });

  it('a clone updates with git, an npm install with npm', () => {
    expect(INSTALL).toBe('clone'); // the tests run from the repo
    expect(updateCommand('npm')).toBe('npm install -g openspec-studio@latest');
    expect(updateCommand('clone')).toContain('git pull');
  });
});
