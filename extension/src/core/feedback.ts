// The per-walkthrough feedback file (spec §4.2): parsing, edits and the
// Copy to chat text. No `vscode` import.
//
// Both the extension and the agent write this file, so every edit here is a
// read-modify-write of one entry by `id` on the YAML document: anything else in
// the file (other entries, the agent's `status` changes, YAML comments) is kept.
import { Document, isMap, isSeq, parseDocument, YAMLMap } from "yaml";
import { checkLines, normalisePath } from "./walkthrough";

export type FeedbackStatus = "open" | "applied";

export interface FeedbackEntry {
  id: string;
  /** 1-based step index in the walkthrough. */
  step?: number;
  file: string;
  /** 1-based, inclusive. */
  lines: [number, number];
  anchor?: string;
  comment: string;
  status: FeedbackStatus;
  /** ISO-8601 UTC. */
  created: string;
}

export interface FeedbackParseResult {
  /** Valid entries, in file order. */
  entries: FeedbackEntry[];
  /** Skipped entries and other non-fatal problems. */
  warnings: string[];
  /** Set when the file can't be read at all; edits must not overwrite it. */
  error?: string;
}

const STATUSES = new Set(["open", "applied"]);

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Parses the file, or reports why it can't be edited safely. Empty text is an empty file. */
function load(text: string | undefined): { doc: Document; error?: string } {
  if (text === undefined || text.trim() === "") {
    const doc = new Document({ version: 1, entries: [] });
    return { doc };
  }
  const doc = parseDocument(text, { prettyErrors: false });
  if (doc.errors.length > 0) return { doc, error: `YAML: ${doc.errors[0].message}` };
  if (!isMap(doc.contents)) return { doc, error: "file must be a YAML mapping" };
  const version = doc.get("version");
  if (version !== 1) return { doc, error: `version: ${JSON.stringify(version)} is not supported (expected 1)` };
  const entries = doc.get("entries", true);
  if (entries === undefined) doc.set("entries", doc.createNode([]));
  else if (!isSeq(entries)) return { doc, error: "entries: must be a list" };
  return { doc };
}

export function parseFeedback(text: string): FeedbackParseResult {
  const { doc, error } = load(text);
  if (error) return { entries: [], warnings: [], error };
  const raw: unknown = doc.toJS().entries ?? [];
  const entries: FeedbackEntry[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  (raw as unknown[]).forEach((e, i) => {
    const p = `entries[${i}]`;
    if (typeof e !== "object" || e === null || Array.isArray(e)) return warnings.push(`${p}: must be a mapping, skipped`);
    const o = e as Record<string, unknown>;
    const problems: string[] = [];
    for (const f of ["id", "file", "comment", "created"] as const) {
      if (!isNonEmptyString(o[f])) problems.push(`${f}: required, non-empty string`);
    }
    const linesError = checkLines(o.lines);
    if (linesError) problems.push(`lines: ${linesError}`);
    if (!STATUSES.has(o.status as string)) problems.push(`status: must be "open" or "applied"`);
    if (o.step !== undefined && (!Number.isInteger(o.step) || (o.step as number) < 1)) {
      problems.push("step: must be a positive integer");
    }
    if (o.anchor !== undefined && !isNonEmptyString(o.anchor)) problems.push("anchor: must be a non-empty string");
    if (isNonEmptyString(o.file) && normalisePath(o.file.trim()).split("/").includes("..")) {
      problems.push('file: must stay inside the repo (no "..")');
    }
    if (isNonEmptyString(o.id) && seen.has(o.id)) problems.push(`id: duplicate "${o.id}"`);
    if (problems.length > 0) return warnings.push(...problems.map((m) => `${p}.${m}, entry skipped`));
    seen.add(o.id as string);
    entries.push({
      id: o.id as string,
      step: o.step as number | undefined,
      file: normalisePath((o.file as string).trim()),
      lines: o.lines as [number, number],
      anchor: o.anchor as string | undefined,
      comment: o.comment as string,
      status: o.status as FeedbackStatus,
      created: o.created as string,
    });
  });
  return { entries, warnings };
}

function serialise(doc: Document): string {
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}

function entryNode(doc: Document, id: string): YAMLMap | undefined {
  const seq = doc.get("entries", true);
  if (!isSeq(seq)) return undefined;
  return seq.items.find((item): item is YAMLMap => isMap(item) && item.get("id") === id);
}

/** The file text with `entry` appended. Throws if the existing file can't be edited safely. */
export function addEntry(text: string | undefined, entry: FeedbackEntry): string {
  const { doc, error } = load(text);
  if (error) throw new Error(error);
  const plain: Record<string, unknown> = { id: entry.id };
  if (entry.step !== undefined) plain.step = entry.step;
  plain.file = entry.file;
  plain.lines = entry.lines;
  if (entry.anchor !== undefined) plain.anchor = entry.anchor;
  Object.assign(plain, { comment: entry.comment, status: entry.status, created: entry.created });
  const node = doc.createNode(plain) as YAMLMap;
  const lines = node.get("lines", true);
  if (isSeq(lines)) lines.flow = true;
  const seq = doc.get("entries", true);
  if (!isSeq(seq)) throw new Error("entries: must be a list");
  seq.flow = false; // `entries: []` parses as a flow list; entries read better as a block
  seq.add(node);
  return serialise(doc);
}

/** The file text with one entry's comment replaced. Throws if the file or entry is gone. */
export function updateComment(text: string | undefined, id: string, comment: string): string {
  const { doc, error } = load(text);
  if (error) throw new Error(error);
  const node = entryNode(doc, id);
  if (!node) throw new Error(`comment ${id} is no longer in the feedback file`);
  node.set("comment", comment);
  return serialise(doc);
}

/** The file text without one entry. A missing entry is not an error (it's already gone). */
export function deleteEntry(text: string | undefined, id: string): string {
  const { doc, error } = load(text);
  if (error) throw new Error(error);
  const seq = doc.get("entries", true);
  if (isSeq(seq)) seq.items = seq.items.filter((item) => !(isMap(item) && item.get("id") === id));
  return serialise(doc);
}

/** `fb-YYYYMMDD-HHMMSS-xxxx`, UTC; unique enough for one reviewer's comments. */
export function newEntryId(now: Date, random: () => number = Math.random): string {
  const iso = now.toISOString(); // 2026-09-28T10:00:00.000Z
  const stamp = `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}`;
  const suffix = Math.floor(random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `fb-${stamp}-${suffix}`;
}

/** The `created` value: ISO-8601 UTC without milliseconds. */
export function timestamp(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * The Copy to chat text (spec §5.3): open entries only, one `file:start-end — comment`
 * line each, under a header naming the walkthrough so the agent updates the right file.
 */
export function formatForChat(walkthroughPath: string, entries: FeedbackEntry[]): string {
  const open = entries.filter((e) => e.status === "open");
  const lines = open.map((e) => {
    const [first, ...rest] = e.comment.trim().split(/\r?\n/);
    const loc = e.lines[0] === e.lines[1] ? `${e.lines[0]}` : `${e.lines[0]}-${e.lines[1]}`;
    return [`- ${e.file}:${loc} — ${first}`, ...rest.map((l) => `  ${l}`)].join("\n");
  });
  return `Apply this review feedback on \`${walkthroughPath}\`:\n\n${lines.join("\n")}\n`;
}
