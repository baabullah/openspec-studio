import { describe, expect, it } from 'vitest';
import type { ReviewComment } from '../../shared/protocol.ts';
import { composeReview } from '../src/review/compose.ts';
import { parseReviewResult, stripReviewResult } from '../src/review/parseResult.ts';

const c = (over: Partial<ReviewComment>): ReviewComment => ({
  id: 'abc', repo: 'r', change: 'add-auth', file: 'proposal.md', kind: 'change', body: 'make it clearer',
  status: 'draft', agentNote: null, roundId: null, orphaned: false, createdAt: '2026-01-01',
  anchor: { exact: 'Users log in', prefix: '', suffix: '', headingPath: ['Why'], lineHint: 3 }, ...over,
});

describe('composeReview', () => {
  it('starts with the agent command and lists feedback with ids, quotes and notes', () => {
    const p = composeReview('/opsx:update add-auth', 'add-auth', [
      c({}), c({ id: 'def', kind: 'ok', body: '' }), c({ id: 'ghi', file: null, anchor: null, kind: 'comment', body: 'overall too big' }),
    ]);
    expect(p.startsWith('/opsx:update add-auth\n')).toBe(true);
    expect(p).toContain('- id: abc');
    expect(p).toContain('where: proposal.md › Why (≈ line 3)');
    expect(p).toContain('  > Users log in');
    expect(p).toContain('## Approved\n- id: def');
    expect(p).toContain('where: whole change');
    expect(p).toContain('```review-result');
    // approved items are not asked to be reported on
    const block = p.split('```review-result\n')[1];
    expect(block).toContain('"abc"');
    expect(block).not.toContain('"def"');
  });

  it('omits the result block when everything is approved', () => {
    expect(composeReview('/x', 'a', [c({ kind: 'ok' })])).not.toContain('review-result');
  });
});

describe('parseReviewResult', () => {
  it('parses the last block and skips invalid items', () => {
    const reply = 'Done.\n```review-result\n[{"id":"old","status":"addressed"}]\n```\nOops, final:\n```review-result\n[{"id":"abc","status":"Addressed","note":"clarified"},{"id":"x","status":"bogus"},{"id":"q","status":"answered"}]\n```';
    expect(parseReviewResult(reply)).toEqual([
      { id: 'abc', status: 'addressed', note: 'clarified' },
      { id: 'q', status: 'answered', note: '' },
    ]);
    expect(stripReviewResult(reply)).toBe('Done.\n\nOops, final:');
  });

  it('returns null when missing or malformed', () => {
    expect(parseReviewResult('no block here')).toBeNull();
    expect(parseReviewResult('```review-result\n{not json\n```')).toBeNull();
    expect(parseReviewResult('```review-result\n{"id":"a"}\n```')).toBeNull();
  });
});
