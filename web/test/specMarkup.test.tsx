import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import { gwtKeyword, headingKind, markGwt, markRfc } from '../src/review/specMarkup.tsx';

const html = (node: unknown) => renderToStaticMarkup(h('div', null, node as never));
const text = (s: string) => s.replace(/<[^>]+>/g, '');

describe('spec markup', () => {
  it('wraps RFC 2119 words without changing the text', () => {
    const src = 'The service SHALL expose it and MUST NOT log; it MAY cache.';
    const out = html(markRfc([src]));
    expect(text(out)).toBe(src);
    expect(out.match(/class="spec-rfc"/g)).toHaveLength(3);
    expect(out).toContain('<span class="spec-rfc">MUST NOT</span>');
  });

  it('labels requirement and scenario headings, keeping their text', () => {
    const r = headingKind(['Requirement: Hello endpoint']);
    expect(r.kind).toBe('requirement');
    expect(text(html(r.children))).toBe('Requirement: Hello endpoint');
    expect(html(r.children)).toContain('<span class="spec-head-kw">Requirement:</span>');
    expect(headingKind(['Scenario: call it']).kind).toBe('scenario');
    expect(headingKind(['Purpose']).kind).toBeUndefined();
  });

  it('marks WHEN/THEN list items', () => {
    const li = [h('strong', { key: 1 }, 'WHEN'), ' a client calls ', h('code', { key: 2 }, 'GET /x')];
    expect(gwtKeyword(li)).toBe('WHEN');
    expect(gwtKeyword([h('strong', { key: 1 }, 'Note')])).toBeUndefined();
    const out = html(markGwt(li, 'WHEN'));
    expect(out).toContain('<strong class="spec-gwt">WHEN</strong>');
    expect(text(out)).toBe('WHEN a client calls GET /x');
  });
});
