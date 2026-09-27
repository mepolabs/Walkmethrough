// The step's explanation shown in the editor, as a read-only comment thread
// under the highlighted lines, with Back / Next / Close in its header.
import * as vscode from "vscode";
import { renderMarkdownForEditor } from "./core/markdown";
import { STATUS_NOTE } from "./panel";
import { Player } from "./player";

const SETTING = "walkmethrough.inlineExplanation";

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export class InlineStep implements vscode.Disposable {
  private current: vscode.CommentThread | undefined;
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly controller: vscode.CommentController,
    private readonly player: Player,
  ) {
    this.subscriptions = [
      player.onDidChange(() => this.render()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(SETTING)) this.render();
      }),
    ];
  }

  /** The thread showing the current step, if any. */
  get thread(): vscode.CommentThread | undefined {
    return this.current;
  }

  dispose(): void {
    this.current?.dispose();
    for (const s of this.subscriptions) s.dispose();
  }

  private render(): void {
    this.current?.dispose();
    this.current = undefined;

    const session = this.player.active;
    const step = session?.step;
    const view = this.player.view;
    if (!session || !step || view.kind !== "step") return;
    if (!vscode.workspace.getConfiguration().get<boolean>(SETTING, true)) return;

    // Agent-written text: sanitised HTML (spec §5.2.2), and the only command it may run is goto.
    let html = renderMarkdownForEditor(step.why, "walkmethrough.goto");
    const note = STATUS_NOTE[view.range.status];
    if (note) html += `<p><em>⚠ ${escape(note)}</em></p>`;
    const body = new vscode.MarkdownString(html);
    body.supportHtml = true;
    body.isTrusted = { enabledCommands: ["walkmethrough.goto"] };

    const range = new vscode.Range(view.range.start - 1, 0, view.range.end - 1, 0);
    const thread = this.controller.createCommentThread(view.uri, range, [
      { body, mode: vscode.CommentMode.Preview, author: { name: step.title } },
    ]);
    thread.label = `Step ${session.position} of ${session.stepCount}`;
    thread.contextValue = "walkmethrough.step";
    thread.canReply = false;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    this.current = thread;
  }
}
