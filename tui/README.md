# hushhash TUI

A full-screen terminal client for hushhash, built with [OpenTUI](https://opentui.com/docs/). It is
separate from the scriptable CLI in `src/cli` and has its own dependencies.

## Run

From the repository root, install both packages and create an identity once:

```sh
bun install
bun run cli --server prod init
cd tui && bun install
bun run start --server prod
bun run start --server prod 0xPARTNER_ADDRESS   # open a conversation at start
```

`--server`, `--identity`, `HUSHHASH_SERVER` and `HUSHHASH_IDENTITY` work as in the
[CLI](../docs/cli.md), so the TUI and CLI share one identity. `--ttl 5m` sets the lifetime of sent
messages (default 30m, as in the browser).

## Use

| Key | Action |
|---|---|
| Enter | Send |
| Shift+Enter, Alt+Enter, Ctrl+J | New line (Shift+Enter needs a terminal that reports it) |
| Tab | Switch between the conversation list and the composer |
| Esc | Go to the conversation list |
| Enter in the list | Open that conversation |
| Click in the list | Open that conversation; the mouse wheel moves the highlight |
| PageUp / PageDown | Scroll; PageUp at the top loads older messages |
| Ctrl+C | Quit |

Commands typed in the composer: `/open ADDRESS`, `/ttl [5m|300]`, `/clear` (asks again first),
`/retry`, `/address`, `/log`, `/help`, `/quit`. Start a message with `//` to send text that begins
with `/`.

A `●` in the list marks a conversation with messages that arrived while another was open. It is
kept in memory only.

## Attention

The TUI treats terminal focus the way the browser treats window focus, using the terminal's focus
reporting:

- Focused: incoming messages in the open conversation are opened (their lifetime starts) and shown,
  and push notifications to your other devices are suppressed.
- Unfocused: new messages stay unopened and hidden until you come back, and push notifications go
  through.

Terminals without focus reporting count as always focused. In tmux, set `focus-events on`.

## Develop

```sh
bun run typecheck
bun run lint
bun run test
```

Tests run the app in OpenTUI's test renderer against an in-process server with an in-memory
database. The TUI reuses `src/shared` (protocol, crypto), the CLI's identity and server-origin
helpers, and the browser's framework-free `ConversationSession`, so run these checks after changing
those modules too.

`@opentui/core` is pinned to an exact version: it is pre-1.0 and releases often. Its native
library bundles FFmpeg (LGPL); that matters only if we ever ship a compiled binary.
