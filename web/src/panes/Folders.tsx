import { useEffect, useState } from 'react';
import { ArrowUp, Folder, FolderGit2, HardDrive, Home, Loader2 } from 'lucide-react';
import type { BrowseResult } from '../../../shared/protocol.ts';
import { api } from '../lib/api.ts';
import { addRoot, openAddFolder, useStore } from '../store.ts';
import { Badge, Button, cx, Dialog, IconButton } from '../lib/ui.tsx';

/** Pick a folder on the server's disk (the browser can't give us real paths). */
export function AddFolderDialog() {
  const open = useStore((s) => s.addFolderOpen);
  const platform = useStore((s) => s.platform);
  const [cur, setCur] = useState<BrowseResult | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async (p: string | null) => {
    setBusy(true); setError(null);
    try {
      const r = await api.browse(p);
      setCur(r);
      setInput(r.path ?? '');
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: load the start page each time the dialog opens, not when go() is recreated
  useEffect(() => { if (open) go(null); }, [open]);

  const close = () => { openAddFolder(false); setCur(null); setError(null); };
  const target = input.trim() || cur?.path || '';
  const add = async () => {
    setBusy(true);
    const ok = await addRoot(target);
    setBusy(false);
    if (ok) close();
  };
  const isTop = cur && cur.path === null;

  return (
    <Dialog open={open} onClose={close} wide title="Add a folder"
      footer={<>
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={!target || busy} onClick={add}>Add this folder</Button>
      </>}>
      <p className="mb-3 text-[12.5px] text-muted">
        Pick the folder that holds your repos (or a single repo). Studio lists every git or OpenSpec repo up to 4 levels inside it.
      </p>
      <div className="flex items-center gap-1.5">
        <IconButton title="Up one folder" disabled={!cur?.parent && !cur?.path} onClick={() => go(cur?.parent ?? null)}><ArrowUp size={15} /></IconButton>
        <IconButton title="Start" onClick={() => go(null)}><Home size={15} /></IconButton>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(input); }}
          placeholder={platform === 'win32' ? 'C:\\Users\\you\\repos' : '~/repos'} spellCheck={false}
          className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-2.5 font-mono text-[12.5px] outline-none focus:border-accent" />
      </div>
      {error && <div className="mt-2 text-[12.5px] text-bad">{error}</div>}
      <div className="mt-2 h-72 overflow-y-auto rounded-lg border border-line">
        {!cur && <div className="flex h-full items-center justify-center text-muted"><Loader2 size={16} className="animate-spin" /></div>}
        {cur && !cur.entries.length && <div className="p-4 text-center text-[12.5px] text-muted">No sub-folders here.</div>}
        {cur?.entries.map((e) => (
          <button key={e.path} onClick={() => go(e.path)} onDoubleClick={() => { setInput(e.path); }}
            className={cx('flex w-full items-center gap-2 border-b border-line/60 px-3 py-1.5 text-left text-[13px] last:border-b-0 hover:bg-surface-2', busy && 'pointer-events-none opacity-60')}>
            {isTop ? (/^[A-Z]:\\$/.test(e.path) ? <HardDrive size={15} className="text-muted" /> : <Home size={15} className="text-muted" />)
              : e.repo ? <FolderGit2 size={15} className="text-accent" /> : <Folder size={15} className="text-muted" />}
            <span className="min-w-0 flex-1 truncate">{e.name}</span>
            {e.repo && <Badge tone="accent">repo</Badge>}
          </button>
        ))}
        {cur?.truncated && <div className="p-2 text-center text-[11.5px] text-muted">Showing the first 400 folders. Type a path to go further.</div>}
      </div>
    </Dialog>
  );
}
