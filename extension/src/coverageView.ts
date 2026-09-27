// The coverage check in the editor (spec §5.4): a "Not in Walkthrough" tree, a
// gutter marker on uncovered changed lines, and a one-line summary for the panel.
import { stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import * as vscode from "vscode";
import { resolveRange } from "./core/anchor";
import { computeCoverage, Coverage, Deletion, LineRange, StepRange } from "./core/coverage";
import { collectChanges, Changes } from "./core/git";
import { Walkthrough } from "./core/walkthrough";
import { Player } from "./player";

export type CoverageState =
  | { kind: "off" }
  | { kind: "running" }
  | { kind: "error"; message: string }
  /** Nothing to compare, e.g. no uncommitted changes and no base_commit. */
  | { kind: "none"; message: string }
  | {
      kind: "done";
      coverage: Coverage;
      mode: Changes["mode"];
      base: string;
      /** Files with uncovered lines that changed after the walkthrough was written. */
      laterEdits: Set<string>;
      /** Files that no longer exist (deleted files). */
      gone: Set<string>;
    };

export type CoverageNode =
  | { kind: "file"; file: string; ranges: LineRange[] }
  | { kind: "range"; file: string; range: LineRange }
  | { kind: "removed"; items: Deletion[] }
  | { kind: "deletion"; del: Deletion };

function lines(n: number): string {
  return n === 1 ? "1 line" : `${n} lines`;
}

function short(rev: string): string {
  return /^[0-9a-f]{12,}$/i.test(rev) ? rev.slice(0, 7) : rev;
}

export class CoverageCheck implements vscode.TreeDataProvider<CoverageNode>, vscode.Disposable {
  static readonly viewId = "walkmethrough.coverage";

  private state: CoverageState = { kind: "off" };
  private walkthrough: Walkthrough | undefined;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;
  private readonly view: vscode.TreeView<CoverageNode>;
  private readonly subscriptions: vscode.Disposable[];
  private readonly treeChanged = new vscode.EventEmitter<CoverageNode | undefined>();
  readonly onDidChangeTreeData = this.treeChanged.event;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  private readonly marker = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    borderColor: new vscode.ThemeColor("walkmethrough.uncoveredGutter"),
    borderStyle: "dotted",
    borderWidth: "0 0 0 2px",
    overviewRulerColor: new vscode.ThemeColor("walkmethrough.uncoveredGutter"),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });

  constructor(
    private readonly player: Player,
    private readonly root: vscode.Uri,
  ) {
    this.view = vscode.window.createTreeView(CoverageCheck.viewId, { treeDataProvider: this });
    this.subscriptions = [
      this.view,
      player.onDidChange(() => this.follow()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.decorate()),
    ];
  }

  get current(): CoverageState {
    return this.state;
  }

  /** One line for the panel's overview. */
  get summary(): string | undefined {
    const s = this.state;
    if (s.kind === "running") return "Checking coverage…";
    if (s.kind === "error") return `Coverage: can't check (${s.message})`;
    if (s.kind === "none") return `Coverage: ${s.message}`;
    if (s.kind !== "done") return undefined;
    const { changed, covered } = s.coverage;
    return `Coverage: ${covered} / ${changed} changed lines`;
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.watcher?.dispose();
    for (const s of this.subscriptions) s.dispose();
    this.marker.dispose();
    this.treeChanged.dispose();
    this.changed.dispose();
  }

  /** Re-runs the check (the view's refresh button, and after files change). */
  async refresh(): Promise<void> {
    const wt = this.walkthrough;
    if (!wt) return;
    const gen = ++this.generation;
    if (this.state.kind !== "done") this.set({ kind: "running" }); // keep old results on screen meanwhile
    let next: CoverageState;
    try {
      const changes = await collectChanges(this.root.fsPath, wt.base_commit, wt.head_commit);
      const steps = await this.stepRanges(wt, changes.mode);
      if (changes.diffs.length === 0) {
        next = {
          kind: "none",
          message: wt.base_commit
            ? `no changes since ${short(changes.base)}.`
            : "no uncommitted changes, and the walkthrough has no base_commit to compare with.",
        };
      } else {
        const coverage = computeCoverage(changes.diffs, steps);
        next = {
          kind: "done",
          coverage,
          mode: changes.mode,
          base: changes.base,
          laterEdits: changes.mode === "worktree" ? await this.editedAfterWalkthrough(coverage) : new Set(),
          gone: await this.missing(coverage.deleted.map((d) => d.file)),
        };
      }
    } catch (err) {
      next = { kind: "error", message: err instanceof Error ? err.message : String(err) };
    }
    if (gen === this.generation && wt === this.walkthrough) this.set(next);
  }

  // ── TreeDataProvider ────────────────────────────────────────────────────

  getChildren(node?: CoverageNode): CoverageNode[] {
    const s = this.state;
    if (s.kind !== "done") return [];
    if (!node) {
      const files: CoverageNode[] = s.coverage.uncovered.map((u) => ({ kind: "file", file: u.file, ranges: u.ranges }));
      if (s.coverage.deleted.length > 0) files.push({ kind: "removed", items: s.coverage.deleted });
      return files;
    }
    if (node.kind === "file") return node.ranges.map((range) => ({ kind: "range", file: node.file, range }));
    if (node.kind === "removed") return node.items.map((del) => ({ kind: "deletion", del }));
    return [];
  }

  getTreeItem(node: CoverageNode): vscode.TreeItem {
    const s = this.state;
    const later = s.kind === "done" && node.kind === "file" && s.laterEdits.has(node.file);
    switch (node.kind) {
      case "file": {
        const item = new vscode.TreeItem(this.uri(node.file), vscode.TreeItemCollapsibleState.Expanded);
        const n = node.ranges.reduce((sum, [a, b]) => sum + b - a + 1, 0);
        const dir = dirname(node.file);
        item.description = [dir === "." ? "" : dir, lines(n), later ? "edited after the walkthrough" : ""]
          .filter(Boolean)
          .join(" · ");
        if (later) {
          item.tooltip = "This file changed after the walkthrough was written, so some of these lines may be later edits (for example, applied feedback).";
        }
        return item;
      }
      case "range": {
        const [a, b] = node.range;
        const item = new vscode.TreeItem(a === b ? `Line ${a}` : `Lines ${a}–${b}`);
        item.iconPath = new vscode.ThemeIcon("diff-modified");
        item.command = this.open(node.file, a, b);
        return item;
      }
      case "removed": {
        const item = new vscode.TreeItem("Removed code", vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon("diff-removed");
        item.description = node.items.length === 1 ? "1 place" : `${node.items.length} places`;
        item.tooltip = "Lines the change removed that no step sits next to. They have no lines left to highlight.";
        return item;
      }
      case "deletion": {
        const { file, after, count } = node.del;
        const gone = s.kind === "done" && s.gone.has(file);
        const item = new vscode.TreeItem(basename(file));
        item.iconPath = new vscode.ThemeIcon("diff-removed");
        item.description = gone
          ? `file deleted (${lines(count)})`
          : `${lines(count)} removed ${after === 0 ? "at the top" : `after line ${after}`}`;
        if (!gone) item.command = this.open(file, Math.max(1, after), Math.max(1, after));
        return item;
      }
    }
  }

  // ── Internals ───────────────────────────────────────────────────────────

  /** Starts over when a different walkthrough opens or the open one is reloaded. */
  private follow(): void {
    const wt = this.player.active?.walkthrough;
    if (wt === this.walkthrough) return;
    this.walkthrough = wt;
    this.generation++;
    clearTimeout(this.timer);
    this.watcher?.dispose();
    this.watcher = undefined;
    if (!wt) return this.set({ kind: "off" });

    // Only the working tree can change the answer; base..head is fixed.
    if (!wt.head_commit) {
      this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.root, "**/*"));
      const soon = (uri: vscode.Uri) => {
        const rel = vscode.workspace.asRelativePath(uri, false);
        if (rel.startsWith(".git/") || rel.startsWith(".walkthrough/")) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.refresh(), 1000);
      };
      this.watcher.onDidChange(soon);
      this.watcher.onDidCreate(soon);
      this.watcher.onDidDelete(soon);
    }
    this.state = { kind: "off" };
    void this.refresh();
  }

  private set(state: CoverageState): void {
    this.state = state;
    this.view.message = this.message();
    this.treeChanged.fire(undefined);
    this.decorate();
    this.changed.fire();
  }

  private message(): string | undefined {
    const s = this.state;
    if (s.kind === "off") return undefined;
    if (s.kind === "running") return "Checking which changed lines the walkthrough covers…";
    if (s.kind === "error") return `Can't check coverage: ${s.message}`;
    if (s.kind === "none") return `Nothing to check: ${s.message}`;
    const { changed, covered, deleted } = s.coverage;
    const against =
      s.mode === "commits"
        ? `Compared ${short(s.base)}..${short(this.walkthrough?.head_commit ?? "")}.`
        : `Compared ${short(s.base)} with the files on disk.`;
    const missing = changed - covered;
    const head =
      missing === 0
        ? `All ${lines(changed)} changed are in the walkthrough.`
        : `${missing} of ${lines(changed)} changed aren't in the walkthrough.`;
    const removed = deleted.length > 0 ? ` Removed code in ${deleted.length === 1 ? "1 place" : `${deleted.length} places`} isn't either.` : "";
    return `${head}${removed} ${against}`;
  }

  private decorate(): void {
    const s = this.state;
    const byFile = new Map<string, LineRange[]>();
    if (s.kind === "done") for (const u of s.coverage.uncovered) byFile.set(u.file, u.ranges);
    for (const editor of vscode.window.visibleTextEditors) {
      const ranges = byFile.get(vscode.workspace.asRelativePath(editor.document.uri, false)) ?? [];
      editor.setDecorations(
        this.marker,
        ranges.map(([a, b]) => ({
          range: new vscode.Range(a - 1, 0, b - 1, 0),
          hoverMessage: "Changed, but not explained by any walkthrough step",
        })),
      );
    }
  }

  /**
   * Step ranges to compare with the diff. Against commits, the recorded lines are
   * exact by definition; against the working tree, follow each step's anchor in the
   * file on disk (what git compared), like the player does.
   */
  private async stepRanges(wt: Walkthrough, mode: Changes["mode"]): Promise<StepRange[]> {
    const out: StepRange[] = [];
    for (const step of wt.steps) {
      if (mode === "commits") {
        out.push({ file: step.file, start: step.lines[0], end: step.lines[1] });
        continue;
      }
      try {
        const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(this.uri(step.file)));
        const r = resolveRange(text, step.lines, step.anchor);
        out.push({ file: step.file, start: r.start, end: r.end });
      } catch {
        // File is gone; the step covers nothing.
      }
    }
    return out;
  }

  private async editedAfterWalkthrough(coverage: Coverage): Promise<Set<string>> {
    const out = new Set<string>();
    const file = this.player.file;
    if (!file) return out;
    const written = (await stat(file.fsPath).catch(() => undefined))?.mtimeMs;
    if (written === undefined) return out;
    for (const u of coverage.uncovered) {
      const m = (await stat(this.uri(u.file).fsPath).catch(() => undefined))?.mtimeMs;
      if (m !== undefined && m > written + 1000) out.add(u.file);
    }
    return out;
  }

  private async missing(files: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (const f of new Set(files)) {
      if (!(await stat(this.uri(f).fsPath).catch(() => undefined))) out.add(f);
    }
    return out;
  }

  private uri(file: string): vscode.Uri {
    return vscode.Uri.joinPath(this.root, file);
  }

  private open(file: string, start: number, end: number): vscode.Command {
    return {
      title: "Open",
      command: "vscode.open",
      arguments: [this.uri(file), { selection: new vscode.Range(start - 1, 0, end - 1, 0), preview: true }],
    };
  }
}
