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
  /** context window use and session cost, as the agent last reported them (ACP usage_update) */
  context: ContextUsage | null;
}

export interface ContextUsage { used: number; size: number; cost: { amount: number; currency: string } | null }

/** Tokens for one prompt turn, as the agent reported them (ACP PromptResponse.usage; optional per agent). */
export interface TurnUsage {
  input: number;
  output: number;
  cacheRead: number | null;
  cacheWrite: number | null;
  thought: number | null;
  total: number;
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
  /** `openspec validate` result; null when the CLI gave no answer */
  validation: ChangeValidation | null;
  /** artifacts written before something they depend on changed */
  stale: StaleArtifact[];
  /** the first unchecked task in tasks.md, e.g. "1.2 Register the route"; null when none */
  nextTask: string | null;
}

/** `id` (e.g. "tasks") may be out of date: `because` (e.g. ["proposal"]) changed after it was written. */
export interface StaleArtifact { id: string; because: string[] }

export interface ValidationIssue { level: 'ERROR' | 'WARNING' | 'INFO'; path: string; message: string }
export interface ChangeValidation { valid: boolean; issues: ValidationIssue[] }

/** A capability's main spec: openspec/specs/<name>/spec.md */
export interface SpecSummary { name: string; file: string; requirements: number }

/** An archived change (openspec/changes/archive/<name>) with the review history Studio kept for it. */
export interface ArchivedChange {
  name: string;        // folder name, e.g. 2026-11-06-add-notes
  change: string;      // the change's name before archiving, e.g. add-notes
  files: string[];     // artifacts, relative to the archived folder
  comments: ReviewComment[];
  rounds: ReviewRound[];
  /** history not shown because an active change has the same name again */
  historyHidden: boolean;
}

/** The repo's git state (GET /api/git). Studio only reads it unless you click a git action. */
export interface GitInfo {
  /** false: not a git repo (or git is not installed) */
  repo: boolean;
  /** checked-out branch; null when HEAD is detached */
  branch: string | null;
  /** the branch changes should not land on directly: origin's default, else main/master */
  base: string | null;
  onBase: boolean;
}

/** Studio's version against the newest one on npm (GET /api/update). */
export interface UpdateInfo {
  current: string;
  /** null: not checked (disabled) or the registry could not be reached */
  latest: string | null;
  newer: boolean;
  /** how this copy was installed, which decides the update command */
  install: 'npm' | 'clone';
  command: string;
  disabled: boolean;
}

export type ChangeStage = 'draft' | 'review' | 'ready' | 'applying' | 'done';

export type LifecycleAction = 'propose' | 'explore' | 'update' | 'apply' | 'verify' | 'sync' | 'archive';

/** OpenSpec workflows outside the core profile that Studio can drive when a repo has them installed. */
export type OptionalWorkflow = 'verify';

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
  | { kind: 'turn_end'; stopReason: string; usage?: TurnUsage }
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
