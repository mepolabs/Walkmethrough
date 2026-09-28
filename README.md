# Agent Walkthrough

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/mepolabs.agent-walkthrough?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=mepolabs.agent-walkthrough)

**See how your coding agent's change actually works, step by step in VS Code,
and send comments straight back to the agent.**

## Why

When a coding agent (Claude Code, Codex, GitHub Copilot, Cursor) finishes a
task, it can touch a dozen files at once. Reading that diff file by file
doesn't tell you how the pieces fit together, or why the agent wrote it that
way.

Agent Walkthrough fixes that. The agent writes a short, ordered explanation of
its own change, and a VS Code extension plays it back for you like a guided
tour, one step at a time, in the real files, with the reasoning right next to
the code.

## How it works

1. **The agent writes a walkthrough.** At the end of a session it saves a
   file describing the changed code in the order you'd read it (route →
   service → database), with a short "why" for each step.
2. **You step through it in VS Code.** Next / Back opens each step's file,
   highlights the lines, and shows the explanation right there.
3. **You leave comments, like on a pull request.** Click **+** next to any
   line, or comment on a whole step.
4. **One click sends your feedback back to the agent.** It applies your
   comments and marks each one done.
5. **Nothing slips through.** A coverage check flags any changed lines the
   walkthrough didn't explain.

> **Status:** early (v0.1). Writing and reviewing walkthroughs works end to
> end.

## Install

You'll need:

- **VS Code** 1.90+ (or a compatible fork, such as Cursor)
- **git**, so the coverage check can work
- A coding agent: **Claude Code**, **Codex**, **GitHub Copilot**, or **Cursor**

### 1. Install the VS Code extension

Install **Agent Walkthrough** from the
[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=mepolabs.agent-walkthrough):
open the **Extensions** view, search for `Agent Walkthrough`, and click
**Install**. Or from a terminal:

```sh
code --install-extension mepolabs.agent-walkthrough
```

<details>
<summary><strong>Cursor or another VS Code fork</strong></summary>

