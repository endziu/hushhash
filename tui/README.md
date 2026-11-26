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
messages (default 30m, as in the browser). `--theme light`, `--theme dark` or the default
`--theme system` picks the colours; `system` follows the terminal's background and changes with it
where the terminal reports that.

## Use

The top line shows the live connection (`● connected`, `◐ reconnecting in 4s` with a countdown to
the next attempt, or `○ offline` after three failed attempts in a row, with the reason when it
fits), the server (`prod`, `local` or its host), the lifetime of new messages, `away` while you
are away (see [Attention](#attention)) and your avatar and address in short form; `/address`
shows it in full. The bottom line shows the keys that work where you are: the composer, the conversation list
or an open dialog. A narrow terminal drops the less important parts of both lines first.

| Key | Action |
|---|---|
| Enter | Send |
| Shift+Enter, Alt+Enter, Ctrl+J | New line (Shift+Enter needs a terminal that reports it) |
| Tab | Switch between the conversation list and the composer |
| Esc | Go to the conversation list; in a dialog, close it |
| Ctrl+B | Hide or show the conversation list; in a narrow terminal, switch screens |
| F1, or ? in the list | Help |
| Enter in the list | Open that conversation |
| r in the list | Name that conversation |
| d in the list | Remove that conversation from the list (asks first) |
| Click in the list | Open that conversation; the mouse wheel moves the highlight |
| PageUp / PageDown | Scroll; PageUp at the top loads older messages |
| Ctrl+C | Quit |

Commands typed in the composer: `/open ADDRESS [NAME]` (or `/new`), `/name [NAME]`, `/remove`, `/ttl [5m|300]`, `/theme [system|light|dark]`, `/clear` (asks in a
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

Your messages are on the right and your partner's on the left. Messages from the same sender a
few minutes apart share one header with the sender and time, days are labelled (`── Today ──`),
and `── new ──` marks the first message that arrived since you last looked at the conversation,
until you send or switch away. Each message shows its time left, which turns amber in its last
fifth and red in its last 10 seconds, when the text fades. Your own also show their state:

| Icon | Meaning |
|---|---|
| `◌` | Sending |
| `○` | Delivered, not opened yet. The time shown is the 24h limit an unopened message waits, labelled `unopened`; its lifetime starts when it is opened |
| `✓` | Opened; the time shown is how long until it disappears |
| `✗` | Not sent. Its text goes back to the composer if that is empty, and the message says `Enter resends`; otherwise `retype to resend`. It may still have arrived, so check before resending |

Conversations and your status show a small mosaic avatar, the same one the browser draws for that
address, so similar short addresses differ at a glance. The status bar has one line, so it shows
the top half of yours. Terminals without at least 256 colours show none.

Under `system`, open dialogs and toasts change colour with the terminal too.

Below 70 columns, or after Ctrl+B, the list is a screen of its own: Tab or Esc switches between it
and the conversation, whose header says `← conversations`. Otherwise the sidebar widens with the
terminal, from 24 to 36 columns. The composer grows with its text up to eight lines.

## Names, unread and removed conversations

Name a conversation with r in the list, `/name NAME` or `/open ADDRESS NAME`; `/name` alone removes
the name. The name replaces the short address in the list, which moves to the second line, and in
the conversation header and message headers. Names are at most 64 characters.

The list counts the messages from your partner that you have not seen (`3`, `9+`; `3+` when older
ones may be missing from a long conversation) and shows their names in bold. A conversation is
seen through the newest message opened in it, so one that is open while you are away stays unread.

d in the list, or `/remove`, takes a conversation off the list on this device and forgets its name.
Its messages stay on the server (`/clear` deletes them). It comes back, unnamed, when a new message
arrives, and only what came after the removal counts as unread.

All three are kept in `tui-state.json` beside the identity file, mode 0600, keyed by your address
so several identities can share it. Nothing in it leaves the machine, and it is separate from the
browser's names. A missing or unreadable file starts empty.

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
