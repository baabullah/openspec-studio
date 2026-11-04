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

/** Optional position hints, used only to break ties between equally good candidates. */
export interface LocateHints {
  headingPathAt?: (offset: number) => string[];
  lineAt?: (offset: number) => number;
}

export interface Located { start: number; end: number; /** true when the quote was edited and matched approximately */ fuzzy: boolean }

type AnchorLike = Pick<Anchor, 'exact' | 'prefix' | 'suffix'> & Partial<Pick<Anchor, 'headingPath' | 'lineHint'>>;

/** Max edit distance accepted for a fuzzy match, as a fraction of the quote length. */
export const FUZZY_MAX = 0.3;
const FUZZY_MIN_LEN = 8; // shorter quotes are too ambiguous to match approximately
const FUZZY_MAX_LEN = 600; // keeps the O(text × quote) search bounded
const CTX_MIN = 8; // context-only fallback needs this much of both prefix and suffix

/**
 * Approximate substring search (Sellers): every place where `pat` occurs in
 * `text` with at most `k` edits. Returns the best match of each run of
 * neighbouring end positions, with its start recovered by tracking alignments.
 */
function fuzzyFind(text: string, pat: string, k: number): { start: number; end: number; dist: number }[] {
  const m = pat.length;
  let prev = new Int32Array(m + 1), cur = new Int32Array(m + 1);
  let prevS = new Int32Array(m + 1), curS = new Int32Array(m + 1);
  for (let i = 0; i <= m; i++) { prev[i] = i; prevS[i] = 0; }
  const out: { start: number; end: number; dist: number }[] = [];
  let run: { start: number; end: number; dist: number } | null = null;
  for (let j = 1; j <= text.length; j++) {
    const ch = text[j - 1];
    cur[0] = 0; curS[0] = j;
    for (let i = 1; i <= m; i++) {
      // prefer the diagonal (match/substitute), then deletion, then insertion
      let d = prev[i - 1] + (pat[i - 1] === ch ? 0 : 1), s = prevS[i - 1];
      if (prev[i] + 1 < d) { d = prev[i] + 1; s = prevS[i]; }
      if (cur[i - 1] + 1 < d) { d = cur[i - 1] + 1; s = curS[i - 1]; }
      cur[i] = d; curS[i] = s;
    }
    if (cur[m] <= k) {
      if (!run || cur[m] < run.dist) run = { start: curS[m], end: j, dist: cur[m] };
    } else if (run) { out.push(run); run = null; }
    [prev, cur] = [cur, prev]; [prevS, curS] = [curS, prevS];
  }
  if (run) out.push(run);
  return out;
}

/** Context-only fallback: the quote was rewritten, but the text right around it survived. */
function betweenContext(text: string, a: AnchorLike): { start: number; end: number }[] {
  const pre = a.prefix.slice(-16), suf = a.suffix.slice(0, 16);
  if (pre.trim().length < CTX_MIN || suf.trim().length < CTX_MIN) return [];
  const maxGap = Math.max(3 * a.exact.length, a.exact.length + 200);
  const out: { start: number; end: number }[] = [];
  for (let i = text.indexOf(pre); i >= 0; i = text.indexOf(pre, i + 1)) {
    const s = i + pre.length;
    const e = text.indexOf(suf, s);
    if (e > s && e - s <= maxGap) out.push({ start: s, end: e });
  }
  return out;
}

const trimWs = (text: string, r: { start: number; end: number }) => {
  let { start, end } = r;
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return { start, end };
};

/** 2 = same heading path, 1 = same innermost heading, 0 = elsewhere / unknown. */
function headingScore(a: AnchorLike, hints: LocateHints | undefined, at: number) {
  const want = a.headingPath;
  if (!want?.length || !hints?.headingPathAt) return 0;
  const got = hints.headingPathAt(at);
  if (got.length === want.length && got.every((h, i) => h === want[i])) return 2;
  return got[got.length - 1] === want[want.length - 1] ? 1 : 0;
}

