import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Brain, Check, ChevronRight, Circle, CircleDot, FileEdit, FilePen, FileSearch, Globe, HelpCircle, ListChecks, Search, ShieldAlert,
  Terminal, Trash2, Wrench, X, MoveRight, CircleCheck, CircleX, Info, AlertTriangle, RotateCcw,
} from 'lucide-react';
import { answerElicitation, answerPermission, sendPrompt, useStore } from '../store.ts';
import { Badge, Button, Chip, cx, Spinner } from '../lib/ui.tsx';
import { MiniDiff } from '../review/DiffView.tsx';
import { cleanTitle, type Item, type ToolItem } from './transcript.ts';

const KIND_ICON: Record<string, typeof Wrench> = {
  read: FileSearch, edit: FilePen, delete: Trash2, move: MoveRight, search: Search, execute: Terminal, think: Brain, fetch: Globe,
};

const stripResult = (t: string) => t.replace(/```review-result[^\n]*\n[\s\S]*?(```|$)/g, '').trim();

export function MessageView({ text }: { text: string }) {
  const hadResult = /```review-result/.test(text);
  const shown = stripResult(text);
  return (
    <div className="md text-[13.5px] text-fg">
      <Markdown remarkPlugins={[remarkGfm]}>{shown}</Markdown>
      {hadResult && <div className="mt-1.5"><Badge tone="accent"><ListChecks size={12} /> Review report attached to the comments</Badge></div>}
    </div>
  );
}

export function ThoughtView({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button onClick={() => setOpen(!open)} className="group block w-full text-left">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <Brain size={13} /> <span>Thinking</span>
        <ChevronRight size={13} className={cx('transition', open && 'rotate-90')} />
      </div>
      {open && <div className="mt-1 whitespace-pre-wrap border-l-2 border-line pl-3 text-xs leading-relaxed text-muted">{text}</div>}
    </button>
  );
}

function toolSummary(t: ToolItem): string | null {
  const ri = t.rawInput ?? {};
  return ri.command ?? ri.file_path ?? ri.path ?? ri.pattern ?? ri.url ?? t.locations[0]?.path ?? null;
}

export function ToolCard({ t }: { t: ToolItem }) {
  const [open, setOpen] = useState(false);
  const Icon = KIND_ICON[t.kind] ?? Wrench;
  const diffs = t.content.filter((c) => c?.type === 'diff');
  const texts = t.content.filter((c) => c?.type === 'content' && c.content?.type === 'text').map((c) => c.content.text).join('');
  const sum = toolSummary(t);
  const status = t.status === 'completed' ? <Check size={14} className="text-ok" />
    : t.status === 'failed' ? <X size={14} className="text-bad" />
    : <Spinner className="text-muted" />;
  return (
    <div className="rounded-lg border border-line bg-surface">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
        <Icon size={14} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-[12.5px]">
          <span className="font-medium">{t.title}</span>
          {sum && sum !== t.title && <span className="ml-1.5 font-mono text-[11.5px] text-muted">{shortPath(String(sum))}</span>}
        </span>
        {diffs.length > 0 && <Badge tone="info">diff</Badge>}
        {status}
      </button>
      {open && (
        <div className="space-y-2 border-t border-line px-2.5 py-2">
          {diffs.map((d, i) => <MiniDiff key={i} path={d.path} before={d.oldText ?? ''} after={d.newText ?? ''} />)}
          {texts && <pre className="max-h-56 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] text-fg-2">{texts.slice(0, 6000)}</pre>}
          {!diffs.length && !texts && t.rawInput && <pre className="max-h-40 overflow-auto font-mono text-[11px] text-muted">{JSON.stringify(t.rawInput, null, 2).slice(0, 3000)}</pre>}
        </div>
      )}
    </div>
  );
}

export function PlanView({ entries }: { entries: { content: string; status: string }[] }) {
  const done = entries.filter((e) => e.status === 'completed').length;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-fg-2">
        <ListChecks size={14} /> Plan <span className="text-muted">{done}/{entries.length}</span>
      </div>
      <ul className="space-y-1">
        {entries.map((e, i) => (
          <li key={i} className={cx('flex items-start gap-2 text-[12.5px]', e.status === 'completed' && 'text-muted line-through')}>
            {e.status === 'completed' ? <CircleCheck size={14} className="mt-0.5 shrink-0 text-ok" />
              : e.status === 'in_progress' ? <CircleDot size={14} className="mt-0.5 shrink-0 text-warn" />
              : <Circle size={14} className="mt-0.5 shrink-0 text-muted" />}
            <span>{e.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const shortPath = (p: string) => (p.length > 60 ? '…' + p.slice(-58) : p);

export function PermissionCard({ it, compact }: { it: Extract<Item, { type: 'permission' }>; compact?: boolean }) {
  const tc = it.toolCall ?? {};
  const title = cleanTitle(tc.title ?? it.tool?.title ?? tc._meta?.['codebuddy.ai/toolName'] ?? 'Agent action');
  const ri = tc.rawInput ?? it.tool?.rawInput ?? {};
  const content: any[] = tc.content ?? it.tool?.content ?? [];
  const diff = content.find((c) => c?.type === 'diff');
  const target = ri.command ?? ri.file_path ?? ri.path ?? ri.url ?? null;
  if (it.resolved) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted">
        <ShieldAlert size={13} /> <span className="truncate">{title}</span> <MoveRight size={12} /> <span className="font-medium text-fg-2">{it.resolved}</span>
      </div>
    );
  }
  const order = (k: string) => (k === 'allow_once' ? 0 : k === 'allow_always' ? 1 : k === 'reject_once' ? 2 : 3);
  const options = [...it.options].sort((a, b) => order(a.kind) - order(b.kind));
  return (
    <div className={cx('attention rounded-xl border border-warn/50 bg-warn-soft p-3', compact && 'shadow-pop')}>
      <div className="flex items-start gap-2">
        <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warn" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">The agent wants to: {title}</div>
          {/* the details scroll on their own, so a long command (e.g. a heredoc) can never push the buttons out of view */}
          <div className={cx('overflow-y-auto', compact ? 'max-h-40' : 'max-h-72')}>
            {target && <pre className="mt-0.5 whitespace-pre-wrap break-all font-mono text-[11.5px] text-fg-2">{String(target).slice(0, 20000)}</pre>}
            {ri.content && !diff && typeof ri.content === 'string' && (
              <pre className="mt-1.5 overflow-auto rounded-md bg-surface p-2 font-mono text-[11px] text-fg-2">{ri.content.slice(0, 2000)}</pre>
            )}
            {diff && <div className="mt-1.5"><MiniDiff path={diff.path} before={diff.oldText ?? ''} after={diff.newText ?? ''} /></div>}
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5 pl-6">
        {options.map((o) => (
          <Button key={o.optionId} size="sm" variant={o.kind === 'allow_once' ? 'ok' : o.kind.startsWith('allow') ? 'secondary' : 'danger'}
            onClick={() => answerPermission(it.id, o.optionId, o.name)}>
            {o.kind.startsWith('allow') ? <Check size={13} /> : <X size={13} />} {o.name}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** ACP form elicitation → buttons/chips; free text only when the schema asks for it. */
export function ElicitationCard({ it }: { it: Extract<Item, { type: 'elicitation' }> }) {
  const props: Record<string, any> = it.schema?.properties ?? {};
  const [vals, setVals] = useState<Record<string, any>>(() =>
    Object.fromEntries(Object.entries(props).map(([k, p]) => [k, p.default ?? (p.type === 'array' ? [] : p.type === 'boolean' ? undefined : '')])));
  if (it.resolved) {
    return <div className="flex items-center gap-2 text-xs text-muted"><HelpCircle size={13} /> <span className="truncate">{it.message}</span> <MoveRight size={12} /> <span className="font-medium text-fg-2">{it.resolved}</span></div>;
  }
  const keys = Object.keys(props);
  const choicesOf = (p: any): { value: string; label: string }[] | null => {
    const src = p.oneOf ?? p.anyOf ?? p.items?.oneOf ?? p.items?.anyOf;
    if (Array.isArray(src)) return src.map((o: any) => ({ value: String(o.const), label: o.title ?? String(o.const) }));
    const en = p.enum ?? p.items?.enum;
    if (Array.isArray(en)) return en.map((v: any, i: number) => ({ value: String(v), label: p.enumNames?.[i] ?? String(v) }));
    return null;
  };
  const single = keys.length === 1 ? props[keys[0]] : null;
  const instant = single && single.type === 'string' && choicesOf(single); // one click answers
  const submit = (v = vals) => answerElicitation(it.id, 'accept', v);

  return (
    <div className="attention rounded-xl border border-info/40 bg-info-soft p-3">
      <div className="flex items-start gap-2">
        <HelpCircle size={16} className="mt-0.5 shrink-0 text-info" />
        <div className="md min-w-0 flex-1 text-[13px] font-medium"><Markdown remarkPlugins={[remarkGfm]}>{it.message}</Markdown></div>
      </div>
      <div className="mt-2 space-y-2.5 pl-6">
        {keys.map((k) => {
          const p = props[k];
          const choices = choicesOf(p);
          const label = p.title ?? (keys.length > 1 ? k : null);
          return (
            <div key={k}>
              {label && <div className="mb-1 text-xs text-fg-2">{label}</div>}
              {p.description && <div className="mb-1 text-[11.5px] text-muted">{p.description}</div>}
              {p.type === 'boolean' ? (
                <div className="flex gap-1.5">
                  <Chip active={vals[k] === true} onClick={() => (single ? submit({ [k]: true }) : setVals({ ...vals, [k]: true }))}>Yes</Chip>
                  <Chip active={vals[k] === false} onClick={() => (single ? submit({ [k]: false }) : setVals({ ...vals, [k]: false }))}>No</Chip>
                </div>
              ) : choices ? (
                <div className="flex flex-wrap gap-1.5">
                  {choices.map((c) => {
                    const multi = p.type === 'array';
                    const on = multi ? vals[k]?.includes(c.value) : vals[k] === c.value;
                    return (
                      <Chip key={c.value} active={on} onClick={() => {
                        if (instant) return submit({ [k]: c.value });
                        setVals({ ...vals, [k]: multi ? (on ? vals[k].filter((x: string) => x !== c.value) : [...(vals[k] ?? []), c.value]) : c.value });
                      }}>{c.label}</Chip>
                    );
                  })}
                </div>
              ) : (
                <input className="h-8 w-full rounded-lg border border-line bg-surface px-2.5 text-[13px] outline-none focus:border-accent"
                  type={p.type === 'number' || p.type === 'integer' ? 'number' : 'text'} value={vals[k] ?? ''}
                  onChange={(e) => setVals({ ...vals, [k]: p.type === 'number' || p.type === 'integer' ? Number(e.target.value) : e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
              )}
            </div>
          );
        })}
        <div className="flex gap-1.5">
          {!instant && keys.length > 0 && <Button size="sm" variant="primary" onClick={() => submit()}>Submit</Button>}
          {keys.length === 0 && <Button size="sm" variant="primary" onClick={() => submit({})}>OK</Button>}
          <Button size="sm" variant="ghost" onClick={() => answerElicitation(it.id, 'decline')}>Decline</Button>
        </div>
      </div>
    </div>
  );
}

export function NoticeView({ level, text }: { level: 'info' | 'error'; text: string }) {
  return (
    <div className={cx('flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-xs', level === 'error' ? 'bg-bad-soft text-bad' : 'text-muted')}>
      {level === 'error' ? <AlertTriangle size={13} className="mt-0.5 shrink-0" /> : <Info size={13} className="mt-0.5 shrink-0" />}
      <span className="whitespace-pre-wrap break-words">{text}</span>
    </div>
  );
}

export function FilesView({ paths }: { paths: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
      <FileEdit size={13} /> Wrote
      {paths.map((p) => <span key={p} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-2">{p}</span>)}
    </div>
  );
}

const STOP_HELP: Record<string, string> = {
  refusal: 'The agent stopped early. CodeBuddy also reports network or model-server errors this way (e.g. DNS/VPN down); check ~/.codebuddy/logs for details.',
  max_tokens: 'The reply hit the output token limit.',
  max_turn_requests: 'The agent hit its maximum number of steps for one turn.',
  error: 'The request to the agent failed.',
};

export function TurnEnd({ stopReason, last }: { stopReason: string; last?: boolean }) {
  const ready = useStore((s) => s.session?.status === 'ready');
  const help = STOP_HELP[stopReason];
  if (help) {
    return (
      <div className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-xs text-bad">
        <div className="flex items-start gap-2">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span className="flex-1"><b>Stopped: {stopReason}.</b> {help}</span>
        </div>
        {last && (
          <div className="mt-2 pl-5">
            <Button size="sm" disabled={!ready} onClick={() => sendPrompt('Continue where you left off.')}><RotateCcw size={12} /> Continue</Button>
          </div>
        )}
      </div>
    );
  }
  const bad = stopReason !== 'end_turn';
  return (
    <div className="flex items-center gap-2 py-1 text-[11px] text-muted">
      <div className="h-px flex-1 bg-line" />
      {bad ? <CircleX size={12} className={stopReason === 'cancelled' ? '' : 'text-bad'} /> : <CircleCheck size={12} className="text-ok" />}
      {stopReason === 'end_turn' ? 'done' : stopReason}
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}
