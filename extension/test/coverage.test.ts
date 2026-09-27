import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeCoverage, parseDiff, subtract } from "../src/core/coverage";
import { collectChanges } from "../src/core/git";

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -3 +3 @@ export class A {
-  old();
+  new();
@@ -10,0 +11,4 @@ export class A {
+  a();
+  b();
+  c();
+  d();
@@ -20,2 +23,0 @@ export class A {
-  gone();
-  gone();
diff --git a/src/new file.ts b/src/new file.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new file.ts\t
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;
diff --git a/old.ts b/old.ts
deleted file mode 100644
index 4444444..0000000
--- a/old.ts
+++ /dev/null
@@ -1,5 +0,0 @@
-a
-b
-c
-d
-e
diff --git "a/src/t\\303\\251st.ts" "b/src/t\\303\\251st.ts"
--- "a/src/t\\303\\251st.ts"
+++ "b/src/t\\303\\251st.ts"
@@ -1 +1 @@
-x
+y
diff --git a/logo.png b/logo.png
index 5555555..6666666 100644
Binary files a/logo.png and b/logo.png differ
`;

test("parses added, modified and deleted lines per file", () => {
  assert.deepEqual(parseDiff(DIFF), [
    {
      file: "src/a.ts",
      added: [
        [3, 3],
        [11, 14],
      ],
      deleted: [{ file: "src/a.ts", after: 23, count: 2 }],
    },
    { file: "src/new file.ts", added: [[1, 2]], deleted: [] },
    { file: "old.ts", added: [], deleted: [{ file: "old.ts", after: 0, count: 5 }] },
    { file: "src/tést.ts", added: [[1, 1]], deleted: [] },
  ]);
});

test("subtracts ranges", () => {
  assert.deepEqual(subtract([[1, 10]], [[3, 4]]), [
    [1, 2],
    [5, 10],
  ]);
  assert.deepEqual(subtract([[1, 10]], [[0, 20]]), []);
  assert.deepEqual(subtract([[5, 6], [1, 2]], [[2, 5]]), [
    [1, 1],
    [6, 6],
  ]);
  assert.deepEqual(subtract([[1, 3]], []), [[1, 3]]);
});

test("counts covered lines and lists the rest", () => {
  const cov = computeCoverage(parseDiff(DIFF), [
    { file: "src/a.ts", start: 10, end: 23 },
    { file: "src/new file.ts", start: 1, end: 2 },
  ]);
  assert.equal(cov.changed, 1 + 4 + 2 + 1);
  assert.equal(cov.covered, 4 + 2);
  assert.deepEqual(cov.uncovered, [
    { file: "src/a.ts", ranges: [[3, 3]] },
    { file: "src/tést.ts", ranges: [[1, 1]] },
  ]);
  // The removal after line 23 sits at the end of the step, so only old.ts is listed.
  assert.deepEqual(cov.deleted, [{ file: "old.ts", after: 0, count: 5 }]);
});

// ── git, against a throwaway repository ─────────────────────────────────────

function repo(): { dir: string; git: (...args: string[]) => string; write: (p: string, s: string) => void } {
  const dir = mkdtempSync(join(tmpdir(), "walkmethrough-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], {
      cwd: dir,
      encoding: "utf8",
    }).trim();
  const write = (p: string, s: string) => {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), s);
  };
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  return { dir, git, write };
}

test("worktree mode: diff against base_commit plus untracked files, minus .walkthrough/", async () => {
  const { dir, git, write } = repo();
  try {
    write("app/src/a.ts", "one\ntwo\nthree\n");
    git("add", "-A");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");

    write("app/src/a.ts", "one\nTWO\nthree\nfour\n");
    write("app/src/new.ts", "x\ny\n");
    write("app/.walkthrough/w.yaml", "version: 1\n");
    write("app/logo.bin", "\0\0binary");
    write("other/b.ts", "outside the workspace folder\n");

    const got = await collectChanges(join(dir, "app"), base);
    assert.equal(got.mode, "worktree");
    assert.deepEqual(
      got.diffs.map((d) => [d.file, d.added]),
      [
        [
          "src/a.ts",
          [
            [2, 2],
            [4, 4],
          ],
        ],
        ["src/new.ts", [[1, 2]]],
      ],
    );

    // No base_commit: compare with HEAD.
    git("add", "-A");
    git("commit", "-qm", "work");
    const clean = await collectChanges(join(dir, "app"));
    assert.deepEqual([clean.base, clean.diffs], ["HEAD", []]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("commits mode: base..head ignores later edits on disk", async () => {
  const { dir, git, write } = repo();
  try {
    write("a.ts", "1\n2\n3\n");
    git("add", "-A");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    write("a.ts", "1\n2\n3\n4\n");
    git("commit", "-qam", "head");
    const head = git("rev-parse", "HEAD");
    write("a.ts", "changed later\n2\n3\n4\n");

    const got = await collectChanges(dir, base, head);
    assert.equal(got.mode, "commits");
    assert.deepEqual(got.diffs, [{ file: "a.ts", added: [[4, 4]], deleted: [] }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reports unknown commits and folders outside git", async () => {
  const { dir, git, write } = repo();
  const outside = mkdtempSync(join(tmpdir(), "walkmethrough-nogit-"));
  try {
    write("a.ts", "1\n");
    git("add", "-A");
    git("commit", "-qm", "base");
    await assert.rejects(collectChanges(dir, "0123456789abcdef"), /base_commit 0123456789abcdef isn't in this repository/);
    await assert.rejects(collectChanges(outside), /isn't in a git repository/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
