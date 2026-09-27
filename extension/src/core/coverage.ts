// Coverage check (spec §5.4): which changed lines no step explains. No `vscode` import.

/** 1-based, inclusive. */
export type LineRange = [number, number];

export interface Deletion {
  file: string;
  /** New-side line the removed lines sat after; 0 means the top of the file. */
  after: number;
  count: number;
}

export interface FileDiff {
  /** Path relative to the workspace root, `/`-separated. */
  file: string;
  /** Added or modified lines, new-side numbers. */
  added: LineRange[];
  deleted: Deletion[];
}

export interface StepRange {
  file: string;
  start: number;
  end: number;
}

export interface Coverage {
  /** Changed (added or modified) lines in total. */
  changed: number;
  covered: number;
  /** Changed lines no step covers, per file, in diff order. */
  uncovered: { file: string; ranges: LineRange[] }[];
  /** Deleted-only hunks not next to any step (they have no lines to highlight). */
  deleted: Deletion[];
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Undoes git's C-style quoting of unusual paths: `"a/t\303\251st.ts"`. */
function unquote(path: string): string {
  if (!path.startsWith('"')) return path;
  const bytes: number[] = [];
  const body = path.slice(1, -1);
  const simple: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, "\\": 92, a: 7, b: 8, f: 12, v: 11 };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== "\\") {
      bytes.push(...new TextEncoder().encode(c));
      continue;
    }
    const next = body[i + 1];
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(body.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      bytes.push(simple[next] ?? next.charCodeAt(0));
      i += 1;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** The path from a `--- a/x` / `+++ b/x` header, or undefined for /dev/null. */
function headerPath(line: string, prefix: string): string | undefined {
  // git appends a tab when the name contains a space.
  const raw = unquote(line.slice(4).replace(/\t$/, ""));
  if (raw === "/dev/null") return undefined;
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
}

/**
 * Parses `git diff --unified=0 --src-prefix=a/ --dst-prefix=b/` output into
 * changed line ranges per file. Binary files and pure renames have no hunks and
 * are skipped.
 */
export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let oldPath: string | undefined;
  let current: FileDiff | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      current = undefined;
      oldPath = undefined;
    } else if (line.startsWith("--- ")) {
      oldPath = headerPath(line, "a/");
    } else if (line.startsWith("+++ ")) {
      const file = headerPath(line, "b/") ?? oldPath; // a deleted file keeps its old path
      if (file === undefined) continue;
      current = { file, added: [], deleted: [] };
      files.push(current);
    } else if (current && line.startsWith("@@")) {
      const m = HUNK.exec(line);
      if (!m) continue;
      const oldCount = m[2] === undefined ? 1 : Number(m[2]);
      const newStart = Number(m[3]);
      const newCount = m[4] === undefined ? 1 : Number(m[4]);
      if (newCount > 0) current.added.push([newStart, newStart + newCount - 1]);
      else if (oldCount > 0) current.deleted.push({ file: current.file, after: newStart, count: oldCount });
    }
  }
  return files.filter((f) => f.added.length > 0 || f.deleted.length > 0);
}

/** `ranges` minus `cuts`. Both sorted or not; the result is sorted and merged. */
export function subtract(ranges: LineRange[], cuts: LineRange[]): LineRange[] {
  let out = merge(ranges);
  for (const [cs, ce] of merge(cuts)) {
    const next: LineRange[] = [];
    for (const [s, e] of out) {
      if (ce < s || cs > e) next.push([s, e]);
      else {
        if (s < cs) next.push([s, cs - 1]);
        if (e > ce) next.push([ce + 1, e]);
      }
    }
    out = next;
  }
  return out;
}

function merge(ranges: LineRange[]): LineRange[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: LineRange[] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

function size(ranges: LineRange[]): number {
  return ranges.reduce((n, [s, e]) => n + e - s + 1, 0);
}

export function computeCoverage(diffs: FileDiff[], steps: StepRange[]): Coverage {
  const byFile = new Map<string, LineRange[]>();
  for (const s of steps) byFile.set(s.file, [...(byFile.get(s.file) ?? []), [s.start, s.end]]);

  let changed = 0;
  const uncovered: Coverage["uncovered"] = [];
  const deleted: Deletion[] = [];
  for (const d of diffs) {
    const stepRanges = byFile.get(d.file) ?? [];
    changed += size(d.added);
    const left = subtract(d.added, stepRanges);
    if (left.length > 0) uncovered.push({ file: d.file, ranges: left });
    // A removal right before, inside or right after a step is taken as explained by it.
    for (const del of d.deleted) {
      if (!stepRanges.some(([s, e]) => del.after >= s - 1 && del.after <= e)) deleted.push(del);
    }
  }
  const missing = uncovered.reduce((n, u) => n + size(u.ranges), 0);
  return { changed, covered: changed - missing, uncovered, deleted };
}
