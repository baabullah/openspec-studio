// Spec-aware decoration of rendered markdown: requirement and scenario labels,
// WHEN/THEN keywords and RFC 2119 words (SHALL, MUST, …). It only wraps existing
// text in spans and adds data attributes; it never adds or removes text, so the
// review canvas's text model (comment anchoring) sees exactly the same characters.

import { Children, cloneElement, isValidElement, type ReactNode } from 'react';

const RFC = /\b(SHALL NOT|MUST NOT|SHOULD NOT|SHALL|MUST|SHOULD|MAY)\b/g;
const HEAD = /^(Requirement|Scenario):/;
const GWT = /^(GIVEN|WHEN|THEN|AND|BUT)$/;

/** Wrap RFC 2119 words of plain-string children in a styled span; other children pass through. */
export function markRfc(children: ReactNode): ReactNode {
  return Children.map(children, (c) => {
    if (typeof c !== 'string' || !RFC.test(c)) return c;
    RFC.lastIndex = 0;
    const out: ReactNode[] = [];
    let last = 0;
    for (const m of c.matchAll(RFC)) {
      if (m.index > last) out.push(c.slice(last, m.index));
      out.push(<span key={m.index} className="spec-rfc">{m[0]}</span>);
      last = m.index + m[0].length;
    }
    if (last < c.length) out.push(c.slice(last));
    return out;
  });
}

/** "Requirement: Foo" / "Scenario: Bar" headings: their kind, and children with the prefix in a label span. */
export function headingKind(children: ReactNode): { kind?: 'requirement' | 'scenario'; children: ReactNode } {
  const arr = Children.toArray(children);
  const first = arr[0];
  const m = typeof first === 'string' ? first.match(HEAD) : null;
  if (!m || typeof first !== 'string') return { children };
  return {
    kind: m[1].toLowerCase() as 'requirement' | 'scenario',
    children: [<span key="kw" className="spec-head-kw">{m[0]}</span>, first.slice(m[0].length), ...arr.slice(1)],
  };
}

/** A list item that starts with **WHEN** / **THEN** / …: the keyword, for styling. */
export function gwtKeyword(children: ReactNode): string | undefined {
  const first = Children.toArray(children).find((c) => !(typeof c === 'string' && !c.trim()));
  if (!isValidElement(first)) return undefined;
  const inner = (first.props as { children?: ReactNode }).children;
  const text = typeof inner === 'string' ? inner.trim() : '';
  return GWT.test(text) ? text : undefined;
}

/** Mark the keyword's <strong> so CSS can draw it as a pill. */
export function markGwt(children: ReactNode, kw: string | undefined): ReactNode {
  if (!kw) return children;
  let done = false;
  return Children.map(children, (c) => {
    if (done || !isValidElement(c)) return c;
    done = true;
    return cloneElement(c as React.ReactElement<{ className?: string }>, { className: 'spec-gwt' });
  });
}
