// Runs the API server (tsx watch) and the web dev server (vite) side by side.
//
// Both children share this console (stdio: inherit) instead of writing into pipes:
// on Windows, `concurrently` + `tsx watch` could hang before the server listened.
// The CLIs are started with node directly, so there are no .cmd shims and no
// "Terminate batch job (Y/N)?" prompts on Ctrl+C.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Absolute path of a package's bin script, resolved from a workspace folder. */
function bin(fromDir, pkg, name = pkg) {
  const req = createRequire(path.join(fromDir, 'package.json'));
  const pkgJson = req.resolve(`${pkg}/package.json`);
  const { bin } = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
  return path.join(path.dirname(pkgJson), typeof bin === 'string' ? bin : bin[name]);
}

let stopping = false;
const serverDir = path.join(root, 'server');
const webDir = path.join(root, 'web');
const procs = [
  { name: 'server', cwd: serverDir, args: [bin(serverDir, 'tsx'), 'watch', 'src/index.ts'] },
  { name: 'web', cwd: webDir, args: [bin(webDir, 'vite')] },
].map(({ name, cwd, args }) => {
  const child = spawn(process.execPath, args, { cwd, stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`\n[${name}] exited (${signal ?? code}); stopping the other one`);
    stop(code ?? 1);
  });
  return child;
});

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of procs) {
    if (c.exitCode !== null || c.signalCode !== null) continue;
    // kill the whole tree: tsx watch and vite start their own children
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill('SIGTERM');
  }
  process.exit(code);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
