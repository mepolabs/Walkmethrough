import * as vscode from "vscode";
import { relativeTo, WALKTHROUGH_DIR } from "./core/paths";
import { isWalkthroughFileName } from "./core/walkthrough";
import { CoverageCheck } from "./coverageView";
import { InlineStep } from "./inline";
import { Panel } from "./panel";
import { Player } from "./player";
import { FeedbackComment, ReviewComments } from "./review";

/** Returned from `activate` so integration tests can inspect the player. */
export interface Api {
  player: Player;
  inline: InlineStep;
  review: ReviewComments;
  coverage: CoverageCheck;
  findWalkthroughs: typeof findWalkthroughs;
}

export function activate(context: vscode.ExtensionContext): Api {
  // No fixed root: each walkthrough is played against its own project (the
  // folder holding its `.walkthrough/`), in whichever workspace folder it is.
  const player = new Player();
  // One controller for both the step explanation and review comments (spec §5.3).
  const comments = vscode.comments.createCommentController("agent-walkthrough", "Walkthrough");
  const inline = new InlineStep(comments, player);
  const review = new ReviewComments(comments, player);
  const coverage = new CoverageCheck(player);
  const panel = new Panel(player, review, coverage);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "agent-walkthrough.next";
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
    // Removing the workspace folder the open walkthrough is in closes it.
    vscode.workspace.onDidChangeWorkspaceFolders((e) => {
      const root = player.root;
      if (root && e.removed.some((f) => relativeTo(f.uri.path, root.path) !== undefined)) player.close();
    }),
    vscode.commands.registerCommand("agent-walkthrough.open", (uri?: vscode.Uri) => openCommand(player, uri)),
    // The Explorer's context menu on a walkthrough file.
    vscode.commands.registerCommand("agent-walkthrough.openFile", (uri?: vscode.Uri) => openCommand(player, uri)),
    vscode.commands.registerCommand("agent-walkthrough.next", () => player.next()),
    vscode.commands.registerCommand("agent-walkthrough.back", () => player.back()),
    // Step links in the inline explanation pass the step number; the palette passes nothing.
    vscode.commands.registerCommand("agent-walkthrough.goto", (position?: unknown) =>
      typeof position === "number" ? player.goto(position) : gotoCommand(player),
    ),
    vscode.commands.registerCommand("agent-walkthrough.close", () => player.close()),
    vscode.commands.registerCommand("agent-walkthrough.commentOnStep", () => review.commentOnStep()),
    vscode.commands.registerCommand("agent-walkthrough.copyFeedback", () => review.copyToChat()),
    vscode.commands.registerCommand("agent-walkthrough.refreshCoverage", () => coverage.refresh()),
    vscode.commands.registerCommand("agent-walkthrough.comment.create", (r: vscode.CommentReply) => review.create(r)),
    vscode.commands.registerCommand("agent-walkthrough.comment.cancelDraft", (r: vscode.CommentReply) =>
      review.cancelDraft(r),
    ),
    vscode.commands.registerCommand("agent-walkthrough.comment.edit", (c: FeedbackComment) => review.edit(c)),
    vscode.commands.registerCommand("agent-walkthrough.comment.save", (c: FeedbackComment) => review.save(c)),
    vscode.commands.registerCommand("agent-walkthrough.comment.cancelEdit", (c: FeedbackComment) => review.cancelEdit(c)),
    vscode.commands.registerCommand("agent-walkthrough.comment.delete", (c: FeedbackComment) => review.delete(c)),
  );
  return { player, inline, review, coverage, findWalkthroughs };
}

export function deactivate(): void {}

/** A walkthrough file found in the workspace, and where its project is. */
export interface Found {
  uri: vscode.Uri;
  /** The project's location for the picker, e.g. `api` or `mono/apps/api`. */
  project: string;
}

/**
 * Every walkthrough in the workspace: `.walkthrough/` folders in each workspace
 * folder and in projects nested inside them. Newest first within each project.
 */
export async function findWalkthroughs(): Promise<Found[]> {
  const uris = await vscode.workspace.findFiles(`**/${WALKTHROUGH_DIR}/*.{yaml,yml}`, "**/node_modules/**");
  const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
  const found = uris
    .filter((uri) => isWalkthroughFileName(uri.path.split("/").pop()!))
    .map((uri) => ({ uri, project: projectLabel(uri, multiRoot) }));
  // YYYY-MM-DD prefixes → newest first.
  const name = (f: Found) => f.uri.path.split("/").pop()!;
  return found.sort((a, b) => a.project.localeCompare(b.project) || name(b).localeCompare(name(a)));
}

function projectLabel(walkthrough: vscode.Uri, multiRoot: boolean): string {
  const project = vscode.Uri.joinPath(walkthrough, "..", "..");
  const folder = vscode.workspace.getWorkspaceFolder(project);
  if (!folder) return project.fsPath;
  const rel = relativeTo(folder.uri.path, project.path) ?? "";
  if (!multiRoot) return rel;
  return rel ? `${folder.name}/${rel}` : folder.name;
}

async function openCommand(player: Player, uri?: vscode.Uri): Promise<void> {
  if (!uri) {
    const found = await findWalkthroughs();
    if (found.length === 0) {
      void vscode.window.showInformationMessage(
        `No walkthroughs in ${WALKTHROUGH_DIR}/. Ask your agent to write one with the walkthrough skill.`,
      );
      return;
    }
    uri = found.length === 1 ? found[0].uri : await pick(found, player.file);
    if (!uri) return;
  }
  if (await player.open(uri)) {
    await vscode.commands.executeCommand(`${Panel.id}.focus`);
  }
}

async function pick(found: Found[], current: vscode.Uri | undefined): Promise<vscode.Uri | undefined> {
  type Item = vscode.QuickPickItem & { uri?: vscode.Uri };
  // A separator per project, once there's more than one to tell apart.
  const grouped = new Set(found.map((f) => f.project)).size > 1;
  const items: Item[] = [];
  let project: string | undefined;
  for (const f of found) {
    if (grouped && f.project !== project) {
      items.push({ label: f.project || "(workspace root)", kind: vscode.QuickPickItemKind.Separator });
      project = f.project;
    }
    const open = f.uri.toString() === current?.toString();
    items.push({ label: f.uri.path.split("/").pop()!, description: open ? "open now" : undefined, uri: f.uri });
  }
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: current ? "Switch to walkthrough" : "Open walkthrough",
    matchOnDescription: true,
  });
  return picked?.uri;
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
