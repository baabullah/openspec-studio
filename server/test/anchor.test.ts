import { describe, expect, it } from 'vitest';
import { locate, makeAnchor, normalize, quoteExists } from '../../shared/anchor.ts';

describe('anchor', () => {
  const doc = 'The system SHALL log in. Later, the system SHALL log out. Finally the system SHALL log in again.';

  it('picks the occurrence whose context matches', () => {
    const start = doc.lastIndexOf('the system SHALL log in');
    const a = makeAnchor(doc, start, start + 'the system SHALL log in'.length, [], 1);
    expect(locate(doc, a)).toEqual({ start, end: start + a.exact.length });
  });

  it('re-attaches after text is inserted before the quote', () => {
    const start = doc.indexOf('log out');
    const a = makeAnchor(doc, start, start + 7, [], 1);
    const edited = 'Intro paragraph added by the agent. ' + doc;
    const hit = locate(edited, a)!;
    expect(edited.slice(hit.start, hit.end)).toBe('log out');
  });

  it('returns null when the quote is gone', () => {
    const a = makeAnchor(doc, 0, 10, [], 1);
    expect(locate('completely different', a)).toBeNull();
  });

  it('matches rendered text against markdown source', () => {
    const src = '### Requirement: Login\nThe system **SHALL** allow [SSO](http://x) login.\n- [x] 1.1 Add `token` check';
    expect(quoteExists(src, 'The system SHALL allow SSO login.')).toBe(true);
    expect(quoteExists(src, 'Add token check')).toBe(true);
    expect(quoteExists(src, 'password reset')).toBe(false);
    expect(normalize('  A\n\n b ')).toBe('a b');
  });
});
