# Changelog

## 0.2.1

- The Marketplace and Open VSX pages now show the demo GIF.
- Listed under the **AI** category.

## 0.2.0

- Fixed: walkthroughs could only be opened from the first workspace folder's
  `.walkthrough/`. **Walkthrough: Open…** now lists walkthroughs from every
  folder of a multi-root workspace and from nested projects (monorepos),
  grouped by project, and each one plays, stores comments and checks coverage
  against its own project.
- **Switch walkthrough…** in the Walkthrough view, and **Open Walkthrough** on
  `.walkthrough/*.yaml` files in the Explorer's context menu.

## 0.1.0

First version.

- Play back `.walkthrough/*.yaml` step by step: highlight each step's lines,
  and show its explanation in the editor and in the **Walkthrough** view.
- Anchors keep highlights on the right lines after the code moves.
- Review comments on any lines, saved to `<session>.feedback.yaml`, with
  **Copy feedback to chat** for the agent.
- Coverage check: **Not in Walkthrough** view and gutter markers for changed
  lines no step explains.
- JSON Schema validation for walkthrough and feedback files.
