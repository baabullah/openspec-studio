// What Studio knows about a repo's git state. Read-only here: Studio never
// changes git on its own (see the commit/branch helpers for the explicit actions).

import type { GitInfo } from '../../shared/protocol.ts';
import { runCmd } from './proc.ts';

// no pager, no prompts, no translated messages; paths as-is (-z everywhere)
// read the environment per call, not once at import, so later changes (e.g. an identity set by tests) apply
const env = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' });

export const git = (cwd: string, args: string[], timeout = 15_000) =>
  runCmd('git', ['-c', 'core.quotepath=off', ...args], { cwd, timeout, env: env() });

/** Branches a change should not land on directly. */
const BASE_NAMES = ['main', 'master'];

/** The branch name from `git status --porcelain=v2 --branch` output; null when detached. */
export function parseBranch(statusV2: string): string | null {
  const head = statusV2.split('\n').find((l) => l.startsWith('# branch.head '))?.slice('# branch.head '.length).trim();
  return !head || head === '(detached)' ? null : head;
}

export async function gitInfo(abs: string): Promise<GitInfo> {
  const st = await git(abs, ['status', '--porcelain=v2', '--branch', '--untracked-files=no']);
  if (!st.ok) return { repo: false, branch: null, base: null, onBase: false };
  const branch = parseBranch(st.stdout);
  // the remote's default branch when known (origin/HEAD), else main/master if it exists
  let base: string | null = null;
  const remote = await git(abs, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (remote.ok && remote.stdout.trim()) base = remote.stdout.trim().replace(/^origin\//, '');
  else {
    for (const b of BASE_NAMES) {
      if (b === branch || (await git(abs, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`])).ok) { base = b; break; }
    }
  }
  return { repo: true, branch, base, onBase: !!branch && (branch === base || (!base && BASE_NAMES.includes(branch))) };
}

// ---- explicit actions (each one a button the user clicked and confirmed) ----------

export interface PendingFile { path: string; status: 'added' | 'modified' | 'deleted' | 'renamed' }

/** `git status --porcelain=v1 -z` entries; a rename also carries its old path, which is committed too. */
export function parseStatusZ(out: string): (PendingFile & { from?: string })[] {
  const parts = out.split('\0');
  const files: (PendingFile & { from?: string })[] = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const xy = e.slice(0, 2), p = e.slice(3);
    if (xy[0] === 'R' || xy[0] === 'C') { files.push({ path: p, status: 'renamed', from: parts[++i] }); continue; }
    const status = xy === '??' || xy.includes('A') ? 'added' : xy.includes('D') ? 'deleted' : 'modified';
    files.push({ path: p, status });
  }
  return files;
}

/** Uncommitted files under `paths` (repo-relative), untracked ones included. */
export async function pendingFiles(abs: string, paths: string[]) {
  const r = await git(abs, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...paths]);
  return r.ok ? parseStatusZ(r.stdout) : [];
}

/** What a change's commit holds: its folder; after archiving, also the main specs it updated. */
export function scopePaths(scope: { change: string } | { archived: string; change: string }): string[] {
  if ('archived' in scope) return [`openspec/changes/archive/${scope.archived}`, `openspec/changes/${scope.change}`, 'openspec/specs'];
  return [`openspec/changes/${scope.change}`];
}

/**
 * Commit exactly these files (the ones the user saw in the dialog), and nothing
 * else: files staged elsewhere in the repo stay staged and out of this commit.
 */
export async function commitFiles(abs: string, files: (PendingFile & { from?: string })[], message: string) {
  const paths = [...new Set(files.flatMap((f) => (f.from ? [f.path, f.from] : [f.path])))];
  if (!paths.length) return { ok: false, output: 'Nothing to commit.', commit: null };
  const add = await git(abs, ['add', '-A', '--', ...paths]);
  if (!add.ok) return { ok: false, output: add.stderr.trim(), commit: null };
  // hooks may run (lint, tests): give them time
  const c = await git(abs, ['commit', '-q', '-m', message, '--', ...paths], 120_000);
  if (!c.ok) return { ok: false, output: `${c.stdout}\n${c.stderr}`.trim(), commit: null };
  const sha = await git(abs, ['rev-parse', '--short', 'HEAD']);
  return { ok: true, output: c.stdout.trim(), commit: sha.stdout.trim() };
}

/** Create a branch from the current HEAD and switch to it; uncommitted work comes along. */
export async function createBranch(abs: string, name: string) {
  const fmt = await git(abs, ['check-ref-format', '--branch', name]);
  if (!fmt.ok) return { ok: false, output: `"${name}" is not a valid branch name.` };
  if ((await git(abs, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])).ok) {
    return { ok: false, output: `Branch ${name} already exists. Switch to it in your git client (git switch ${name}).` };
  }
  const r = await git(abs, ['switch', '-c', name]);
  return { ok: r.ok, output: (r.ok ? r.stdout || r.stderr : r.stderr).trim() };
}
