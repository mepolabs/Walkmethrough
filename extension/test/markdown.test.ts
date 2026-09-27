import { test } from "node:test";
import assert from "node:assert/strict";
import { linkStepReferences, renderMarkdown, stepFromHref } from "../src/core/markdown";

test("links step references", () => {
  assert.equal(linkStepReferences("see [#3]"), "see [#3](#step-3)");
  assert.equal(linkStepReferences("see [the service][#2]."), "see [the service](#step-2).");
  assert.match(renderMarkdown("see [#3]"), /<a href="#step-3">#3<\/a>/);
});

test("leaves step references in code alone", () => {
  assert.equal(linkStepReferences("`arr[#1]` and\n```\nx[#2]\n```"), "`arr[#1]` and\n```\nx[#2]\n```");
});

test("keeps http(s) links", () => {
  assert.match(renderMarkdown("[docs](https://example.com)"), /<a href="https:\/\/example.com">docs<\/a>/);
});

test("drops active and local link schemes", () => {
  for (const url of [
    "command:workbench.action.terminal.new",
    "vscode://ms-vscode.foo",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "src/a.ts",
  ]) {
    assert.doesNotMatch(renderMarkdown(`[x](${url})`), /<a /, url);
  }
});

test("escapes raw HTML and skips images", () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> ![i](https://example.com/i.png)');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test("reads the step number from a link", () => {
  assert.equal(stepFromHref("#step-4"), 4);
  assert.equal(stepFromHref("https://example.com"), undefined);
});
