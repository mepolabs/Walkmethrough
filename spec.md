# Agent Walkthrough — Specification (v1)

Source plan: "Agent Walkthrough — Plan" (Claude Docs, 2026-09-27).

## 1. Summary

A coding-agent session produces a lot of code at once. Reviewing it file by file,
in no particular order, makes it hard to see what each part does and why.

Agent Walkthrough closes that gap with three pieces joined by two files in the repo:

```
 Coding agent + skill ──writes at session end──▶ .walkthrough/<session>.yaml
        ▲                                                  │ played back
        │ agent reads and applies on request               ▼
 .walkthrough/<session>.feedback.yaml ◀──comments── VS Code extension
```

1. **Agent skill** — a `SKILL.md` that tells the agent to write
   `.walkthrough/<session>.yaml` at the end of a session, listing the changed code
   in execution order (controller → service → data layer), one step per logical unit.
2. **VS Code extension** — loads the walkthrough, opens each step's file, highlights
   its lines and shows the explanation in a side panel with **Next** and **Back**.
   Reviewers comment on any step using VS Code's native Comments API.
3. **Feedback loop** — every comment is saved with file, lines and text to
   `.walkthrough/<session>.feedback.yaml`, next to the walkthrough it was made
   in. The skill tells the agent to read that file and apply it when the user
   asks. A copy-to-chat button puts the same text on the clipboard for any harness.

Targets: Claude Code, Codex, GitHub Copilot and Cursor. Open source.

## 2. Differentiation from prior art

