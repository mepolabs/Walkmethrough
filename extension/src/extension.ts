import * as vscode from "vscode";
import { isWalkthroughFileName } from "./core/walkthrough";
import { CoverageCheck } from "./coverageView";
import { InlineStep } from "./inline";
import { Panel } from "./panel";
import { Player } from "./player";
import { FeedbackComment, ReviewComments } from "./review";

const WALKTHROUGH_DIR = ".walkthrough";

/** Returned from `activate` so integration tests can inspect the player. */
export interface Api {
  player: Player;
  inline: InlineStep;
  review: ReviewComments;
  coverage: CoverageCheck;
}

export function activate(context: vscode.ExtensionContext): Api | undefined {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return undefined;

  const player = new Player(root);
  // One controller for both the step explanation and review comments (spec §5.3).
  const comments = vscode.comments.createCommentController("walkmethrough", "Walkthrough");
  const inline = new InlineStep(comments, player);
  const review = new ReviewComments(comments, player, root);
  const coverage = new CoverageCheck(player, root);
  const panel = new Panel(player, review, coverage);
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
    inline,
    review,
    comments,
    coverage,
    status,
    vscode.window.registerWebviewViewProvider(Panel.id, panel),
    vscode.commands.registerCommand("walkmethrough.open", (uri?: vscode.Uri) => openCommand(root, player, uri)),
    vscode.commands.registerCommand("walkmethrough.next", () => player.next()),
    vscode.commands.registerCommand("walkmethrough.back", () => player.back()),
    // Step links in the inline explanation pass the step number; the palette passes nothing.
    vscode.commands.registerCommand("walkmethrough.goto", (position?: unknown) =>
      typeof position === "number" ? player.goto(position) : gotoCommand(player),
    ),
    vscode.commands.registerCommand("walkmethrough.close", () => player.close()),
    vscode.commands.registerCommand("walkmethrough.commentOnStep", () => review.commentOnStep()),
    vscode.commands.registerCommand("walkmethrough.copyFeedback", () => review.copyToChat()),
    vscode.commands.registerCommand("walkmethrough.refreshCoverage", () => coverage.refresh()),
    vscode.commands.registerCommand("walkmethrough.comment.create", (r: vscode.CommentReply) => review.create(r)),
    vscode.commands.registerCommand("walkmethrough.comment.cancelDraft", (r: vscode.CommentReply) =>
      review.cancelDraft(r),
    ),
    vscode.commands.registerCommand("walkmethrough.comment.edit", (c: FeedbackComment) => review.edit(c)),
    vscode.commands.registerCommand("walkmethrough.comment.save", (c: FeedbackComment) => review.save(c)),
    vscode.commands.registerCommand("walkmethrough.comment.cancelEdit", (c: FeedbackComment) => review.cancelEdit(c)),
    vscode.commands.registerCommand("walkmethrough.comment.delete", (c: FeedbackComment) => review.delete(c)),
  );
  return { player, inline, review, coverage };
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
