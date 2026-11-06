import { useState } from 'react';
import { ChevronDown, ChevronRight, ShieldAlert, Wrench } from 'lucide-react';
import type { ChangeSummary } from '../../../shared/protocol.ts';
import { runAction, useStore } from '../store.ts';
import { Button, cx } from '../lib/ui.tsx';

export const issueCounts = (c: ChangeSummary) => {
  const issues = c.validation?.issues ?? [];
  return { errors: issues.filter((i) => i.level === 'ERROR').length, warnings: issues.filter((i) => i.level !== 'ERROR').length };
};

/** `openspec validate` findings for the open change, with a one-click request to fix them. */
export function ValidationPanel({ c }: { c: ChangeSummary }) {
  const [open, setOpen] = useState(false);
  const busy = useStore((s) => s.session?.status === 'busy');
  const issues = c.validation?.issues ?? [];
  if (!issues.length) return null;
  const { errors, warnings } = issueCounts(c);
  const summary = [errors && `${errors} error${errors > 1 ? 's' : ''}`, warnings && `${warnings} warning${warnings > 1 ? 's' : ''}`].filter(Boolean).join(', ');
  const fix = () => runAction('update', c.name,
    `Fix these \`openspec validate\` findings in the change's artifacts, then make sure \`openspec validate ${c.name}\` passes:\n${issues.map((i) => `- ${i.level} ${i.path}: ${i.message}`).join('\n')}`);
  return (
    <div className={cx('border-b px-6 py-2 text-[13px]', errors ? 'border-bad/30 bg-bad-soft' : 'border-warn/30 bg-warn-soft')}>
      <div className="flex items-center gap-2">
        <ShieldAlert size={15} className={errors ? 'text-bad' : 'text-warn'} />
        <button type="button" onClick={() => setOpen(!open)} className="flex flex-1 items-center gap-1 text-left">
          <span className="font-medium">OpenSpec validation: {summary}</span>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <Button size="sm" disabled={busy} onClick={fix} title="Ask the agent to fix these findings (update workflow)"><Wrench size={13} /> Ask agent to fix</Button>
      </div>
      {open && (
        <ul className="mt-1.5 space-y-1 pl-6">
          {issues.map((i, n) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a static list, rebuilt with each validation
            <li key={n} className="flex gap-2">
              <span className={cx('shrink-0 font-mono text-[11px] font-semibold', i.level === 'ERROR' ? 'text-bad' : 'text-warn')}>{i.level}</span>
              <span className="shrink-0 font-mono text-[12px] text-fg-2">{i.path}</span>
              <span>{i.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
