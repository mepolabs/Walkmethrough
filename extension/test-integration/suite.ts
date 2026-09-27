// Runs inside the VS Code extension host. Plays the example walkthrough end to end.
import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { Api } from "../src/extension";

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  console.log(`  ✓ ${name}`);
}

async function waitFor(what: string, cond: () => boolean, ms = 5000): Promise<void> {
  const until = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > until) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

function activeFileAndLine(): [string, number] {
  const editor = vscode.window.activeTextEditor;
  assert.ok(editor, "an editor is open");
  return [vscode.workspace.asRelativePath(editor.document.uri), editor.selection.active.line + 1];
}

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension<Api>("mepolabs.walkmethrough");
  assert.ok(ext, "extension is installed");
  const api = await ext.activate();
  const root = vscode.workspace.workspaceFolders![0].uri;
  const file = vscode.Uri.joinPath(root, ".walkthrough", "2026-09-27-order-cancel.yaml");

  await check("opens on the overview", async () => {
    await vscode.commands.executeCommand("walkmethrough.open", file);
    assert.equal(api.player.active?.position, 0);
    assert.equal(api.player.active?.walkthrough.title, "Cancel a pending order");
  });

  await check("Next opens each step's file at its first line", async () => {
    const expected: [string, number][] = [
      ["src/orders/controller.ts", 14],
      ["src/orders/service.ts", 3],
      ["src/orders/service.ts", 25],
      ["src/orders/repository.ts", 33],
      ["src/orders/repository.ts", 42],
    ];
    for (const [path, line] of expected) {
      await vscode.commands.executeCommand("walkmethrough.next");
      assert.deepEqual(activeFileAndLine(), [path, line]);
      const view = api.player.view;
      assert.equal(view.kind === "step" && view.range.status, "exact");
    }
    assert.equal(api.player.active?.canGoNext, false);
  });

  await check("shows the explanation inline under the step's lines", async () => {
    await api.player.goto(2);
    const thread = api.inline.thread;
    assert.ok(thread, "a comment thread is shown");
    assert.equal(vscode.workspace.asRelativePath(thread.uri), "src/orders/service.ts");
    assert.equal(thread.label, "Step 2 of 5");
    const view = api.player.view;
    assert.ok(view.kind === "step");
    assert.deepEqual([thread.range!.start.line + 1, thread.range!.end.line + 1], [view.range.start, view.range.end]);
    assert.equal(thread.comments[0].author.name, api.player.active?.step?.title);

    await vscode.commands.executeCommand("walkmethrough.goto", 5);
    assert.equal(api.player.active?.position, 5, "step links pass a number to goto");
    assert.notEqual(api.inline.thread, thread, "the old thread is replaced");

    await api.player.goto(0);
    assert.equal(api.inline.thread, undefined, "no thread on the overview");
    await api.player.goto(5);
  });

  const feedbackUri = vscode.Uri.joinPath(root, ".walkthrough", "2026-09-27-order-cancel.feedback.yaml");
  const original = new TextDecoder().decode(await vscode.workspace.fs.readFile(feedbackUri));
  const readFeedback = async () => new TextDecoder().decode(await vscode.workspace.fs.readFile(feedbackUri));
  try {
    await check("shows the walkthrough's existing open comments", async () => {
      await waitFor("comments load", () => api.review.open.length === 1);
      const thread = api.review.thread("fb-20260927-141502-a1b2");
      assert.ok(thread);
      assert.equal(vscode.workspace.asRelativePath(thread.uri), "src/orders/service.ts");
      assert.deepEqual([thread.range.start.line + 1, thread.range.end.line + 1], [28, 30]);
      assert.equal(thread.label, "Review comment · step 3");
    });

    let id = "";
    await check("a new comment on a step is saved to the walkthrough's feedback file", async () => {
      await api.player.goto(2);
      const draft = api.review.commentOnStep();
      assert.ok(draft, "a draft thread opens on the step");
      await api.review.create({ thread: draft, text: "Use one DomainError with a code." });
      const saved = api.review.open.find((e) => e.comment === "Use one DomainError with a code.");
      assert.ok(saved);
      id = saved.id;
      assert.deepEqual(
        [saved.step, saved.file, saved.lines, saved.anchor],
        [2, "src/orders/service.ts", [3, 4], "export class OrderNotFound extends Error {}"],
      );
      assert.equal(api.review.thread(id), draft, "the draft becomes the comment's thread");
      const text = await readFeedback();
      assert.match(text, /fb-20260927-141502-a1b2[\s\S]*Use one DomainError with a code\./, "appended after the existing entry");
    });

    await check("editing a comment rewrites only that entry", async () => {
      const comment = api.review.thread(id)!.comments[0] as vscode.Comment & { body: string };
      comment.body = "Use one DomainError with a code field.";
      await vscode.commands.executeCommand("walkmethrough.comment.save", comment);
      const text = await readFeedback();
      assert.match(text, /comment: Use one DomainError with a code field\./);
      assert.match(text, /comment: Paid orders should also be cancellable/);
    });

    await check("Copy to chat names the walkthrough and lists its open comments", async () => {
      await vscode.commands.executeCommand("walkmethrough.copyFeedback");
      assert.equal(
        await vscode.env.clipboard.readText(),
        [
          "Apply this review feedback on `.walkthrough/2026-09-27-order-cancel.yaml`:",
          "",
          "- src/orders/service.ts:28-30 — Paid orders should also be cancellable if they have not shipped yet; add a refund TODO.",
          "- src/orders/service.ts:3-4 — Use one DomainError with a code field.",
          "",
        ].join("\n"),
      );
    });

    await check("comments the agent marks applied disappear", async () => {
      const text = (await readFeedback()).replace(/status: open/g, "status: applied");
      await vscode.workspace.fs.writeFile(feedbackUri, new TextEncoder().encode(text));
      await waitFor("the watcher reloads", () => api.review.open.length === 0);
      assert.equal(api.review.thread(id), undefined);
      assert.equal(api.review.thread("fb-20260927-141502-a1b2"), undefined);
    });
  } finally {
    await vscode.workspace.fs.writeFile(feedbackUri, new TextEncoder().encode(original));
    await api.player.goto(5);
  }

  await check("Back returns to the previous step", async () => {
    await vscode.commands.executeCommand("walkmethrough.back");
    assert.deepEqual(activeFileAndLine(), ["src/orders/repository.ts", 33]);
  });

  await check("follows the anchor after the file changes", async () => {
    const uri = vscode.Uri.joinPath(root, "src", "orders", "repository.ts");
    const doc = await vscode.workspace.openTextDocument(uri);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, new vscode.Position(0, 0), "// a\n// b\n");
    await vscode.workspace.applyEdit(edit);
    try {
      await api.player.goto(4);
      const view = api.player.view;
      assert.ok(view.kind === "step");
      assert.deepEqual([view.range.start, view.range.end, view.range.status], [35, 41, "moved"]);
    } finally {
      await vscode.commands.executeCommand("workbench.action.files.revert", doc.uri);
    }
  });

  await check("Close clears the session", async () => {
    await vscode.commands.executeCommand("walkmethrough.close");
    assert.equal(api.player.active, undefined);
    assert.equal(api.inline.thread, undefined);
    assert.equal(api.review.file, undefined);
    assert.equal(api.review.open.length, 0);
  });
}
