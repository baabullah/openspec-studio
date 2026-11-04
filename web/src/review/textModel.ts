// Maps the rendered document's text (skipping our own UI bits marked
// [data-ui]) to flat character offsets, so comments can be anchored with
// shared/anchor.ts and painted back as DOM Ranges.

import type { Anchor } from '../../../shared/protocol.ts';
import { makeAnchor } from '../../../shared/anchor.ts';

interface Seg { node: Text; start: number }

export class TextModel {
  readonly segs: Seg[] = [];
  readonly text: string;
  private headings: { level: number; text: string; offset: number }[] = [];

  constructor(readonly root: HTMLElement) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => ((n.parentElement?.closest('[data-ui]')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let pos = 0;
    const parts: string[] = [];
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      this.segs.push({ node: n, start: pos });
      parts.push(n.data);
      pos += n.data.length;
    }
    this.text = parts.join('');
    for (const h of root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')) {
      this.headings.push({ level: Number(h.tagName[1]), text: this.textOf(h).trim(), offset: this.offsetAtStart(h) });
    }
  }

  /** Text of an element as seen by the model (excludes [data-ui]). */
  textOf(el: Element): string {
    const r = this.elementRange(el);
    return r ? this.text.slice(r.start, r.end) : '';
  }

  /** Offset of a DOM boundary point. */
  offsetOf(container: Node, offset: number): number {
    if (container.nodeType === Node.TEXT_NODE) {
      const s = this.segs.find((x) => x.node === container);
      if (s) return s.start + Math.min(offset, s.node.data.length);
    }
    const p = document.createRange();
    try { p.setStart(container, offset); } catch { return this.text.length; }
    for (const s of this.segs) if (p.comparePoint(s.node, 0) >= 0) return s.start;
    return this.text.length;
  }

  offsetAtStart(el: Node) { return this.offsetOf(el, 0); }

  elementRange(el: Element, excludeNested?: string): { start: number; end: number } | null {
    const start = this.offsetOf(el, 0);
    let end = this.offsetOf(el, el.childNodes.length);
    if (excludeNested) {
      const nested = el.querySelector(excludeNested);
      if (nested) end = this.offsetOf(nested, 0);
    }
    return end > start ? { start, end } : null;
  }

  toRange(start: number, end: number): Range | null {
    if (end <= start || !this.segs.length) return null;
    const find = (off: number, isEnd: boolean) => {
      for (let i = 0; i < this.segs.length; i++) {
        const s = this.segs[i];
        const len = s.node.data.length;
        if (isEnd ? off <= s.start + len : off < s.start + len) return { node: s.node, off: off - s.start };
      }
      const last = this.segs[this.segs.length - 1];
      return { node: last.node, off: last.node.data.length };
    };
    const a = find(start, false), b = find(end, true);
    const r = document.createRange();
    r.setStart(a.node, Math.max(0, a.off));
    r.setEnd(b.node, Math.max(0, b.off));
    return r;
  }

  headingPath(offset: number): string[] {
    const stack: { level: number; text: string }[] = [];
    for (const h of this.headings) {
      if (h.offset > offset) break;
      while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
      stack.push(h);
    }
    return stack.map((h) => h.text);
  }

  /** Build an anchor for [start,end), trimming surrounding whitespace. */
  anchor(start: number, end: number, lineHint: number): Anchor | null {
    while (start < end && /\s/.test(this.text[start])) start++;
    while (end > start && /\s/.test(this.text[end - 1])) end--;
    if (end <= start) return null;
    return makeAnchor(this.text, start, end, this.headingPath(start), lineHint);
  }
}

export const lineHintOf = (node: Node | null): number => {
  const el = node && (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement);
  return Number(el?.closest('[data-line]')?.getAttribute('data-line')) || 0;
};

// ---- CSS Custom Highlight API ------------------------------------------------
const HL: any = (globalThis as any).CSS?.highlights;
const Highlight: any = (globalThis as any).Highlight;
export const highlightsSupported = !!(HL && Highlight);

export function paint(groups: Record<string, Range[]>) {
  if (!highlightsSupported) return;
  for (const [name, ranges] of Object.entries(groups)) {
    if (ranges.length) HL.set(name, new Highlight(...ranges));
    else HL.delete(name);
  }
}

/** Character offset under the mouse. */
export function offsetAtPoint(model: TextModel, x: number, y: number): number | null {
  const d: any = document;
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    return p ? model.offsetOf(p.offsetNode, p.offset) : null;
  }
  if (d.caretRangeFromPoint) {
    const r: Range | null = d.caretRangeFromPoint(x, y);
    return r ? model.offsetOf(r.startContainer, r.startOffset) : null;
  }
  return null;
}
