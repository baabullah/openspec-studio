import { useState } from 'react';
import { GitBranch, GitCommitHorizontal } from 'lucide-react';
import type { GitPendingFile } from '../../../shared/protocol.ts';
import { commitChange, useStore } from '../store.ts';
import { Button, cx, Dialog, Spinner } from '../lib/ui.tsx';

const MARK: Record<GitPendingFile['status'], { letter: string; tone: string; label: string }> = {
  added: { letter: 'A', tone: 'text-ok', label: 'new' },
  modified: { letter: 'M', tone: 'text-warn', label: 'modified' },
  deleted: { letter: 'D', tone: 'text-bad', label: 'deleted' },
  renamed: { letter: 'R', tone: 'text-info', label: 'renamed' },
};

/**
 * "Commit N files…" for the open change (or archived change): shows exactly which
 * files go in, lets you leave some out and edit the message. Only files of this
 * change are ever listed; nothing else in the repo is touched.
 */
export function CommitButton({ defaultMessage, what }: { defaultMessage: string; what: string }) {
  const pending = useStore((s) => s.git?.pending ?? []);
  const git = useStore((s) => s.git);
  const busy = useStore((s) => s.session?.status === 'busy');
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(defaultMessage);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  if (!git?.repo || !pending.length) return null;
  const files = pending.filter((f) => !skip.has(f.path));
  const toggle = (p: string) => setSkip((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const show = () => { setMessage(defaultMessage); setSkip(new Set()); setOpen(true); };
  const go = async () => {
    setSaving(true);
    const ok = await commitChange(files.map((f) => f.path), message.trim());
    setSaving(false);
    if (ok) setOpen(false);
  };
  return (
    <>
      <Button size="sm" disabled={busy} onClick={show}
        title={busy ? 'Wait for the agent to finish' : `Commit the uncommitted files of ${what} (and nothing else)`}>
        <GitCommitHorizontal size={14} /> Commit {pending.length} file{pending.length === 1 ? '' : 's'}…
      </Button>
      <Dialog open={open} onClose={() => !saving && setOpen(false)} title={`Commit ${what}`} wide
        footer={<>
          <Button variant="ghost" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" disabled={saving || !files.length || !message.trim()} onClick={go}>
            {saving ? <Spinner /> : <GitCommitHorizontal size={14} />} Commit {files.length} file{files.length === 1 ? '' : 's'}
          </Button>
        </>}>
        <p className="mb-2 flex items-center gap-1.5 text-[12.5px] text-muted">
          <GitBranch size={13} className={git.onBase ? 'text-warn' : ''} />
          <span>On <b className="font-mono font-medium text-fg-2">{git.branch ?? 'detached HEAD'}</b>{git.onBase && ', the main branch'}. Only these files go in; anything else you have staged stays staged.</span>
        </p>
        <ul className="max-h-[38vh] overflow-y-auto rounded-xl border border-line bg-bg py-1">
          {pending.map((f) => (
            <li key={f.path}>
              <label className="flex cursor-pointer items-center gap-2 px-3 py-1 text-[12.5px] hover:bg-surface-2">
                <input type="checkbox" checked={!skip.has(f.path)} onChange={() => toggle(f.path)} />
                <span className={cx('w-3 font-mono font-semibold', MARK[f.status].tone)} title={MARK[f.status].label}>{MARK[f.status].letter}</span>
                <span className={cx('min-w-0 flex-1 truncate font-mono', skip.has(f.path) && 'text-muted line-through')} title={f.path}>{f.path}</span>
              </label>
            </li>
          ))}
        </ul>
        <label className="mt-3 block text-[12px] font-medium text-fg-2" htmlFor="commit-message">Message</label>
        <textarea id="commit-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && files.length && message.trim()) go(); }}
          className="mt-1 w-full resize-none rounded-xl border border-line bg-bg px-3 py-2 font-mono text-[12.5px] outline-none focus:border-accent" />
      </Dialog>
    </>
  );
}
