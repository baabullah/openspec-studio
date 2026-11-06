// Create a small, disposable OpenSpec repo for demos, screenshots and tutorials.
//
//   node scripts/demo-repo.mjs [folder] [--tools claude|codebuddy|codex]
//                                        (folder defaults to ./demo-repos)
//
// Makes <folder>/hello-app: a git repo holding a tiny zero-dependency Node HTTP
// app (node:http + node:test, so `npm test` works without npm install), one
// main spec and one active change ("add-hello-endpoint") whose proposal, design,
// delta spec and tasks are all written, so it opens in Studio's "In review"
// stage right away, and whose three tasks the agent can really implement.
// --tools also runs `openspec init --tools <agent>`, which installs the /opsx
// workflow commands so "Send review", "Build it" etc. work with that agent
// (without it, Studio's own "Initialize OpenSpec" screen is skipped, because
// openspec/ already exists). Add <folder> in Studio with "Add folder…".
// Run it again to reset the demo.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const toolsAt = argv.indexOf('--tools');
const tools = toolsAt >= 0 ? argv.splice(toolsAt, 2)[1] : null;
if (toolsAt >= 0 && !tools) { console.error('--tools needs a value, e.g. --tools claude'); process.exit(1); }
const root = path.resolve(argv[0] ?? 'demo-repos');
const repo = path.join(root, 'hello-app');
const change = path.join(repo, 'openspec', 'changes', 'add-hello-endpoint');

const today = new Date().toISOString().slice(0, 10);
const files = {
  // ---- a small, zero-dependency Node app, so "Build it" can really finish ----
  'package.json': `${JSON.stringify({
    name: 'hello-app', version: '0.1.0', private: true, type: 'module',
    scripts: { start: 'node src/server.js', test: 'node --test' },
    engines: { node: '>=20' },
  }, null, 2)}\n`,
  '.gitignore': 'node_modules/\n',
  'README.md': `# hello-app

Demo repository for OpenSpec Studio: a tiny HTTP API with no dependencies.

\`\`\`bash
npm start   # http://localhost:3000/api/health
npm test    # node:test
\`\`\`
`,
  'src/app.js': `import http from 'node:http';
import { health } from './routes/health.js';

/** "METHOD /path" → handler(req) returning { status, body }. */
export const routes = {
  'GET /api/health': health,
};

export function createApp() {
  return http.createServer(async (req, res) => {
    const handler = routes[\`\${req.method} \${req.url}\`];
    const { status, body } = handler ? await handler(req) : { status: 404, body: { error: 'not found' } };
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
}
`,
  'src/routes/health.js': `export function health() {
  return { status: 200, body: { status: 'ok' } };
}
`,
  'src/server.js': `import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
createApp().listen(port, () => console.log(\`hello-app on http://localhost:\${port}\`));
`,
  'test/health.test.js': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

test('GET /api/health returns ok', async () => {
  const server = createApp().listen(0);
  const { port } = server.address();
  const res = await fetch(\`http://localhost:\${port}/api/health\`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
  server.close();
});

test('unknown routes return 404', async () => {
  const server = createApp().listen(0);
  const { port } = server.address();
  const res = await fetch(\`http://localhost:\${port}/nope\`);
  assert.equal(res.status, 404);
  server.close();
});
`,

  // ---- OpenSpec: one main spec and one change ready for review ----
  'openspec/config.yaml': 'schema: spec-driven\n',
  'openspec/specs/health/spec.md': `# health Specification

## Purpose
Let clients and load balancers check that the service is up.

## Requirements
### Requirement: Health check
The service SHALL answer \`GET /api/health\` with status 200 and \`{ "status": "ok" }\`.

#### Scenario: service is up
- **WHEN** a client calls \`GET /api/health\`
- **THEN** it receives status 200 and \`{ "status": "ok" }\`
`,
  'openspec/changes/add-hello-endpoint/.openspec.yaml': `schema: spec-driven\ncreated: ${today}\n`,
  'openspec/changes/add-hello-endpoint/proposal.md': `# Proposal: Add hello endpoint

## Why
Clients need a cheap greeting call that also proves routing works end to end.

## What Changes
- Add \`GET /api/v1/helloworld\` returning a JSON greeting.
- Log every call at debug level.

## Capabilities
### New Capabilities
- \`greeting\`: a hello endpoint for clients.

## Impact
- New file \`src/routes/hello.js\`, one new entry in the route table in \`src/app.js\`, a new test.
`,
  'openspec/changes/add-hello-endpoint/design.md': `# Design

## Context
The app is a zero-dependency Node HTTP server. \`src/app.js\` holds a route table that maps
\`"METHOD /path"\` to a handler returning \`{ status, body }\`; tests use \`node:test\` and \`fetch\`.

## Decisions
- One handler module per route, like \`src/routes/health.js\`.
- Return \`{ "message": "Hello" }\` with status 200.
- Log each call with \`console.debug\`, so normal runs stay quiet.
`,
  'openspec/changes/add-hello-endpoint/specs/greeting/spec.md': `## ADDED Requirements
### Requirement: Hello endpoint
The service SHALL expose \`GET /api/v1/helloworld\`, answering with status 200 and \`{ "message": "Hello" }\`.

#### Scenario: call the endpoint
- **WHEN** a client calls \`GET /api/v1/helloworld\`
- **THEN** it receives status 200 and \`{ "message": "Hello" }\`
`,
  'openspec/changes/add-hello-endpoint/tasks.md': `## 1. Implementation
- [ ] 1.1 Add the handler in \`src/routes/hello.js\` (returns the greeting, logs the call with \`console.debug\`)
- [ ] 1.2 Register \`GET /api/v1/helloworld\` in the route table in \`src/app.js\`
- [ ] 1.3 Add \`test/hello.test.js\` checking the status and body; \`npm test\` passes
`,
};

fs.rmSync(repo, { recursive: true, force: true });
for (const [rel, text] of Object.entries(files)) {
  const f = path.join(repo, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
}

if (tools) {
  // npm CLIs are .cmd shims on Windows, which need a shell to start
  const r = spawnSync(process.env.OPENSPEC_BIN || 'openspec', ['init', '--tools', tools, '--no-animation', process.platform === 'win32' ? `"${repo}"` : repo], {
    cwd: repo, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, OPENSPEC_TELEMETRY: process.env.OPENSPEC_TELEMETRY ?? '0' },
  });
  if (r.status !== 0) { console.error('openspec init failed (is the OpenSpec CLI installed? npm i -g @fission-ai/openspec)'); process.exit(1); }
}

// a git repo is what Studio's folder scan looks for (an openspec/ folder also counts)
const git = (...args) => spawnSync('git', args, { cwd: repo, stdio: 'ignore' }).status === 0;
if (git('init', '-q')) {
  git('add', '-A');
  git('-c', 'user.name=demo', '-c', 'user.email=demo@example.com', 'commit', '-qm', 'demo repo');
} else {
  console.warn('git not found: created the files without a git repo (Studio still finds it via openspec/)');
}

console.log(`Demo repo ready: ${repo}`);
console.log(`In Studio: repo menu → Add folder… → ${root}`);
console.log(`Change "${path.basename(change)}" is waiting in "In review".`);
