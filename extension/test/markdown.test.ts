import { test } from "node:test";
import assert from "node:assert/strict";
import { linkStepReferences, renderMarkdown, renderMarkdownForEditor, stepFromHref } from "../src/core/markdown";

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

test("turns step links into command links for the editor", () => {
  const html = renderMarkdownForEditor("see [#3] and [docs](https://example.com)", "walkmethrough.goto");
  assert.match(html, /<a href="command:walkmethrough.goto\?%5B3%5D">#3<\/a>/);
  assert.match(html, /<a href="https:\/\/example.com">docs<\/a>/);
});

test("untrusted text can't smuggle a command link into the editor view", () => {
  for (const text of ['[x](command:walkmethrough.goto?[1])', '`href="#step-1"`', 'href="#step-1"']) {
    assert.doesNotMatch(renderMarkdownForEditor(text, "walkmethrough.goto"), /href="command:/, text);
  }
});

test("reads the step number from a link", () => {
  assert.equal(stepFromHref("#step-4"), 4);
  assert.equal(stepFromHref("https://example.com"), undefined);
});
