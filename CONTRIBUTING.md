# Contributing to InLoop

Thanks for helping! Bug reports, ideas and pull requests are all welcome. For larger changes, please open an issue first so we can agree on the approach.

## Setup

Requirements: Node.js ≥ 22.13 and Git.

```bash
git clone https://github.com/Howardisme/inloop.git
cd inloop
npm install
npm run build
```

To try your build in VS Code, the repo's `.vscode/mcp.json` already points at `dist/cli/main.js`. After changing code, run `npm run build` and restart the `inloop` server.

## Checks

Run all of these before opening a PR:

```bash
npm test            # Vitest; tests create real git repos in temp folders
npm run typecheck
npm run lint
npm run build
```

## Project layout

```
src/
  core/     diff parsing and hunk matching (pure: no files, no git)
  git/      git CLI wrapper
  store/    SQLite store, append-only history, migrations
  sync/     status computation, find_unrecorded
  service/  record, review, why, Markdown
  mcp/      MCP server, tools, prompts
  app/      review list card (MCP App)
  cli/      the inloop command
  hooks/    git hook handlers
  init/     init / uninstall
```

## Ground rules

- **Tests first.** Every behavior change comes with a test. Git scenarios (amend, rebase, rename, branch switch) are tested against real repositories, not mocks.
- **Records are append-only.** Never overwrite record content; changes create a new version.
- **Status is derived, not stored.** Existence and review status are always recomputed by `sync`.
- **Record text is untrusted.** Escape it in Markdown and render it as plain text in the card.
- **Hooks never block by accident.** Hook errors must exit 0; only `pre-push` with `inloop.prePush=block` may fail.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/).
