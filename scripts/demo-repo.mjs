// Create a small, disposable OpenSpec repo for demos, screenshots and tutorials.
//
//   node scripts/demo-repo.mjs [folder] [--tools claude|codebuddy|codex]
//                                        (folder defaults to ./demo-repos)
//
// Makes <folder>/hello-app: a git repo with an openspec/ tree, one main spec and
// one active change ("add-hello-endpoint") whose proposal, design, delta spec and
// tasks are all written, so it opens in Studio's "In review" stage right away.
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

const files = {
  'openspec/config.yaml': 'schema: spec-driven\n',
  'openspec/specs/greeting/spec.md': `# greeting Specification

## Purpose
Say hello to clients.

## Requirements
### Requirement: Greeting text
The service SHALL greet in English.

#### Scenario: default greeting
- **WHEN** a client asks for a greeting
- **THEN** it receives "Hello"
`,
  'openspec/changes/add-hello-endpoint/proposal.md': `# Proposal: Add hello endpoint

## Why
Clients need a cheap health-style call that also proves routing works.

## What Changes
- Add \`GET /api/v1/helloworld\` returning a JSON greeting.
- Log every call at debug level.

## Impact
- Affected code: \`src/routes/hello.ts\`
`,
  'openspec/changes/add-hello-endpoint/design.md': `# Design

## Context
The router is express-based.

## Decisions
- Use a plain handler; no service layer.
- Return \`{ "message": "Hello" }\` with status 200.
`,
  'openspec/changes/add-hello-endpoint/specs/greeting/spec.md': `## ADDED Requirements
### Requirement: Hello endpoint
The service SHALL expose \`GET /api/v1/helloworld\`.

#### Scenario: call the endpoint
- **WHEN** a client calls \`GET /api/v1/helloworld\`
- **THEN** it receives status 200 and \`{ "message": "Hello" }\`
`,
  'openspec/changes/add-hello-endpoint/tasks.md': `## 1. Implementation
- [ ] 1.1 Add the route handler
- [ ] 1.2 Register the route
- [ ] 1.3 Add a unit test
`,
  'src/routes/hello.ts': '// the agent implements this when you press "Build it"\n',
  'README.md': '# hello-app\n\nDemo repository for OpenSpec Studio.\n',
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
