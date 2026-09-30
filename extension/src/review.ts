// Reviewer comments (spec §5.3): native comment threads on any lines while a
// walkthrough is open, stored in that walkthrough's `<session>.feedback.yaml`.
import * as vscode from "vscode";
import { resolveRange } from "./core/anchor";
import {
  addEntry,
  deleteEntry,
  FeedbackEntry,
  formatForChat,
  newEntryId,
  parseFeedback,
  timestamp,
  updateComment,
} from "./core/feedback";
import { feedbackFileName } from "./core/walkthrough";
import { Player } from "./player";

/** Context values used by the `comments/*` menus in package.json. */
const THREAD = "agent-walkthrough.feedback";
const DRAFT = "agent-walkthrough.draft";
const COMMENT = "agent-walkthrough.feedback";

export class FeedbackComment implements vscode.Comment {
  mode = vscode.CommentMode.Preview;
  readonly contextValue = COMMENT;
  readonly author = { name: "Reviewer" };
  body: string;
  timestamp: Date;

  constructor(
    public entry: FeedbackEntry,
    readonly thread: vscode.CommentThread,
  ) {
    this.body = entry.comment;
    this.timestamp = new Date(entry.created);
  }
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function toRange(start: number, end: number): vscode.Range {
  return new vscode.Range(start - 1, 0, end - 1, 0);
}

export class ReviewComments implements vscode.Disposable {
  /** One thread per open entry, by entry id. */
  private readonly threads = new Map<string, vscode.CommentThread>();
  private readonly drafts = new Set<vscode.CommentThread>();
  private entries: FeedbackEntry[] = [];
  private feedback: vscode.Uri | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;
  /** Reloads and writes run one at a time, so a write always starts from the latest file. */
  private queue: Promise<unknown> = Promise.resolve();
  private readonly subscriptions: vscode.Disposable[];
  private readonly changed = new vscode.EventEmitter<void>();
  /** Fires when the set of open comments changes. */
  readonly onDidChange = this.changed.event;

  constructor(
    private readonly controller: vscode.CommentController,
    private readonly player: Player,
  ) {
    this.setCommentingRanges();
    this.subscriptions = [player.onDidChange(() => this.follow())];
  }

  /** The open walkthrough's feedback file, if a walkthrough is open. */
  get file(): vscode.Uri | undefined {
    return this.feedback;
  }

  /** Open comments on the open walkthrough, as last read from disk. */
  get open(): FeedbackEntry[] {
    return this.entries.filter((e) => e.status === "open");
  }

  /** The thread showing an entry, if it's open and its file exists. */
  thread(id: string): vscode.CommentThread | undefined {
    return this.threads.get(id);
  }

  dispose(): void {
    this.detach();
    for (const s of this.subscriptions) s.dispose();
    this.changed.dispose();
  }

  // ── Commands ────────────────────────────────────────────────────────────

  /** Starts an empty thread on the current step's lines, ready to type into. */
  commentOnStep(): vscode.CommentThread | undefined {
    const view = this.player.view;
    if (view.kind !== "step" || !this.feedback) return undefined;
    const thread = this.controller.createCommentThread(view.uri, toRange(view.range.start, view.range.end), []);
    thread.contextValue = DRAFT;
    thread.label = `New comment on step ${this.player.active?.position}`;
    thread.canReply = true;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    this.drafts.add(thread);
    return thread;
  }

  /** "Add Comment" on an empty thread: the + gutter's, or one from `commentOnStep`. */
  async create(reply: vscode.CommentReply): Promise<void> {
    const text = reply.text.trim();
    const thread = reply.thread;
    const session = this.player.active;
    if (!text) return;
    if (!session || !this.feedback) {
      void vscode.window.showWarningMessage("Walkthrough: open a walkthrough to comment on it.");
      return;
    }
    const doc = await vscode.workspace.openTextDocument(thread.uri);
    const start = thread.range.start.line + 1;
    const end = Math.max(start, thread.range.end.line + 1);
    const now = new Date();
    const entry: FeedbackEntry = {
      id: newEntryId(now),
      step: this.stepAt(thread.uri, start, end),
      file: this.player.relative(thread.uri) ?? vscode.workspace.asRelativePath(thread.uri, false),
      lines: [start, end],
      anchor: doc.lineAt(start - 1).text.trim() || undefined,
      comment: text,
      status: "open",
      created: timestamp(now),
    };
    const ok = await this.write((t) => addEntry(t, entry), () => {
      this.drafts.delete(thread);
      this.adopt(thread, entry);
      this.entries.push(entry);
    });
    if (ok) this.changed.fire();
  }

