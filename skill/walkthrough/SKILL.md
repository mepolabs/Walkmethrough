---
name: walkthrough
description: Write a step-by-step code walkthrough of the changes made in this session to .walkthrough/<session>.yaml, ordered by execution flow, so a reviewer can play it back in the Walkmethrough VS Code extension. Use at the end of any session that changed code, or when the user asks for a walkthrough. Also use when the user asks to apply walkthrough feedback or review comments from .walkthrough/<session>.feedback.yaml.
---

# Walkthrough

You have two jobs: **write** a walkthrough of the code you changed, and **apply**
reviewer feedback left on it. Both use files in `.walkthrough/` at the repo root.

## Write a walkthrough

Do this at the end of every session in which you changed code, before your final message.

1. **Find the changes.** Run `git diff <base>` where `<base>` is the commit you
   started from (`git rev-parse HEAD` at session start; if you committed along the
   way, the commit before your first one). Include untracked files you created
   (`git status --porcelain`).
2. **Group into steps.** One step per logical unit (a route, a function, a query,
   a type), not per line or per hunk. Unrelated trivia (imports, formatting) does
   not need its own step unless it matters.
3. **Order by execution flow.** Follow the path a request or call takes: entry
   point → controller/handler → service/domain logic → data access → helpers.
   Put types and config just before the first step that uses them.
4. **Write `.walkthrough/<session>.yaml`**, where `<session>` is
   `YYYY-MM-DD-<short-slug>` (e.g. `2026-09-27-order-cancel`). Create the folder if
   needed. Never overwrite another session's file; add `-2` if the name is taken.

```yaml
version: 1
title: <what this session built, one line>
summary: |
  <2–5 sentences: the architecture of the change and how the pieces connect.
  Markdown is allowed. This is shown before step 1.>
base_commit: "<SHA of <base>>"      # quoted, so YAML keeps it a string
head_commit: "<SHA of HEAD>"         # only if all described changes are committed
steps:
  - title: <one-line name of the step>
    file: <path relative to repo root, forward slashes>
    lines: [<start>, <end>]        # 1-based, inclusive, current file contents
    anchor: "<the first line of the range, copied verbatim>"
    why: |
      <1–4 sentences: what this code does and why you wrote it this way.
      Mention alternatives you rejected if the choice is not obvious.>
```

Rules:

- `lines` must match the file **as it is now on disk** — re-read the file to get
  them; do not guess from the diff.
- `anchor` must be copied character-for-character from the **first line** of
  `lines` (or the first 2–3 lines if that one is not distinctive). Make the range
  start at a distinctive line — a signature, a route string — not `}` or `return x;`.
- Every changed hunk should fall inside some step. The reviewer's extension flags
  changed lines that no step covers.
- Keep it short: at most 15 steps. The code is on screen; `why` explains intent,
  not syntax.
- Refer to another step with `[#3]` or `[label][#3]`; the viewer turns these into links.
  Only `https://` links are shown as links; don't use `command:`, `file:` or HTML.
- Be honest: if something is a workaround, untested, or a guess, say so in `why`.

When done, tell the user the file path and that they can open it with
**Walkthrough: Open…** in VS Code.

## Apply feedback

Each walkthrough has its own feedback file next to it:
`.walkthrough/2026-09-27-order-cancel.yaml` → `.walkthrough/2026-09-27-order-cancel.feedback.yaml`.

When the user asks you to apply walkthrough feedback / review comments:

1. Pick the walkthrough. Use the one the user names (Copy to chat names it).
   If they don't name one, use the newest walkthrough whose feedback file has
   `status: open` entries, and tell the user which one you picked. Only read and
   change that walkthrough's feedback file, never another one's.
2. Read its `<session>.feedback.yaml`:

   ```yaml
   version: 1
   entries:
     - id: fb-...
       step: 3
       file: src/orders/service.ts
       lines: [28, 30]
       anchor: 'if (order.status !== "pending") {'
       comment: <the reviewer's request>
       status: open
       created: 2026-09-27T14:15:02Z
   ```

3. For each entry with `status: open`, in order: open `file` around `lines`
   (lines may have drifted; search for `anchor`, or the step's `anchor` in the
   walkthrough, to re-find them), make the requested change, or explain why
   you did not.
4. Set each handled entry's `status` to `applied`. Change only that field: do
   not delete entries, edit other fields, or rewrite the file wholesale (the
   reviewer's VS Code may be adding comments to it at the same time).
5. If your changes were substantial, write a fresh walkthrough for them (a new
   session file) as above.
6. Reply with one line per entry: what you changed, or why you left it.
