# hushhash TUI

A full-screen terminal client for hushhash, built with [OpenTUI](https://opentui.com/docs/). It is
separate from the scriptable CLI in `src/cli` and has its own dependencies.

**Everything about it — keys, commands, themes, the Omarchy app, files, terminal support and how it
is built — is in [docs/tui.md](../docs/tui.md).**

```sh
bun install                      # in the repository root
cd tui && bun install
bun run start --server prod      # run from the checkout
bin/install                      # or install it as an Omarchy app: hushhash-tui in the launcher
```

Checks, after changing the TUI or the `src/shared`, `src/cli` or `src/client/lib` modules it uses:

```sh
bun run typecheck && bun run lint && bun run test
```
