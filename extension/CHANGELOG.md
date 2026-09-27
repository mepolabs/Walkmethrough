# Changelog

## 0.1.0 — unreleased

First version.

- Play back `.walkthrough/*.yaml` step by step: highlight each step's lines,
  and show its explanation in the editor and in the **Walkthrough** view.
- Anchors keep highlights on the right lines after the code moves.
- Review comments on any lines, saved to `<session>.feedback.yaml`, with
  **Copy feedback to chat** for the agent.
- Coverage check: **Not in Walkthrough** view and gutter markers for changed
  lines no step explains.
- JSON Schema validation for walkthrough and feedback files.
