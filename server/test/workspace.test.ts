import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// isolated data dir and db for this file (each test file runs in its own worker)
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-ws-data-'));
process.env.STUDIO_DATA = DATA;
process.env.STUDIO_DB = path.join(DATA, 'studio.db');
delete process.env.REPOS_ROOT;

const ws = await import('../src/workspace.ts');
const { db, migrateRepoIds } = await import('../src/db.ts');

const mk = (...p: string[]) => { const d = path.join(...p); fs.mkdirSync(d, { recursive: true }); return d; };
let base: string, outside: string;

beforeAll(() => {
  base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-ws-')));
  mk(base, 'work', 'api', '.git');
  mk(base, 'work', 'team', 'web', 'openspec');
  mk(base, 'work', 'team', 'web', 'nested', '.git'); // inside a repo: not listed
  mk(base, 'work', 'node_modules', 'pkg', '.git'); // skipped
  mk(base, 'work', 'notes');
  mk(base, 'other', 'api', '.git'); // same name, different folder
  outside = mk(base, 'secret', '.git');
});
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

describe('workspace folders', () => {
  it('starts empty and validates what is added', () => {
    expect(ws.roots()).toEqual([]);
    expect(() => ws.addRoot('relative/path')).toThrow(/full path/);
    expect(() => ws.addRoot(path.join(base, 'nope'))).toThrow(/not found/);
    expect(() => ws.addRoot(path.parse(base).root)).toThrow(/more specific/);
  });

  it('lists repos by absolute id, across folders, without nested or skipped ones', async () => {
    ws.addRoot(path.join(base, 'work'));
    ws.addRoot(path.join(base, 'other', 'api')); // a single repo as a folder
    const ids = (await ws.findRepos(true)).repos.map((r) => r.id).sort();
    expect(ids).toEqual([path.join(base, 'other', 'api'), path.join(base, 'work', 'api'), path.join(base, 'work', 'team', 'web')].sort());
    const web = (await ws.findRepos()).repos.find((r) => r.name === 'web')!;
    expect(web.rel).toBe('team/web');
    expect(JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8')).roots).toHaveLength(2);
  });

  it('only resolves repos inside a configured folder', () => {
    expect(ws.repoPath(path.join(base, 'work', 'api'))).toBe(path.join(base, 'work', 'api'));
    expect(ws.repoPath(outside)).toBeNull();
    expect(ws.repoPath(path.join(base, 'work', '..', 'secret'))).toBeNull();
    expect(ws.repoPath('api')).toBeNull(); // old relative ids are not accepted
  });

  it('a symlink inside a folder cannot point outside it', () => {
    const link = path.join(base, 'work', 'escape');
    try { fs.symlinkSync(outside, link, 'junction'); } catch { return; } // no symlink rights (Windows)
    expect(ws.repoPath(link)).toBeNull();
  });

  it('removing a folder drops its repos', async () => {
    ws.removeRoot(path.join(base, 'other', 'api'));
    expect((await ws.findRepos(true)).repos.some((r) => r.id === path.join(base, 'other', 'api'))).toBe(false);
    expect(ws.repoPath(path.join(base, 'other', 'api'))).toBeNull();
  });

  it('browses folders only and marks repos', () => {
    const r = ws.browse(path.join(base, 'work'));
    expect(r.parent).toBe(base);
    expect(r.entries.map((e) => [e.name, e.repo])).toEqual([['api', true], ['node_modules', false], ['notes', false], ['team', false]]);
    expect(ws.browse('').path).toBeNull(); // starting places
    expect(() => ws.browse(path.join(base, 'nope'))).toThrow();
  });
});

describe('migration from relative repo ids', () => {
  const fsx = {
    exists: (p: string) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
    real: (p: string) => fs.realpathSync.native(p),
    join: (a: string, b: string) => path.join(a, b),
  };

  it('rewrites every table, including the repo inside stored json', () => {
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run('team/web', 'codebuddy', 'acp-1', 'now');
    db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)').run('team/web', 1, 'now', '{"kind":"notice"}');
    db.prepare('INSERT INTO comments VALUES (?, ?, ?, ?)').run('c1', 'team/web', 'ch', JSON.stringify({ id: 'c1', repo: 'team/web' }));
    db.prepare('INSERT INTO rounds VALUES (?, ?, ?, ?, ?, ?)').run('r1', 'team/web', 'ch', 'now', JSON.stringify({ id: 'r1', repo: 'team/web' }), '{}');
    const abs = path.join(base, 'work', 'team', 'web');
    expect(migrateRepoIds(path.join(base, 'work'), fsx)).toEqual([path.join(base, 'work')]);
    for (const t of ['sessions', 'events', 'comments', 'rounds']) expect((db.prepare(`SELECT DISTINCT repo FROM ${t}`).all() as any[]).map((r) => r.repo)).toEqual([abs]);
    expect(JSON.parse((db.prepare('SELECT json FROM comments').get() as any).json).repo).toBe(abs);
    expect(JSON.parse((db.prepare('SELECT json FROM rounds').get() as any).json).repo).toBe(abs);
    expect(migrateRepoIds(path.join(base, 'work'), fsx)).toEqual([]); // idempotent
  });

  it('finds the repo from its event history when REPOS_ROOT is no longer set', () => {
    // data was written with REPOS_ROOT=<base>/other; now the default root is somewhere else
    const repo = path.join(base, 'other', 'api');
    const ev = JSON.stringify({ kind: 'update', update: { title: `cd ${repo} && grep -n APP src`, locations: [{ path: `${repo}/src/main.ts` }] } });
    db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)').run('api', 1, 'now', ev);
    db.prepare('INSERT INTO comments VALUES (?, ?, ?, ?)').run('c2', 'api', 'ch', JSON.stringify({ id: 'c2', repo: 'api' }));
    expect(migrateRepoIds(path.join(base, 'nowhere'), fsx)).toEqual([path.join(base, 'other')]);
    expect((db.prepare("SELECT repo FROM comments WHERE id = 'c2'").get() as any).repo).toBe(repo);
  });

  it('understands Windows paths in events', () => {
    db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)').run('svc', 1, 'now', JSON.stringify({ text: 'cd C:\\Users\\me\\code\\svc && dir' }));
    const seen: string[] = [];
    const winFs = { exists: (p: string) => { seen.push(p); return p === 'C:\\Users\\me\\code\\svc'; }, real: (p: string) => p, join: (a: string, b: string) => `${a}\\${b}` };
    expect(migrateRepoIds('D:\\old', winFs)).toEqual(['C:\\Users\\me\\code']);
  });
});
