import type { ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import { gwtKeyword, headingKind, markGwt, markRfc } from '../review/specMarkup.tsx';
import remarkGfm from 'remark-gfm';
import { Lock } from 'lucide-react';
import { cx } from '../lib/ui.tsx';

export interface Tab { id: string; label: ReactNode }

const DELTA = /^(ADDED|MODIFIED|REMOVED|RENAMED)\b/;
const text = (c: ReactNode): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(text).join('') : '');

// the same spec-aware markup as the review canvas, without the review tools
const deco = (Tag: any) => ({ node: _node, children, ...rest }: any) => {
  const isHeading = /^h[1-6]$/.test(Tag);
  const head = isHeading ? headingKind(children) : { kind: undefined, children };
  const kw = Tag === 'li' ? gwtKeyword(children) : undefined;
  const body = Tag === 'p' || Tag === 'li' ? markRfc(markGwt(head.children, kw)) : head.children;
  return <Tag {...rest} data-delta={isHeading ? text(children).match(DELTA)?.[1] : undefined} data-kind={head.kind} data-gwt={kw}>{body}</Tag>;
};
const COMPONENTS: Components = { h2: deco('h2'), h3: deco('h3'), h4: deco('h4'), p: deco('p'), li: deco('li') };

/**
 * A document shown without review tools: main specs and archived changes.
 * Same typography as the review canvas, no comment toolbar, no review bar.
 */
export function ReadOnlyDoc({ title, badges, tabs, tab, onTab, content, children }: {
  title: string;
  badges?: ReactNode;
  tabs?: Tab[];
  tab?: string;
  onTab?: (id: string) => void;
  /** Markdown to render; ignored when children are given (e.g. a history view). */
  content?: string;
  children?: ReactNode;
}) {
  return (
    <main className="flex h-full min-h-0 flex-col bg-bg">
      <header className={cx('border-b border-line bg-surface px-6', tabs?.length ? 'pt-3' : 'py-3')}>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="truncate text-[17px] font-semibold tracking-tight">{title}</h1>
          {badges}
          <span className="ml-auto flex items-center gap-1 text-[11.5px] text-muted" title="Studio shows this for reading only; edit it through a change">
            <Lock size={12} /> read-only
          </span>
        </div>
        {!!tabs?.length && (
          <div className="mt-2 flex gap-0.5 overflow-x-auto">
            {tabs.map((t) => (
              <button type="button" key={t.id} onClick={() => onTab?.(t.id)}
                className={cx('flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2 pt-1 text-[13px] transition', t.id === tab ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg')}>
                {t.label}
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {children ?? (
          <div className="mx-auto max-w-[760px] px-8 py-6">
            <div className="doc"><Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>{content ?? ''}</Markdown></div>
          </div>
        )}
      </div>
    </main>
  );
}
