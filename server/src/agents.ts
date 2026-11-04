import fs from 'node:fs';
import path from 'node:path';
import type { AgentInfo, LifecycleAction } from '../../shared/protocol.ts';
import { DATA_DIR } from './repos.ts';

export interface AgentDef extends AgentInfo {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
  /** How this agent invokes an OpenSpec workflow. */
  command: (action: LifecycleAction, args: string) => string;
}

// Verified against the files `openspec init --tools codebuddy,claude,codex`
// generates (openspec 1.14): CodeBuddy and Claude get `/opsx:<cmd>` slash
// commands; Codex only gets skills, invoked as `$openspec-<skill>`.
const SKILL: Record<LifecycleAction, string> = {
  propose: 'openspec-propose',
  explore: 'openspec-explore',
  update: 'openspec-update-change',
  apply: 'openspec-apply-change',
  sync: 'openspec-sync-specs',
  archive: 'openspec-archive-change',
};
const slash = (a: LifecycleAction, args: string) => `/opsx:${a} ${args}`.trim();
const skill = (a: LifecycleAction, args: string) => `$${SKILL[a]} ${args}`.trim();

const BUILTIN: AgentDef[] = [
  { id: 'codebuddy', label: 'CodeBuddy', openspecTool: 'codebuddy', cmd: 'codebuddy', args: ['--acp'], command: slash },
  { id: 'claude', label: 'Claude Code', openspecTool: 'claude', cmd: 'npx', args: ['-y', '@agentclientprotocol/claude-agent-acp@0.100.0'], command: slash },
  { id: 'codex', label: 'Codex', openspecTool: 'codex', cmd: 'npx', args: ['-y', '@agentclientprotocol/codex-acp@2.5.0'], command: skill },
];

/**
 * Extra / overriding agents from ~/.openspec-studio/agents.json:
 * [{ "id": "gemini", "label": "Gemini", "cmd": "gemini", "args": ["--experimental-acp"],
 *    "openspecTool": "gemini", "style": "slash" | "skill" | "/custom:{action} {args}" }]
 */
function loadCustom(): AgentDef[] {
  const file = path.join(DATA_DIR, 'agents.json');
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (Array.isArray(raw) ? raw : []).filter((a) => a?.id && a?.cmd).map((a): AgentDef => {
      const style: string = a.style || 'slash';
      const command = style === 'slash' ? slash : style === 'skill' ? skill
        : (act: LifecycleAction, args: string) => style.replace('{action}', act).replace('{skill}', SKILL[act]).replace('{args}', args).trim();
      return { id: String(a.id), label: String(a.label || a.id), openspecTool: a.openspecTool ?? null, cmd: String(a.cmd), args: (a.args || []).map(String), env: a.env, command };
    });
  } catch (e) {
    console.warn('agents.json ignored:', (e as Error).message);
    return [];
  }
}

export function agents(): AgentDef[] {
  const map = new Map(BUILTIN.map((a) => [a.id, a]));
  for (const a of loadCustom()) map.set(a.id, a);
  return [...map.values()];
}

export const getAgent = (id: string) => agents().find((a) => a.id === id) ?? null;
export const DEFAULT_AGENT = process.env.DEFAULT_AGENT || 'codebuddy';
