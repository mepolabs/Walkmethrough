// Runs inside the VS Code extension host. Plays the example walkthrough end to end.
import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { Api } from "../src/extension";

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  console.log(`  ✓ ${name}`);
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
  });
}
