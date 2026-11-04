import { HelpCircle, MessageSquare, PenLine, ThumbsUp, Trash2 } from 'lucide-react';
import type { CommentKind, CommentStatus } from '../../../shared/protocol.ts';

export const KINDS: { id: CommentKind; label: string; short: string; icon: typeof PenLine; tone: string; presets: string[] }[] = [
  { id: 'change', label: 'Change this', short: 'Change', icon: PenLine, tone: 'text-accent',
    presets: ['Make this more specific', 'Add a scenario for the error case', 'Use measurable acceptance criteria', 'Split into smaller items', 'Keep existing behavior', 'Simplify'] },
  { id: 'question', label: 'Ask a question', short: 'Question', icon: HelpCircle, tone: 'text-info',
    presets: ['Why is this needed?', 'What happens on failure?', 'Is there a simpler alternative?', 'Who is affected?', 'How do we test this?'] },
  { id: 'remove', label: 'Remove this', short: 'Remove', icon: Trash2, tone: 'text-bad',
    presets: ['Out of scope', 'Duplicate', 'Not needed now'] },
  { id: 'comment', label: 'Comment', short: 'Comment', icon: MessageSquare, tone: 'text-fg-2',
    presets: ['Looks risky', 'Needs a design note', 'Consider backward compatibility', 'Check security impact'] },
  { id: 'ok', label: 'Looks good', short: 'Approve', icon: ThumbsUp, tone: 'text-ok', presets: [] },
];
export const kindOf = (k: CommentKind) => KINDS.find((x) => x.id === k)!;

export const STATUS_META: Record<CommentStatus, { label: string; tone: 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'info'; hl: string }> = {
  draft: { label: 'Draft', tone: 'warn', hl: 'c-draft' },
  sent: { label: 'With agent', tone: 'info', hl: 'c-sent' },
  addressed: { label: 'Addressed', tone: 'ok', hl: 'c-done' },
  partial: { label: 'Partly addressed', tone: 'warn', hl: 'c-done' },
  declined: { label: 'Declined', tone: 'bad', hl: 'c-done' },
  answered: { label: 'Answered', tone: 'info', hl: 'c-done' },
  unverified: { label: 'No report', tone: 'neutral', hl: 'c-done' },
  resolved: { label: 'Resolved', tone: 'neutral', hl: '' },
};

/** Statuses where the agent has acted and the reviewer should check. */
export const TO_CHECK = new Set<CommentStatus>(['addressed', 'partial', 'declined', 'answered', 'unverified']);
