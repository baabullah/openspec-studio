import { forwardRef, useState } from 'react';
import { Bot, Check, Pencil, RotateCcw, Trash2, Unlink } from 'lucide-react';
import type { ReviewComment } from '../../../shared/protocol.ts';
import { review, useStore } from '../store.ts';
import { Badge, Button, cx, IconButton, Spinner } from '../lib/ui.tsx';
import { Composer } from './Composer.tsx';
import { kindOf, STATUS_META, TO_CHECK } from './kinds.tsx';

export const CommentCard = forwardRef<HTMLDivElement, { c: ReviewComment; style?: React.CSSProperties; showQuote?: boolean }>(function CommentCard({ c, style, showQuote }, ref) {
  const focused = useStore((s) => s.focusComment === c.id);
  const [editing, setEditing] = useState(false);
  const k = kindOf(c.kind);
  const st = STATUS_META[c.status];
  const focus = () => useStore.setState({ focusComment: c.id });

  if (editing) {
    return (
      <div ref={ref} style={style} className="z-20">
        <Composer kind={c.kind} body={c.body} quote={c.anchor?.exact} saveLabel="Save"
          onCancel={() => setEditing(false)}
          onSave={async (kind, body) => { await review.patch(c.id, { kind, body, ...(c.status !== 'draft' ? { status: 'draft' } : {}) }); setEditing(false); }} />
      </div>
    );
  }

  return (
    <div ref={ref} style={style} onClick={focus}
      className={cx('group w-full cursor-pointer rounded-xl border bg-surface p-2.5 text-[12.5px] transition',
        focused ? 'z-10 border-accent shadow-pop' : 'border-line shadow-sm hover:border-line-strong',
        c.status === 'resolved' && !focused && 'opacity-60')}>
      <div className="flex items-center gap-1.5">
        <k.icon size={13} className={k.tone} />
        <span className="font-medium">{k.short}</span>
        <Badge tone={st.tone} className="ml-auto">{c.status === 'sent' && <Spinner className="h-2.5 w-2.5" />}{st.label}</Badge>
      </div>
      {(showQuote || c.orphaned) && c.anchor && (
        <div className="mt-1.5 line-clamp-2 border-l-2 border-line-strong pl-2 text-[11.5px] italic text-muted">{c.anchor.exact}</div>
      )}
      {c.orphaned && <div className="mt-1 flex items-center gap-1 text-[11px] text-warn"><Unlink size={11} /> Quoted text no longer in the document</div>}
      {c.body && <div className={cx('mt-1.5 whitespace-pre-wrap break-words text-fg', !focused && 'line-clamp-3')}>{c.body}</div>}
      {c.agentNote && (
        <div className="mt-2 flex gap-1.5 rounded-lg bg-surface-2 px-2 py-1.5 text-[12px] text-fg-2">
          <Bot size={13} className="mt-0.5 shrink-0 text-accent" />
          <span className={cx(!focused && 'line-clamp-3')}>{c.agentNote}</span>
        </div>
      )}
      {focused && (
        <div className="mt-2 flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {TO_CHECK.has(c.status) && <>
            <Button size="sm" variant="ok" onClick={() => review.patch(c.id, { status: 'resolved' })}><Check size={12} /> Resolve</Button>
            <Button size="sm" onClick={() => setEditing(true)}><RotateCcw size={12} /> Reopen</Button>
          </>}
          {c.status === 'resolved' && <Button size="sm" onClick={() => setEditing(true)}><RotateCcw size={12} /> Reopen</Button>}
          {c.status === 'draft' && <>
            <IconButton title="Edit" onClick={() => setEditing(true)}><Pencil size={13} /></IconButton>
            <IconButton title="Delete" onClick={() => review.remove(c.id)}><Trash2 size={13} /></IconButton>
          </>}
          {c.status !== 'sent' && c.status !== 'draft' && <IconButton title="Delete" className="ml-auto" onClick={() => review.remove(c.id)}><Trash2 size={13} /></IconButton>}
        </div>
      )}
    </div>
  );
});
