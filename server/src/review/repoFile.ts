// Review history kept in the repo, next to the change it belongs to:
// openspec/changes/<change>/.studio-review.json. Committed, it travels with the
// branch and the PR, and `openspec archive` moves it along with the change.
// Writing it is opt-in per repo; reading it is always on.

import fs from 'node:fs';
import path from 'node:path';
import type { ReviewComment, ReviewRound } from '../../../shared/protocol.ts';

export const REVIEW_FILE = '.studio-review.json';
const FORMAT = 'openspec-studio-review';

/** What goes in the file: no machine-specific repo path. */
type StoredComment = Omit<ReviewComment, 'repo'>;
type StoredRound = Omit<ReviewRound, 'repo'>;
interface ReviewFile { format: typeof FORMAT; version: 1; change: string; comments: StoredComment[]; rounds: StoredRound[] }

const strip = <T extends { repo: string }>({ repo: _r, ...rest }: T) => rest;

/**
 * Write the change's review history into its folder. Rewrites only when the
 * content differs, so an unchanged review never touches the file (or git).
 * Returns true when the file was written.
 */
export function writeReviewFile(changeDir: string, change: string, comments: ReviewComment[], rounds: ReviewRound[]): boolean {
  if (!fs.existsSync(changeDir)) return false;
  const file = path.join(changeDir, REVIEW_FILE);
  if (!comments.length && !rounds.length) {
    // nothing to keep: don't create a file for a change that was never reviewed
    return false;
  }
  const body: ReviewFile = {
    format: FORMAT, version: 1, change,
    comments: comments.map(strip),
    rounds: rounds.filter((r) => r.status === 'done').map(strip),
  };
  const text = `${JSON.stringify(body, null, 2)}\n`;
  try { if (fs.readFileSync(file, 'utf8') === text) return false; } catch { /* not there yet */ }
  fs.writeFileSync(file, text);
  return true;
}

/** Read a review file, attaching `repo` to its records; null when absent or not ours. */
export function readReviewFile(dir: string, repo: string): { change: string; comments: ReviewComment[]; rounds: ReviewRound[] } | null {
  let data: Partial<ReviewFile>;
  try { data = JSON.parse(fs.readFileSync(path.join(dir, REVIEW_FILE), 'utf8')); } catch { return null; }
  if (data?.format !== FORMAT || !Array.isArray(data.comments) || !Array.isArray(data.rounds) || typeof data.change !== 'string') return null;
  const ok = (x: any) => x && typeof x.id === 'string';
  return {
    change: data.change,
    comments: data.comments.filter(ok).map((c) => ({ ...c, repo }) as ReviewComment),
    rounds: data.rounds.filter(ok).map((r) => ({ ...r, repo }) as ReviewRound),
  };
}

/**
 * Records to store when importing a review file into `change`. Ids already in
 * use (a change folder copied within the repo carries its source's ids) get a
 * new one, and the links between comments and rounds follow, so an import can
 * never overwrite another change's review.
 */
export function importRecords(
  file: { comments: ReviewComment[]; rounds: ReviewRound[] },
  change: string,
  taken: { comment: (id: string) => boolean; round: (id: string) => boolean },
  newId: () => string,
): { comments: ReviewComment[]; rounds: ReviewRound[] } {
  const ids = new Map<string, string>();
  const fresh = (id: string, used: (id: string) => boolean) => {
    if (!used(id)) return id;
    let n = newId();
    while (used(n)) n = newId();
    return n;
  };
  for (const c of file.comments) ids.set(`c:${c.id}`, fresh(c.id, taken.comment));
  for (const r of file.rounds) ids.set(`r:${r.id}`, fresh(r.id, taken.round));
  return {
    comments: file.comments.map((c) => ({ ...c, change, id: ids.get(`c:${c.id}`)!, roundId: c.roundId ? (ids.get(`r:${c.roundId}`) ?? c.roundId) : null })),
    rounds: file.rounds.map((r) => ({ ...r, change, id: ids.get(`r:${r.id}`)!, commentIds: r.commentIds.map((id) => ids.get(`c:${id}`) ?? id) })),
  };
}
