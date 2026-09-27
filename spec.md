# Walkmethrough — Specification (v1)

Source plan: "Agent Walkthrough — Plan" (Claude Docs, 2026-09-27).

## 1. Summary

A coding-agent session produces a lot of code at once. Reviewing it file by file,
in no particular order, makes it hard to see what each part does and why.

Walkmethrough closes that gap with three pieces joined by two files in the repo:

```
 Coding agent + skill ──writes at session end──▶ .walkthrough/<session>.yaml
        ▲                                                  │ played back
        │ agent reads and applies on request               ▼
 .walkthrough/feedback.yaml ◀──reviewer comments── VS Code extension
```

1. **Agent skill** — a `SKILL.md` that tells the agent to write
   `.walkthrough/<session>.yaml` at the end of a session, listing the changed code
   in execution order (controller → service → data layer), one step per logical unit.
2. **VS Code extension** — loads the walkthrough, opens each step's file, highlights
   its lines and shows the explanation in a side panel with **Next** and **Back**.
   Reviewers comment on any step using VS Code's native Comments API.
3. **Feedback loop** — every comment is saved to `.walkthrough/feedback.yaml` with
   file, lines and text. The skill tells the agent to read that file and apply it
   when the user asks. A copy-to-chat button puts the same text on the clipboard
   for any harness.

Targets: Claude Code, Codex, GitHub Copilot and Cursor. Open source.

## 2. Differentiation from prior art

