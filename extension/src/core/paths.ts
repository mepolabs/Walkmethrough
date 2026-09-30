// Which project a walkthrough belongs to, and paths relative to it. No `vscode`
// import; paths are `/`-separated URI paths.
//
// A walkthrough's step paths are relative to the folder holding its
// `.walkthrough/` (the repo root, spec §4.1). That folder need not be a
// workspace folder: a multi-root workspace has several, and a monorepo can have
// a `.walkthrough/` in each project.

export const WALKTHROUGH_DIR = ".walkthrough";

/** `/repo/.walkthrough/x.yaml` → `/repo`. A file outside `.walkthrough/` belongs to its own folder. */
export function projectRootOf(walkthroughPath: string): string {
  const parts = walkthroughPath.split("/");
  parts.pop();
  if (parts[parts.length - 1] === WALKTHROUGH_DIR) parts.pop();
  return parts.join("/") || "/";
}

/**
 * `path` relative to `root`, `/`-separated; `""` for `root` itself and
 * undefined when `path` is outside it.
 */
export function relativeTo(root: string, path: string): string | undefined {
  const base = root.replace(/\/+$/, "");
  if (path === base) return "";
  if (!path.startsWith(`${base}/`)) return undefined;
  return path.slice(base.length + 1);
}
