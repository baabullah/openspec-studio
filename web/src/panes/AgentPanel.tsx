import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bot, ChevronDown, Plug, Power, RotateCcw, Send, Square, Sparkles } from 'lucide-react';
import { cancelTurn, sendPrompt, setAgent, setConfig, startAgent, stopAgent, useStore } from '../store.ts';
import { Badge, Button, cx, IconButton, Menu, MenuItem, Spinner } from '../lib/ui.tsx';
import { fold, type Item } from '../agent/transcript.ts';
import { ContextMeter, TurnUsageLine } from '../agent/usage.tsx';
import { TurnWorkLine } from '../agent/TurnWorkLine.tsx';
import { ElicitationCard, FilesView, MessageView, NoticeView, PermissionCard, PlanView, ThoughtView, ToolCard, TurnEnd } from '../agent/cards.tsx';

function Row({ it, last }: { it: Item; last?: boolean }) {
  switch (it.type) {
    case 'user':
      return (
        <div className="ml-6 rounded-xl rounded-tr-sm bg-accent-soft px-3 py-2 text-[13px]">
          {it.label
            ? <div className="flex items-center gap-1.5 font-medium text-accent"><Sparkles size={13} /> {it.label}</div>
            : <div className="whitespace-pre-wrap break-words">{it.text}</div>}
        </div>
      );
    case 'message': return <MessageView text={it.text} />;
    case 'thought': return <ThoughtView text={it.text} />;
    case 'tool': return <ToolCard t={it} />;
    case 'plan': return <PlanView entries={it.entries} />;
    case 'permission':
    case 'elicitation':
      if (!it.resolved) return <div className="flex items-center gap-1.5 text-xs font-medium text-warn"><Spinner className="h-3 w-3" /> Waiting for your decision below</div>;
      return it.type === 'permission' ? <PermissionCard it={it} /> : <ElicitationCard it={it} />;
    case 'notice': return <NoticeView level={it.level} text={it.text} />;
    case 'files': return <FilesView paths={it.paths} />;
    case 'turn_end': return <>{<TurnEnd stopReason={it.stopReason} last={last} />}<TurnWorkLine work={it.work} />{it.usage && <TurnUsageLine u={it.usage} />}</>;
  }
}

const STATUS: Record<string, { tone: 'ok' | 'warn' | 'bad' | 'neutral' | 'info'; label: string }> = {
  starting: { tone: 'info', label: 'Starting' }, ready: { tone: 'ok', label: 'Ready' }, busy: { tone: 'warn', label: 'Working' },
  exited: { tone: 'neutral', label: 'Stopped' }, error: { tone: 'bad', label: 'Error' },
};

function Elapsed({ since }: { since: string }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000));
  return <span className="tabular-nums">{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>;
}