[Microsoft CodeTour](https://github.com/microsoft/codetour) already plays guided
tours, and a [community fork](https://github.com/maurice30120/codetour) can
generate a "Changes Tour" over MCP. Walkmethrough adds:

- **Generated from the agent's diff**, not recorded by hand.
- **Ordered by execution flow**, not by file.
- **Coverage check** that flags changed lines no step explains.
- **Comments go back to the agent** as actionable feedback.

## 3. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | v1 reads only its own YAML schema; no CodeTour `.tour` import/export. | Resolves the plan's open decision in line with its own "out of scope for v1" list. The schema is small enough that a `.tour` converter can be added later without changing it. |
| D2 | YAML, not JSON, for both files. | Agents write multi-line prose (`why`) more reliably in YAML block scalars; humans can read and hand-edit it. |
| D3 | Files carry `version: 1`. | One extra field buys forward compatibility; the player refuses unknown major versions with a clear message. |
| D4 | Line numbers are 1-based and inclusive. | Matches what editors, `git diff` and agents show. |
| D5 | The extension never rewrites a walkthrough file. | The file is the agent's claim; reviewer state (position, comments) lives elsewhere. |
| D6 | Feedback entries reference steps by 1-based index **and** carry `file`/`lines`. | The index gives context; file and lines make the entry actionable even if the walkthrough is regenerated. |

## 4. File formats

All paths are relative to the workspace (repo) root and use `/` separators.
JSON Schemas live in [`schema/`](schema/) and are the normative definition;
this section explains them.

### 4.1 Walkthrough file — `.walkthrough/<session>.yaml`

`<session>` is a filename-safe id chosen by the agent, recommended
`YYYY-MM-DD-<short-slug>` (e.g. `2026-09-27-order-cancel`). Any `*.yaml` or
`*.yml` in `.walkthrough/` other than `feedback.yaml` is a walkthrough.

| Field | Level | Required | Type | Purpose |
|-------|-------|----------|------|---------|
| `version` | file | yes | `1` | Schema version (D3). |
| `title` | file | yes | string | What the session built. |
| `summary` | file | no | string (Markdown) | Architecture explanation shown before step 1. |
| `base_commit` | file | no | string (commit SHA) | Commit the walkthrough was written against; the coverage check diffs against it. |
| `steps` | file | yes | list, ≥1 | Steps in execution order. |
| `file` | step | yes | string | Path relative to the repo root. |
| `lines` | step | yes | `[start, end]` integers, `1 ≤ start ≤ end` | Lines the step covers. |
| `anchor` | step | no (strongly recommended) | string | The range's first 1–3 lines, verbatim, used to re-find the lines after edits (§5.2.1). |
| `title` | step | yes | string | One-line name of the step. |
| `why` | step | yes | string (Markdown) | What the code does and why the agent wrote it this way. |

Unknown fields are ignored with a warning (not an error), so newer agents can
add fields without breaking older players.

Example:

```yaml
version: 1
title: Cancel an order
summary: |
  `POST /orders/:id/cancel` goes controller → service → repository.
  The service owns the business rule (only `pending` orders can be cancelled).
base_commit: 3f2c1a9
steps:
  - title: Route and controller
    file: src/orders/controller.ts
    lines: [12, 24]
    anchor: "router.post('/orders/:id/cancel'"
    why: |
      New route. The controller only parses the id and maps errors to HTTP codes.
```

### 4.2 Feedback file — `.walkthrough/feedback.yaml`

One file per repo, appended to by the extension.

```yaml
version: 1
entries:
  - id: fb-20260927-141502-a1b2         # unique, stable
    walkthrough: 2026-09-27-order-cancel.yaml
    step: 2                              # 1-based step index
    file: src/orders/service.ts
    lines: [8, 19]
    comment: Return 409 instead of throwing a generic Error here.
    status: open                         # open | applied
    created: 2026-09-27T14:15:02Z
```

| Field | Required | Purpose |
|-------|----------|---------|
| `id` | yes | Stable id so the extension can update/delete a comment. |
| `walkthrough` | yes | File name of the walkthrough the comment was made in. |
| `step` | no | 1-based step index; absent for comments made outside a step. |
| `file`, `lines` | yes | Where the comment points (same rules as steps). |
| `comment` | yes | Reviewer's text. |
| `status` | yes | `open` until the agent applies it, then `applied`. |
| `created` | yes | ISO-8601 UTC timestamp. |

The agent flips `status` to `applied` after acting on an entry; it never deletes entries.

## 5. Component specs

### 5.1 Agent skill (`skill/walkthrough/SKILL.md`)

- Frontmatter `name: walkthrough` and a description that triggers at the end of
  any session that changed code, and when the user says "apply walkthrough feedback".
- **Write mode**: run `git diff <base>` (base = `HEAD` at session start, or the
  merge-base with the default branch), group hunks into logical units, order
  them by execution flow, and write `.walkthrough/<session>.yaml` per §4.1.
  Rules: one step per logical unit, not per line; `why` is 1–4 sentences;
  `anchor` is copied verbatim from the file; every changed hunk should be in
  some step (the coverage check will flag gaps).
- **Apply mode**: read `.walkthrough/feedback.yaml`, act on every `status: open`
  entry, set each to `applied`, and summarise what changed.
- Installation: `.agents/skills/walkthrough/` (Codex, Copilot, Cursor) and a copy
  in `.claude/skills/walkthrough/` (Claude Code).
- Claude Code only: an optional `Stop` hook (`skill/hooks/require-walkthrough.mjs`)
  blocks the first stop of a session when the working tree has changes and no
  walkthrough was written since they were made. It honours `stop_hook_active`
  so it can never loop.

### 5.2 VS Code extension (`extension/`)

Engine: VS Code `^1.90`; also published to Open VSX so Cursor can install it.

**Commands**

| Command | Title | Default key |
|---------|-------|-------------|
| `walkmethrough.open` | Walkthrough: Open… (quick-pick of `.walkthrough/*.yaml`) | — |
| `walkmethrough.next` | Walkthrough: Next Step | `Alt+]` while playing |
| `walkmethrough.back` | Walkthrough: Previous Step | `Alt+[` while playing |
| `walkmethrough.goto` | Walkthrough: Go to Step… | — |
| `walkmethrough.close` | Walkthrough: Close | — |

**Player behaviour**

- Position 0 is the overview (title + summary); positions 1…N are steps.
- On entering a step: open the file, resolve the range (§5.2.1), select nothing,
  reveal the range centred, and decorate those lines (whole-line background +
  gutter bar, theme colour `walkmethrough.stepHighlight`).
- A webview view **Walkthrough** (Explorer sidebar) shows: title, "Step k of N",
  step title, rendered `why`, file:lines link, a warning banner when the anchor
  was relocated or not found, and **Back / Next** buttons.
- A status-bar item shows `$(book) k/N`; clicking it runs Next.
- The context key `walkmethrough.playing` is true while a walkthrough is open.
- A file that fails validation opens nothing and shows every error with its
  YAML path (e.g. `steps[2].lines: end (4) is before start (9)`).
- The file watcher reloads the walkthrough if it changes on disk, keeping the
  current step index when it still exists.

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

### 5.3 Comments and feedback (roadmap step 4)

- A `CommentController` (`walkmethrough`) lets reviewers start a thread on any
  line range in any file while a walkthrough is open; the active step's range
  is offered as the default.
- Creating, editing or deleting a comment writes `feedback.yaml` (§4.2)
  atomically (write temp file, rename).
- Existing `open` entries are shown as threads when the walkthrough opens.
- **Copy to chat** (thread action and panel button) copies:
  `file:start-end — comment` lines for all open entries, prefixed with
  "Apply this review feedback:".

### 5.4 Coverage check (roadmap step 5)

- Runs `git diff --unified=0 <base_commit>` (falls back to `HEAD` if absent) in
  the workspace, and collects added/modified line ranges per file.
- A changed line is *covered* if it falls in some step's resolved range.
- Uncovered ranges are shown in a **Not in walkthrough** tree and as a subtle
  gutter marker; the overview shows `covered / changed` lines.
- Deleted-only hunks are listed separately (they have no lines to highlight).

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
skill/walkthrough/SKILL.md   the agent skill
skill/hooks/                 optional Claude Code Stop hook
extension/                   VS Code extension (TypeScript)
  src/core/                  pure logic, no `vscode` import (unit-tested with node:test)
  src/                       VS Code glue: player, panel, commands
```

## 8. Roadmap and status

| # | Step | Status |
|---|------|--------|
| 1 | **Schema** — freeze v1 fields, two hand-made examples | done |
| 2 | **Skill** — SKILL.md; test on real sessions in Claude Code and Codex | written; real-session testing pending |
| 3 | **Player** — load YAML, highlight, Next/Back, explanation panel | done (first cut); unit-tested, VS Code integration test written but not yet run |
| 4 | **Comments** — native threads → `feedback.yaml`, copy-to-chat | not started |
| 5 | **Coverage check** — diff vs `base_commit`, show uncovered lines | not started |
| 6 | **Ship** — Marketplace + Open VSX; installer placing the skill per harness | not started |

## 9. Out of scope for v1

- Sending comments straight into each harness's chat window.
- An MCP server so the agent can read feedback as a tool.
- Tours across several sessions or PRs.
- A web viewer for reviewing outside VS Code.
- Importing or exporting CodeTour `.tour` files.
