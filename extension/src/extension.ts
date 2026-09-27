import * as vscode from "vscode";
import { isWalkthroughFileName } from "./core/walkthrough";
import { Panel } from "./panel";
import { Player } from "./player";

const WALKTHROUGH_DIR = ".walkthrough";

/** Returned from `activate` so integration tests can inspect the player. */
export interface Api {
  player: Player;
}

export function activate(context: vscode.ExtensionContext): Api | undefined {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return undefined;

  const player = new Player(root);
  const panel = new Panel(player);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "walkmethrough.next";
  status.tooltip = "Walkthrough: next step";

  player.onDidChange(() => {
    const session = player.active;
    if (!session) return status.hide();
    status.text = `$(book) ${session.position}/${session.stepCount}`;
    status.show();
  });

  context.subscriptions.push(
    player,
    panel,
    status,
    vscode.window.registerWebviewViewProvider(Panel.id, panel),
    vscode.commands.registerCommand("walkmethrough.open", (uri?: vscode.Uri) => openCommand(root, player, uri)),
    vscode.commands.registerCommand("walkmethrough.next", () => player.next()),
    vscode.commands.registerCommand("walkmethrough.back", () => player.back()),
    vscode.commands.registerCommand("walkmethrough.goto", () => gotoCommand(player)),
    vscode.commands.registerCommand("walkmethrough.close", () => player.close()),
  );
  return { player };
}

export function deactivate(): void {}

async function openCommand(root: vscode.Uri, player: Player, uri?: vscode.Uri): Promise<void> {
  if (uri) {
    await player.open(uri);
    return;
  }
  const dir = vscode.Uri.joinPath(root, WALKTHROUGH_DIR);
  let entries: [string, vscode.FileType][] = [];
  try {
    entries = await vscode.workspace.fs.readDirectory(dir);
  } catch {
    // No folder yet; handled below.
  }
  const names = entries
    .filter(([name, type]) => type === vscode.FileType.File && isWalkthroughFileName(name))
    .map(([name]) => name)
    .sort()
    .reverse(); // YYYY-MM-DD prefixes → newest first
  if (names.length === 0) {
    void vscode.window.showInformationMessage(
      `No walkthroughs in ${WALKTHROUGH_DIR}/. Ask your agent to write one with the walkthrough skill.`,
    );
    return;
  }
  const picked =
    names.length === 1 ? names[0] : await vscode.window.showQuickPick(names, { placeHolder: "Open walkthrough" });
  if (!picked) return;
  if (await player.open(vscode.Uri.joinPath(dir, picked))) {
    await vscode.commands.executeCommand(`${Panel.id}.focus`);
  }
}

async function gotoCommand(player: Player): Promise<void> {
  const session = player.active;
  if (!session) return;
  const items = [
    { label: "Overview", description: session.walkthrough.title, position: 0 },
    ...session.walkthrough.steps.map((s, i) => ({
      label: `${i + 1}. ${s.title}`,
      description: `${s.file}:${s.lines[0]}-${s.lines[1]}`,
      position: i + 1,
    })),
  ];
  const picked = await vscode.window.showQuickPick(items, { placeHolder: "Go to step" });
  if (picked) await player.goto(picked.position);
}
