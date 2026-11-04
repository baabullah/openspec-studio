import { useEffect, useRef, useState } from 'react';
import type { CommentKind } from '../../../shared/protocol.ts';
import { Button, Chip, cx } from '../lib/ui.tsx';
import { KINDS } from './kinds.tsx';

/** Comment editor: pick a kind, click presets, optionally type. */
export function Composer({ kind: initialKind, body: initialBody = '', quote, onSave, onCancel, saveLabel = 'Add comment' }: {
  kind: CommentKind; body?: string; quote?: string; saveLabel?: string;
  onSave: (kind: CommentKind, body: string) => void; onCancel: () => void;
}) {
  const [kind, setKind] = useState(initialKind);
  const [body, setBody] = useState(initialBody);
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ta.current?.focus(); }, []);
  const k = KINDS.find((x) => x.id === kind)!;
  const needsText = kind === 'change' || kind === 'question' || kind === 'comment';
  const addPreset = (p: string) => setBody((b) => (b.includes(p) ? b : b.trim() ? `${b.trim()}. ${p}` : p));
  const save = () => { if (!needsText || body.trim()) onSave(kind, body.trim()); };

  return (
    <div className="w-80 rounded-xl border border-line bg-surface p-2.5 shadow-pop" onMouseDown={(e) => e.stopPropagation()}>
      {quote && <div className="mb-2 line-clamp-2 border-l-2 border-warn pl-2 text-xs italic text-fg-2">{quote}</div>}
      <div className="mb-2 flex gap-1">
        {KINDS.map((x) => (
          <button key={x.id} title={x.label} onClick={() => setKind(x.id)}
            className={cx('flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10.5px] transition', kind === x.id ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2')}>
            <x.icon size={15} /> {x.short}
          </button>
        ))}
      </div>
      {k.presets.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {k.presets.map((p) => <Chip key={p} active={body.includes(p)} onClick={() => addPreset(p)} className="!px-2 !py-0.5 text-[11.5px]">{p}</Chip>)}
        </div>
      )}
      <textarea ref={ta} value={body} onChange={(e) => setBody(e.target.value)} rows={2}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); if (e.key === 'Escape') onCancel(); }}
        placeholder={needsText ? 'Pick a suggestion or write a note…' : 'Optional note'}
        className="w-full resize-none rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent field-sizing-content max-h-40" />
      <div className="mt-2 flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={needsText && !body.trim()} onClick={save}>{saveLabel}</Button>
      </div>
    </div>
  );
}
