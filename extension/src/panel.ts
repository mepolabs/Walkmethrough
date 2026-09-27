// The "Walkthrough" sidebar view: explanation, position and Back / Next.
import * as vscode from "vscode";
import MarkdownIt from "markdown-it";
import { Player } from "./player";

const md = new MarkdownIt({ html: false, linkify: true });

const STATUS_NOTE: Record<string, string | undefined> = {
  moved: "The code moved since this walkthrough was written; the highlight follows its anchor.",
  stale: "Couldn't find this step's anchor; the highlight shows the original lines and may be off.",
  unanchored: undefined,
  exact: undefined,
};

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function nonce(): string {
  let s = "";
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}

export class Panel implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly id = "walkmethrough.panel";
  private view: vscode.WebviewView | undefined;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly player: Player) {
    this.subscription = player.onDidChange(() => this.render());
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, enableCommandUris: false };
    view.webview.onDidReceiveMessage((msg: { type: string }) => {
      if (msg.type === "next") void this.player.next();
      else if (msg.type === "back") void this.player.back();
      else if (msg.type === "open") void vscode.commands.executeCommand("walkmethrough.open");
      else if (msg.type === "reveal") void this.player.goto(this.player.active?.position ?? 0);
    });
    this.render();
  }

  dispose(): void {
    this.subscription.dispose();
  }

  private render(): void {
    if (!this.view) return;
    const n = nonce();
    this.view.webview.html = `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${n}'; script-src 'nonce-${n}';">
<style nonce="${n}">
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0 12px 12px; line-height: 1.5; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin: 10px 0 2px; }
  h2 { font-size: 1.15em; margin: 2px 0 8px; }
  h3 { font-size: 1.05em; margin: 12px 0 6px; }
  code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 0 3px; border-radius: 3px; }
  pre code { display: block; padding: 6px 8px; overflow-x: auto; }
  a.loc { cursor: pointer; font-family: var(--vscode-editor-font-family); font-size: 0.9em; }
  .note { border-left: 3px solid var(--vscode-editorWarning-foreground); padding: 4px 8px; margin: 8px 0; background: var(--vscode-inputValidation-warningBackground); }
  .nav { display: flex; gap: 8px; margin-top: 14px; position: sticky; bottom: 0; padding: 8px 0; background: var(--vscode-sideBar-background); }
  button { flex: 1; padding: 5px 8px; border: none; border-radius: 2px; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); font: inherit; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  button:disabled { opacity: 0.5; cursor: default; }
</style></head>
<body>${this.body()}
<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  document.querySelectorAll("[data-msg]").forEach((el) =>
    el.addEventListener("click", () => vscode.postMessage({ type: el.dataset.msg })));
</script>
</body></html>`;
  }

  private body(): string {
    const session = this.player.active;
    if (!session) {
      return `<p>No walkthrough is open.</p>
<p class="meta">Agents write walkthroughs to <code>.walkthrough/*.yaml</code> at the end of a session.</p>
<div class="nav"><button data-msg="open">Open walkthrough…</button></div>`;
    }

    const wt = session.walkthrough;
    const nav = `<div class="nav">
  <button class="secondary" data-msg="back" ${session.canGoBack ? "" : "disabled"}>Back</button>
  <button data-msg="next" ${session.canGoNext ? "" : "disabled"}>${session.position === 0 ? "Start" : "Next"}</button>
</div>`;

    const step = session.step;
    if (!step) {
      return `<div class="meta">Overview · ${session.stepCount} steps</div>
<h2>${escape(wt.title)}</h2>
${wt.summary ? md.render(wt.summary) : ""}
${nav}`;
    }

    const view = this.player.view;
    let location = `${escape(step.file)}:${step.lines[0]}-${step.lines[1]}`;
    let note = "";
    if (view.kind === "step") {
      location = `${escape(step.file)}:${view.range.start}-${view.range.end}`;
      const text = STATUS_NOTE[view.range.status];
      if (text) note = `<div class="note">${escape(text)}</div>`;
    } else if (view.kind === "missing") {
      note = `<div class="note">${escape(step.file)} doesn't exist in this workspace.</div>`;
    }

    return `<div class="meta">${escape(wt.title)} · Step ${session.position} of ${session.stepCount}</div>
<h2>${escape(step.title)}</h2>
<a class="loc" data-msg="reveal" title="Show in editor">${location}</a>
${note}
${md.render(step.why)}
${nav}`;
  }
}
