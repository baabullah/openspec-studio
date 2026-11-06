import { describe, expect, it } from 'vitest';
import { actionBody, clientMsg, commentCreate, commentPatch, parseOr400 } from '../src/schemas.ts';

describe('request schemas', () => {
  it('accepts what the web client sends', () => {
    expect(actionBody.parse({ repo: '/r', action: 'apply', change: 'c1' })).toMatchObject({ action: 'apply' });
    expect(commentCreate.parse({ repo: '/r', change: 'c1', file: null, anchor: null, kind: 'change', body: 'x' })).toMatchObject({ kind: 'change' });
    expect(clientMsg.parse({ type: 'permission', repo: '/r', id: 'p1', optionId: null })).toMatchObject({ type: 'permission' });
  });

  it('cuts over-long text instead of rejecting it', () => {
    expect(commentPatch.parse({ body: 'a'.repeat(9000) }).body).toHaveLength(8000);
    const m = clientMsg.parse({ type: 'prompt', repo: '/r', text: 'a'.repeat(30000) });
    expect(m.type === 'prompt' && m.text.length).toBe(20000);
  });

  it('rejects wrong shapes with a 400', () => {
    expect(() => parseOr400(actionBody, { repo: '/r', action: 'rm -rf' })).toThrow(/invalid request: action/);
    expect(() => parseOr400(commentPatch, { status: 'sent' })).toThrow(expect.objectContaining({ status: 400 }));
    expect(clientMsg.safeParse({ type: 'prompt', repo: '/r', text: 42 }).success).toBe(false);
    expect(clientMsg.safeParse({ type: 'nope', repo: '/r' }).success).toBe(false);
  });
});
