import fs from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { killTree, spawnCmd } from '../proc.ts';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import type { AgentEvent, ConfigOption, LoggedEvent, SessionState, SessionStatus } from '../../../shared/protocol.ts';
import type { AgentDef } from '../agents.ts';
import { events, sessions } from '../db.ts';
import { safeResolve } from '../repos.ts';

export interface TurnResult { stopReason: string; reply: string }
type Listener = { onEvent(repo: string, e: LoggedEvent): void; onState(repo: string, s: SessionState | null): void };

interface Pending { kind: 'permission' | 'elicitation'; resolve: (v: any) => void; cancelValue: any }

function flattenConfig(raw: any[] | null | undefined): ConfigOption[] {
  return (raw ?? []).map((o) => ({
    id: o.id, name: o.name, description: o.description, type: o.type, currentValue: o.currentValue,
    options: Array.isArray(o.options)
      ? o.options.flatMap((x: any) => (Array.isArray(x.options) ? x.options : [x])).map((x: any) => ({ value: x.value, name: x.name, description: x.description }))
      : undefined,
  }));
}

/** Corporate shells often only export lowercase proxy vars; mirror them so every HTTP client sees them. */
function agentEnv(extra?: Record<string, string>) {
  const env: Record<string, string | undefined> = { ...process.env, ...extra };
  for (const k of ['no_proxy', 'http_proxy', 'https_proxy']) if (env[k] && !env[k.toUpperCase()]) env[k.toUpperCase()] = env[k];
  return env;
}

export class AgentSession {
  status: SessionStatus = 'starting';
  sessionId: string | null = null;
  configOptions: ConfigOption[] = [];
  error?: string;
  private proc: ChildProcess;
  private conn: acp.ClientConnection;
  private pending = new Map<string, Pending>();
  private nextInteraction = 1;
  private replaying = false;
  private reply = '';
  private stderrTail: string[] = [];

  constructor(
    readonly repo: string,
    readonly cwd: string,
    readonly agent: AgentDef,
    private emit: (e: AgentEvent) => void,
    private changed: () => void,
  ) {
    this.proc = spawnCmd(agent.cmd, agent.args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: agentEnv(agent.env) });
    this.proc.stderr!.on('data', (d) => {
      this.stderrTail.push(...String(d).split('\n').filter(Boolean));
      this.stderrTail = this.stderrTail.slice(-20);
    });
    this.proc.on('error', (e) => this.fail(`Cannot start ${agent.label} (${agent.cmd}): ${e.message}`));
    this.proc.on('exit', (code) => {
      this.cancelPending();
      if (this.status !== 'error') {
        this.status = 'exited';
        if (code) this.emit({ kind: 'notice', level: 'error', text: `${agent.label} exited (code ${code}).\n${this.stderrTail.join('\n')}` });
      }
      this.changed();
    });

