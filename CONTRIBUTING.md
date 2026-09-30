# Contributing to Agent Walkthrough

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Before you start

- **Bugs:** open an issue with what you did, what you expected, and what
  happened. If a walkthrough or feedback file is involved, attach it (or a
  trimmed-down copy).
- **Features and format changes:** open an issue first. The file formats are a
  contract with every agent that writes them, so agree on the change in the
  issue before writing code.
- **Security issues:** don't open a public issue; use
  [private vulnerability reporting](https://github.com/mepolabs/agent-walkthrough/security/advisories/new).

## Repository layout

| Path | What |
|------|------|
| [`schema/`](schema/) | JSON Schemas for the walkthrough and feedback files; the normative format |
| [`skills/walkthrough/SKILL.md`](skills/walkthrough/SKILL.md) | The agent skill: how agents write walkthroughs and apply feedback. Kept at `skills/<name>/SKILL.md` so `gh skill`, `npx skills` and Claude Code all find it |
| [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) | Makes this repository a Claude Code plugin marketplace |
| [`plugins/agent-walkthrough-stop-hook/`](plugins/agent-walkthrough-stop-hook/) | Optional Claude Code `Stop` hook, as its own plugin |
| [`extension/`](extension/) | The VS Code extension (TypeScript) |
| [`examples/order-api/`](examples/order-api/) | A small sample app with hand-written walkthroughs; used by the tests |

Inside `extension/src/`:

- `core/` holds the logic: parsing, anchors, Markdown sanitising, feedback
  edits, diff and coverage. It never imports `vscode`, so it's unit-tested with
  plain `node:test`.
- The files next to it (`player.ts`, `panel.ts`, `inline.ts`, `review.ts`,
  `coverageView.ts`) are the VS Code glue. They're covered by integration tests
  that run in a real VS Code.

## Build and test

You need Node.js 18+, git, and VS Code.

```sh
cd extension
npm ci
npm run typecheck
npm test                  # unit tests (node:test), including git runs in a temp repo
npm run test:integration  # downloads a test VS Code and runs it on examples/order-api
npm run package           # builds agent-walkthrough-<version>.vsix
```

The integration tests download VS Code into `extension/.vscode-test/` the
first time (about 150 MB) and need a display. On a headless Linux machine, run
them under `xvfb-run -a`. They create and remove temporary files in
`examples/order-api/` and put the example feedback file back when they finish.

### The skill and the Claude Code plugins

From the repository root:

```sh
claude plugin validate .                                  # marketplace.json and the plugins it lists
npx skills add . --list                                   # what `npx skills` finds (should be: walkthrough)
```

To install your working copy into Claude Code, run
`claude plugin marketplace add /path/to/agent-walkthrough` and
`claude plugin install agent-walkthrough@agent-walkthrough`. Afterwards, remove it with
`claude plugin marketplace remove agent-walkthrough`.

When you change the skill or the hook, bump `version` in
`.claude-plugin/marketplace.json` (and in `plugins/agent-walkthrough-stop-hook/.claude-plugin/plugin.json`
for the hook) so Claude Code users receive the update.

## Run the extension from source

Open the `extension/` folder in VS Code and press **F5**. That builds the
extension and opens a second VS Code window on `examples/order-api` with it
loaded. Run **Walkthrough: Open…** there. After changing the code, run
**Developer: Reload Window** in that second window.

To try it on another repository:

```sh
code --extensionDevelopmentPath=/path/to/agent-walkthrough/extension /path/to/other-repo
```

## Releasing the extension

Merging to `main` runs [`.github/workflows/release.yml`](.github/workflows/release.yml).
It always runs the tests. If the `version` in `extension/package.json` has no
`v<version>` tag yet, it also packages one `.vsix`, publishes it to the
[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=mepolabs.agent-walkthrough)
and [Open VSX](https://open-vsx.org/extension/mepolabs/agent-walkthrough), and
creates a GitHub release with the tag, the `.vsix` and that version's
`CHANGELOG.md` section.

So to release, in your pull request:

1. Bump the version: `cd extension && npm version <x.y.z> --no-git-tag-version`
   (this updates `package-lock.json` too).
2. Add a `## <x.y.z>` section to `extension/CHANGELOG.md`.

Pull requests that don't bump the version are tested but not released. If a
store rejects the upload, fix the cause and re-run the failed job from the
Actions tab: the version isn't tagged until both stores have it.

The workflow needs two repository secrets (**Settings → Secrets and variables → Actions**):

- `VSCE_PAT`: an Azure DevOps personal access token with the **Marketplace (Manage)**
  scope, from an account that can publish as `mepolabs`.
- `OVSX_PAT`: an [Open VSX access token](https://open-vsx.org/user-settings/tokens)
  from an account that's a member of the `mepolabs` namespace.

## Pull requests

- Keep each pull request to one change, and describe what it does and why.
- Add or update tests: unit tests for anything in `core/`, and an integration
  check in `test-integration/suite.ts` for editor behaviour.
- If behaviour or a file format changes, update `schema/` and
  `skills/walkthrough/SKILL.md` as needed in the same pull request.
- Treat walkthrough and feedback text as untrusted input: never
  render raw HTML, and never let file content run a command.
- Match the existing style: small modules, comments that explain why, and no
  new runtime dependencies without a good reason.
- `npm run typecheck`, `npm test` and `npm run test:integration` should pass.

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
