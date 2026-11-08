#!/usr/bin/env node
// `openspec-studio` command of the npm package.
//
//   openspec-studio [--port 3940] [--host 127.0.0.1]   start Studio (built web app + API on one port)
//   openspec-studio demo-repo [folder] [--tools claude] create the demo repo (see README)
//
// The server is TypeScript run through tsx, the same way `npm start` runs it in a clone.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const argv = process.argv.slice(2);

const HELP = `OpenSpec Studio ${version}: review OpenSpec changes like a doc, then let your agent build them.

Usage:
  openspec-studio [options]                     start Studio and print its URL
  openspec-studio demo-repo [folder] [--tools claude|codebuddy|codex]
                                                create a small demo repo to try it on

Options:
  -p, --port <n>   port (default 3940, or $PORT)
  --host <addr>    address to listen on (default 127.0.0.1, or $HOST). The agent can run
                   code on this machine: keep it local unless you know why not.
  -v, --version    print the version
  -h, --help       show this help

Environment:
  STUDIO_DATA      data folder (default ~/.openspec-studio)
  DEFAULT_AGENT    agent selected by default: codebuddy, claude or codex
  OPENSPEC_BIN     the openspec CLI to run (default: openspec on PATH)
  STUDIO_NO_UPDATE_CHECK=1   don't check npm for a newer Studio (once a day)

Docs: https://github.com/baabullah/openspec-studio`;

if (argv[0] === 'demo-repo') {
  process.argv = [process.argv[0], path.join(root, 'scripts', 'demo-repo.mjs'), ...argv.slice(1)];
  await import(pathToFileURL(path.join(root, 'scripts', 'demo-repo.mjs')).href);
} else {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v) { console.error(`${a} needs a value`); process.exit(1); }
      return v;
    };
    if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
    else if (a === '-v' || a === '--version') { console.log(version); process.exit(0); }
    else if (a === '-p' || a === '--port') process.env.PORT = value();
    else if (a.startsWith('--port=')) process.env.PORT = a.slice(7);
    else if (a === '--host') process.env.HOST = value();
    else if (a.startsWith('--host=')) process.env.HOST = a.slice(7);
    else { console.error(`unknown argument: ${a}\n\n${HELP}`); process.exit(1); }
  }
  if (!fs.existsSync(path.join(root, 'web', 'dist', 'index.html'))) {
    console.error('The web app is not built (web/dist is missing). In a clone, run `npm run build` first.');
    process.exit(1);
  }
  // node:sqlite is stable enough for Studio; don't greet every start with Node's "experimental" warning
  const emitWarning = process.emitWarning;
  process.emitWarning = (w, ...rest) => {
    if (String(w?.message ?? w).includes('SQLite is an experimental feature')) return;
    return emitWarning.call(process, w, ...rest);
  };
  const { register } = await import('tsx/esm/api');
  register();
  await import(pathToFileURL(path.join(root, 'server', 'src', 'index.ts')).href);
}