  cancelDraft(reply: vscode.CommentReply | vscode.CommentThread): void {
    const thread = "thread" in reply ? reply.thread : reply;
    this.drafts.delete(thread);
    thread.dispose();
  }

  edit(comment: FeedbackComment): void {
    comment.mode = vscode.CommentMode.Editing;
    this.refresh(comment.thread);
  }

  cancelEdit(comment: FeedbackComment): void {
    comment.body = comment.entry.comment;
    comment.mode = vscode.CommentMode.Preview;
    this.refresh(comment.thread);
  }

  async save(comment: FeedbackComment): Promise<void> {
    const text = comment.body.trim();
    if (!text) return;
    const ok = await this.write((t) => updateComment(t, comment.entry.id, text), () => {
      comment.entry = { ...comment.entry, comment: text };
      this.entries = this.entries.map((e) => (e.id === comment.entry.id ? comment.entry : e));
    });
    if (!ok) return; // stay in edit mode so the text isn't lost
    comment.body = comment.entry.comment;
    comment.mode = vscode.CommentMode.Preview;
    this.refresh(comment.thread);
  }

  async delete(comment: FeedbackComment): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      "Delete this review comment?",
      { modal: true, detail: comment.entry.comment },
      "Delete",
    );
    if (choice !== "Delete") return;
    const id = comment.entry.id;
    const ok = await this.write((t) => deleteEntry(t, id), () => {
      this.threads.get(id)?.dispose();
      this.threads.delete(id);
      this.entries = this.entries.filter((e) => e.id !== id);
    });
    if (ok) this.changed.fire();
  }

  /** Copies the open comments, located where their lines are now, for the agent's chat. */
  async copyToChat(): Promise<void> {
    const session = this.player.active;
    if (!session) return;
    await this.reload();
    const open = this.open;
    if (open.length === 0) {
      void vscode.window.showInformationMessage("Walkthrough: no open comments on this walkthrough yet.");
      return;
    }
    const located: FeedbackEntry[] = [];
    for (const e of open) {
      const range = await this.locate(e);
      located.push(range ? { ...e, lines: [range.start, range.end] } : e);
    }
    await vscode.env.clipboard.writeText(formatForChat(session.source, located));
    const n = open.length === 1 ? "1 comment" : `${open.length} comments`;
    void vscode.window.showInformationMessage(`Walkthrough: copied ${n}. Paste it into your agent's chat.`);
  }

  // ── Following the player and the file ───────────────────────────────────

  /** Switches to the open walkthrough's feedback file when the walkthrough changes. */
  private follow(): void {
    const walkthrough = this.player.file;
    const next = walkthrough && vscode.Uri.joinPath(walkthrough, "..", feedbackFileName(walkthrough.path.split("/").pop()!));
    if (next?.toString() === this.feedback?.toString()) return;
    this.detach();
    this.feedback = next;
    this.setCommentingRanges();
    if (!next) return this.changed.fire();

    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.joinPath(next, ".."), next.path.split("/").pop()!),
    );
    // A write is a temp-file rename, which can arrive as delete + create; settle first.
    const soon = () => {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => void this.reload(), 100);
    };
    this.watcher.onDidCreate(soon);
    this.watcher.onDidChange(soon);
    this.watcher.onDidDelete(soon);
    void this.reload();
  }

  private detach(): void {
    clearTimeout(this.reloadTimer);
    this.watcher?.dispose();
    this.watcher = undefined;
    for (const t of [...this.threads.values(), ...this.drafts]) t.dispose();
    this.threads.clear();
    this.drafts.clear();
    this.entries = [];
    this.feedback = undefined;
  }

  /** The + gutter is offered on the open walkthrough's project files only. */
  private setCommentingRanges(): void {
    // Reassigning the provider makes VS Code ask again for already open editors.
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: (doc) => {
        if (!this.feedback || doc.uri.scheme !== "file") return [];
        const rel = this.player.relative(doc.uri);
        if (!rel || rel.startsWith(".walkthrough/")) return [];
        return [new vscode.Range(0, 0, Math.max(0, doc.lineCount - 1), 0)];
      },
    };
  }

  /** Re-reads the feedback file and brings the threads in line with it. */
  reload(): Promise<void> {
    return this.enqueue(async () => {
      const uri = this.feedback;
      if (!uri) return;
      const text = await this.read(uri);
      if (uri !== this.feedback) return; // the walkthrough changed meanwhile
      const parsed = parseFeedback(text ?? "");
      if (parsed.error) {
        void vscode.window.showWarningMessage(
          `Walkthrough: can't read ${vscode.workspace.asRelativePath(uri, false)} (${parsed.error}). Fix it before adding comments.`,
        );
        return;
      }
      for (const w of parsed.warnings) console.warn(`[agent-walkthrough] ${uri.path}: ${w}`);
      this.entries = parsed.entries;
      await this.sync();
      this.changed.fire();
    });
  }

  private async sync(): Promise<void> {
    const open = new Map(this.open.map((e) => [e.id, e]));
    for (const [id, thread] of this.threads) {
      if (!open.has(id)) {
        thread.dispose();
        this.threads.delete(id);
      }
    }
    for (const entry of open.values()) {
      const thread = this.threads.get(entry.id);
      const comment = thread?.comments[0] as FeedbackComment | undefined;
      if (thread && comment) {
        if (comment.mode === vscode.CommentMode.Editing) continue; // don't clobber an edit in progress
        if (comment.entry.comment !== entry.comment || comment.entry.step !== entry.step) {
          comment.entry = entry;
          comment.body = entry.comment;
          this.label(thread, entry);
          this.refresh(thread);
        }
        continue;
      }
      const range = await this.locate(entry);
      const uri = this.uri(entry);
      if (!range || !uri) continue; // file is gone; the entry still counts for Copy to chat
      const created = this.controller.createCommentThread(
        uri,
        toRange(range.start, range.end),
        [],
      );
      created.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
      this.adopt(created, entry);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  /** Turns a thread into the display of one saved entry. */
  private adopt(thread: vscode.CommentThread, entry: FeedbackEntry): void {
    thread.comments = [new FeedbackComment(entry, thread)];
    thread.contextValue = THREAD;
    thread.canReply = false;
    this.label(thread, entry);
    this.threads.set(entry.id, thread);
  }

  private label(thread: vscode.CommentThread, entry: FeedbackEntry): void {
    thread.label = entry.step ? `Review comment · step ${entry.step}` : "Review comment";
  }

  /** Comment objects are only re-rendered when the thread's array is replaced. */
  private refresh(thread: vscode.CommentThread): void {
    thread.comments = [...thread.comments];
  }

  /** An entry's file, in the open walkthrough's project. */
  private uri(entry: FeedbackEntry): vscode.Uri | undefined {
    const root = this.player.root;
    return root && vscode.Uri.joinPath(root, entry.file);
  }

  /** Where an entry's lines are now, following its anchor; undefined if the file is gone. */
  private async locate(entry: FeedbackEntry) {
    const uri = this.uri(entry);
    if (!uri) return undefined;
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      return resolveRange(doc.getText(), entry.lines, entry.anchor);
    } catch {
      return undefined;
    }
  }

  /** The current step's index if `[start, end]` in `uri` overlaps it. */
  private stepAt(uri: vscode.Uri, start: number, end: number): number | undefined {
    const view = this.player.view;
    if (view.kind !== "step" || view.uri.toString() !== uri.toString()) return undefined;
    const overlaps = start <= view.range.end && end >= view.range.start;
    return overlaps ? this.player.active?.position : undefined;
  }

  private async read(uri: vscode.Uri): Promise<string | undefined> {
    try {
      return decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      return undefined; // no comments yet
    }
  }

  /**
   * Read-modify-write of the feedback file (spec §5.3): re-read, apply one change,
   * write a temp file and rename it over the original. `then` updates the threads
   * inside the same queue slot, before the file watcher's reload can run.
   */
  private async write(change: (text: string | undefined) => string, then: () => void): Promise<boolean> {
    try {
      await this.enqueue(async () => {
        const uri = this.feedback;
        if (!uri) throw new Error("no walkthrough is open");
        const next = change(await this.read(uri));
        const tmp = uri.with({ path: `${uri.path}.tmp` });
        await vscode.workspace.fs.writeFile(tmp, new TextEncoder().encode(next));
        await vscode.workspace.fs.rename(tmp, uri, { overwrite: true });
        then();
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Walkthrough: couldn't save the comment: ${message}`);
      return false;
    }
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
