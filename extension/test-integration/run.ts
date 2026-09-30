// Launches VS Code with this extension and runs the suites: ./suite on
// examples/order-api, then ./suite-multiroot on a multi-root workspace.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

async function main() {
  const extensionDevelopmentPath = resolve(__dirname, "..", "..");
  const repo = resolve(extensionDevelopmentPath, "..");
  const flags = ["--disable-extensions", "--disable-workspace-trust", "--skip-welcome"];
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath: join(__dirname, "suite.js"),
    launchArgs: [join(repo, "examples", "order-api"), ...flags],
  });

  // The first folder has no walkthroughs; the second holds one project nested a level down.
  const workspace = join(mkdtempSync(join(tmpdir(), "agent-walkthrough-")), "multi.code-workspace");
  const folders = [{ path: join(repo, "schema") }, { path: join(repo, "examples") }];
  writeFileSync(workspace, JSON.stringify({ folders }));
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath: join(__dirname, "suite-multiroot.js"),
    launchArgs: [workspace, ...flags],
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
