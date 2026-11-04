import type { CommentKind, ReviewComment } from '../../../shared/protocol.ts';

const KIND_LABEL: Record<CommentKind, string> = {
  comment: 'comment',
  change: 'change this',
  remove: 'remove this',
  question: 'question (answer it; edit only if the answer implies a change)',
  ok: 'approved (keep as is)',
};

const quoteBlock = (s: string) => s.split('\n').map((l) => `  > ${l}`).join('\n');

/**
 * Build the review prompt. `command` is the agent-specific invocation of the
 * OpenSpec update workflow, e.g. `/opsx:update add-auth`.
 */
export function composeReview(command: string, change: string, list: ReviewComment[]): string {
  const actionable = list.filter((c) => c.kind !== 'ok');
  const approved = list.filter((c) => c.kind === 'ok');
  const out: string[] = [
    command,
    '',
    `Review feedback for OpenSpec change "${change}". Revise the planning artifacts under openspec/changes/${change}/ to address every item below.`,
    'Rules:',
    '- Edit only what the feedback targets, and keep the artifacts coherent with each other (proposal, specs, design, tasks).',
    '- Do not write implementation code.',
    '- Items marked "approved" are confirmed by the reviewer: do not change them unless another item requires it.',
    '',
  ];
  const section = (title: string, items: ReviewComment[]) => {
    if (!items.length) return;
    out.push(`## ${title}`);
    for (const c of items) {
      const where = c.file ? `${c.file}${c.anchor ? ` › ${[...c.anchor.headingPath].join(' › ') || 'top'} (≈ line ${c.anchor.lineHint})` : ' (whole document)'}` : 'whole change';
      out.push(`- id: ${c.id}`, `  kind: ${KIND_LABEL[c.kind]}`, `  where: ${where}`);
      if (c.anchor?.exact) out.push('  quote:', quoteBlock(c.anchor.exact.trim()));
      if (c.body.trim()) out.push('  note:', quoteBlock(c.body.trim()));
    }
    out.push('');
  };
  section('Feedback', actionable);
  section('Approved', approved);
  if (actionable.length) {
    out.push(
      'When you are done, end your reply with exactly one fenced block reporting on every feedback id above:',
      '```review-result',
      JSON.stringify(actionable.map((c) => ({ id: c.id, status: 'addressed | partial | declined | answered', note: 'one short sentence' })), null, 0),
      '```',
      'Use "answered" for questions, "declined" (with the reason in note) when you disagree.',
    );
  }
  return out.join('\n');
}
