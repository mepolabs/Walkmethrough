# Agent Walkthrough

Play back code walkthroughs written by your coding agent, step by step, and send
review comments back to it.

At the end of a session, your agent (Claude Code, Codex, GitHub Copilot, Cursor)
writes `.walkthrough/<session>.yaml`: the code it changed, in execution order,
with a short explanation per step. This extension turns that file into a guided
review.

![Agent Walkthrough demo: stepping through an agent's change in VS Code and leaving comments](https://raw.githubusercontent.com/mepolabs/agent-walkthrough/main/docs/demo.gif)

## Features

- **Step through the change.** **Next** / **Back** (Alt+] / Alt+[) open each
  step's file, highlight its lines and show the explanation right below them,
  as well as in the **Walkthrough** view in the Explorer.
- **Follows the code.** Each step records its first line, so the highlight
  still lands in the right place after later edits, and tells you when it moved.
- **Comment like on a pull request.** Click **+** in the gutter, or 💬 on a step.
  Comments are saved next to the walkthrough in `<session>.feedback.yaml`.
- **Send feedback to the agent.** **Copy feedback to chat** puts every open
  comment on the clipboard, ready to paste. When the agent marks a comment
  `applied`, it disappears from the editor.
- **Coverage check.** The **Not in Walkthrough** view lists changed lines no step
  explains (from `git diff`), and marks them in the gutter.
- **Safe with untrusted walkthroughs.** No raw HTML, no images, no command links:
  a walkthrough from someone else's pull request can't run anything.

## Getting started

1. Add the agent skill to your repository. The skill is the part that makes
   your agent write walkthroughs. See the
   [install guide](https://github.com/mepolabs/agent-walkthrough#2-add-the-skill-to-your-project).
2. Let your agent finish a change, or ask it to "write a walkthrough".
3. Run **Walkthrough: Open…** and pick the walkthrough. To switch to another
   one later, click **Switch walkthrough…** in the Walkthrough view, or
   right-click a file in `.walkthrough/` and choose **Open Walkthrough**.

Walkthroughs are found in every folder of a multi-root workspace, and in
projects nested inside a folder (such as a monorepo with a `.walkthrough/` per
project). Each one plays against its own project: the folder that holds its
`.walkthrough/`.

The extension activates in workspaces that contain `.walkthrough/*.yaml`.
The coverage check needs `git` on your `PATH`.

## Commands

| Command | Key |
|---------|-----|
| Walkthrough: Open… | |
| Walkthrough: Next Step | Alt+] |
| Walkthrough: Previous Step | Alt+[ |
| Walkthrough: Go to Step… | |
| Walkthrough: Comment on Step | |
| Walkthrough: Copy Feedback to Chat | |
| Walkthrough: Refresh Coverage | |
| Walkthrough: Close | |

## Settings

- `agent-walkthrough.inlineExplanation` (default `true`): show each step's
  explanation in the editor below its lines, as well as in the side panel.

Theme colours: `agent-walkthrough.stepHighlight`, `agent-walkthrough.stepGutter`,
`agent-walkthrough.uncoveredGutter`.

## More

- [Project README](https://github.com/mepolabs/agent-walkthrough#readme): install the skill, the file formats
- [Issues](https://github.com/mepolabs/agent-walkthrough/issues)

If it's useful, a ⭐ on [GitHub](https://github.com/mepolabs/agent-walkthrough)
helps other people find it. To hear about new versions, click **Watch →
Custom → Releases** there.

MIT licensed.
