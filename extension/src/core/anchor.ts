// Re-finding a step's lines after later edits (spec §5.2.1). No `vscode` import.

export type AnchorStatus = "exact" | "moved" | "stale" | "unanchored";

export interface ResolvedRange {
  /** 1-based, inclusive. */
  start: number;
  end: number;
  status: AnchorStatus;
}

/** Trim and collapse internal whitespace so indentation changes don't break matching. */
function normaliseLine(line: string): string {
  return line.trim().replace(/\s+/g, " ");
}

function anchorLines(anchor: string): string[] {
  const lines = anchor.split(/\r?\n/).map(normaliseLine);
  // Drop blank lines at either end (YAML block scalars add a trailing newline).
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * All 1-based line numbers where the anchor starts. A single-line anchor may be
 * a substring of the file line; the first and last lines of a multi-line anchor
 * may be partial, inner lines must match whole.
 */
export function findAnchor(fileLines: string[], anchor: string): number[] {
  const needle = anchorLines(anchor);
  if (needle.length === 0) return [];
  const hay = fileLines.map(normaliseLine);
  const hits: number[] = [];
  const last = needle.length - 1;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length && ok; j++) {
      const line = hay[i + j];
      const want = needle[j];
      if (needle.length === 1) ok = line.includes(want);
      else if (j === 0) ok = line.endsWith(want);
      else if (j === last) ok = line.startsWith(want);
      else ok = line === want;
    }
    if (ok) hits.push(i + 1);
  }
  return hits;
}

function clamp(start: number, end: number, lineCount: number): [number, number] {
  const max = Math.max(1, lineCount);
  const s = Math.min(Math.max(1, start), max);
  const e = Math.min(Math.max(s, end), max);
  return [s, e];
}

/**
 * Resolves where a step's `[start, end]` range is in the current file text.
 * The anchor is the range's first line(s). If it matches at `start` the range
 * is `exact`; if it matches elsewhere, the range moves to start there and keeps
 * its length (`moved`); if it's gone, the recorded range is kept (`stale`).
 */
export function resolveRange(
  fileText: string,
  lines: [number, number],
  anchor: string | undefined,
): ResolvedRange {
  const fileLines = fileText.split(/\r?\n/);
  const [start, end] = lines;
  const length = end - start;

  if (anchor === undefined || anchorLines(anchor).length === 0) {
    const [s, e] = clamp(start, end, fileLines.length);
    return { start: s, end: e, status: "unanchored" };
  }

  const anchorLen = anchorLines(anchor).length;
  const hits = findAnchor(fileLines, anchor);
  if (hits.includes(start)) {
    const [s, e] = clamp(start, end, fileLines.length);
    return { start: s, end: e, status: "exact" };
  }
  if (hits.length === 0) {
    const [s, e] = clamp(start, end, fileLines.length);
    return { start: s, end: e, status: "stale" };
  }

  let best = hits[0];
  for (const h of hits) {
    if (Math.abs(h - start) < Math.abs(best - start)) best = h;
  }
  const [s, e] = clamp(best, best + Math.max(length, anchorLen - 1), fileLines.length);
  return { start: s, end: e, status: "moved" };
}
