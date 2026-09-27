# Walkmethrough

Agent-written code walkthroughs you can step through in VS Code, with review
comments that flow back to the agent.

At the end of a session, the coding agent (Claude Code, Codex, Copilot, Cursor)
writes `.walkthrough/<session>.yaml`: the changed code in execution order, each
step with file, lines and an explanation. The VS Code extension plays it back
with **Next** / **Back**, highlighting each step's lines.

See [spec.md](spec.md) for the full design and roadmap status.

## Layout

| Path | What |
|------|------|
| [`spec.md`](spec.md) | Specification (v1) |
| [`schema/`](schema/) | JSON Schemas for the walkthrough and feedback files |
| [`skill/walkthrough/SKILL.md`](skill/walkthrough/SKILL.md) | Agent skill that writes walkthroughs and applies feedback |
| [`skill/hooks/require-walkthrough.mjs`](skill/hooks/require-walkthrough.mjs) | Optional Claude Code `Stop` hook that makes the agent write one |
| [`extension/`](extension/) | VS Code extension |
| [`examples/order-api/`](examples/order-api/) | Tiny sample app with two hand-written walkthroughs |

## Install the skill

Copy `skill/walkthrough/` into your repo:

- Codex, Copilot, Cursor: `.agents/skills/walkthrough/`
- Claude Code: `.claude/skills/walkthrough/`

For Claude Code, optionally copy `skill/hooks/require-walkthrough.mjs` to
`.claude/hooks/` and register it in `.claude/settings.json`:

```json
{ "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "node .claude/hooks/require-walkthrough.mjs" } ] } ] } }
```

## Develop the extension

```sh
cd extension
npm install
npm test               # unit tests (node:test)
npm run build          # bundle to dist/
npm run test:integration   # launches VS Code on examples/order-api (needs network + display)
```

Open `extension/` in VS Code and press F5 to launch it on `examples/order-api`,
then run **Walkthrough: Open…**.