export function AgentPanel() {
  const { session, events, agents, agent, repo, repos } = useStore();
  const { items, pending, busySince, totals } = useMemo(() => fold(events), [events]);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [text, setText] = useState('');
  const hasOpenSpec = repos.find((r) => r.id === repo)?.openspec;

  // follow the stream; jump to the newest message when a repo's history loads
  // biome-ignore lint/correctness/useExhaustiveDependencies: repo is the trigger, not an input
  useEffect(() => { stick.current = true; }, [repo]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: items/repo are triggers: scroll after new output renders
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [items, repo]);

  // tab title badge when the agent waits for you
  const doneUnseen = useStore((s) => s.doneUnseen);
  useEffect(() => {
    document.title = pending.length ? `(${pending.length}) Needs you · OpenSpec Studio` : doneUnseen ? '✓ Agent finished · OpenSpec Studio' : 'OpenSpec Studio';
    if (pending.length && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  }, [pending.length, doneUnseen]);

  const status = session ? STATUS[session.status] : null;
  const agentLabel = agents.find((a) => a.id === (session?.agent ?? agent))?.label ?? agent;
  const live = session && (session.status === 'ready' || session.status === 'busy' || session.status === 'starting');
  const modeOpt = session?.configOptions.find((o) => o.id === 'mode' || o.name.toLowerCase().includes('permission'));
  const otherOpts = session?.configOptions.filter((o) => o !== modeOpt && o.type === 'select' && (o.options?.length ?? 0) > 1) ?? [];

  if (!repo) return <aside className="flex h-full flex-col border-l border-line bg-surface" />;

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-line bg-surface">
      {/* header */}
      {/* one line at any width: the agent name gives way (truncates) before the status, gauge and buttons */}
      <div className="flex min-w-0 items-center gap-2 border-b border-line px-3 py-2.5 [&>*:not(.agent-name)]:shrink-0">
        <Bot size={16} className="text-accent" />
        <Menu rootClassName="agent-name min-w-0" trigger={(t) => (
          <button type="button" onClick={t} disabled={!!live} title={agentLabel}
            className="flex min-w-0 max-w-full items-center gap-1 rounded-md px-1 text-[13px] font-semibold hover:bg-surface-2 disabled:hover:bg-transparent">
            <span className="truncate whitespace-nowrap">{agentLabel}</span> {!live && <ChevronDown size={13} className="shrink-0 text-muted" />}
          </button>
        )}>
          {(close) => agents.map((a) => <MenuItem key={a.id} onClick={() => { setAgent(a.id); close(); }} hint={a.id === agent ? '✓' : undefined}>{a.label}</MenuItem>)}
        </Menu>
        {status && (
          <Badge tone={status.tone} className="whitespace-nowrap">
            {session?.status === 'busy' || session?.status === 'starting' ? <Spinner className="h-2.5 w-2.5" /> : null}{status.label}
            {busySince && session?.status === 'busy' && <span className="tabular-nums opacity-80"><Elapsed since={busySince} /></span>}
          </Badge>
        )}
        <div className="flex-1 !shrink" />
        {session?.status === 'busy' && <Button size="sm" variant="danger" onClick={cancelTurn}><Square size={12} /> Stop</Button>}
        {live && (
          <Menu align="right" trigger={(t) => <IconButton title="Session" onClick={t}><Power size={15} /></IconButton>}>
            {(close) => <>
              <MenuItem icon={<RotateCcw />} onClick={() => { startAgent(false); close(); }}>New session</MenuItem>
              <MenuItem icon={<Power />} danger onClick={() => { stopAgent(); close(); }}>Disconnect agent</MenuItem>
            </>}
          </Menu>
        )}
      </div>

      {/* session config as mouse-friendly selects */}
      {live && (modeOpt || otherOpts.length > 0) && (
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 border-b border-line px-3 py-2">
          {[modeOpt, ...otherOpts].filter(Boolean).map((o) => (
            <label key={o!.id} className="flex min-w-0 flex-col gap-0.5 text-[10.5px] uppercase tracking-wide text-muted" title={o!.description ?? ''}>
              {o!.name}
              <select value={String(o!.currentValue)} onChange={(e) => setConfig(o!.id, e.target.value)}
                className="h-7 w-full rounded-md border border-line bg-surface px-1.5 text-[12px] normal-case tracking-normal text-fg outline-none hover:border-line-strong">
                {o!.options?.map((x) => <option key={x.value} value={x.value} title={x.description ?? ''}>{x.name}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}

      {/* stream */}
      <div ref={scroller} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}
        className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        {!live && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong px-5 py-8 text-center">
            <Plug size={22} className="text-muted" />
            <div className="text-[13px] text-fg-2">
              {session?.status === 'error' ? 'The agent could not start.' : `Connect ${agentLabel} to work on this repo.`}
              {!hasOpenSpec && <div className="mt-1 text-xs text-muted">Tip: initialize OpenSpec first so the agent gets the workflow commands.</div>}
            </div>
            <div className="flex gap-2">
              <Button variant="primary" size="lg" onClick={() => startAgent(true)}><Plug size={15} /> Connect</Button>
            </div>
            <div className="text-[11px] text-muted">Resumes the previous session when the agent supports it.</div>
          </div>
        )}
        {items.map((it, i) => <Row key={it.key} it={it} last={i === items.length - 1} />)}
        {session?.status === 'busy' && pending.length === 0 && (
          <div className="flex items-center gap-2 text-xs text-muted"><Spinner /> Working…</div>
        )}
      </div>

      {/* decisions waiting for you are pinned so they are never scrolled away */}
      {pending.length > 0 && (
        // capped so the transcript and the chat box stay visible even with several tall cards
        <div className="max-h-[60%] shrink-0 space-y-2 overflow-y-auto border-t border-warn/40 bg-warn-soft/40 px-3 py-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-warn">Needs your decision</div>
          {pending.map((it) => it.type === 'permission' ? <PermissionCard key={it.key} it={it} compact /> : it.type === 'elicitation' ? <ElicitationCard key={it.key} it={it} /> : null)}
        </div>
      )}

      {/* composer: secondary, for ad-hoc chat */}
      <div className="border-t border-line p-2.5">
        {/* context and cost sit with the prompt, like a status line, so the header stays readable */}
        {session && <div className="mb-1.5 flex justify-end px-1"><ContextMeter context={session.context ?? null} totals={totals} /></div>}
        <div className={cx('flex items-end gap-2 rounded-xl border border-line bg-bg px-2.5 py-1.5 focus-within:border-accent', !live && 'opacity-60')}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} disabled={!live}
            placeholder={live ? 'Message the agent…' : 'Connect to chat'}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (session?.status === 'ready') { sendPrompt(text); setText(''); } } }}
            className="max-h-32 min-h-6 flex-1 resize-none bg-transparent py-1 text-[13px] outline-none field-sizing-content" />
          <IconButton title="Send" disabled={session?.status !== 'ready' || !text.trim()} onClick={() => { sendPrompt(text); setText(''); }} className="text-accent">
            <Send size={15} />
          </IconButton>
        </div>
      </div>
    </aside>
  );
}
