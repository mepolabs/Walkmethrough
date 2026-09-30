// Drives the editor: opens each step's file, resolves and highlights its lines.
import * as vscode from "vscode";
import { ResolvedRange, resolveRange } from "./core/anchor";
import { projectRootOf, relativeTo } from "./core/paths";
import { Session } from "./core/session";
import { parseWalkthrough } from "./core/walkthrough";

export type StepView =
  | { kind: "overview" }
  | { kind: "step"; range: ResolvedRange; uri: vscode.Uri }
  | { kind: "missing"; uri: vscode.Uri };

export class Player implements vscode.Disposable {
  private session: Session | undefined;
  private opened: vscode.Uri | undefined;
  private project: vscode.Uri | undefined;
  private current: StepView = { kind: "overview" };
  private watcher: vscode.FileSystemWatcher | undefined;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  private readonly highlight = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor("agent-walkthrough.stepHighlight"),
    borderColor: new vscode.ThemeColor("agent-walkthrough.stepGutter"),
    borderStyle: "solid",
    borderWidth: "0 0 0 3px",
    overviewRulerColor: new vscode.ThemeColor("agent-walkthrough.stepGutter"),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });

  get active(): Session | undefined {
    return this.session;
  }

  /** The open walkthrough file. */
  get file(): vscode.Uri | undefined {
    return this.opened;
  }

  /**
   * The open walkthrough's project: the folder holding its `.walkthrough/`.
   * Step paths, feedback paths and the coverage check are all relative to it.
   */
  get root(): vscode.Uri | undefined {
    return this.project;
  }

  get view(): StepView {
    return this.current;
  }

  /** `uri`'s path relative to the open walkthrough's project; undefined if outside it or none is open. */
  relative(uri: vscode.Uri): string | undefined {
    if (!this.project || uri.scheme !== this.project.scheme || uri.authority !== this.project.authority) return undefined;
    return relativeTo(this.project.path, uri.path);
  }

  /** Loads and validates a walkthrough file; shows errors and returns false on failure. */
  async open(file: vscode.Uri): Promise<boolean> {
    const parsed = await this.read(file);
    if (!parsed) return false;
    this.close();
    this.project = file.with({ path: projectRootOf(file.path) });
    this.opened = file;
    this.session = new Session(parsed, this.relative(file)!);
    this.watch(file);
    await vscode.commands.executeCommand("setContext", "agent-walkthrough.playing", true);
    await this.show();
    return true;
  }

  async next(): Promise<void> {
    if (this.session?.next()) await this.show();
  }

  async back(): Promise<void> {
    if (this.session?.back()) await this.show();
  }

  async goto(position: number): Promise<void> {
    if (!this.session) return;
    this.session.goto(position);
    await this.show();
  }

  close(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
    this.session = undefined;
    this.opened = undefined;
    this.project = undefined;
    this.current = { kind: "overview" };
    for (const editor of vscode.window.visibleTextEditors) editor.setDecorations(this.highlight, []);
    void vscode.commands.executeCommand("setContext", "agent-walkthrough.playing", false);
    this.changed.fire();
  }

  dispose(): void {
    this.close();
    this.highlight.dispose();
    this.changed.dispose();
  }

  private async read(file: vscode.Uri) {
    let text: string;
    try {
      text = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
    } catch (err) {
      void vscode.window.showErrorMessage(`Walkthrough: cannot read ${file.fsPath}: ${err}`);
      return undefined;
    }
    const result = parseWalkthrough(text);
    const name = vscode.workspace.asRelativePath(file, false);
    if (!result.walkthrough) {
      const detail = result.errors.map((e) => `• ${e}`).join("\n");
      void vscode.window.showErrorMessage(`Walkthrough: ${name} is not valid.`, { modal: true, detail });
      return undefined;
    }
    for (const w of result.warnings) console.warn(`[agent-walkthrough] ${name}: ${w}`);
    return result.walkthrough;
  }

  /** Reloads when the file changes on disk; closes if it is deleted. */
  private watch(file: vscode.Uri) {
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.joinPath(file, ".."), file.path.split("/").pop()!),
    );
    this.watcher.onDidChange(async () => {
      const parsed = await this.read(file);
      if (parsed && this.session) {
        this.session.replace(parsed);
        await this.show();
      }
    });
    this.watcher.onDidDelete(() => this.close());
  }

  /** Renders the current position in the editor and notifies the panel. */
  private async show(): Promise<void> {
    const step = this.session?.step;
    const root = this.project;
    for (const editor of vscode.window.visibleTextEditors) editor.setDecorations(this.highlight, []);
    if (!step || !root) {
      this.current = { kind: "overview" };
      this.changed.fire();
      return;
    }

    const uri = vscode.Uri.joinPath(root, step.file);
    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      this.current = { kind: "missing", uri };
      this.changed.fire();
      return;
    }

    const range = resolveRange(doc.getText(), step.lines, step.anchor);
    this.current = { kind: "step", range, uri };
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: true,
      preview: true,
    });
    const vsRange = new vscode.Range(range.start - 1, 0, range.end - 1, 0);
    editor.setDecorations(this.highlight, [vsRange]);
    editor.selection = new vscode.Selection(vsRange.start, vsRange.start);
    editor.revealRange(vsRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    this.changed.fire();
  }
}
