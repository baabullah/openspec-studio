// Text-quote anchoring (W3C Web Annotation style): a comment remembers the
// quoted text plus a little context on each side, so it can be found again
// after the document is edited. Used by the browser (against rendered text) and
// the server (against markdown source, normalized).

import type { Anchor } from './protocol.ts';

export const CONTEXT = 32;

/** Collapse whitespace and drop inline markdown syntax so rendered and source text compare equal. */
export function normalize(s: string): string {
  return s
    .replace(/```[^\n]*\n?/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links/images → text
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '') // block markers
    .replace(/\[[ xX]\]\s+/g, '') // task checkboxes
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function makeAnchor(text: string, start: number, end: number, headingPath: string[], lineHint: number): Anchor {
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
    headingPath,
    lineHint,
  };
}

/** Number of matching chars between a and b, compared from the end of a / start of b. */
function overlapEnd(a: string, b: string) { let n = 0; while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++; return n; }
function overlapStart(a: string, b: string) { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; }

/**
 * Find the anchor's quote in `text`. When it occurs several times, prefer the
 * occurrence whose surrounding text best matches the stored prefix/suffix.
 * Returns null if the quote no longer exists (the comment is orphaned).
 */
export function locate(text: string, anchor: Pick<Anchor, 'exact' | 'prefix' | 'suffix'>): { start: number; end: number } | null {
  const { exact } = anchor;
  if (!exact) return null;
  let best: { start: number; end: number; score: number } | null = null;
  for (let i = text.indexOf(exact); i >= 0; i = text.indexOf(exact, i + 1)) {
    const score = overlapEnd(text.slice(Math.max(0, i - CONTEXT), i), anchor.prefix)
      + overlapStart(text.slice(i + exact.length, i + exact.length + CONTEXT), anchor.suffix);
    if (!best || score > best.score) best = { start: i, end: i + exact.length, score };
  }
  return best && { start: best.start, end: best.end };
}

/** Does the quote still exist in this markdown source (ignoring formatting)? */
export function quoteExists(source: string, exact: string): boolean {
  const q = normalize(exact);
  return q.length > 0 && normalize(source).includes(q);
}
