import { useEffect, useState } from 'react';
import { ArrowUpCircle, Monitor, Moon, Sun, WifiOff, X } from 'lucide-react';
import type { UpdateInfo } from '../../shared/protocol.ts';
import { api } from './lib/api.ts';
import { boot, initialTheme, setTheme, toast, useStore } from './store.ts';
import { cx, IconButton } from './lib/ui.tsx';
import { RepoRail } from './panes/RepoRail.tsx';
import { DocReview } from './panes/DocReview.tsx';
import { AgentPanel } from './panes/AgentPanel.tsx';
import { AddFolderDialog } from './panes/Folders.tsx';
import { ErrorBoundary } from './lib/ErrorBoundary.tsx';
import { clampAgentWidth, ColumnResizer, readAgentWidth, saveAgentWidth } from './panes/ColumnResizer.tsx';

/** the layout's own agent width (the breakpoints set it), in px */
const defaultAgentWidth = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--agent-w')) || 400;
/** the rail's width at this window width (the CSS breakpoints in index.css) */
const railFor = (vw: number) => (vw < 1024 ? 210 : vw < 1280 ? 230 : 272);

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-16 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={cx('pointer-events-auto max-w-lg rounded-xl px-4 py-2 text-[13px] shadow-pop',
          t.level === 'error' ? 'bg-bad text-white' : 'bg-fg text-bg')}>{t.text}</div>
      ))}
    </div>
  );
}

function ThemeToggle() {
  const [t, setT] = useState(initialTheme);
  const next = { system: 'light', light: 'dark', dark: 'system' } as const;
  const Icon = t === 'light' ? Sun : t === 'dark' ? Moon : Monitor;
  return <IconButton title={`Theme: ${t}`} onClick={() => { const n = next[t]; setTheme(n); setT(n); }}><Icon size={15} /></IconButton>;
}

const DISMISS_KEY = 'update-dismissed';
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/** "Studio x.y.z is available": click copies the update command; hidden per version. */
function UpdatePill() {
  const [u, setU] = useState<UpdateInfo | null>(null);
  const [hidden, setHidden] = useState<string | null>(() => lsGet(DISMISS_KEY));
  useEffect(() => { api.update().then(setU).catch(() => {}); }, []);
  if (!u?.newer || !u.latest || hidden === u.latest) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(u.command); toast(`Copied: ${u.command}. Run it in a terminal, then restart Studio.`); }
    catch { toast(`Update with: ${u.command}`); }
  };
  return (
    <span className="flex items-center rounded-full bg-accent-soft text-[11px] text-accent">
      <button type="button" onClick={copy} className="flex items-center gap-1 py-0.5 pl-2 pr-1 hover:underline"
        title={`You have ${u.current}. Click to copy the update command: ${u.command}`}>
        <ArrowUpCircle size={12} /> Studio {u.latest} available
      </button>
      <button type="button" title="Hide until the next version" onClick={() => { lsSet(DISMISS_KEY, u.latest!); setHidden(u.latest); }}
        className="rounded-full py-0.5 pl-0.5 pr-1.5 opacity-70 hover:opacity-100"><X size={11} /></button>
    </span>
  );
}

export function App() {
  const wsUp = useStore((s) => s.wsUp);
  const repo = useStore((s) => s.repo);
  const change = useStore((s) => s.change);
  // the chat width the user dragged to (kept as chosen); null keeps the layout's default
  const [preferred, setPreferred] = useState<number | null>(readAgentWidth);
  const [vw, setVw] = useState(() => window.innerWidth);
  useEffect(() => { setTheme(initialTheme()); boot(); }, []);
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // the width in effect: the chosen one, kept inside what this window leaves the document; a
  // window that gets wider again brings the chosen width back
  const agentW = preferred === null ? null : clampAgentWidth(preferred, vw, railFor(vw));
  const chooseWidth = (w: number | null) => { setPreferred(w); saveAgentWidth(w); };
  return (
    <div className="grid h-full grid-cols-[var(--rail-w)_minmax(0,1fr)_var(--agent-w)]"
      style={agentW === null ? undefined : { '--agent-w': `${agentW}px` } as React.CSSProperties}>
      <ErrorBoundary name="Repositories"><RepoRail /></ErrorBoundary>
      <ErrorBoundary name="Review" resetKey={`${repo}|${change}`}><DocReview /></ErrorBoundary>
      {/* h-full + min-h-0: the chat scrolls inside its column; a long transcript must not grow the grid row */}
      <div className="relative h-full min-h-0 min-w-0">
        <ErrorBoundary name="Agent panel" resetKey={repo}><AgentPanel /></ErrorBoundary>
        <ColumnResizer width={agentW ?? defaultAgentWidth()}
          onChange={(w) => chooseWidth(w)} onReset={() => chooseWidth(null)} railWidth={() => railFor(window.innerWidth)} />
      </div>
      <div className="fixed bottom-3 left-3 z-40 flex items-center gap-1">
        <ThemeToggle />
        <UpdatePill />
        {!wsUp && <span className="flex items-center gap-1 rounded-full bg-bad-soft px-2 py-0.5 text-[11px] text-bad"><WifiOff size={11} /> server offline · reconnecting…</span>}
      </div>
      <Toasts />
      <AddFolderDialog />
    </div>
  );
}
