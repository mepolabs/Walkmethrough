import { test } from "node:test";
import assert from "node:assert/strict";
import { findAnchor, resolveRange } from "../src/core/anchor";

const file = [
  "import x from 'x';", //   1
  "", //                     2
  "function a() {", //       3
  "  return 1;", //          4
  "}", //                    5
  "", //                     6
  "function b() {", //       7
  "  return 2;", //          8
  "}", //                    9
].join("\n");

test("exact when the anchor is inside the recorded range", () => {
  assert.deepEqual(resolveRange(file, [7, 9], "function b() {"), { start: 7, end: 9, status: "exact" });
});

test("moved: follows the anchor and keeps the range length", () => {
  const shifted = "// new header\n// another\n" + file;
  assert.deepEqual(resolveRange(shifted, [7, 9], "function b() {"), { start: 9, end: 11, status: "moved" });
});

test("moved: picks the match closest to the recorded start", () => {
  const twice = file + "\n\nfunction b() {\n  return 3;\n}";
  const shifted = "// x\n" + twice;
  // Matches at 8 and 14; 8 is closer to 7.
  assert.deepEqual(resolveRange(shifted, [7, 9], "function b() {"), { start: 8, end: 10, status: "moved" });
});

test("stale: keeps the recorded range when the anchor is gone", () => {
  assert.deepEqual(resolveRange(file, [3, 5], "function gone() {"), { start: 3, end: 5, status: "stale" });
});

test("unanchored: uses the recorded range, clamped to the file", () => {
  assert.deepEqual(resolveRange(file, [8, 40], undefined), { start: 8, end: 9, status: "unanchored" });
  assert.deepEqual(resolveRange(file, [50, 60], undefined), { start: 9, end: 9, status: "unanchored" });
});

test("ignores indentation and whitespace differences", () => {
  const reindented = file.replace("function b() {", "    function   b()  {");
  assert.equal(resolveRange(reindented, [7, 9], "function b() {").status, "exact");
});

test("single-line anchors may be a substring of the line", () => {
  assert.deepEqual(findAnchor(file.split("\n"), "b()"), [7]);
});

test("multi-line anchors match consecutive lines", () => {
  const lines = file.split("\n");
  assert.deepEqual(findAnchor(lines, "function b() {\n  return 2;\n"), [7]);
  assert.deepEqual(findAnchor(lines, "}\n\nfunction b() {"), [5]);
  assert.deepEqual(findAnchor(lines, "function b() {\n  return 1;"), []);
});

test("handles CRLF files", () => {
  const crlf = file.replace(/\n/g, "\r\n");
  assert.deepEqual(resolveRange(crlf, [7, 9], "function b() {"), { start: 7, end: 9, status: "exact" });
});

test("moved even when the new position is still inside the old range", () => {
  const shifted = "// one\n" + file;
  // Anchor was line 3; it's now line 4, which is inside [3, 5] but not the start.
  assert.deepEqual(resolveRange(shifted, [3, 5], "function a() {"), { start: 4, end: 6, status: "moved" });
});
