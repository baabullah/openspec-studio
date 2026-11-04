import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Anchor, CommentKind, ReviewComment, ReviewRound } from '../../../shared/protocol.ts';
import { quoteExists } from '../../../shared/anchor.ts';
import { comments, rounds, type Snapshot } from '../db.ts';
import { changeDir, changeFiles } from '../openspec.ts';
import type { AgentSession } from '../acp/hub.ts';
import { composeReview } from './compose.ts';
import { parseReviewResult } from './parseResult.ts';

const KINDS = new Set<CommentKind>(['comment', 'change', 'remove', 'question', 'ok']);
const shortId = () => randomUUID().slice(0, 8);

export function snapshot(repoAbs: string, change: string): Snapshot {
  const dir = changeDir(repoAbs, change);
  return Object.fromEntries(changeFiles(repoAbs, change).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
}

export function createComment(repo: string, change: string, input: { file?: unknown; anchor?: unknown; kind?: unknown; body?: unknown }): ReviewComment {
  const kind = KINDS.has(input.kind as CommentKind) ? (input.kind as CommentKind) : 'comment';
  const a = input.anchor as Partial<Anchor> | null | undefined;
  const anchor: Anchor | null = a && typeof a.exact === 'string' && a.exact.trim()
    ? {
      exact: a.exact.slice(0, 4000), prefix: String(a.prefix ?? '').slice(-64), suffix: String(a.suffix ?? '').slice(0, 64),
      headingPath: Array.isArray(a.headingPath) ? a.headingPath.map(String).slice(0, 8) : [], lineHint: Number(a.lineHint) || 0,
    }
    : null;
  const c: ReviewComment = {
    id: shortId(), repo, change, file: typeof input.file === 'string' && input.file ? input.file : null, anchor, kind,
    body: String(input.body ?? '').slice(0, 8000), status: 'draft', agentNote: null, roundId: null, orphaned: false,
    createdAt: new Date().toISOString(),
  };
  comments.put(c);
  return c;
}

/** Comments that go out in the next review: drafts (new or reopened). */
const outgoing = (repo: string, change: string) => comments.list(repo, change).filter((c) => c.status === 'draft');

export async function sendReview(session: AgentSession, repo: string, repoAbs: string, change: string, onDone: () => void) {
  const list = outgoing(repo, change);
  if (!list.length) throw new Error('No comments to send');
  const round: ReviewRound = {
    id: shortId(), repo, change, status: 'running', createdAt: new Date().toISOString(),
    commentIds: list.map((c) => c.id), resultParsed: false, stopReason: null, diffs: [],
  };
  const before = snapshot(repoAbs, change);
  rounds.put(round, before);
  for (const c of list) comments.put({ ...c, status: c.kind === 'ok' ? 'resolved' : 'sent', roundId: round.id, agentNote: null });
  onDone();

  const prompt = composeReview(session.agent.command('update', change), change, list);
  const n = list.length;
  // don't await: the turn can take minutes; finish the round when it ends
  session.prompt(prompt, `Review sent · ${n} item${n > 1 ? 's' : ''} · ${change}`).then(({ stopReason, reply }) => {
    finishRound(round.id, repoAbs, reply, stopReason);
    onDone();
  });
  return round;
}

export function finishRound(roundId: string, repoAbs: string, reply: string, stopReason: string) {
  const r = rounds.get(roundId);
  if (!r || r.round.status === 'done') return;
  const { round, snapshot: before } = r;
  const after = snapshot(repoAbs, round.change);
  const results = parseReviewResult(reply);
  const byId = new Map((results ?? []).map((x) => [x.id, x]));

  for (const id of round.commentIds) {
    const c = comments.get(id);
    if (!c || c.status !== 'sent') continue;
    const res = byId.get(id);
    const src = c.file ? after[c.file] : undefined;
    comments.put({
      ...c,
      status: res ? res.status : 'unverified',
      agentNote: res?.note || null,
      orphaned: !!(c.anchor && (src === undefined || !quoteExists(src, c.anchor.exact, c.anchor))),
    });
  }
  const files = new Set([...Object.keys(before), ...Object.keys(after)]);
  round.diffs = [...files].filter((f) => before[f] !== after[f]).map((f) => ({ file: f, before: before[f] ?? '', after: after[f] ?? '' }));
  round.status = 'done';
  round.resultParsed = results !== null;
  round.stopReason = stopReason;
  rounds.put(round, before);
}

/** On server start, rounds left running by a crash can never finish: close them. */
export function closeStaleRounds(repoAbsOf: (repo: string) => string | null, repos: string[]) {
  for (const repo of repos) {
    const r = rounds.running(repo);
    const abs = r && repoAbsOf(repo);
    if (r && abs) finishRound(r.id, abs, '', 'interrupted');
  }
}