Forks like Cursor don't read the VS Code Marketplace. Download the `.vsix`
file with **Download Extension** on the
[Marketplace page](https://marketplace.visualstudio.com/items?itemName=mepolabs.agent-walkthrough),
then install it:

```sh
cursor --install-extension agent-walkthrough-0.1.0.vsix
```

Or: **Extensions** view → **⋯** → **Install from VSIX…**, and pick the file.

</details>

<details>
<summary><strong>Building from source</strong></summary>

Needs Node.js 18+.

```sh
git clone https://github.com/mepolabs/agent-walkthrough.git
cd agent-walkthrough/extension
npm ci
npm run package
code --install-extension agent-walkthrough-0.1.0.vsix
```

</details>

### 2. Add the skill to your project

This is what tells your agent how to write walkthroughs. Run one command
inside the repository you work in, then start a **new** agent session (a
session already running won't pick it up).

**Claude Code** (recommended way):

```sh
claude plugin marketplace add mepolabs/agent-walkthrough
claude plugin install agent-walkthrough@agent-walkthrough
```

Working on a shared repository? Add `--scope project` to both commands so
Claude Code offers the skill to everyone on the team, not just you.

<details>
<summary><strong>Using Copilot, Cursor, Codex, or installing without Claude Code's plugin system</strong></summary>

**GitHub Copilot**, with [GitHub CLI](https://cli.github.com/) 2.90+:

```sh
gh skill install mepolabs/agent-walkthrough walkthrough
```

**Any of the four agents at once**, using the
[`skills`](https://github.com/vercel-labs/skills) CLI (needs Node.js):

```sh
npx skills add mepolabs/agent-walkthrough --skill walkthrough -a claude-code -a github-copilot --copy
```

Add `-a codex -a cursor` to also cover those, or `-g` to install it for
yourself everywhere instead of just this repository.

**Manually:** copy the [`skills/walkthrough/`](skills/walkthrough/) folder
into `.agents/skills/walkthrough/` (Copilot, Codex, Cursor) and/or
`.claude/skills/walkthrough/` (Claude Code) in your repository.

**Claude Code only, optional:** to make Claude Code write a walkthrough
before it finishes *every* session that changed code (instead of only when
asked), also install:

```sh
claude plugin install agent-walkthrough-stop-hook@agent-walkthrough --scope project
```

It only looks at uncommitted changes and never interrupts twice in a row.

</details>

## Use it

1. Let your agent finish a change, or ask it to *"write a walkthrough."*
2. Open the **Walkthrough** view in the Explorer sidebar, or run
   **Walkthrough: Open…** from the Command Palette, and pick the walkthrough
   (the newest one is listed first).
3. Step through with the **Next** / **Back** buttons, or **Alt+]** / **Alt+[**.
4. Hover a line number and click **+** to comment on it, or click 💬 in a
   step's header to comment on the whole step, just like reviewing a pull
   request.
5. When you're done, click **Copy feedback to chat** and paste it to your
   agent. It'll apply your comments and mark each one done, and they'll
   disappear from the editor.
6. Check the **Not in Walkthrough** view for anything changed that the
   walkthrough didn't cover.

No agent handy? Try it on the bundled example: open
[`examples/order-api/`](examples/order-api/) in VS Code and run
**Walkthrough: Open…**.

Walkthroughs are saved as files in a `.walkthrough/` folder in your
repository. Commit that folder if you want reviewers to be able to open the
walkthrough from a pull request, or add it to `.gitignore` to keep your
walkthroughs personal — either is fine, since they're an aid for reviewing
one change, not long-term documentation.

## Reference

<details>
<summary>Commands and keybindings</summary>

| Command | Default key |
|---------|-------------|
| Walkthrough: Open… | |
| Walkthrough: Next Step | Alt+] |
| Walkthrough: Previous Step | Alt+[ |
| Walkthrough: Go to Step… | |
| Walkthrough: Comment on Step | |
| Walkthrough: Copy Feedback to Chat | |
| Walkthrough: Refresh Coverage | |
| Walkthrough: Close | |

</details>

<details>
<summary>Settings</summary>

| Setting | Default | |
|---------|---------|---|
| `agent-walkthrough.inlineExplanation` | `true` | Show each step's explanation in the editor below its lines, as well as in the side panel. |

The highlight colours can be themed too, with `agent-walkthrough.stepHighlight`,
`agent-walkthrough.stepGutter` and `agent-walkthrough.uncoveredGutter` in
`workbench.colorCustomizations`.

</details>

<details>
<summary>The walkthrough file format</summary>

A walkthrough is a YAML file the agent writes to `.walkthrough/<session>.yaml`:

```yaml
version: 1
title: Cancel a pending order
summary: |
  Adds `POST /orders/:id/cancel`: controller → service → repository.
base_commit: "3e393a7"
steps:
  - title: Route and error mapping
    file: src/orders/controller.ts
    lines: [14, 23]
    anchor: 'router.post("/orders/:id/cancel"'   # first line, to re-find it after edits
    why: |
      The controller stays thin and maps domain errors to 404 / 409.
```

Comments you leave are saved next to it, in `.walkthrough/<session>.feedback.yaml`.
Both files have a JSON Schema in [`schema/`](schema/), and the full format is
documented in the [specification](spec.md).

</details>

## Security

Walkthroughs are written by an agent and may arrive in someone else's pull
request, so the extension treats their text as untrusted: no raw HTML or
images, no links except to web pages (which VS Code asks before opening) or
other steps, and nothing in a walkthrough can run a command on your machine.
To report a vulnerability, please use
[GitHub's private vulnerability reporting](https://github.com/mepolabs/agent-walkthrough/security/advisories/new)
rather than a public issue.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md)
for how to build, test and run the extension from source.

## License

[MIT](LICENSE)
