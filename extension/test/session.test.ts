import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "../src/core/session";
import { Walkthrough } from "../src/core/walkthrough";

function wt(n: number): Walkthrough {
  return {
    version: 1,
    title: "T",
    steps: Array.from({ length: n }, (_, i) => ({ title: `s${i + 1}`, file: "a.ts", lines: [1, 1], why: "w" })),
  };
}

test("starts on the overview and walks forward and back", () => {
  const s = new Session(wt(2), ".walkthrough/x.yaml");
  // A function avoids TypeScript narrowing `s.step` to undefined after the first assert.
  const current = () => s.step?.title;
  assert.equal(s.position, 0);
  assert.equal(s.step, undefined);
  assert.ok(!s.canGoBack);
  assert.ok(s.next());
  assert.equal(current(), "s1");
  assert.ok(s.next());
  assert.ok(!s.canGoNext);
  assert.ok(!s.next(), "no-op past the end");
  assert.equal(s.position, 2);
  assert.ok(s.back());
  assert.equal(current(), "s1");
});

test("goto clamps to the valid range", () => {
  const s = new Session(wt(3), "x");
  s.goto(99);
  assert.equal(s.position, 3);
  s.goto(-4);
  assert.equal(s.position, 0);
});

test("replace keeps the position when it still exists", () => {
  const s = new Session(wt(3), "x");
  s.goto(2);
  s.replace(wt(4));
  assert.equal(s.position, 2);
  s.goto(4);
  s.replace(wt(1));
  assert.equal(s.position, 1);
});
