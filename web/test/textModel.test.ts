// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { TextModel } from '../src/review/textModel.ts';

function render(html: string) {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.replaceChildren(root);
  return new TextModel(root);
}

const DOC = `
<h1 data-line="1">Proposal</h1>
<p data-line="3">Use <code>GET /api</code> here.<span data-ui>[ui]</span></p>
<h2 data-line="5">Why</h2>
<p data-line="6">Because  it is simple.</p>`;

describe('TextModel', () => {
  it('flattens text and skips [data-ui]', () => {
    const m = render(DOC);
    expect(m.text).toContain('Use GET /api here.');
    expect(m.text).not.toContain('[ui]');
  });

  it('maps offsets to DOM ranges and back', () => {
    const m = render(DOC);
    const start = m.text.indexOf('GET /api');
    const r = m.toRange(start, start + 'GET /api'.length)!;
    expect(r.toString()).toBe('GET /api');
    expect(m.offsetOf(r.startContainer, r.startOffset)).toBe(start);
    expect(m.offsetOf(r.endContainer, r.endOffset)).toBe(start + 8);
  });

  it('knows the heading path and source line of an offset', () => {
    const m = render(DOC);
    const at = m.text.indexOf('simple');
    expect(m.headingPath(at)).toEqual(['Proposal', 'Why']);
    expect(m.headingPath(m.text.indexOf('GET'))).toEqual(['Proposal']);
    expect(m.lineAt(at)).toBe(6);
  });

  it('builds a trimmed anchor', () => {
    const m = render(DOC);
    const s = m.text.indexOf('Because');
    // a selection that starts on the newline before and ends inside the double space
    const a = m.anchor(s - 1, s + 'Because '.length + 1, 6)!;
    expect(a).toMatchObject({ exact: 'Because', headingPath: ['Proposal', 'Why'], lineHint: 6 });
    expect(a.suffix.startsWith('  it is simple.')).toBe(true);
    expect(m.anchor(0, 0, 0)).toBeNull();
  });
});
