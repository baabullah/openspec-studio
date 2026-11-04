# OpenSpec Studio

A visual, mouse-first workbench for [OpenSpec](https://github.com/Fission-AI/OpenSpec). Pick a repo, drive the whole
lifecycle (init → explore/propose → review → apply → sync → archive) with buttons, review artifacts Google-Docs style,
and watch the coding agent work live, including its permission requests and questions.

```
Browser (React) ⇄ WebSocket/REST ⇄ Node server ⇄ ACP over stdio ⇄ agent (cwd = repo)
                                     ├─ openspec CLI (--json) + file watcher
                                     └─ SQLite (~/.openspec-studio/studio.db): event log, comments, review rounds
```

## Run
```bash
npm install
npm run dev            # API :3940 + web :5173 → open http://127.0.0.1:5173
# or production
npm run build && npm start   # everything on http://127.0.0.1:3940
```
Env: `REPOS_ROOT` (folder scanned for repos; default = two levels above this folder), `PORT`, `HOST` (default 127.0.0.1),
`DEFAULT_AGENT`, `STUDIO_DATA` (default `~/.openspec-studio`), `REPO_SCAN_DEPTH` (default 4).

## Agents
| id | how it runs | OpenSpec invocation |
|---|---|---|
| codebuddy | `codebuddy --acp` | `/opsx:<cmd>` |
| claude | `npx @agentclientprotocol/claude-agent-acp` | `/opsx:<cmd>` |
| codex | `npx @agentclientprotocol/codex-acp` | `$openspec-<skill>` |

Add or override agents in `~/.openspec-studio/agents.json`:
```json
[{ "id": "gemini", "label": "Gemini", "cmd": "gemini", "args": ["--experimental-acp"], "openspecTool": "gemini", "style": "slash" }]
```
`style` is `slash`, `skill`, or a template like `"/my:{action} {args}"` (`{skill}` is also available).

## Review loop
1. Select text in an artifact → floating toolbar: **Change / Question / Remove / Comment / Approve**. Or hover any heading,
   paragraph or list item for the same one-click reactions. Presets fill most notes for you.
2. Notes on the whole document or the whole change are in the bottom bar.
3. **Send review** snapshots the artifacts and sends the agent one structured prompt (`/opsx:update <change>` + every comment
   with id, location, quote and note). The agent ends its reply with a `review-result` block.
4. When the turn ends, each comment shows the agent's verdict (addressed / partly / declined / answered) and note, and
   **What changed** shows a word-level diff per file. Resolve or reopen each one; reopened comments go out in the next round.

Comments are anchored by quote + context, so they re-attach after edits; ones whose text disappeared are flagged.

## Security
The agent can run code. The server binds to localhost, checks Origin on WebSocket and mutating requests, limits repos to
`REPOS_ROOT`, serves files only from `<repo>/openspec`, and confines the agent's ACP file reads/writes to the repo. There is
no authentication: do not expose it on a network.

## Tests
`npm test` (anchoring, prompt composer, result parser, path sandbox).
