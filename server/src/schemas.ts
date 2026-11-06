// Shapes of what the browser may send: REST bodies and WebSocket messages.
// Anything else is rejected with a 400 / an error message instead of being
// cast and trusted. Over-long text is cut, not rejected, as before.

import { z } from 'zod';
import type { ClientMsg } from '../../shared/protocol.ts';

const capped = (max: number) => z.string().transform((s) => s.slice(0, max));
const repo = z.string().min(1);

export const LIFECYCLE = ['propose', 'explore', 'update', 'apply', 'sync', 'archive'] as const;
export const COMMENT_KINDS = ['comment', 'change', 'remove', 'question', 'ok'] as const;

export const rootBody = z.object({ path: z.string().default('') });
export const initBody = z.object({ repo, agent: z.string() });
export const actionBody = z.object({
  repo,
  action: z.enum(LIFECYCLE),
  change: z.string().optional(),
  text: capped(4000).optional(),
});
export const changeBody = z.object({ repo, change: z.string() });

const anchor = z.object({
  exact: z.string(),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  headingPath: z.array(z.string()).optional(),
  lineHint: z.number().optional(),
});
export const commentCreate = changeBody.extend({
  file: z.string().nullish(),
  kind: z.enum(COMMENT_KINDS).optional(),
  body: capped(8000).optional(),
  anchor: anchor.nullish(),
});
export const commentPatch = z.object({
  body: capped(8000).optional(),
  kind: z.enum(COMMENT_KINDS).optional(),
  status: z.enum(['resolved', 'draft']).optional(),
});

export const clientMsg = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), repo }),
  z.object({ type: z.literal('start'), repo, agent: z.string(), resume: z.boolean().optional() }),
  z.object({ type: z.literal('stop'), repo }),
  z.object({ type: z.literal('prompt'), repo, text: capped(20000) }),
  z.object({ type: z.literal('cancel'), repo }),
  z.object({ type: z.literal('permission'), repo, id: z.string(), optionId: z.string().nullable(), label: z.string().optional() }),
  z.object({
    type: z.literal('elicitation'), repo, id: z.string(),
    action: z.enum(['accept', 'decline', 'cancel']), content: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({ type: z.literal('set_config'), repo, configId: z.string(), value: z.union([z.string(), z.boolean()]) }),
]) satisfies z.ZodType<ClientMsg>;

/** One-line, user-facing summary of what was wrong. */
export const describeIssues = (e: z.ZodError) =>
  e.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ');

/** Parse or throw an error the HTTP error handler turns into a 400. */
export function parseOr400<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw Object.assign(new Error(`invalid request: ${describeIssues(r.error)}`), { status: 400 });
  return r.data;
}