const cache = new Map<string, { text: string; hit: Located | null }>();

/**
 * Find the anchor's quote in `text`.
 *  1. Every exact occurrence is a candidate, scored by how much of the stored
 *     prefix/suffix matches around it. Ties are broken by heading path, then
 *     by distance from the original line.
 *  2. If the quote no longer occurs exactly, look for approximate matches (up
 *     to FUZZY_MAX edits) and for a span still enclosed by the old context.
 * Returns null if nothing is close enough (the comment is orphaned).
 */
export function locate(text: string, anchor: AnchorLike, hints?: LocateHints): Located | null {
  const { exact } = anchor;
  if (!exact) return null;

  const context = (s: number, e: number) =>
    overlapEnd(text.slice(Math.max(0, s - CONTEXT), s), anchor.prefix) + overlapStart(text.slice(e, e + CONTEXT), anchor.suffix);
  const lineDist = (at: number) =>
    anchor.lineHint && hints?.lineAt ? Math.abs(hints.lineAt(at) - anchor.lineHint) : 0;
  type Cand = { start: number; end: number; score: number };
  const pick = (cands: Cand[], fuzzy: boolean): Located | null => {
    let best: (Cand & { h: number; l: number }) | null = null;
    for (const c of cands) {
      if (best && c.score < best.score) continue;
      const h = headingScore(anchor, hints, c.start), l = lineDist(c.start);
      if (!best || c.score > best.score || h > best.h || (h === best.h && l < best.l)) best = { ...c, h, l };
    }
    return best && { start: best.start, end: best.end, fuzzy };
  };

  const exactCands: Cand[] = [];
  for (let i = text.indexOf(exact); i >= 0; i = text.indexOf(exact, i + 1)) {
    exactCands.push({ start: i, end: i + exact.length, score: context(i, i + exact.length) });
  }
  if (exactCands.length) return pick(exactCands, false);

  // fuzzy search is costly; remember the answer for this exact text
  const key = `${exact}\u0000${anchor.prefix}\u0000${anchor.suffix}\u0000${anchor.headingPath?.join('\u0001') ?? ''}\u0000${anchor.lineHint ?? ''}`;
  const cached = cache.get(key);
  if (cached && cached.text === text) return cached.hit;

  const m = exact.length;
  const cands: Cand[] = [];
  if (m >= FUZZY_MIN_LEN && m <= FUZZY_MAX_LEN) {
    for (const f of fuzzyFind(text, exact, Math.floor(m * FUZZY_MAX))) {
      const r = trimWs(text, f);
      if (r.end > r.start) cands.push({ ...r, score: 2 * CONTEXT * (1 - f.dist / m) + context(r.start, r.end) });
    }
  }
  for (const b of betweenContext(text, anchor)) {
    const r = trimWs(text, b);
    if (r.end > r.start) cands.push({ ...r, score: context(r.start, r.end) });
  }
  const hit = pick(cands, true);
  if (cache.size > 500) cache.clear();
  cache.set(key, { text, hit });
  return hit;
}

/** Like normalize() but keeps edge whitespace, for prefix/suffix fragments. */
const normalizeCtx = (s: string) => s.replace(/[*_`~]/g, '').replace(/\s+/g, ' ').toLowerCase();

/** Does the quote still exist in this markdown source (ignoring formatting), exactly or approximately? */
export function quoteExists(source: string, exact: string, ctx?: Pick<Anchor, 'prefix' | 'suffix'>): boolean {
  return quoteMatch(source, exact, ctx) !== null;
}

/** Locate a (rendered-text) anchor in markdown source, after normalizing both. */
export function quoteMatch(source: string, exact: string, ctx?: Pick<Anchor, 'prefix' | 'suffix'>): Located | null {
  const q = normalize(exact);
  if (!q) return null;
  return locate(normalize(source), { exact: q, prefix: normalizeCtx(ctx?.prefix ?? ''), suffix: normalizeCtx(ctx?.suffix ?? '') });
}
