import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitFiles, createBranch, gitInfo, parseBranch, parseStatusZ, pendingFiles, scopePaths } from '../src/git.ts';

// commits in these temp repos need an identity, whatever the machine's git config says
Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' });

const sh = (cwd: string, ...args: string[]) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
function tempRepo(branch = 'main') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-git-'));
  sh(dir, 'init', '-q', '-b', branch);
  fs.writeFileSync(path.join(dir, 'README.md'), 'hi\n');
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-q', '-m', 'init');
  return { dir, sh: (...a: string[]) => sh(dir, ...a) };
}

describe('git info', () => {
  it('reads the branch from porcelain v2', () => {
    expect(parseBranch('# branch.oid abc\n# branch.head feature/x\n')).toBe('feature/x');
    expect(parseBranch('# branch.oid abc\n# branch.head (detached)\n')).toBeNull();
    expect(parseBranch('')).toBeNull();
  });

  it('flags main as the base branch, and a change branch as not', async () => {
    const r = tempRepo();
    expect(await gitInfo(r.dir)).toEqual({ repo: true, branch: 'main', base: 'main', onBase: true });
    r.sh('switch', '-q', '-c', 'change/add-x');
    expect(await gitInfo(r.dir)).toEqual({ repo: true, branch: 'change/add-x', base: 'main', onBase: false });
  });

  it('uses origin/HEAD as the base when the remote has one', async () => {
    const r = tempRepo('trunk');
    r.sh('update-ref', 'refs/remotes/origin/trunk', 'HEAD');
    r.sh('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
    expect(await gitInfo(r.dir)).toMatchObject({ branch: 'trunk', base: 'trunk', onBase: true });
  });

  it('a detached HEAD is on no branch; a plain folder is no repo', async () => {
    const r = tempRepo();
    r.sh('switch', '-q', '--detach');
    expect(await gitInfo(r.dir)).toMatchObject({ repo: true, branch: null, onBase: false });
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-nogit-'));
    expect((await gitInfo(plain)).repo).toBe(false);
  });
});

const write = (dir: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};

describe('git actions', () => {
  it('parses -z status, renames included', () => {
    expect(parseStatusZ('?? a b.md\0 M x.md\0 D gone.md\0R  new.md\0old.md\0A  added.md\0')).toEqual([
      { path: 'a b.md', status: 'added' },
      { path: 'x.md', status: 'modified' },
      { path: 'gone.md', status: 'deleted' },
      { path: 'new.md', status: 'renamed', from: 'old.md' },
      { path: 'added.md', status: 'added' },
    ]);
    expect(parseStatusZ('')).toEqual([]);
  });

  it("commits only the change's files; the user's other staged work stays staged", async () => {
    const r = tempRepo();
    write(r.dir, 'openspec/changes/add-x/proposal.md', '# Why\n');
    write(r.dir, 'openspec/changes/add-x/specs/greet/spec.md', '## ADDED\n');
    write(r.dir, 'openspec/changes/other/proposal.md', '# other\n');
    write(r.dir, 'src/app.js', 'wip\n');
    r.sh('add', 'src/app.js'); // staged by the user, not part of this commit
    const pending = await pendingFiles(r.dir, scopePaths({ change: 'add-x' }));
    expect(pending.map((f) => f.path).sort()).toEqual(['openspec/changes/add-x/proposal.md', 'openspec/changes/add-x/specs/greet/spec.md']);
    const res = await commitFiles(r.dir, pending, 'Spec for add-x');
    expect(res.ok).toBe(true);
    expect(res.commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(r.sh('show', '--name-only', '--format=%s', 'HEAD').split('\n')).toEqual(['Spec for add-x', '', 'openspec/changes/add-x/proposal.md', 'openspec/changes/add-x/specs/greet/spec.md']);
    expect(r.sh('diff', '--cached', '--name-only')).toBe('src/app.js');
    expect(r.sh('status', '--porcelain', '--', 'openspec/changes/other')).toBe('?? openspec/changes/other/');
    expect(await pendingFiles(r.dir, scopePaths({ change: 'add-x' }))).toEqual([]);
  });

  it('an archive commit holds the move and the main spec update', async () => {
    const r = tempRepo();
    write(r.dir, 'openspec/changes/add-x/proposal.md', '# Why\n');
    write(r.dir, 'openspec/specs/greet/spec.md', 'v1\n');
    r.sh('add', '.'); r.sh('commit', '-q', '-m', 'spec');
    // what `openspec archive` does: move the folder, update the main spec
    fs.mkdirSync(path.join(r.dir, 'openspec/changes/archive'), { recursive: true });
    fs.renameSync(path.join(r.dir, 'openspec/changes/add-x'), path.join(r.dir, 'openspec/changes/archive/2026-11-08-add-x'));
    write(r.dir, 'openspec/specs/greet/spec.md', 'v2\n');
    write(r.dir, 'notes.txt', 'unrelated\n');
    const pending = await pendingFiles(r.dir, scopePaths({ archived: '2026-11-08-add-x', change: 'add-x' }));
    expect(pending.map((f) => `${f.status} ${f.path}`).sort()).toEqual([
      'added openspec/changes/archive/2026-11-08-add-x/proposal.md',
      'deleted openspec/changes/add-x/proposal.md',
      'modified openspec/specs/greet/spec.md',
    ]);
    expect((await commitFiles(r.dir, pending, 'Archive add-x')).ok).toBe(true);
    expect(r.sh('status', '--porcelain')).toBe('?? notes.txt');
  });

  it('creates change branches, refuses an existing or invalid name', async () => {
    const r = tempRepo();
    write(r.dir, 'openspec/changes/add-x/proposal.md', '# Why\n');
    expect((await createBranch(r.dir, 'change/add-x')).ok).toBe(true);
    expect(r.sh('branch', '--show-current')).toBe('change/add-x');
    expect(fs.existsSync(path.join(r.dir, 'openspec/changes/add-x/proposal.md'))).toBe(true); // came along
    const again = await createBranch(r.dir, 'change/add-x');
    expect(again.ok).toBe(false);
    expect(again.output).toContain('already exists');
    expect((await createBranch(r.dir, 'bad..name')).ok).toBe(false);
  });

  it('reports a failing commit (a hook that rejects it)', async () => {
    const r = tempRepo();
    write(r.dir, 'openspec/changes/add-x/proposal.md', '# Why\n');
    write(r.dir, '.git/hooks/pre-commit', '#!/bin/sh\necho "lint failed" >&2\nexit 1\n');
    fs.chmodSync(path.join(r.dir, '.git/hooks/pre-commit'), 0o755);
    const res = await commitFiles(r.dir, await pendingFiles(r.dir, ['openspec/changes/add-x']), 'Spec');
    expect(res.ok).toBe(false);
    expect(res.output).toContain('lint failed');
  });
});
