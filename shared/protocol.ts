// Types shared by server and web. Keep this file dependency-free.

export type AgentId = string;

export interface AgentInfo {
  id: AgentId;
  label: string;
  openspecTool: string | null; // id passed to `openspec init --tools`
}

export interface RepoInfo {
  id: string; // absolute path; the repo's identity everywhere
  name: string; // folder name
  root: string; // the workspace folder it was found in
  rel: string; // path relative to that folder ('' when the folder is the repo)
  openspec: boolean;
  session: SessionState | null;
}

/** A folder the studio scans for repos (chosen in the UI, or REPOS_ROOT). */
export interface RootInfo { path: string; fromEnv: boolean; truncated: boolean }

export interface Workspace { roots: RootInfo[]; repos: RepoInfo[] }

export interface BrowseResult {
  path: string | null; // null = starting places (home, folders, drives)
  parent: string | null;
  entries: { name: string; path: string; repo: boolean }[];
  truncated: boolean;
}

export type SessionStatus = 'starting' | 'ready' | 'busy' | 'exited' | 'error';

export interface ConfigSelectOption { value: string; name: string; description?: string | null }
export interface ConfigOption {
  id: string;
  name: string;
  description?: string | null;
  type: 'select' | 'boolean' | string;
  currentValue: string | boolean;
  options?: ConfigSelectOption[]; // flattened (groups expanded)
}

export interface SessionState {
  repo: string;
  agent: AgentId;
  status: SessionStatus;
  sessionId: string | null;
  configOptions: ConfigOption[];
  pendingInteractions: number;
  error?: string;
}

// ---- OpenSpec ---------------------------------------------------------------
export interface ArtifactStatus { id: string; outputPath: string; status: string; requires: string[] }

export interface ChangeSummary {
  name: string;
  completedTasks: number;
  totalTasks: number;
  lastModified: string;
  status: string; // openspec list status, e.g. "in-progress", "complete", "no-tasks"
  artifacts: ArtifactStatus[];
  isPlanningComplete: boolean;
  isComplete: boolean;
  files: string[]; // markdown files relative to the change dir
  stage: ChangeStage;
  openComments: number;
}

export type ChangeStage = 'draft' | 'review' | 'ready' | 'applying' | 'done';

export type LifecycleAction = 'propose' | 'explore' | 'update' | 'apply' | 'sync' | 'archive';

// ---- Review -----------------------------------------------------------------
export type CommentKind = 'comment' | 'change' | 'remove' | 'question' | 'ok';

export type CommentStatus =
  | 'draft'      // not yet sent
  | 'sent'       // in a running review round
  | 'addressed' | 'partial' | 'declined' | 'answered'
  | 'unverified' // agent did not report on it
  | 'resolved';  // user accepted

export interface Anchor {
  exact: string;
  prefix: string;
  suffix: string;
  headingPath: string[];
  lineHint: number;
}

export interface ReviewComment {
  id: string;
  repo: string;
  change: string;
  file: string | null;     // relative to change dir; null = whole change
  anchor: Anchor | null;   // null = whole document
  kind: CommentKind;
  body: string;
  status: CommentStatus;
  agentNote: string | null;
  roundId: string | null;
  orphaned: boolean;
  createdAt: string;
}

export interface FileDiff { file: string; before: string; after: string }

export interface ReviewRound {
  id: string;
  repo: string;
  change: string;
  status: 'running' | 'done';
  createdAt: string;
  commentIds: string[];
  resultParsed: boolean;
  stopReason: string | null;
  diffs: FileDiff[];
}

// ---- WebSocket --------------------------------------------------------------
// Everything the agent produces (and what the user sent) is an event in a
// per-repo log, so a reconnecting browser can replay it.
export type AgentEvent =
  | { kind: 'user'; text: string; label?: string }
  | { kind: 'update'; update: any }
  | { kind: 'permission'; id: string; toolCall: any; options: { optionId: string; name: string; kind: string }[] }
  | { kind: 'elicitation'; id: string; message: string; schema: any }
  | { kind: 'interaction_resolved'; id: string; summary: string }
  | { kind: 'turn_end'; stopReason: string }
  | { kind: 'file_write'; path: string }
  | { kind: 'notice'; level: 'info' | 'error'; text: string };

export interface LoggedEvent { seq: number; at: string; event: AgentEvent }

export type ServerMsg =
  | { type: 'session'; repo: string; session: SessionState | null }
  | { type: 'event'; repo: string; entry: LoggedEvent }
  | { type: 'replay'; repo: string; entries: LoggedEvent[] }
  | { type: 'artifacts_changed'; repo: string; path: string }
  | { type: 'review_changed'; repo: string; change: string }
  | { type: 'error'; message: string };

export type ClientMsg =
  | { type: 'subscribe'; repo: string }
  | { type: 'start'; repo: string; agent: AgentId; resume?: boolean }
  | { type: 'stop'; repo: string }
  | { type: 'prompt'; repo: string; text: string }
  | { type: 'cancel'; repo: string }
  | { type: 'permission'; repo: string; id: string; optionId: string | null; label?: string }
  | { type: 'elicitation'; repo: string; id: string; action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }
  | { type: 'set_config'; repo: string; configId: string; value: string | boolean };
