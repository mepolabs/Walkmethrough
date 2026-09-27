#!/usr/bin/env node
// Claude Code Stop hook: asks the agent to write a walkthrough before it stops
// when the working tree has changes newer than the latest walkthrough file.
//
// Install in .claude/settings.json:
//   { "hooks": { "Stop": [ { "hooks": [ { "type": "command",
//       "command": "node .claude/hooks/require-walkthrough.mjs" } ] } ] } }
//
// Only uncommitted changes are considered. Never blocks twice in a row
// (honours stop_hook_active), so it cannot loop.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const WALKTHROUGH_DIR = ".walkthrough";

function readInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function mtime(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/** Paths from `git status --porcelain -z`, excluding the walkthrough folder. */
function changedPaths(cwd) {
  let out;
  try {
    out = execFileSync("git", ["status", "--porcelain", "-z", "--untracked-files=all"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return []; // not a git repo
  }
  const records = out.split("\0").filter(Boolean);
  const paths = [];
  for (let i = 0; i < records.length; i++) {
    const status = records[i].slice(0, 2);
    paths.push(records[i].slice(3));
    if (status[0] === "R" || status[0] === "C") i++; // skip the rename source
  }
  return paths.filter((p) => p !== WALKTHROUGH_DIR && !p.startsWith(WALKTHROUGH_DIR + "/"));
}

function newestWalkthrough(cwd) {
  let names;
  try {
    names = readdirSync(join(cwd, WALKTHROUGH_DIR));
  } catch {
    return 0;
  }
  return Math.max(
    0,
    ...names
      .filter((n) => /\.ya?ml$/.test(n) && !/\.feedback\.ya?ml$/.test(n))
      .map((n) => mtime(join(cwd, WALKTHROUGH_DIR, n))),
  );
}

const input = readInput();
if (input.stop_hook_active) process.exit(0);

const cwd = input.cwd || process.cwd();
const changed = changedPaths(cwd);
if (changed.length === 0) process.exit(0);

const newestChange = Math.max(0, ...changed.map((p) => mtime(join(cwd, p))));
if (newestWalkthrough(cwd) >= newestChange) process.exit(0);

process.stdout.write(
  JSON.stringify({
    decision: "block",
    reason:
      "You changed code in this session but have not written a walkthrough for it. " +
      "Follow the `walkthrough` skill: write .walkthrough/<session>.yaml describing the " +
      "changes in execution order, then finish.",
  }),
);