[Microsoft CodeTour](https://github.com/microsoft/codetour) already plays guided
tours, and a [community fork](https://github.com/maurice30120/codetour) can
generate a "Changes Tour" over MCP. Agent Walkthrough adds:

- **Generated from the agent's diff**, not recorded by hand.
- **Ordered by execution flow**, not by file.
- **Coverage check** that flags changed lines no step explains.
- **Comments go back to the agent** as actionable feedback.

## 3. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | v1 reads only its own YAML schema; no CodeTour `.tour` import/export. | Resolves the plan's open decision in line with its own "out of scope for v1" list. The schema is small enough that a `.tour` converter can be added later without changing it. The useful ideas in `.tour` are adopted into the YAML schema instead (§10). |
| D2 | YAML, not JSON, for both files. | Agents write multi-line prose (`why`) more reliably in YAML block scalars; humans can read and hand-edit it. |
| D3 | Files carry `version: 1`. | One extra field buys forward compatibility; the player refuses unknown major versions with a clear message. |
| D4 | Line numbers are 1-based and inclusive. | Matches what editors, `git diff` and agents show. |
| D5 | The extension never rewrites a walkthrough file. | The file is the agent's claim; reviewer state lives elsewhere (position in VS Code `workspaceState`, comments in the feedback file, D9). Agents also tend to regenerate a file wholesale, which would silently drop anything the extension had added to it. |
| D6 | Feedback entries reference steps by 1-based index **and** carry `file`/`lines`. | The index gives context; file and lines make the entry actionable even if the walkthrough is regenerated. |
| D7 | Walkthrough text is untrusted input. | It is written by an agent and can arrive in a pull request. The player never runs anything a walkthrough says to (no command links, scripts, `when` conditions) and renders Markdown through an allowlist (§5.2.2). |
| D8 | Commit SHAs are read from the YAML source text. | Unquoted, YAML turns `0123456` into `123456` and `12e4567` into a float. The skill also asks agents to quote them. |
| D9 | One feedback file per walkthrough, `<session>.feedback.yaml`, not one per repo and not inside the walkthrough. | Comments stay scoped to the walkthrough they were made in: threads, Copy to chat and the agent's apply step can't pick up another session's comments, and deleting a walkthrough's two files removes both. Keeping it out of the walkthrough file preserves D5. |

## 4. File formats

All paths are relative to the workspace (repo) root and use `/` separators.
JSON Schemas live in [`schema/`](schema/) and are the normative definition;
this section explains them.

### 4.1 Walkthrough file — `.walkthrough/<session>.yaml`

`<session>` is a filename-safe id chosen by the agent, recommended
`YYYY-MM-DD-<short-slug>` (e.g. `2026-09-27-order-cancel`). Any `*.yaml` or
`*.yml` in `.walkthrough/` is a walkthrough, except `*.feedback.yaml` /
`*.feedback.yml` (§4.2).

| Field | Level | Required | Type | Purpose |
|-------|-------|----------|------|---------|
| `version` | file | yes | `1` | Schema version (D3). |
| `title` | file | yes | string | What the session built. |
| `summary` | file | no | string (Markdown) | Architecture explanation shown before step 1. |
| `base_commit` | file | no | string (commit SHA) | Commit the changes start from; the coverage check diffs against it. |
| `head_commit` | file | no | string (commit SHA) | Commit whose contents the steps describe. Set only when every described change is committed; omitted for uncommitted work. Lets the player show a step "as written" when the working tree has drifted (§5.2.1). |
| `steps` | file | yes | list, ≥1 | Steps in execution order. |
| `file` | step | yes | string | Path relative to the repo root. |
| `lines` | step | yes | `[start, end]` integers, `1 ≤ start ≤ end` | Lines the step covers. |
| `anchor` | step | no (strongly recommended) | string | The range's first 1–3 lines, verbatim, used to re-find the lines after edits (§5.2.1). |
| `title` | step | yes | string | One-line name of the step. |
| `why` | step | yes | string (Markdown) | What the code does and why the agent wrote it this way. |

Unknown fields are ignored with a warning (not an error), so newer agents can
add fields without breaking older players. More than 15 steps is also a
warning: long walkthroughs cost tokens to write and attention to review.

In `summary` and `why`, `[#3]` or `[label][#3]` links to step 3 (CodeTour's
step-reference syntax). Only `https://` links are rendered as links (§5.2.2).

Example:

```yaml
version: 1
title: Cancel an order
summary: |
  `POST /orders/:id/cancel` goes controller → service → repository.
  The service owns the business rule (only `pending` orders can be cancelled).
base_commit: "3f2c1a9"
steps:
  - title: Route and controller
    file: src/orders/controller.ts
    lines: [12, 24]
    anchor: "router.post('/orders/:id/cancel'"
    why: |
      New route. The controller only parses the id and maps errors to HTTP codes.
```

### 4.2 Feedback file — `.walkthrough/<session>.feedback.yaml`

One file per walkthrough (D9), next to it and named after it:
`2026-09-27-order-cancel.yaml` → `2026-09-27-order-cancel.feedback.yaml`
(`.yml` → `.feedback.yml`). The extension creates it on the first comment.

```yaml
version: 1
entries:
  - id: fb-20260927-141502-a1b2         # unique, stable
    step: 2                              # 1-based step index
    file: src/orders/service.ts
    lines: [8, 19]
    anchor: "async cancel(id: string) {"  # optional
    comment: Return 409 instead of throwing a generic Error here.
    status: open                         # open | applied
    created: 2026-09-27T14:15:02Z
```

| Field | Required | Purpose |
|-------|----------|---------|
| `id` | yes | Stable id so the extension can update/delete a comment. |
| `step` | no | 1-based step index in this file's walkthrough; absent for comments made outside a step. |
| `file`, `lines` | yes | Where the comment points (same rules as steps). |
| `anchor` | no | First line(s) of the commented range, copied when the comment is made, so the extension and the agent can re-find the lines after edits (§5.2.1). |
| `comment` | yes | Reviewer's text. |
| `status` | yes | `open` until the agent applies it, then `applied`. |
| `created` | yes | ISO-8601 UTC timestamp. |

Both the extension and the agent write this file. The agent only flips `status`
to `applied` after acting on an entry; it never deletes entries or edits other
fields. The extension owns everything else (§5.3).

## 5. Component specs

### 5.1 Agent skill (`skills/walkthrough/SKILL.md`)

- Frontmatter `name: walkthrough` and a description that triggers at the end of
  any session that changed code, and when the user says "apply walkthrough feedback".
- **Write mode**: run `git diff <base>` (base = `HEAD` at session start, or the
  merge-base with the default branch), group hunks into logical units, order
  them by execution flow, and write `.walkthrough/<session>.yaml` per §4.1.
  Rules: one step per logical unit, not per line, at most 15 steps; `why` is
  1–4 sentences; `anchor` is copied verbatim from the file; every changed hunk
  should be in some step (the coverage check will flag gaps); SHAs are quoted;
  `head_commit` is set only when the described changes are all committed.
- **Apply mode**: pick the walkthrough the user names (or the newest one with
  open feedback, and say which), read its `<session>.feedback.yaml`, act on
  every `status: open` entry, set each to `applied`, and summarise what changed.
  Never read or change another walkthrough's feedback file.
- Location: `skills/walkthrough/` at the repository root, the `skills/*/SKILL.md`
  layout that `gh skill`, `npx skills` and Claude Code plugins all discover.
- Installation (README): the Claude Code plugin marketplace
  (`.claude-plugin/marketplace.json`, plugin `agent-walkthrough`, whose source is the
  repository root and which lists only `./skills/walkthrough`); `gh skill install`
  (Copilot, `.agents/skills/`); `npx skills add` (any agent); or copying the
  folder to `.agents/skills/walkthrough/` (Codex, Copilot, Cursor) and/or
  `.claude/skills/walkthrough/` (Claude Code).
- Claude Code only: an optional `Stop` hook, shipped as its own plugin
  (`plugins/agent-walkthrough-stop-hook/`) so it can be enabled per project,
  blocks the first stop of a session when the working tree has changes and no
  walkthrough was written since they were made. It honours `stop_hook_active`
  so it can never loop.

### 5.2 VS Code extension (`extension/`)

Engine: VS Code `^1.90`; also published to Open VSX so Cursor can install it.

**Commands**

| Command | Title | Default key |
|---------|-------|-------------|
| `agent-walkthrough.open` | Walkthrough: Open… (quick-pick of `.walkthrough/*.yaml`) | — |
| `agent-walkthrough.next` | Walkthrough: Next Step | `Alt+]` while playing |
| `agent-walkthrough.back` | Walkthrough: Previous Step | `Alt+[` while playing |
| `agent-walkthrough.goto` | Walkthrough: Go to Step… | — |
| `agent-walkthrough.close` | Walkthrough: Close | — |

**Player behaviour**

- Position 0 is the overview (title + summary); positions 1…N are steps.
- On entering a step: open the file, resolve the range (§5.2.1), select nothing,
  reveal the range centred, and decorate those lines (whole-line background +
  gutter bar, theme colour `agent-walkthrough.stepHighlight`).
- A webview view **Walkthrough** (Explorer sidebar) shows: title, "Step k of N",
  step title, rendered `why`, file:lines link, a warning banner when the anchor
  was relocated or not found, and **Back / Next** buttons.
- The same explanation also appears in the editor, directly below the step's
  lines, as a read-only comment thread (controller `agent-walkthrough`, context value
  `agent-walkthrough.step`): label "Step k of N", the step title as author, rendered
  `why` and the relocation warning, with Back / Next / Close in its header. One
  thread exists at a time; none on the overview or when the file is missing.
  Setting `agent-walkthrough.inlineExplanation` (default `true`) turns it off. The
  body is the §5.2.2 HTML with step links rewritten to `command:agent-walkthrough.goto`
  URIs; the `MarkdownString` trusts only that command.
- A status-bar item shows `$(book) k/N`; clicking it runs Next.
- The context key `agent-walkthrough.playing` is true while a walkthrough is open.
- A file that fails validation opens nothing and shows every error with its
  YAML path (e.g. `steps[2].lines: end (4) is before start (9)`).
- The file watcher reloads the walkthrough if it changes on disk, keeping the
  current step index when it still exists.
- *(Planned, from CodeTour)* The player remembers per walkthrough which steps
  the reviewer has seen and the last position (VS Code `workspaceState`, keyed by
  file name and content hash). Seen steps get a check mark in **Go to Step…**, and
  reopening a walkthrough offers to resume. This is reviewer state, so it never
  goes into the YAML (D5).

#### 5.2.1 Anchor relocation

Given a step `(file, [start, end], anchor)` and the current file text:

1. If `anchor` is absent → use `[start, end]` as-is (status `unanchored`).
2. Normalise: split anchor and file into lines; compare lines with leading and
   trailing whitespace trimmed and internal whitespace runs collapsed.
3. The anchor is the range's first line(s). If it matches starting at `start`
   → status `exact`.
4. Else search the whole file for all matches and pick the one closest to the
   recorded `start` (ties → earlier). Place the range so it starts at the match
   and keeps its length, clamped to the file → status `moved`.
   (A single-line anchor may be a substring of a line; in a multi-line anchor
   the first line must end the file line, the last must start it, inner lines match whole.)
5. No match → keep `[start, end]` clamped to the file, status `stale`, and warn.
6. File missing → status `missing`; the panel says so and Next/Back still work.
7. *(Planned, from CodeTour's `ref`)* When the status is `stale` or `missing`
   and `head_commit` is set, the panel offers **Show as written**: it opens the
   file read-only at `head_commit` (the built-in Git extension's `toGitUri`) with
   the recorded `[start, end]`, which are exact there by definition.

#### 5.2.2 Rendering untrusted text

`summary` and `why` go through one renderer (`src/core/markdown.ts`), which is
unit-tested:

- Raw HTML is escaped, and images are not rendered.
- Links are kept only for `http(s)://` and step references (`#step-N`). Every
  other scheme (`command:`, `vscode:`, `file:`, `javascript:`, relative paths)
  is rendered as plain text.
- The webview has a nonce-only Content Security Policy and command URIs
  disabled. Link clicks are handled by the extension: a step link calls
  `goto`, and an http(s) link opens through `vscode.env.openExternal`, which
  asks the user to confirm.

### 5.3 Comments and feedback (roadmap step 4)

- A `CommentController` (`agent-walkthrough`) lets reviewers start a thread on any
  line range in any file while a walkthrough is open; the active step's range
  is offered as the default (**Comment on Step**: a button in the step's inline
  thread header and in the panel). Every comment belongs to the open walkthrough and
  goes to its feedback file (§4.2); `step` is set when the range overlaps the
  current step.
- Only the open walkthrough's `open` entries are shown as threads, relocated by
  their `anchor` when they have one. `applied` entries are hidden.
- Creating, editing or deleting a comment is a read-modify-write by `id`:
  re-read the file, apply the one change, write atomically (temp file, rename).
  This keeps an agent's concurrent `status` edits instead of overwriting them.
- A saved comment can be edited or deleted (with a confirmation) from its
  thread; reviewer comments have no replies, one entry per thread.
- The extension watches the feedback file and refreshes the threads when it
  changes on disk (e.g. the agent marked entries `applied`).
- **Copy to chat** (panel title-bar button, a panel link showing the count, and
  the command palette) copies the open entries of
  the open walkthrough only, as `file:start-end — comment` lines, prefixed with
  "Apply this review feedback on `.walkthrough/<session>.yaml`:" so the agent
  knows which feedback file to update.

### 5.4 Coverage check (roadmap step 5)

- Runs `git diff --unified=0 --ignore-blank-lines <base_commit> <head_commit>`
  when both are set (*commits* mode), otherwise `git diff --unified=0
  --ignore-blank-lines <base_commit>` against the working tree (`HEAD` if
  `base_commit` is absent; *worktree* mode), limited to the workspace folder and
  excluding `.walkthrough/`, and collects added/modified line ranges per file.
- In worktree mode, untracked files (`git ls-files --others --exclude-standard`)
  count as changed in full: agents create new files all the time and `git diff`
  doesn't see them. Binary files are skipped.
- A changed line is *covered* if it falls in some step's range: the recorded
  `lines` in commits mode (exact at `head_commit`), or the range resolved by its
  anchor (§5.2.1) in the file on disk in worktree mode.
- Uncovered ranges are shown in a **Not in Walkthrough** view (Explorer, only
  while a walkthrough is open; clicking a range opens it) and as a dotted gutter
  marker (theme colour `agent-walkthrough.uncoveredGutter`); the panel's overview
  shows `Coverage: covered / changed lines`.
- Deleted-only hunks are listed under **Removed code**, unless they sit right
  before, inside or right after a step's range (that step is taken to explain them).
- When there is nothing to compare (no changes, e.g. no `base_commit` and the
  agent already committed), the view says so instead of reporting full coverage.
  When git fails (not a repo, unknown commit) it shows the reason.
- In worktree mode the check re-runs when files change (debounced), and files
  edited after the walkthrough file was written are labelled "edited after the
  walkthrough", since those lines may be later edits such as applied feedback.

## 6. Caveats and mitigations

| Caveat | Mitigation |
|--------|------------|
| Line numbers drift after later edits | `anchor` relocation (§5.2.1); warn when not found. |
| Agent skips changes or explains them wrongly | Coverage check (§5.4). Explanations are the agent's claims, so reviewers still read the code. |
| No shared way to type into each harness's chat | Feedback file + clipboard for all; direct send later where a harness allows it. |
| Only Claude Code can force the step with a hook | Elsewhere it depends on the skill being followed, or the user asking. |
| Writing the tour costs tokens | Short steps; one per logical unit. |
| Flow order is the agent's judgment | Reviewer can jump to any step; the UI does not claim it matches runtime exactly. |

## 7. Repository layout

```
spec.md                      this document
schema/                      JSON Schemas for both files (normative)
examples/                    hand-made walkthroughs over a tiny sample app
skills/walkthrough/SKILL.md  the agent skill
.claude-plugin/              Claude Code plugin marketplace (marketplace.json)
plugins/agent-walkthrough-stop-hook/  optional Claude Code Stop hook, as a plugin
extension/                   VS Code extension (TypeScript)
  src/core/                  pure logic, no `vscode` import (unit-tested with node:test)
  src/                       VS Code glue: player, panel, commands
```

## 8. Roadmap and status

| # | Step | Status |
|---|------|--------|
| 1 | **Schema** — freeze v1 fields, two hand-made examples | done |
| 2 | **Skill** — SKILL.md; test on real sessions in Claude Code and Codex | written. 2026-09-28: write mode tested in a real Claude Code session (walkthrough decent, played back and commented on in VS Code). Pending: apply mode with a real agent; Codex |
| 3 | **Player** — load YAML, highlight, Next/Back, explanation panel | done (first cut), plus inline explanation in the editor; unit and VS Code integration tests pass. Planned: seen-step progress, **Show as written** |
| 4 | **Comments** — native threads → `<session>.feedback.yaml`, copy-to-chat | done (first cut); unit and VS Code integration tests pass |
| 5 | **Coverage check** — diff vs `base_commit`, show uncovered lines | done (first cut); unit tests (incl. a real temp git repo) and VS Code integration test pass |
| 6 | **Ship** — Marketplace + Open VSX; installer placing the skill per harness | not started |

## 9. Out of scope for v1

- Sending comments straight into each harness's chat window.
- An MCP server so the agent can read feedback as a tool.
- Tours across several sessions or PRs.
- A web viewer for reviewing outside VS Code.
- Importing or exporting CodeTour `.tour` files.

## 10. Lessons from CodeTour

Reviewed on 2026-09-27: [microsoft/codetour](https://github.com/microsoft/codetour)
(the `.tour` schema, player and README) and the
[community fork](https://github.com/maurice30120/codetour) (its MCP "Changes
Tour" generator and design records). The format stays YAML (D1); what follows
is what we took, what we deferred, and what we left out.

**Adopted**

| From | Idea | Where |
|------|------|-------|
| CodeTour `ref`, fork ADR 0004 | Pin a walkthrough to the commit it describes, but only when the changes are committed. For uncommitted work, record no commit, since that state can't be reproduced. | `head_commit` (§4.1), **Show as written** (§5.2.1) |
| Fork ADR 0003 | Generated tours are untrusted: no command links, `when` expressions or external URIs; only safe Markdown. | D7, §5.2.2 |
| Fork result codes | Report every validation problem in one pass, each with its field path; keep hard errors apart from warnings. | Parser (already did this); step-limit warning added |
| Fork `STEP_LIMIT_EXCEEDED` | Warn above 15 steps. | Parser, skill |
| CodeTour step references | `[#3]` and `[label][#3]` in descriptions link to another step. | §4.1, renderer |
| CodeTour progress | Remember which steps were seen, and resume where you left off. | §5.2 (planned) |

**Deferred (v2 candidates)**

| From | Idea | Why not yet |
|------|------|-------------|
| Fork ADR 0007 | Mermaid diagrams in `summary`, rendered and validated locally. | Useful for the architecture summary, but it adds a large dependency and needs its own sanitisation rules. |
| CodeTour Watch (CI) | Fail CI when a tour drifts from the code. | Our anchor logic is pure, so an `agent-walkthrough check` CLI is cheap later. Walkthroughs are per-session review aids, not long-lived docs, so drift matters less. |
| CodeTour tour markers | Gutter icon on lines that belong to a step, even when no walkthrough is playing. | Overlaps the coverage-check gutter (§5.4); decide after that ships. |
| CodeTour content steps | Steps with no file, e.g. "what I deliberately didn't change". | `summary` covers the intro case. Revisit if agents need to explain deletions or non-changes; `base_commit` could show deleted code the same way `head_commit` shows drifted code. |

**Rejected**

| From | Idea | Why |
|------|------|-----|
| CodeTour `pattern` (regex) | Locate a step by regular expression. | Agents write regexes poorly, and a bad regex fails silently. A literal first-line `anchor` is easier to write correctly and to check. |
| CodeTour `line` / `selection` with columns | Point at one line or a character span. | A reviewer reads whole logical units, so a line range is the right grain. |
| CodeTour `commands`, `when`, `>>` shell links, "Insert Code" | Interactive-tutorial features. | They run things, which D7 rules out. They also don't help anyone review a diff. |
| Fork ADR 0002 | One fixed output file, replaced on each generation. | We keep one file per session so several sessions can be reviewed, each with its own feedback file (D9). |
| CodeTour `nextTour`, `isPrimary` | Linking tours and choosing a primary one. | Tours across sessions are out of scope (§9). |
