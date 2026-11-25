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
| Esc | Go to the conversation list; in a dialog, close it |
| F1, or ? in the list | Help |
| Enter in the list | Open that conversation |
| Click in the list | Open that conversation; the mouse wheel moves the highlight |
| PageUp / PageDown | Scroll; PageUp at the top loads older messages |
| Ctrl+C | Quit |

Commands typed in the composer: `/open ADDRESS` (or `/new`), `/ttl [5m|300]`, `/clear` (asks in a
dialog first), `/retry`, `/older`, `/address`, `/log`, `/help`, `/quit` (or `/exit`). A command is a
single line; multi-line text that starts with `/` is sent as a message. Start a one-line message
with `//` to send text that begins with `/`; multi-line text is sent as typed. A mistyped command
stays in the composer.

Help, `/address` and `/clear` open a dialog over the screen. While it is open it takes every key;
Esc or a click outside closes it. `/clear` starts on Cancel, so Enter alone does not delete
anything: choose Delete with →, or press y.

Command results and errors appear in the top-right corner and disappear after a few seconds
(errors after eight); click one to dismiss it. Problems with the open conversation, such as an
address that is not registered or messages that could not be opened, stay at the top of the pane
until they are fixed.

A `●` in the list marks a conversation with messages that arrived while another was open. It is
kept in memory only.

## Attention

The TUI treats terminal attention the way the browser treats window focus:

- Attentive: incoming messages in the open conversation are opened (their lifetime starts) and
  shown, and push notifications to your other devices are suppressed. It also counts the identity
  as active that day, as a focused browser does.
- Away: new messages stay unopened and hidden until you come back, and push notifications go
  through.

Once the terminal reports focus, focus alone decides. Until it does (some terminals never report
it, such as tmux without `focus-events on`, or screen), the TUI is attentive at start and for
5 minutes after each key press, paste or click, then shows itself as away. Press any key to come
back. In tmux, set `focus-events on`.

Multi-line pastes need a terminal with bracketed paste, which nearly all modern terminals have.
Without it, each pasted line arrives as Enter and is sent on its own.

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
