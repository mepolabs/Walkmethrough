// Renders agent-written Markdown (`summary`, `why`) for the panel. No `vscode` import.
//
// Walkthroughs are written by an agent and may arrive in a pull request, so their
// text is untrusted (spec §5.2.2): no raw HTML, no images, and links only to
// http(s) or to another step of the same walkthrough.
import MarkdownIt from "markdown-it";

const STEP_LINK = /^#step-(\d+)$/;

const md = new MarkdownIt({ html: false, linkify: true });
md.disable("image");
md.validateLink = (url: string) => /^https?:\/\//i.test(url) || STEP_LINK.test(url);

/**
 * Rewrites CodeTour-style step references to links: `[#3]` → step 3, and
 * `[label][#3]` → "label" linking to step 3. Code spans and fences are left alone.
 */
export function linkStepReferences(text: string): string {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/);
  return parts
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/\[([^\]\n]+)\]\[#(\d+)\]/g, "[$1](#step-$2)")
            .replace(/\[#(\d+)\](?![[(])/g, "[#$1](#step-$1)"),
    )
    .join("");
}

export function renderMarkdown(text: string): string {
  return md.render(linkStepReferences(text));
}

/**
 * `renderMarkdown` for editor surfaces that can't intercept link clicks (the
 * inline step comment): step links become `command:<command>?[N]` URIs. Only
 * links the renderer already validated are rewritten; untrusted text can't
 * produce a `command:` link of its own.
 */
export function renderMarkdownForEditor(text: string, command: string): string {
  return renderMarkdown(text).replace(
    /href="#step-(\d+)"/g,
    (_, n: string) => `href="command:${command}?${encodeURIComponent(JSON.stringify([Number(n)]))}"`,
  );
}

/** The 1-based step number a rendered link points to, or undefined for other links. */
export function stepFromHref(href: string): number | undefined {
  const m = STEP_LINK.exec(href);
  return m ? Number(m[1]) : undefined;
}
