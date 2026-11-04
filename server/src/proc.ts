// Cross-platform process helpers. On Windows, CLIs installed by npm (npx,
// openspec, codebuddy, ...) are .cmd shims that Node cannot spawn directly;
// cross-spawn resolves PATHEXT and escapes arguments for cmd.exe.

import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import crossSpawn from 'cross-spawn';

export const isWindows = process.platform === 'win32';

export function spawnCmd(cmd: string, args: string[], opts: SpawnOptions): ChildProcess {
  return crossSpawn(cmd, args, { windowsHide: true, ...opts });
}

/** Kill a process and its children (on Windows a .cmd shim leaves the real process running otherwise). */
export function killTree(p: ChildProcess) {
  if (!p.pid || p.exitCode !== null || p.signalCode !== null) return;
  if (isWindows) nodeSpawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => p.kill());
  else p.kill();
}

export interface RunResult { ok: boolean; stdout: string; stderr: string }

/** Run a command to completion and collect its output (execFile replacement that handles .cmd shims). */
export function runCmd(cmd: string, args: string[], opts: { cwd: string; timeout: number; env?: NodeJS.ProcessEnv; maxBuffer?: number }): Promise<RunResult> {
  const max = opts.maxBuffer ?? 16 * 1024 * 1024;
  return new Promise((resolve) => {
    let stdout = '', stderr = '', done = false;
    const p = spawnCmd(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (ok: boolean, extra = '') => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok, stdout, stderr: stderr + extra });
    };
    const timer = setTimeout(() => { killTree(p); finish(false, `\n${cmd}: timed out after ${opts.timeout} ms`); }, opts.timeout);
    p.stdout!.on('data', (d) => { if (stdout.length < max) stdout += d; });
    p.stderr!.on('data', (d) => { if (stderr.length < max) stderr += d; });
    p.on('error', (e) => finish(false, `\n${cmd}: ${e.message}`));
    p.on('close', (code) => finish(code === 0));
  });
}
