# Agent Walkthrough

**Code walkthroughs written by your coding agent, played back step by step in
VS Code, with review comments that go back to the agent.**

A coding-agent session changes a lot of code at once. Reading the diff file by
file doesn't tell you how the pieces fit together or why they were written that
way. Agent Walkthrough asks the agent to explain its own change:

1. At the end of a session, the agent (Claude Code, Codex, GitHub Copilot, Cursor)
   writes `.walkthrough/<session>.yaml`: the changed code **in execution order**
   (route → service → data layer), each step with its file, lines and a short "why".
2. The VS Code extension plays it back. **Next** / **Back** open each step's file,
   highlight its lines and show the explanation right below them.
3. You comment on any line, like on a pull request. Comments are saved to
   `.walkthrough/<session>.feedback.yaml`; **Copy feedback to chat** hands them to
   the agent, which applies them and marks them done.
4. A **coverage check** lists changed lines that no step explains, so nothing the
   agent changed slips past you.

> **Status:** early (v0.1). The walkthrough format and the extension work end to
> end and are tested; the extension isn't on the Marketplace yet, so you install
> it from a `.vsix` file (below). See the [roadmap](spec.md#8-roadmap-and-status).

## Requirements

- **VS Code** 1.90 or later (or a fork that runs VS Code extensions, such as Cursor)
- **git** on your `PATH`, for the coverage check
- **Node.js 18+**, to build the extension, for `npx skills`, and for the optional Claude Code hook
- A coding agent that supports skills: Claude Code, Codex, GitHub Copilot or Cursor

## Install

There are two parts: the **VS Code extension** (for you, the reviewer) and the
**agent skill** (for the agent, in each repository you want walkthroughs in).

### 1. The VS Code extension

Build the `.vsix` package and install it:

```sh
git clone https://github.com/mepolabs/agent-walkthrough.git
cd agent-walkthrough/extension
npm ci
npm run package                       # creates agent-walkthrough-<version>.vsix
code --install-extension agent-walkthrough-0.1.0.vsix
```

Or, in VS Code: **Extensions** view → **⋯** → **Install from VSIX…** and pick the file.
In Cursor, use `cursor --install-extension` or the same menu.

### 2. The agent skill

The skill tells your agent how to write walkthroughs and apply review feedback.
Install it with one command, from inside the repository you work in. Then start
a **new** agent session, because running sessions don't pick up new skills.

#### Claude Code: plugin marketplace (recommended)

```sh
claude plugin marketplace add mepolabs/agent-walkthrough
claude plugin install agent-walkthrough@agent-walkthrough
```

Or, inside a Claude Code session: `/plugin marketplace add mepolabs/agent-walkthrough`,
then `/plugin install agent-walkthrough@agent-walkthrough`.

This installs the skill for you in every repository. To share it with your team
instead, add `--scope project` to both commands. That records the marketplace
and the plugin in the repository's `.claude/settings.json`, and Claude Code
offers the plugin to everyone who opens the repository.

**Optional: always write a walkthrough.** Agents write one when the skill kicks
in or when you ask. To make Claude Code write one before it finishes *every*
session that changed code, also install the Stop hook. Install it per project,
so it doesn't apply to every repository on your machine:

```sh
claude plugin install agent-walkthrough-stop-hook@agent-walkthrough --scope project
```

The hook only looks at uncommitted changes and never blocks twice in a row, so
it can't loop.

#### GitHub Copilot: `gh skill`

With [GitHub CLI](https://cli.github.com/) 2.90 or later:

```sh
gh skill install mepolabs/agent-walkthrough walkthrough
```

This puts the skill in `.agents/skills/walkthrough/`, which Copilot reads, and
so do Codex and Cursor. Add `--agent claude-code` to install it for Claude Code
instead, or `--scope user` to install it for all your repositories.

#### Any agent: `npx skills`

The [`skills`](https://github.com/vercel-labs/skills) CLI installs for Claude
Code, Copilot, Codex, Cursor and many other agents in one go (needs Node.js):

```sh
npx skills add mepolabs/agent-walkthrough --skill walkthrough -a claude-code -a github-copilot --copy
```

This writes `.agents/skills/walkthrough/`, used by Copilot, Codex and Cursor,
and `.claude/skills/walkthrough/`. Add `-a codex -a cursor` for other agents, or
`-g` to install for your user instead of this repository. Keep `--copy` if you
commit the skill: without it, `.claude/skills/` gets a symlink to a path on your
machine, which breaks for everyone else.

#### Manually

The skill is one folder, [`skills/walkthrough/`](skills/walkthrough/). Copy it to
`.agents/skills/walkthrough/` (Copilot, Codex, Cursor) and/or
`.claude/skills/walkthrough/` (Claude Code) in your repository. The Stop hook
for Claude Code is
[`plugins/agent-walkthrough-stop-hook/scripts/require-walkthrough.mjs`](plugins/agent-walkthrough-stop-hook/scripts/require-walkthrough.mjs);
the comment at its top shows how to register it in `.claude/settings.json`.

## Use it

1. **Let the agent work.** At the end of the session it writes
   `.walkthrough/2026-09-28-<slug>.yaml`. You can also just ask: *"write a walkthrough"*.
2. **Open it.** In VS Code, run **Walkthrough: Open…** from the Command Palette, or
   click the book icon in the **Walkthrough** view in the Explorer. The newest
   walkthrough is listed first.
3. **Step through.** **Alt+]** next, **Alt+[** back, or the buttons in the step's
   inline header and the side panel. Step links like *step 3* in an explanation
   jump there. If the code moved since the walkthrough was written, the highlight
   follows it and says so.
4. **Comment.** Hover over the line numbers and click **+** (select lines first
   for a range), or click 💬 in the step's header to comment on the whole step.
   Edit or delete comments from the comment itself.
5. **Send the feedback.** Click **Copy feedback to chat** in the Walkthrough view
   and paste it into your agent. It applies each comment and marks it `applied`,
   and the comment disappears from the editor.
6. **Check coverage.** The **Not in Walkthrough** view lists changed lines no step
   covers; they're also marked with a dotted line in the gutter. The overview
   shows `Coverage: covered / changed lines`.

Try it without an agent first: open [`examples/order-api/`](examples/order-api/)
in VS Code and run **Walkthrough: Open…**.

### Should `.walkthrough/` be committed?

Either works. Commit it to let reviewers play walkthroughs from a pull request;
add `.walkthrough/` to `.gitignore` to keep them personal. Walkthroughs are
review aids for one change, not long-lived documentation.

### Commands and settings

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

| Setting | Default | |
|---------|---------|---|
| `agent-walkthrough.inlineExplanation` | `true` | Show each step's explanation in the editor below its lines, as well as in the side panel. |

Colours can be themed with `agent-walkthrough.stepHighlight`, `agent-walkthrough.stepGutter`
and `agent-walkthrough.uncoveredGutter` in `workbench.colorCustomizations`.

## The files

Both files are YAML in `.walkthrough/` at the repository root, and both have a
JSON Schema in [`schema/`](schema/) (the extension validates them as you edit).

```yaml
# .walkthrough/2026-09-27-order-cancel.yaml — written by the agent
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

```yaml
# .walkthrough/2026-09-27-order-cancel.feedback.yaml — written by the extension
version: 1
entries:
  - id: fb-20260927-141502-a1b2
    step: 3
    file: src/orders/service.ts
    lines: [28, 30]
    anchor: 'if (order.status !== "pending") {'
    comment: Paid orders should also be cancellable if they haven't shipped.
    status: open        # the agent sets this to `applied`
    created: 2026-09-27T14:15:02Z
```

The full format, and the reasons behind it, are in the [specification](spec.md).

## Security

Walkthroughs are written by an agent and may arrive in someone else's pull
request, so the extension treats their text as untrusted: no raw HTML or images,
links only to web pages (`http(s)://`, which VS Code asks before opening) or to other steps, and
nothing in a walkthrough can run a command. Details are in
[spec §5.2.2](spec.md#522-rendering-untrusted-text). To report a vulnerability,
please use [GitHub's private vulnerability reporting](https://github.com/mepolabs/agent-walkthrough/security/advisories/new)
rather than a public issue.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for
how to build, test and run the extension from source.

## License

[MIT](LICENSE)
