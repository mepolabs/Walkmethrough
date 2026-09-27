// Launches VS Code on examples/order-api with this extension and runs ./suite.
import { join, resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

async function main() {
  const extensionDevelopmentPath = resolve(__dirname, "..", "..");
  const workspace = resolve(extensionDevelopmentPath, "..", "examples", "order-api");
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath: join(__dirname, "suite.js"),
    launchArgs: [workspace, "--disable-extensions", "--disable-workspace-trust", "--skip-welcome"],
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
