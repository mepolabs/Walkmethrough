// Drives the editor: opens each step's file, resolves and highlights its lines.
import * as vscode from "vscode";
import { ResolvedRange, resolveRange } from "./core/anchor";
import { Session } from "./core/session";
import { parseWalkthrough } from "./core/walkthrough";

export type StepView =
  | { kind: "overview" }
  | { kind: "step"; range: ResolvedRange; uri: vscode.Uri }
  | { kind: "missing"; uri: vscode.Uri };

export class Player implements vscode.Disposable {
  private session: Session | undefined;
  private current: StepView = { kind: "overview" };
  private watcher: vscode.FileSystemWatcher | undefined;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  private readonly highlight = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor("walkmethrough.stepHighlight"),
    borderColor: new vscode.ThemeColor("walkmethrough.stepGutter"),
    borderStyle: "solid",
    borderWidth: "0 0 0 3px",
    overviewRulerColor: new vscode.ThemeColor("walkmethrough.stepGutter"),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });

  constructor(private readonly root: vscode.Uri) {}

  get active(): Session | undefined {
    return this.session;
  }

  get view(): StepView {
    return this.current;
  }

  /** Loads and validates a walkthrough file; shows errors and returns false on failure. */
  async open(file: vscode.Uri): Promise<boolean> {
    const parsed = await this.read(file);
    if (!parsed) return false;
    this.close();
    this.session = new Session(parsed, vscode.workspace.asRelativePath(file, false));
    this.watch(file);
    await vscode.commands.executeCommand("setContext", "walkmethrough.playing", true);
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
    this.current = { kind: "overview" };
    for (const editor of vscode.window.visibleTextEditors) editor.setDecorations(this.highlight, []);
    void vscode.commands.executeCommand("setContext", "walkmethrough.playing", false);
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
    for (const w of result.warnings) console.warn(`[walkmethrough] ${name}: ${w}`);
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
    for (const editor of vscode.window.visibleTextEditors) editor.setDecorations(this.highlight, []);
    if (!step) {
      this.current = { kind: "overview" };
      this.changed.fire();
      return;
    }

    const uri = vscode.Uri.joinPath(this.root, step.file);
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
