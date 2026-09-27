import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addEntry,
  deleteEntry,
  FeedbackEntry,
  formatForChat,
  newEntryId,
  parseFeedback,
  timestamp,
  updateComment,
} from "../src/core/feedback";

const entry = (over: Partial<FeedbackEntry> = {}): FeedbackEntry => ({
  id: "fb-1",
  step: 2,
  file: "src/a.ts",
  lines: [3, 4],
  anchor: "export class A {",
  comment: "Rename this.",
  status: "open",
  created: "2026-09-28T10:00:00Z",
  ...over,
});

test("creates the file on the first comment", () => {
  const text = addEntry(undefined, entry());
  assert.equal(
    text,
    `version: 1
entries:
  - id: fb-1
    step: 2
    file: src/a.ts
    lines: [3, 4]
    anchor: export class A {
    comment: Rename this.
    status: open
    created: 2026-09-28T10:00:00Z
`,
  );
  assert.deepEqual(parseFeedback(text), { entries: [entry()], warnings: [] });
});

test("round-trips multi-line comments and anchors with quotes", () => {
  const e = entry({ comment: "First line.\nSecond: with colon.\n", anchor: 'if (x !== "a") {', step: undefined });
  const parsed = parseFeedback(addEntry(undefined, e));
  assert.deepEqual(parsed.entries, [e]);
});

test("edits keep the rest of the file, including the agent's changes and YAML comments", () => {
  let text = addEntry(undefined, entry());
  text = addEntry(text, entry({ id: "fb-2", comment: "Second." }));
  // The agent applies fb-1 and leaves a note.
  text = text.replace("status: open", "status: applied # done in abc123");
  text = updateComment(text, "fb-2", "Second, edited.");
  assert.match(text, /status: applied # done in abc123/);
  assert.deepEqual(
    parseFeedback(text).entries.map((e) => [e.id, e.status, e.comment]),
    [
      ["fb-1", "applied", "Rename this."],
      ["fb-2", "open", "Second, edited."],
    ],
  );
  text = deleteEntry(text, "fb-1");
  assert.deepEqual(
    parseFeedback(text).entries.map((e) => e.id),
    ["fb-2"],
  );
  assert.equal(deleteEntry(text, "gone"), text, "deleting a missing entry is a no-op");
});

test("appends to an empty flow list as a block", () => {
  const text = addEntry("version: 1\nentries: []\n", entry());
  assert.match(text, /^entries:\n {2}- id: fb-1$/m);
});

test("refuses to overwrite a file it can't read", () => {
  for (const bad of ["version: 1\nentries: [", "- a\n- b\n", "version: 2\nentries: []\n", "version: 1\nentries: {}\n"]) {
    assert.ok(parseFeedback(bad).error, bad);
    assert.throws(() => addEntry(bad, entry()), Error, bad);
  }
  assert.throws(() => updateComment(addEntry(undefined, entry()), "gone", "x"), /no longer/);
});

test("skips invalid entries with a warning and keeps the rest", () => {
  const text = `version: 1
entries:
  - id: ok
    file: ./src/a.ts
    lines: [1, 2]
    comment: fine
    status: open
    created: 2026-09-28T10:00:00Z
  - id: bad
    file: ../x.ts
    lines: [5, 1]
    comment: ""
    status: done
    created: 2026-09-28T10:00:00Z
  - id: ok
    file: b.ts
    lines: [1, 1]
    comment: dup
    status: open
    created: 2026-09-28T10:00:00Z
`;
  const r = parseFeedback(text);
  assert.equal(r.error, undefined);
  assert.deepEqual(
    r.entries.map((e) => [e.id, e.file]),
    [["ok", "src/a.ts"]],
  );
  for (const want of ["entries[1].comment", "entries[1].lines", "entries[1].status", "entries[1].file", 'entries[2].id: duplicate "ok"']) {
    assert.ok(
      r.warnings.some((w) => w.startsWith(want)),
      want,
    );
  }
});

test("formats open entries for the agent's chat", () => {
  const text = formatForChat(".walkthrough/2026-09-27-x.yaml", [
    entry(),
    entry({ id: "fb-2", status: "applied" }),
    entry({ id: "fb-3", file: "b.ts", lines: [7, 7], comment: "Two\nlines" }),
  ]);
  assert.equal(
    text,
    "Apply this review feedback on `.walkthrough/2026-09-27-x.yaml`:\n\n- src/a.ts:3-4 — Rename this.\n- b.ts:7 — Two\n  lines\n",
  );
});

test("makes ids and timestamps in UTC", () => {
  const now = new Date("2026-09-28T10:05:09.123Z");
  assert.equal(newEntryId(now, () => 0), "fb-20260928-100509-0000");
  assert.match(newEntryId(now), /^fb-20260928-100509-[0-9a-z]{4}$/);
  assert.equal(timestamp(now), "2026-09-28T10:05:09Z");
});
