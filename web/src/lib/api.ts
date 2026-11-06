import type { AgentInfo, BrowseResult, ChangeSummary, SpecSummary, LifecycleAction, ReviewComment, ReviewRound, Anchor, CommentKind, Workspace } from '../../../shared/protocol.ts';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as any).error || `${r.status} ${r.statusText}`);
  return data as T;
}
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

export const api = {
  config: () => req<{ platform: string; defaultAgent: string; agents: AgentInfo[] }>('GET', '/api/config'),
  repos: (refresh = false) => req<Workspace>('GET', `/api/repos${refresh ? '?refresh=1' : ''}`),
  addRoot: (path: string) => req<Workspace>('POST', '/api/roots', { path }),
  removeRoot: (path: string) => req<Workspace>('DELETE', '/api/roots', { path }),
  browse: (path?: string | null) => req<BrowseResult>('GET', `/api/browse${path ? `?${q({ path })}` : ''}`),
  init: (repo: string, agent: string) => req<{ ok: boolean; output: string }>('POST', '/api/init', { repo, agent }),
  changes: (repo: string) => req<{ active: ChangeSummary[]; archived: string[]; specs: SpecSummary[] }>('GET', `/api/changes?${q({ repo })}`),
  file: (repo: string, path: string) => req<{ content: string }>('GET', `/api/file?${q({ repo, path })}`),
  action: (repo: string, action: LifecycleAction, change?: string, text?: string) =>
    req<{ ok: true }>('POST', '/api/action', { repo, action, change, text }),
  review: (repo: string, change: string) => req<{ comments: ReviewComment[]; rounds: ReviewRound[] }>('GET', `/api/review?${q({ repo, change })}`),
  addComment: (c: { repo: string; change: string; file: string | null; anchor: Anchor | null; kind: CommentKind; body: string }) =>
    req<ReviewComment>('POST', '/api/comments', c),
  patchComment: (id: string, patch: Partial<Pick<ReviewComment, 'body' | 'kind' | 'status'>>) => req<ReviewComment>('PATCH', `/api/comments/${id}`, patch),
  deleteComment: (id: string) => req<{ ok: true }>('DELETE', `/api/comments/${id}`),
  sendReview: (repo: string, change: string) => req<ReviewRound>('POST', '/api/review/send', { repo, change }),
  closeRound: (repo: string, change: string) => req<{ ok: true }>('POST', '/api/review/close', { repo, change }),
};
