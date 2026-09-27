// Parsing and validation of walkthrough files (spec §4.1). No `vscode` import.
import { parseDocument } from "yaml";

export const SUPPORTED_VERSION = 1;

export interface Step {
  title: string;
  file: string;
  /** 1-based, inclusive. */
  lines: [number, number];
  anchor?: string;
  why: string;
}

export interface Walkthrough {
  version: 1;
  title: string;
  summary?: string;
  base_commit?: string;
  steps: Step[];
}

export interface ParseResult {
  walkthrough?: Walkthrough;
  /** Fatal problems; `walkthrough` is undefined when there are any. */
  errors: string[];
  /** Non-fatal problems, e.g. unknown fields. */
  warnings: string[];
}

const FILE_FIELDS = new Set(["version", "title", "summary", "base_commit", "steps"]);
const STEP_FIELDS = new Set(["title", "file", "lines", "anchor", "why"]);

type Obj = Record<string, unknown>;

function isObject(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Validates a `[start, end]` pair; returns an error message or undefined. */
export function checkLines(v: unknown): string | undefined {
  if (!Array.isArray(v) || v.length !== 2) return "must be [start, end]";
  const [start, end] = v;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return "start and end must be integers";
  if (start < 1) return `start (${start}) must be at least 1`;
  if (end < start) return `end (${end}) is before start (${start})`;
  return undefined;
}

function checkUnknown(obj: Obj, known: Set<string>, path: string, warnings: string[]) {
  for (const key of Object.keys(obj)) {
    if (!known.has(key)) warnings.push(`${path}${key}: unknown field, ignored`);
  }
}

/** Normalises a user-written path to forward slashes with no leading "./" or "/". */
export function normalisePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/^\/+/, "");
}

export function parseWalkthrough(text: string): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const doc = parseDocument(text, { prettyErrors: false });
  if (doc.errors.length > 0) {
    return { errors: doc.errors.map((e) => `YAML: ${e.message}`), warnings };
  }
  const data: unknown = doc.toJS();
  if (!isObject(data)) return { errors: ["file must be a YAML mapping"], warnings };

  checkUnknown(data, FILE_FIELDS, "", warnings);

  if (data.version === undefined) errors.push("version: required (expected 1)");
  else if (data.version !== SUPPORTED_VERSION) {
    errors.push(`version: ${JSON.stringify(data.version)} is not supported (expected 1); update the extension`);
  }
  if (!isNonEmptyString(data.title)) errors.push("title: required, non-empty string");
  if (data.summary !== undefined && typeof data.summary !== "string") errors.push("summary: must be a string");
  if (data.base_commit !== undefined) {
    const bc = String(data.base_commit);
    if (!/^[0-9a-fA-F]{4,40}$/.test(bc)) errors.push(`base_commit: "${bc}" is not a commit SHA`);
  }

  const steps: Step[] = [];
  if (!Array.isArray(data.steps) || data.steps.length === 0) {
    errors.push("steps: required, at least one step");
  } else {
    data.steps.forEach((raw: unknown, i: number) => {
      const p = `steps[${i}]`;
      if (!isObject(raw)) {
        errors.push(`${p}: must be a mapping`);
        return;
      }
      checkUnknown(raw, STEP_FIELDS, `${p}.`, warnings);
      const before = errors.length;
      for (const field of ["title", "file", "why"] as const) {
        if (!isNonEmptyString(raw[field])) errors.push(`${p}.${field}: required, non-empty string`);
      }
      if (isNonEmptyString(raw.file) && normalisePath(raw.file.trim()).split("/").includes("..")) {
        errors.push(`${p}.file: must stay inside the repo (no "..")`);
      }
      const linesError = checkLines(raw.lines);
      if (linesError) errors.push(`${p}.lines: ${linesError}`);
      if (raw.anchor !== undefined && !isNonEmptyString(raw.anchor)) {
        errors.push(`${p}.anchor: must be a non-empty string`);
      }
      if (errors.length === before) {
        steps.push({
          title: (raw.title as string).trim(),
          file: normalisePath((raw.file as string).trim()),
          lines: raw.lines as [number, number],
          anchor: raw.anchor as string | undefined,
          why: raw.why as string,
        });
      }
    });
  }

  if (errors.length > 0) return { errors, warnings };
  return {
    walkthrough: {
      version: 1,
      title: (data.title as string).trim(),
      summary: data.summary as string | undefined,
      base_commit: data.base_commit === undefined ? undefined : String(data.base_commit),
      steps,
    },
    errors,
    warnings,
  };
}

/** True for files in `.walkthrough/` that are walkthroughs (not the feedback file). */
export function isWalkthroughFileName(name: string): boolean {
  return /\.ya?ml$/i.test(name) && !/^feedback\.ya?ml$/i.test(name);
}
