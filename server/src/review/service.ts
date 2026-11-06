import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Anchor, CommentKind, ReviewComment, ReviewRound } from '../../../shared/protocol.ts';
import { quoteExists } from '../../../shared/anchor.ts';
import { comments, rounds, type Snapshot } from '../db.ts';
import { changeDir, changeFiles, MAX_DOC_BYTES, readDoc } from '../openspec.ts';
import type { AgentSession } from '../acp/hub.ts';
import { composeReview } from './compose.ts';
import { parseReviewResult } from './parseResult.ts';

const KINDS = new Set<CommentKind>(['comment', 'change', 'remove', 'question', 'ok']);
const shortId = () => randomUUID().slice(0, 8);

export function snapshot(repoAbs: string, change: string): Snapshot {
  const dir = changeDir(repoAbs, change);
  // an oversized file is stood in for by a marker, so a change to it still shows up in the diff
  return Object.fromEntries(changeFiles(repoAbs, change).map((f) => {
    const file = path.join(dir, f);
    return [f, readDoc(file) ?? `[${f} is larger than ${MAX_DOC_BYTES} bytes; ${fs.statSync(file).size} bytes, modified ${fs.statSync(file).mtime.toISOString()}]`];
  }));
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

/**
 * Edit, resolve or reopen a comment. A comment in a running round is frozen
 * (like delete, which already refuses it): the agent is working on exactly
 * that text, and reopening would drop it from the round. Returns null then.
 */
export function patchComment(cm: ReviewComment, b: { body?: string; kind?: CommentKind; status?: 'resolved' | 'draft' }): ReviewComment | null {
  if (cm.status === 'sent') return null;
  const next = { ...cm };
  if (b.body !== undefined) next.body = b.body;
  if (b.kind) next.kind = b.kind;
  if (b.status === 'resolved') next.status = 'resolved';
  if (b.status === 'draft') { next.status = 'draft'; next.roundId = null; } // reopen → goes out with the next review
  comments.put(next);
  return next;
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
  // prompt() rejects when the session is not ready (e.g. it exited meanwhile); an
  // unhandled rejection would take the whole server down, so settle the round instead
  session.prompt(prompt, `Review sent · ${n} item${n > 1 ? 's' : ''} · ${change}`)
    .then(({ stopReason, reply }) => onTurnEnd(repo, repoAbs, stopReason, reply))
    .catch((e) => finishRound(round.id, repoAbs, '', `error: ${(e as Error)?.message ?? e}`))
    .finally(onDone);
  return round;
}

/**
 * Turns that end like this didn't finish the work; the user can press Continue
 * and the agent picks up where it stopped. The round stays open until a turn
 * ends normally (or is cancelled, or the user closes it).
 */
export const CONTINUABLE = new Set(['refusal', 'error', 'max_tokens', 'max_turn_requests']);
const replies = new Map<string, string>(); // round id → agent replies so far

/** Call after every agent turn in a repo. Returns the change whose round was updated, if any. */
export function onTurnEnd(repo: string, repoAbs: string, stopReason: string, reply: string): string | null {
  const running = rounds.running(repo);
  const r = running && rounds.get(running.id);
  if (!r) return null;
  const all = [replies.get(r.round.id), reply].filter(Boolean).join('\n\n');
  if (CONTINUABLE.has(stopReason)) {
    replies.set(r.round.id, all);
    rounds.put({ ...r.round, stopReason }, r.snapshot); // "interrupted, waiting for Continue"
  } else {
    replies.delete(r.round.id);
    finishRound(r.round.id, repoAbs, all, stopReason);
  }
  return r.round.change;
}

/** The user gives up on an interrupted round: settle it with what we have. */
export function closeRound(repo: string, repoAbs: string, change: string): boolean {
  const r = rounds.running(repo);
  if (!r || r.change !== change) return false;
  finishRound(r.id, repoAbs, replies.get(r.id) ?? '', r.stopReason ?? 'closed');
  replies.delete(r.id);
  return true;
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
    // a round already waiting for Continue can still be finished (session/load); one mid-turn cannot
    if (r && abs && !r.stopReason) finishRound(r.id, abs, '', 'interrupted');
  }
}
