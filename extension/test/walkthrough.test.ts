import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { feedbackFileName, isWalkthroughFileName, normalisePath, parseWalkthrough } from "../src/core/walkthrough";

const EXAMPLE_DIR = join(__dirname, "..", "..", "..", "examples", "order-api");

const minimal = `
version: 1
title: T
steps:
  - title: S
    file: a.ts
    lines: [1, 2]
    why: because
`;

test("parses a minimal walkthrough", () => {
  const r = parseWalkthrough(minimal);
  assert.deepEqual(r.errors, []);
  assert.equal(r.walkthrough?.steps[0].file, "a.ts");
  assert.deepEqual(r.walkthrough?.steps[0].lines, [1, 2]);
});

test("the example walkthroughs are valid and their anchors resolve exactly", async () => {
  const { resolveRange } = await import("../src/core/anchor");
  const dir = join(EXAMPLE_DIR, ".walkthrough");
  const names = readdirSync(dir).filter(isWalkthroughFileName);
  assert.equal(names.length, 2);
  for (const name of names) {
    const r = parseWalkthrough(readFileSync(join(dir, name), "utf8"));
    assert.deepEqual(r.errors, [], name);
    assert.deepEqual(r.warnings, [], name);
    for (const step of r.walkthrough!.steps) {
      const text = readFileSync(join(EXAMPLE_DIR, step.file), "utf8");
      const resolved = resolveRange(text, step.lines, step.anchor);
      assert.equal(resolved.status, "exact", `${name}: ${step.title}`);
    }
  }
});

test("reports every error with its path", () => {
  const r = parseWalkthrough(`
version: 1
steps:
  - title: ""
    file: a.ts
    lines: [9, 4]
    why: x
  - file: b.ts
    lines: [0, 1]
    anchor: ""
`);
  assert.equal(r.walkthrough, undefined);
  assert.deepEqual(r.errors, [
    "title: required, non-empty string",
    "steps[0].title: required, non-empty string",
    "steps[0].lines: end (4) is before start (9)",
    "steps[1].title: required, non-empty string",
    "steps[1].why: required, non-empty string",
    "steps[1].lines: start (0) must be at least 1",
    "steps[1].anchor: must be a non-empty string",
  ]);
});

test("rejects unsupported versions and missing steps", () => {
  const r = parseWalkthrough("version: 2\ntitle: T\nsteps: []\n");
  assert.deepEqual(r.errors, [
    "version: 2 is not supported (expected 1); update the extension",
    "steps: required, at least one step",
  ]);
});

test("reports YAML syntax errors", () => {
  const r = parseWalkthrough("version: 1\ntitle: [unclosed\n");
  assert.ok(r.errors.length > 0);
  assert.match(r.errors[0], /^YAML: /);
});

test("warns on unknown fields but still parses", () => {
  const r = parseWalkthrough(minimal + "extra: 1\n");
  assert.ok(r.walkthrough);
  assert.deepEqual(r.warnings, ["extra: unknown field, ignored"]);
});

test("validates base_commit and head_commit as SHAs", () => {
  assert.deepEqual(parseWalkthrough(minimal + "base_commit: 3f2c1a9\nhead_commit: 9a8b7c6\n").errors, []);
  assert.deepEqual(parseWalkthrough(minimal + "base_commit: main\n").errors, [
    'base_commit: "main" is not a commit SHA',
  ]);
  assert.deepEqual(parseWalkthrough(minimal + "head_commit: [1]\n").errors, [
    "head_commit: [1] is not a commit SHA",
  ]);
});

test("keeps SHAs that YAML would read as numbers", () => {
  const r = parseWalkthrough(minimal + "base_commit: 0123456\nhead_commit: 12e4567\n");
  assert.deepEqual(r.errors, []);
  assert.equal(r.walkthrough?.base_commit, "0123456");
  assert.equal(r.walkthrough?.head_commit, "12e4567");
});

test("warns when a walkthrough has more than 15 steps", () => {
  const step = "  - title: S\n    file: a.ts\n    lines: [1, 2]\n    why: w\n";
  const r = parseWalkthrough("version: 1\ntitle: T\nsteps:\n" + step.repeat(16));
  assert.ok(r.walkthrough);
  assert.deepEqual(r.warnings, ["steps: 16 steps; keep walkthroughs to 15 or fewer"]);
});

test("normalises paths", () => {
  assert.equal(normalisePath("./src\\a.ts"), "src/a.ts");
  assert.equal(normalisePath("/src/a.ts"), "src/a.ts");
});

test("recognises walkthrough file names", () => {
  assert.ok(isWalkthroughFileName("2026-09-27-x.yaml"));
  assert.ok(isWalkthroughFileName("x.yml"));
  assert.ok(!isWalkthroughFileName("2026-09-27-x.feedback.yaml"));
  assert.ok(!isWalkthroughFileName("x.feedback.yml"));
  assert.ok(!isWalkthroughFileName("notes.md"));
});

test("example feedback files sit next to their walkthrough and their anchors resolve", async () => {
  const { resolveRange } = await import("../src/core/anchor");
  const { parse } = await import("yaml");
  const dir = join(EXAMPLE_DIR, ".walkthrough");
  const names = readdirSync(dir);
  const feedback = names.filter((n) => /\.feedback\.ya?ml$/.test(n));
  assert.ok(feedback.length > 0);
  for (const name of feedback) {
    assert.ok(
      names.some((w) => isWalkthroughFileName(w) && feedbackFileName(w) === name),
      `${name} has a walkthrough`,
    );
    for (const entry of parse(readFileSync(join(dir, name), "utf8")).entries) {
      assert.equal(entry.walkthrough, undefined, "the file name says which walkthrough");
      const text = readFileSync(join(EXAMPLE_DIR, entry.file), "utf8");
      assert.equal(resolveRange(text, entry.lines, entry.anchor).status, "exact", entry.id);
    }
  }
});

test("names a walkthrough's feedback file", () => {
  assert.equal(feedbackFileName("2026-09-27-x.yaml"), "2026-09-27-x.feedback.yaml");
  assert.equal(feedbackFileName("x.yml"), "x.feedback.yml");
});

test("rejects paths that leave the repo", () => {
  const r = parseWalkthrough(minimal.replace("file: a.ts", "file: ../secrets.txt"));
  assert.deepEqual(r.errors, ['steps[0].file: must stay inside the repo (no "..")']);
});
