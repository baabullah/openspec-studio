import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gitInfo, parseBranch } from '../src/git.ts';

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
