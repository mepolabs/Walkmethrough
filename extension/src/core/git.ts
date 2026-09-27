// Collects the changed lines a walkthrough should cover (spec §5.4) by running
// git. No `vscode` import, so it runs under node:test against a temp repo.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FileDiff, parseDiff } from "./coverage";

const WALKTHROUGH_DIR = ".walkthrough";
/** Everything under the workspace except the walkthrough files themselves. */
const PATHSPEC = ["--", ".", `:(exclude)${WALKTHROUGH_DIR}`];

export interface Changes {
  /**
   * `commits`: `base..head`, both from the walkthrough; steps' recorded lines are exact there.
   * `worktree`: `base` (or HEAD) against the files on disk, plus untracked files.
   */
  mode: "commits" | "worktree";
  /** What the diff started from, as given (`HEAD` when the walkthrough has no base_commit). */
  base: string;
  diffs: FileDiff[];
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-c", "core.quotePath=false", ...args],
      { cwd, maxBuffer: 64 * 1024 * 1024, timeout: 30_000, windowsHide: true },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout);
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return reject(new Error("git isn't installed or isn't on PATH"));
        reject(new Error(stderr.trim().split("\n")[0] || err.message));
      },
    );
  });
}

async function checkCommit(cwd: string, sha: string, field: string): Promise<void> {
  try {
    await git(cwd, ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`]);
  } catch {
    throw new Error(`${field} ${sha} isn't in this repository (fetch it, or the walkthrough is from another repo)`);
  }
}

/** Line count of a new untracked file, or 0 if it looks binary. */
async function untrackedLines(path: string): Promise<number> {
  const bytes = await readFile(path);
  if (bytes.subarray(0, 8000).includes(0)) return 0;
  const lines = bytes.toString("utf8").split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

/**
 * The changes to check, with paths relative to `root` (which may be a
 * subfolder of the repository). Throws a readable Error when git can't answer.
 */
export async function collectChanges(root: string, baseCommit?: string, headCommit?: string): Promise<Changes> {
  await git(root, ["rev-parse", "--is-inside-work-tree"]).catch(() => {
    throw new Error("this folder isn't in a git repository");
  });
  if (baseCommit) await checkCommit(root, baseCommit, "base_commit");
  if (headCommit) await checkCommit(root, headCommit, "head_commit");

  const diffArgs = [
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--unified=0",
    "--ignore-blank-lines",
    "--relative",
    "--src-prefix=a/",
    "--dst-prefix=b/",
  ];
  if (baseCommit && headCommit) {
    const diffs = parseDiff(await git(root, [...diffArgs, baseCommit, headCommit, ...PATHSPEC]));
    return { mode: "commits", base: baseCommit, diffs };
  }

  const base = baseCommit ?? "HEAD";
  const diffs = parseDiff(await git(root, [...diffArgs, base, ...PATHSPEC]));
  // `git diff` doesn't see files git doesn't track yet; agents create those all the time.
  const untracked = (await git(root, ["ls-files", "--others", "--exclude-standard", "-z", ...PATHSPEC]))
    .split("\0")
    .filter(Boolean);
  for (const file of untracked) {
    const n = await untrackedLines(join(root, file)).catch(() => 0);
    if (n > 0) diffs.push({ file, added: [[1, n]], deleted: [] });
  }
  return { mode: "worktree", base, diffs };
}
