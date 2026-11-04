import { describe, expect, it } from 'vitest';
import { locate, makeAnchor, normalize, quoteExists, quoteMatch } from '../../shared/anchor.ts';

describe('anchor', () => {
  const doc = 'The system SHALL log in. Later, the system SHALL log out. Finally the system SHALL log in again.';

  it('picks the occurrence whose context matches', () => {
    const start = doc.lastIndexOf('the system SHALL log in');
    const a = makeAnchor(doc, start, start + 'the system SHALL log in'.length, [], 1);
    expect(locate(doc, a)).toEqual({ start, end: start + a.exact.length, fuzzy: false });
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

  describe('tie-breaks', () => {
    // two scenarios that are identical, word for word, under different requirements
    const block = '\n#### Scenario: Success\n- WHEN the client calls the endpoint\n- THEN the system returns HTTP 200\n';
    const text = '### Requirement: Hello' + block + '### Requirement: Goodbye' + block;
    const quote = 'THEN the system returns HTTP 200';
    const second = text.lastIndexOf(quote);
    const headingPathAt = (o: number) => [o > text.indexOf('Goodbye') ? 'Requirement: Goodbye' : 'Requirement: Hello', 'Scenario: Success'];

    it('uses the heading path when the context is identical', () => {
      const a = makeAnchor(text, second, second + quote.length, ['Requirement: Goodbye', 'Scenario: Success'], 0);
      expect(locate(text, a)!.start).toBe(text.indexOf(quote)); // without hints: first wins
      expect(locate(text, a, { headingPathAt })!.start).toBe(second);
    });

    it('falls back to the nearest line', () => {
      const lineAt = (o: number) => text.slice(0, o).split('\n').length;
      const a = makeAnchor(text, second, second + quote.length, [], lineAt(second));
      expect(locate(text, a, { lineAt })!.start).toBe(second);
    });

    it('context still beats the hints', () => {
      const t = 'alpha one returns 200 done. beta two returns 200 done.';
      const s = t.indexOf('returns 200', 20);
      const a = { ...makeAnchor(t, s, s + 11, ['X'], 99) };
      expect(locate(t, a, { headingPathAt: (o) => (o < 20 ? ['X'] : ['Y']), lineAt: () => 1 })!.start).toBe(s);
    });
  });

  describe('fuzzy', () => {
    const doc = 'Intro about the latency budget. The endpoint SHALL respond within 200 milliseconds under normal load. Outro text here.';
    const quote = 'The endpoint SHALL respond within 200 milliseconds';
    const a = makeAnchor(doc, doc.indexOf(quote), doc.indexOf(quote) + quote.length, [], 1);

    it('re-attaches to a lightly edited quote', () => {
      const edited = doc.replace('within 200 milliseconds', 'within 250 ms');
      const hit = locate(edited, a)!;
      expect(hit.fuzzy).toBe(true);
      expect(edited.slice(hit.start, hit.end)).toMatch(/^The endpoint SHALL respond within 250 ms/);
    });

    it('re-attaches to a rewritten quote when its context survived', () => {
      const edited = doc.replace(quote, 'Responses MUST be fast');
      const hit = locate(edited, a)!;
      expect(edited.slice(hit.start, hit.end)).toBe('Responses MUST be fast');
    });

    it('stays orphaned when quote and context are both gone', () => {
      expect(locate('Something else entirely, nothing in common with the old spec at all.', a)).toBeNull();
    });

    it('is exact when possible', () => {
      expect(locate(doc, a)!.fuzzy).toBe(false);
    });

    it('works against markdown source on the server', () => {
      const src = '## Perf\nThe endpoint **SHALL** respond within 250 ms under normal load.';
      expect(quoteMatch(src, quote, a)?.fuzzy).toBe(true);
      expect(quoteExists('## Perf\nNo latency requirement.', quote, a)).toBe(false);
    });
  });
});
