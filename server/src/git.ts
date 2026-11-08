// What Studio knows about a repo's git state. Read-only here: Studio never
// changes git on its own (see the commit/branch helpers for the explicit actions).

import type { GitInfo } from '../../shared/protocol.ts';
import { runCmd } from './proc.ts';

// no pager, no prompts, no translated messages; paths as-is (-z everywhere)
const ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };

export const git = (cwd: string, args: string[], timeout = 15_000) =>
  runCmd('git', ['-c', 'core.quotepath=off', ...args], { cwd, timeout, env: ENV });

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
