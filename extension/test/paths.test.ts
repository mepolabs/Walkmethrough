import { test } from "node:test";
import assert from "node:assert/strict";
import { projectRootOf, relativeTo } from "../src/core/paths";

test("a walkthrough's project is the folder holding its .walkthrough/", () => {
  assert.equal(projectRootOf("/work/repo/.walkthrough/2026-09-27-x.yaml"), "/work/repo");
  assert.equal(projectRootOf("/work/mono/apps/api/.walkthrough/x.yaml"), "/work/mono/apps/api");
  assert.equal(projectRootOf("/c:/Users/me/repo/.walkthrough/x.yml"), "/c:/Users/me/repo");
  assert.equal(projectRootOf("/.walkthrough/x.yaml"), "/");
});

test("a walkthrough outside .walkthrough/ belongs to its own folder", () => {
  assert.equal(projectRootOf("/work/repo/docs/x.yaml"), "/work/repo/docs");
});

test("relativeTo gives paths inside the root and nothing outside it", () => {
  assert.equal(relativeTo("/work/repo", "/work/repo/src/a.ts"), "src/a.ts");
  assert.equal(relativeTo("/work/repo/", "/work/repo/src/a.ts"), "src/a.ts");
  assert.equal(relativeTo("/work/repo", "/work/repo"), "");
  assert.equal(relativeTo("/work/repo", "/work/repo-2/src/a.ts"), undefined);
  assert.equal(relativeTo("/work/repo", "/work/other/a.ts"), undefined);
  assert.equal(relativeTo("/", "/a.ts"), "a.ts");
});