    const stream = acp.ndJsonStream(Writable.toWeb(this.proc.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(this.proc.stdout!) as ReadableStream<Uint8Array>);
    this.conn = acp.client({ name: 'openspec-studio' })
      .onNotification('session/update', ({ params }) => this.onUpdate(params.update))
      .onRequest('session/request_permission', ({ params }) => this.ask('permission', {
        toolCall: params.toolCall,
        options: params.options.map((o) => ({ optionId: o.optionId, name: o.name, kind: o.kind })),
      }, { outcome: { outcome: 'cancelled' } }))
      .onRequest('elicitation/create', ({ params }) => {
        const p = params as any;
        if (p.mode !== 'form') return { action: 'decline' } as any;
        return this.ask('elicitation', { message: p.message, schema: p.requestedSchema }, { action: 'cancel' });
      })
      .onRequest('fs/read_text_file', ({ params }) => {
        const abs = this.sandbox(params.path);
        let content = fs.readFileSync(abs, 'utf8');
        if (params.line || params.limit) {
          const lines = content.split('\n');
          const from = Math.max(0, (params.line ?? 1) - 1);
          content = lines.slice(from, params.limit ? from + params.limit : undefined).join('\n');
        }
        return { content };
      })
      .onRequest('fs/write_text_file', ({ params }) => {
        const abs = this.sandbox(params.path);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, params.content);
        this.emit({ kind: 'file_write', path: path.relative(this.cwd, abs) });
        return {};
      })
      .connect(stream);
  }

  private sandbox(p: string): string {
    const abs = safeResolve(this.cwd, p);
    if (!abs) throw new acp.RequestError(-32602, `path outside workspace: ${p}`);
    return abs;
  }

  private fail(msg: string) {
    this.status = 'error';
    this.error = msg;
    this.emit({ kind: 'notice', level: 'error', text: msg });
    this.changed();
  }

  /** Park an agent request until the browser answers it. */
  private ask(kind: Pending['kind'], payload: any, cancelValue: any): Promise<any> {
    const id = `${kind[0]}${this.nextInteraction++}`;
    return new Promise((resolve) => {
      this.pending.set(id, { kind, resolve, cancelValue });
      this.emit({ kind, id, ...payload } as AgentEvent);
      this.changed();
    });
  }

  private settle(id: string, value: any, summary: string) {
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    p.resolve(value);
    this.emit({ kind: 'interaction_resolved', id, summary });
    this.changed();
    return true;
  }

  private cancelPending() {
    for (const id of [...this.pending.keys()]) this.settle(id, this.pending.get(id)!.cancelValue, 'cancelled');
  }

  private onUpdate(u: any) {
    if (u.sessionUpdate === 'config_option_update') { this.configOptions = flattenConfig(u.configOptions); this.changed(); return; }
    if (this.replaying) return; // history from session/load is already in our event log
    if (['available_commands_update', 'usage_update', 'session_info_update', 'current_mode_update'].includes(u.sessionUpdate)) return;
    if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') this.reply += u.content.text;
    this.emit({ kind: 'update', update: u });
  }

  async start(resume: boolean) {
    try {
      const init: any = await this.conn.agent.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false, elicitation: { form: {} } },
        clientInfo: { name: 'openspec-studio', version: '0.1.0' },
      } as any);
      const stored = sessions.get(this.repo, this.agent.id);
      let res: any = null;
      if (resume && stored && init.agentCapabilities?.loadSession) {
        this.replaying = true;
        try {
          res = await this.conn.agent.request('session/load', { sessionId: stored, cwd: this.cwd, mcpServers: [] });
          this.sessionId = stored;
        } catch { res = null; } finally { this.replaying = false; }
      }
      if (!this.sessionId) {
        res = await this.conn.agent.request('session/new', { cwd: this.cwd, mcpServers: [] });
        this.sessionId = res.sessionId;
        sessions.set(this.repo, this.agent.id, this.sessionId!);
        events.clear(this.repo);
        this.emit({ kind: 'notice', level: 'info', text: `New ${this.agent.label} session started.` });
      } else {
        this.emit({ kind: 'notice', level: 'info', text: `Resumed ${this.agent.label} session.` });
      }
      if (res?.configOptions) this.configOptions = flattenConfig(res.configOptions);
      this.status = 'ready';
      this.changed();
    } catch (e: any) {
      const msg = String(e?.message || e);
      this.fail(/auth/i.test(msg)
        ? `${this.agent.label} needs login. Run \`${this.agent.cmd}\` once in a terminal and sign in, then reconnect.\n(${msg})`
        : `Failed to start ${this.agent.label}: ${msg}\n${this.stderrTail.join('\n')}`);
    }
  }

  async prompt(text: string, label?: string): Promise<TurnResult> {
    if (this.status !== 'ready') throw new Error(this.status === 'busy' ? 'Agent is still working' : 'Agent is not ready');
    this.status = 'busy';
    this.reply = '';
    this.emit({ kind: 'user', text, label });
    this.changed();
    let stopReason = 'error';
    try {
      const r = await this.conn.agent.request('session/prompt', { sessionId: this.sessionId!, prompt: [{ type: 'text', text }] });
      stopReason = r.stopReason;
    } catch (e: any) {
      this.emit({ kind: 'notice', level: 'error', text: String(e?.message || e) });
    } finally {
      if (this.status === 'busy') this.status = 'ready';
      this.cancelPending();
      this.emit({ kind: 'turn_end', stopReason });
      this.changed();
    }
    return { stopReason, reply: this.reply };
  }

  cancel() {
    if (this.sessionId) this.conn.agent.notify('session/cancel', { sessionId: this.sessionId }).catch(() => {});
    this.cancelPending();
  }

  answerPermission(id: string, optionId: string | null, label: string) {
    return this.settle(id, { outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } }, label);
  }

  answerElicitation(id: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, unknown>) {
    const summary = action === 'accept' ? Object.values(content ?? {}).map((v) => (Array.isArray(v) ? v.join(', ') : String(v))).join(' · ') || 'answered' : action;
    return this.settle(id, action === 'accept' ? { action, content: content ?? {} } : { action }, summary);
  }

  async setConfig(configId: string, value: string | boolean) {
    // ACP: boolean options must be tagged with type "boolean"; select options send the value id
    const params = typeof value === 'boolean' ? { sessionId: this.sessionId!, configId, type: 'boolean' as const, value } : { sessionId: this.sessionId!, configId, value };
    const r: any = await this.conn.agent.request('session/set_config_option', params);
    if (r?.configOptions) this.configOptions = flattenConfig(r.configOptions);
    this.changed();
  }

  state(): SessionState {
    return {
      repo: this.repo, agent: this.agent.id, status: this.status, sessionId: this.sessionId,
      configOptions: this.configOptions, pendingInteractions: this.pending.size, error: this.error,
    };
  }

  stop() {
    this.cancelPending();
    this.conn.close();
    killTree(this.proc);
  }
}

/** One live agent session per repo, owned by the server so it survives browser reloads. */
export class Hub {
  private sessions = new Map<string, AgentSession>();
  constructor(private listener: Listener) {}

  get(repo: string) { return this.sessions.get(repo) ?? null; }

  repos() { return [...this.sessions.keys()]; }

  emit(repo: string, e: AgentEvent) {
    this.listener.onEvent(repo, events.append(repo, e));
  }

  async start(repo: string, cwd: string, agent: AgentDef, resume = true) {
    this.stop(repo);
    const s = new AgentSession(repo, cwd, agent, (e) => this.emit(repo, e), () => {
      if (this.sessions.get(repo) === s) this.listener.onState(repo, s.state());
    });
    this.sessions.set(repo, s);
    this.listener.onState(repo, s.state());
    await s.start(resume);
    return s;
  }

  stop(repo: string) {
    const s = this.sessions.get(repo);
    if (!s) return;
    this.sessions.delete(repo);
    s.stop();
    this.listener.onState(repo, null);
  }

  stopAll() { for (const r of [...this.sessions.keys()]) this.stop(r); }
}
