import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { comments, rounds } from '../src/db.ts';
import { closeRound, createComment, onTurnEnd, patchComment, sendReview } from '../src/review/service.ts';
import type { AgentSession } from '../src/acp/hub.ts';

function setup(repo: string) {
  const abs = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-round-'));
  const dir = path.join(abs, 'openspec', 'changes', 'c1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'proposal.md'), '# Proposal\nUse GET /api/v1/helloworld for the endpoint.\n');
  const cm = createComment(repo, 'c1', {
    file: 'proposal.md', kind: 'change', body: 'use /helloworld',
    anchor: { exact: 'GET /api/v1/helloworld', prefix: 'Proposal\nUse ', suffix: ' for the endpoint.\n', headingPath: ['Proposal'], lineHint: 2 },
  });
  // the review turn itself is interrupted (e.g. the model host is unreachable)
  const session = { agent: { command: () => '/opsx:update c1' }, prompt: async () => ({ stopReason: 'refusal', reply: 'Working on it…' }) } as unknown as AgentSession;
  return { abs, dir, cm, session };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('review round continuation', () => {
  it('stays open after an interrupted turn and finishes on Continue', async () => {
    const { abs, dir, cm, session } = setup('r-cont');
    const round = await sendReview(session, 'r-cont', abs, 'c1', () => {});
    await flush();
    let r = rounds.get(round.id)!.round;
    expect(r.status).toBe('running');
    expect(r.stopReason).toBe('refusal');
    expect(comments.get(cm.id)!.status).toBe('sent');

    // the Continue turn makes the edit and reports the verdict
    fs.writeFileSync(path.join(dir, 'proposal.md'), '# Proposal\nUse GET /helloworld for the endpoint.\n');
    expect(onTurnEnd('r-cont', abs, 'end_turn', `Done.\n\`\`\`review-result\n[{"id":"${cm.id}","status":"addressed","note":"renamed"}]\n\`\`\``)).toBe('c1');
    r = rounds.get(round.id)!.round;
    expect(r.status).toBe('done');
    expect(r.resultParsed).toBe(true);
    expect(r.diffs.map((d) => d.file)).toEqual(['proposal.md']);
    const after = comments.get(cm.id)!;
    expect(after.status).toBe('addressed');
    expect(after.orphaned).toBe(false); // fuzzy re-attaches "GET /helloworld"
  });

  it('can be closed by the user', async () => {
    const { abs, cm, session } = setup('r-close');
    const round = await sendReview(session, 'r-close', abs, 'c1', () => {});
    await flush();
    expect(closeRound('r-close', abs, 'c1')).toBe(true);
    expect(rounds.get(round.id)!.round).toMatchObject({ status: 'done', stopReason: 'refusal', resultParsed: false });
    expect(comments.get(cm.id)!.status).toBe('unverified');
    expect(onTurnEnd('r-close', abs, 'end_turn', '')).toBeNull();
  });

  it('settles the round instead of crashing when the prompt is rejected', async () => {
    const { abs, cm, session } = setup('r-reject');
    (session as any).prompt = async () => { throw new Error('Agent is not ready'); };
    let done = 0;
    const round = await sendReview(session, 'r-reject', abs, 'c1', () => { done++; });
    await flush();
    expect(rounds.get(round.id)!.round).toMatchObject({ status: 'done', stopReason: 'error: Agent is not ready' });
    expect(comments.get(cm.id)!.status).toBe('unverified');
    expect(done).toBe(2); // once when sent, once when settled
  });

  it('freezes comments while their round runs', async () => {
    const { abs, cm, session } = setup('r-frozen');
    (session as any).prompt = () => new Promise(() => {}); // turn still running
    await sendReview(session, 'r-frozen', abs, 'c1', () => {});
    const sent = comments.get(cm.id)!;
    expect(sent.status).toBe('sent');
    expect(patchComment(sent, { status: 'draft', body: 'changed my mind' })).toBeNull();
    expect(comments.get(cm.id)).toMatchObject({ status: 'sent', body: 'use /helloworld' });
  });
});
