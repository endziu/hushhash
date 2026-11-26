# CLAUDE.md

Commands, environment variables, rate limits, and retention rules are in the README:

@README.md

## Working here

- Bun only — never `node` / `npm` / `npx`.
- `bun run typecheck` and `bun run lint` before calling anything done. `bun run test` clears the db
  and builds first, so it is slow but is the real check.
- Four tsconfigs: `tsconfig.client.json`, `tsconfig.server.json`, `tsconfig.cli.json`, and the root
  `tsconfig.json`. `bun run typecheck` covers the first three. Client code is Preact, not React.
- `tui/` is a separate package (OpenTUI terminal client) with its own `package.json`, lockfile and
  checks: `cd tui && bun install && bun run typecheck && bun run lint && bun run test`. It imports
  `src/shared`, `src/cli` and browser `src/client/lib` modules, so run its checks after changing those.
  Root `bun test` ignores `tui/` (see `bunfig.toml`). `docs/tui.md` documents it all, including the
  Omarchy package in `tui/pkgbuild/`; keep it current when the TUI changes.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `endziu/hushhash`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default triage label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout. See `docs/agents/domain.md`.
