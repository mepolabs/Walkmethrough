// Runs inside the VS Code extension host on a multi-root workspace whose first
// folder has no walkthroughs and whose second holds examples/order-api a level down.
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

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension<Api>("mepolabs.agent-walkthrough");
  assert.ok(ext, "extension is installed");
  const api = await ext.activate();
  const folders = vscode.workspace.workspaceFolders!;
  assert.equal(folders.length, 2);
  const project = vscode.Uri.joinPath(folders[1].uri, "order-api");
  const walkthrough = (name: string) => vscode.Uri.joinPath(project, ".walkthrough", `${name}.yaml`);

  await check("finds walkthroughs in any workspace folder, in nested projects", async () => {
    const found = await api.findWalkthroughs();
    assert.deepEqual(
      found.map((f) => [f.project, f.uri.path.split("/").pop()]),
      [
        ["examples/order-api", "2026-09-27-order-pagination.yaml"],
        ["examples/order-api", "2026-09-27-order-cancel.yaml"],
      ],
    );
  });

  await check("plays steps against the walkthrough's project, not the first folder", async () => {
    await vscode.commands.executeCommand("agent-walkthrough.open", walkthrough("2026-09-27-order-cancel"));
    assert.equal(api.player.root?.path, project.path);
    assert.equal(api.player.active?.source, ".walkthrough/2026-09-27-order-cancel.yaml");
    await vscode.commands.executeCommand("agent-walkthrough.next");
    const view = api.player.view;
    assert.ok(view.kind === "step", `step 1 resolves, got ${view.kind}`);
    assert.equal(view.uri.path, vscode.Uri.joinPath(project, "src", "orders", "controller.ts").path);
    assert.equal(view.range.status, "exact");
  });

  await check("loads that project's review comments", async () => {
    await waitFor("comments load", () => api.review.thread("fb-20260927-141502-a1b2") !== undefined);
    const thread = api.review.thread("fb-20260927-141502-a1b2")!;
    assert.equal(thread.uri.path, vscode.Uri.joinPath(project, "src", "orders", "service.ts").path);
  });

  await check("runs the coverage check in that project", async () => {
    const settled = () => api.coverage.current.kind !== "off" && api.coverage.current.kind !== "running";
    await waitFor("the check finishes", settled, 20000);
    assert.notEqual(api.coverage.current.kind, "error", JSON.stringify(api.coverage.current));
  });

  await check("switches to another walkthrough", async () => {
    await vscode.commands.executeCommand("agent-walkthrough.open", walkthrough("2026-09-27-order-pagination"));
    assert.equal(api.player.active?.walkthrough.title, "Paginate the order list");
    assert.equal(api.player.active?.position, 0);
    await waitFor("the old comments go", () => api.review.thread("fb-20260927-141502-a1b2") === undefined);
  });

  await check("removing the walkthrough's workspace folder closes it", async () => {
    const closed = new Promise<void>((resolve) => {
      const sub = api.player.onDidChange(() => {
        if (!api.player.active) {
          sub.dispose();
          resolve();
        }
      });
    });
    assert.ok(vscode.workspace.updateWorkspaceFolders(1, 1));
    await closed;
    assert.equal(api.player.root, undefined);
  });
}
