# OpenSpec Studio

A visual, mouse-first workbench for [OpenSpec](https://github.com/Fission-AI/OpenSpec). Pick a repo, drive the whole
lifecycle (init → explore/propose → review → apply → sync → archive) with buttons, review artifacts Google-Docs style,
and watch the coding agent work live, including its permission requests and questions.

> **Status:** early, personal project. It works for daily use, but expect rough edges.

![Reviewing a proposal: comments in the margin, one per highlight](docs/review.png)

```
Browser (React) ⇄ WebSocket/REST ⇄ Node server ⇄ ACP over stdio ⇄ agent (cwd = repo)
                                     ├─ openspec CLI (--json) + file watcher
                                     └─ SQLite (~/.openspec-studio/studio.db): event log, comments, review rounds
```

## Quick start
You need **Node.js ≥ 22.13** (Studio uses the built-in `node:sqlite`).

```bash
# 1. OpenSpec CLI
npm install -g @fission-ai/openspec

# 2. An agent CLI, logged in once from a terminal (see "Agents" below), e.g.
codebuddy        # or: claude / codex

# 3. Studio
git clone https://github.com/baabullah/openspec-studio.git
cd openspec-studio
npm install
npm run dev      # API :3940 + web :5173 → open http://127.0.0.1:5173
```

Then open the repo menu → **Add folder…** and pick the folder that holds your repos. Studio lists every git or OpenSpec
repo up to 4 levels inside it. Folders are saved in `~/.openspec-studio/config.json`; add as many as you like.

For everyday use, run a production build on a single port:
```bash
npm run build && npm start   # http://127.0.0.1:3940
```
`npm start` runs the TypeScript server through `tsx` (no separate compile step), so keep the dev dependencies installed;
the startup cost is a second or two and nothing else changes at runtime.

### Configuration
All optional, as environment variables:

| variable | default | meaning |
|---|---|---|
| `REPOS_ROOT` | none | a folder that is always listed, in addition to the ones picked in the UI |
| `PORT` | `3940` | server port |
| `HOST` | `127.0.0.1` | bind address; keep it local (see Security) |
| `ALLOWED_HOSTS` | none | extra host names the server answers to, comma separated |
| `DEFAULT_AGENT` | `codebuddy` | agent selected for new repos |
| `STUDIO_DATA` | `~/.openspec-studio` | database, config and `agents.json` |
| `REPO_SCAN_DEPTH` | `4` | how deep to look for repos inside a folder |
| `OPENSPEC_BIN` | `openspec` | OpenSpec CLI to run |
| `MAX_DOC_BYTES` | `2097152` | largest spec file the server opens or snapshots (bigger ones get a 413 / a marker) |

## Agents
| id | how it runs | login | OpenSpec invocation |
|---|---|---|---|
| codebuddy | `codebuddy --acp` | run `codebuddy` once and sign in | `/opsx:<cmd>` |
| claude | `npx @agentclientprotocol/claude-agent-acp` | sign in to Claude Code (`claude`), or set `ANTHROPIC_API_KEY` | `/opsx:<cmd>` |
| codex | `npx @agentclientprotocol/codex-acp` | `codex login`, or set `OPENAI_API_KEY` | `$openspec-<skill>` |

The Claude and Codex adapters are downloaded by `npx` the first time you connect, so that first start takes a while.

Add or override agents in `~/.openspec-studio/agents.json`:
```json
[{ "id": "gemini", "label": "Gemini", "cmd": "gemini", "args": ["--experimental-acp"], "openspecTool": "gemini", "style": "slash" }]
```
`style` is `slash`, `skill`, or a template like `"/my:{action} {args}"` (`{skill}` is also available).

## Review loop
1. Select text in an artifact → floating toolbar: **Change / Question / Remove / Comment / Approve**. Or hover any heading,
   paragraph or list item for the same one-click reactions.

   ![Selecting text shows the annotation toolbar](docs/annotate.png)

2. Pick a preset or type a note. Notes on the whole document or the whole change are in the bottom bar.

   ![Writing a comment: kind, presets and a free-text note](docs/comment.png)

3. **Send review** snapshots the artifacts and sends the agent one structured prompt (`/opsx:update <change>` + every comment
   with id, location, quote and note). The agent ends its reply with a `review-result` block.
4. When the turn ends, each comment shows the agent's verdict (addressed / partly / declined / answered) and note, and
   **What changed** shows a word-level diff per file. Resolve or reopen each one; reopened comments go out in the next round.
   If the turn stops early (refusal, error, token limit), the round stays open so you can continue it.

Comments are anchored by quote + surrounding context (with heading and line as tie-breaks, and fuzzy matching), so they
re-attach after edits. Ones whose text changed are marked, and ones whose text disappeared are flagged.

## Platforms
Tested on **Linux**, **WSL** and **native Windows**. **macOS** should work the same way but has not been tested yet;
reports are welcome.

- **Windows:** npm-installed CLIs are `.cmd` shims; the server launches them via cross-spawn and stops agents with their
  whole process tree. Use `cmd` or PowerShell, whichever your machine allows.
- **WSL with repos on `/mnt/c`:** works, but file watching falls back to polling and installs/builds are slow. Prefer
  keeping repos in the Linux filesystem, or run Studio with Windows Node instead.
- **Install with the same OS you run on:** `node_modules` contains native binaries (esbuild, rolldown), so a folder
  installed from WSL won't run under Windows Node and vice versa. Use a separate clone per OS.

## Troubleshooting
- **The page loads but shows connection errors / `ECONNREFUSED 127.0.0.1:3940` in the terminal.** A few right after
  `npm run dev` starts are normal while the server compiles. If they continue, check that `node_modules` was installed
  on the same OS you run on (see above), and that no older Studio process still holds port 3940.
- **The agent is very slow or keeps "thinking" without answering.** Some models loop on reasoning-only replies. Switch
  the model in the agent panel (for CodeBuddy, e.g. `glm-5.3`).
- **Every OpenSpec action takes ~10 seconds behind a proxy.** That is the CLI's telemetry request timing out. Studio sets
  `OPENSPEC_TELEMETRY=0` for its own calls unless you set it yourself.
- **`npm install` prints `install-scripts` warnings.** Newer npm versions ask before running install scripts; Studio
  works without them, so they can be ignored.

## Security
The agent can run code. The server binds to localhost and only answers requests whose `Host` is localhost/127.0.0.1/[::1]
(or `ALLOWED_HOSTS`), which blocks DNS-rebinding attacks from web pages. WebSocket and mutating requests must also come
from the same origin. Repos are limited to the folders you added, files are served only from `<repo>/openspec`, and the
agent's ACP file reads/writes are confined to the repo. There is no authentication: do not expose it on a network.

## Development
```bash
npm test           # unit tests (vitest): server, then web
npm run typecheck  # server + web
npm run lint       # biome (lint only; the formatter is off)
```
Server tests cover comment anchoring, the review prompt and `review-result` parser, review rounds, request schemas,
custom agents, the path sandbox, the Host/Origin checks, and workspace folders (scan, sandbox, data migration). Web
tests cover the transcript fold and the document text model (under jsdom).

CI runs lint, typecheck, tests and the build on Linux and Windows (Node 22 and 24) for every push to `main` and every
pull request. Lint warnings (mostly accessibility) are a known backlog and don't fail the build; errors do.

Line endings are pinned to LF by `.gitattributes`, so editing from Windows and WSL doesn't show every file as changed.

## License
MIT, see [LICENSE](LICENSE).
