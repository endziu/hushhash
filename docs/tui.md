# Full-screen terminal client

`tui/` is a full-screen terminal client for hushhash, built with [OpenTUI](https://opentui.com/docs/).
It is a separate package from the scriptable [CLI](cli.md) in `src/cli`, with its own dependencies,
but shares the CLI's identity file and the browser's conversation logic, so it reads and sends the
same encrypted messages as both.

- [Run it](#run-it)
- [Install as an Omarchy app](#install-as-an-omarchy-app)
- [The screen and its keys](#the-screen-and-its-keys)
- [Commands](#commands)
- [Messages](#messages)
- [Finding a conversation](#finding-a-conversation)
- [Names, unread and removed conversations](#names-unread-and-removed-conversations)
- [Share, links and your key](#share-links-and-your-key)
- [Notifications and the title](#notifications-and-the-title)
- [Attention](#attention)
- [Themes](#themes)
- [Files](#files)
- [What the terminal needs](#what-the-terminal-needs)
- [How it is built](#how-it-is-built)
- [Develop](#develop)

## Run it

From the repository root, install both packages:

```sh
bun install
cd tui && bun install
bun run start --server prod
bun run start --server prod 0xPARTNER_ADDRESS   # open a conversation at start
```

| Option | Default | Meaning |
|---|---|---|
| `ADDRESS` | none | Open this conversation at start |
| `--server ORIGIN` | `HUSHHASH_SERVER`, else `local` | `prod` (`https://hushhash.org`), `local` (`http://localhost:3000`) or an origin; HTTPS for anything remote |
| `--identity FILE` | `HUSHHASH_IDENTITY`, else `~/.config/hushhash/identity.json` | The identity file, shared with the CLI |
| `--ttl LIFETIME` | `30m` | Lifetime of sent messages, such as `5m` or `300`, as in the browser |
| `--theme THEME` | `omarchy` on Omarchy, else `system` | `system`, `omarchy`, `light` or `dark`; see [Themes](#themes) |
| `--help` | | Show the options |

The TUI needs an interactive terminal; it refuses to start with piped input or output. Use the CLI
for scripts.

Without an identity, the TUI opens on a welcome screen that explains the key and offers to create a
new identity or import a key you backed up. An imported key is pasted into a field that shows a •
for each character, never the key. Either way the TUI signs in to the server first and saves the
identity only once that works, in the file the CLI uses (mode 0600), so a connection error leaves
nothing half made: it shows on the welcome screen, and you can try again.

With an identity, the TUI signs in before it takes over the screen, so a connection error stays
readable. A server that needs a newer client stops it with advice to `git pull` and run
`bun install` in the repository and in `tui/`.

## Install as an Omarchy app

On [Omarchy](https://omarchy.org), the TUI can be installed so it shows up in the app launcher like
the desktop's own terminal apps (btop, lazydocker):

```sh
tui/bin/install
```

This builds a pacman package from the checkout with `makepkg -fsi` and installs it, asking for sudo.
Run it again to pick up changes; `sudo pacman -R hushhash` removes it.

What you get:

- **hushhash-tui in the launcher** (Super + Space). The name differs from the browser app's
  `hushhash` so both can be installed. It opens in the default terminal (`xdg-terminal-exec`) as
  its own window with app id `org.omarchy.hushhash`, which Omarchy's window rules treat as a
  terminal. Launching it again focuses the open window (`omarchy-launch-or-focus-tui`) rather than
  opening a second one, which would hold a second live stream.
- **A `hushhash` command** that takes the same options as `bun run start`. It talks to
  `hushhash.org` unless `HUSHHASH_SERVER` or `--server` names another server.
- **The icon**, from `public/favicon.svg` and `public/icon-512.png`.

How it is packaged, in `tui/pkgbuild/`:

| File | Installed as | What it is |
|---|---|---|
| `PKGBUILD` | | Bundles `tui/src/main.ts` with `bun build --target=bun` into `/usr/lib/hushhash` |
| `hushhash` | `/usr/bin/hushhash` | Sets `HUSHHASH_SERVER=prod` unless set, then runs `bun --no-install /usr/lib/hushhash/main.js` |
| `hushhash.desktop` | `/usr/share/applications/hushhash.desktop` | The launcher entry |

The package version is `r<commit count>.<short hash>` of the checkout, so uncommitted changes go
into a package with the version of the last commit; `makepkg -f` and `pacman -U` reinstall it anyway.

The package is a Bun bundle (about 16 MB) run by the system's `bun`, which it depends on, not a
compiled binary: `bun build --compile` also works, but carries the Bun runtime and comes to about
116 MB. Two details of the bundle matter:

- OpenTUI imports a native package per platform. The build marks every platform but `linux-x64`
  (glibc) external, so only that native library is bundled, and the package is `x86_64` only.
- The bundle finds its native library and assets by the path in `--public-path`, which is the
  install directory, so the TUI runs from any working directory. A bundle built for another
  directory fails with "OpenTUI native library does not exist".

OpenTUI's native library bundles FFmpeg (LGPL). That is fine for a package you build for yourself;
it would need notices and a source offer before giving the package to others.

## The screen and its keys

The top line shows the live connection (`● connected`, `◐ reconnecting in 4s` with a countdown to
the next attempt, or `○ offline` after three failed attempts in a row, with the reason when it
fits), the server (`prod`, `local` or its host), the lifetime of new messages (also on the
composer's border), `away` while you are away (see [Attention](#attention)) and your avatar and
address in short form; `/share` shows it in full. The bottom line shows the keys that work where
you are: the composer, the conversation list or an open dialog. A narrow terminal drops the less
important parts of both lines first.

| Key | Action |
|---|---|
| Enter | Send |
| Shift+Enter, Alt+Enter, Ctrl+J | New line (Shift+Enter needs a terminal that reports it) |
| Tab | Switch between the conversation list and the composer; complete a command |
| Esc | Go to the conversation list; in a dialog, close it; close the command list |
| Ctrl+K | Switch conversation by name or address |
| Alt+1…9 | Open the first to ninth conversation in the list |
| Ctrl+T | Choose the lifetime of new messages |
| Ctrl+B | Hide or show the conversation list; in a narrow terminal, switch screens |
| F1, or ? in the list | Help |
| Enter in the list | Open that conversation |
| / in the list | Filter the list; Esc clears it |
| r in the list | Name that conversation |
| d in the list | Remove that conversation from the list (asks first) |
| s in the list | Share your address: a QR code and your conversation link |
| Click in the list | Open that conversation; the mouse wheel moves the highlight |
| PageUp / PageDown | Scroll; PageUp at the top loads older messages |
| Ctrl+C | Quit |

Below 70 columns, or after Ctrl+B, the list is a screen of its own: Tab or Esc switches between it
and the conversation, whose header says `← conversations`. Otherwise the sidebar widens with the
terminal, from 24 to 36 columns. The composer grows with its text up to eight lines.

Help, `/share`, `/key`, `/ttl`, Ctrl+K and `/clear` open a dialog over the screen. While it is open
it takes every key; Esc or a click outside closes it. `/clear` starts on Cancel, so Enter alone does
not delete anything: choose Delete with →, or press y.

Command results and errors appear in the top-right corner and disappear after a few seconds (errors
after eight); click one to dismiss it. Problems with the open conversation, such as an address that
is not registered or messages that could not be opened, stay at the top of the pane until they are
fixed.

## Commands

Commands are typed in the composer:

| Command | What it does |
|---|---|
| `/open ADDRESS [NAME]`, `/new` | Start or switch to a conversation, naming it |
| `/name [NAME]` | Name this conversation on this device; alone, remove the name |
| `/remove` | Take this conversation off the list here (asks first) |
| `/ttl [5m\|300]` | Lifetime of new messages; alone, a list to pick from |
| `/theme [system\|omarchy\|light\|dark]` | Colours; alone, says which |
| `/notify [on\|off]` | Desktop notifications for messages that arrive while you are away |
| `/clear` | Delete all messages for both of you (asks in a dialog first) |
| `/retry` | Retry loading or opening |
| `/older` | Load older messages |
| `/share`, `/address` | Your address, link and QR code |
| `/key` | Back up your private key |
| `/log` | Toggle the debug log |
| `/help` | The keys and commands |
| `/quit`, `/exit` | Quit |

Typing `/` lists the commands above the composer with what each does, narrowing as you type. ↑↓
choose one, Tab completes it and Enter runs it; a command that needs more, such as `/open`, is
filled in for you to finish, unless you typed it in full. Esc hides the list until you type
something else. Arguments, `//text` and multi-line text get no list.

A command is a single line; multi-line text that starts with `/` is sent as a message. Start a
one-line message with `//` to send text that begins with `/`. A mistyped command stays in the
composer.

Multi-line pastes need a terminal with bracketed paste, which nearly all modern terminals have.
Without it, each pasted line arrives as Enter and is sent on its own.

## Messages

Your messages are on the right and your partner's on the left. Messages from the same sender a few
minutes apart share one header with the sender and time, days are labelled (`── Today ──`), and
`── new ──` marks the first message that arrived since you last looked at the conversation, until
you send or switch away. Each message shows its time left, which turns amber in its last fifth and
red in its last 10 seconds, when the text fades. Your own also show their state:

| Icon | Meaning |
|---|---|
| `◌` | Sending |
| `○` | Delivered, not opened yet. The time shown is the 24h limit an unopened message waits, labelled `unopened`; its lifetime starts when it is opened |
| `✓` | Opened; the time shown is how long until it disappears |
| `✗` | Not sent. Its text goes back to the composer if that is empty, and the message says `Enter resends`; otherwise `retype to resend`. It may still have arrived, so check before resending |

Conversations and your status show a small mosaic avatar, the same one the browser draws for that
address, so similar short addresses differ at a glance. The status bar has one line, so it shows
the top half of yours. Terminals without at least 256 colours show none.

When messages open and expire follows the [domain behavior](domain-behavior.md): a message in the
open conversation is opened only while the terminal is attentive.

## Finding a conversation

Ctrl+K opens the quick switcher. Type part of a name or an address, ignoring case: a name matches
from its start, from a word's start, anywhere, or by its letters in order (`bbr` finds Bob
Builder); an address from its start, with or without `0x`, or anywhere without it, such as its last
characters. The best matches come first and the open conversation is marked `●`. ↑↓ choose, Enter
or a click opens. A whole address that is not listed offers "Start a conversation with 0x…".

`/` in the list filters it in place by the same rules, keeping its order. Keys that act on the list,
such as r and d, type into the filter instead; ↑↓ and Enter still move and open. Esc, rubbing out
the filter, or leaving the list clears it. Alt+1 to Alt+9 open the conversation in that place in
the list, as it is shown.

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

Names, what you have seen, removals and whether notifications are on are kept in `tui-state.json`
(see [Files](#files)). Nothing in it leaves the machine, and it is separate from the browser's names.

## Share, links and your key

`/share`, `/address` or s in the list shows your full address, your conversation link on this
server and a QR code of the link. A phone camera opens the link. The code is drawn dark on light
whatever the theme, so it scans in a dark terminal too; if the terminal is too small for it, the
dialog says how large it needs to be. c copies the address and l the link.

Copying goes through the terminal (OSC 52). A terminal that cannot copy says so, and you can select
the text instead.

http and https links in messages are underlined in the accent colour. Where the terminal supports
hyperlinks (OSC 8) they are clickable, usually with Ctrl or Cmd held. Nothing else becomes a link.

`/key` backs up your key without leaving the TUI. It shows your address and where the identity file
is, with the private key hidden until v shows it; c copies it. The key hides again when the dialog
closes or you look away (see [Attention](#attention)). Anyone with the key can read your messages
and send messages as you, so keep it secret, and never import a key from a crypto wallet that holds
money or anything else of value; see [Your key](../site/your-key.md). Your clipboard and terminal
scrollback may keep the key after you copy or show it. To replace a key, use the CLI's `import`;
the welcome screen imports one only when there is no identity yet.

## Notifications and the title

The terminal's title shows how many messages are unread across your conversations: `hushhash (3)`,
or `hushhash` when nothing is. The TUI saves the title it found and puts it back when it quits,
where the terminal supports that (most do); elsewhere the title is cleared.

A message that arrives while you are away (see [Attention](#attention)) shows a desktop notification
through the terminal: OSC 99 in kitty and foot, OSC 777 in WezTerm, Ghostty and others that report
it. A terminal without them, such as tmux, gets a bell instead, which tmux can pass on with
`monitor-bell` and `bell-action`. The notification says only "hushhash: New message", never who
sent it or what it says, like push notifications. A burst makes one: there is at most one every
5 seconds. Nothing is sent while you are at the screen.

`/notify off` turns notifications off and `/notify on` back on; `/notify` alone says which. The
choice is kept per identity in `tui-state.json`, and they are on until turned off.

## Attention

The TUI treats terminal attention the way the browser treats window focus:

- **Attentive:** incoming messages in the open conversation are opened (their lifetime starts) and
  shown, and push notifications to your other devices are suppressed. It also counts the identity
  as active that day, as a focused browser does (see the main README's daily active identities).
- **Away:** new messages stay unopened and hidden until you come back, and push notifications go
  through.

Once the terminal reports focus, focus alone decides. Until it does (some terminals never report
it, such as tmux without `focus-events on`, or screen), the TUI is attentive at start and for
5 minutes after each key press, paste or click, then shows itself as away. Press any key to come
back. The attention is reported to the server with the same 20-second heartbeat as the browser.

## Themes

`--theme` at start, or `/theme` while running, picks the colours:

| Setting | Colours |
|---|---|
| `omarchy` | The Omarchy desktop theme, changing with it. The default where an Omarchy theme is installed |
| `system` | The built-in light or dark palette, whichever suits the terminal's background, changing with it where the terminal reports that. The default elsewhere, and what `omarchy` falls back to while there is no theme to read |
| `light`, `dark` | The built-in palette, whatever the terminal or desktop does |

Under `system` and `omarchy`, open dialogs and toasts change colour with the theme too.

`--theme omarchy` without an Omarchy theme stops at start with an error, and `/theme omarchy` says
"No Omarchy theme to follow here" and keeps the current colours.

### How the Omarchy theme is read

The TUI reads `$XDG_STATE_HOME/omarchy/current/theme/colors.toml` (normally
`~/.local/state/omarchy/current/theme/colors.toml`) and maps Omarchy's colours onto its own:

| TUI colour | From Omarchy |
|---|---|
| accent, your name | `accent` |
| text | `foreground` |
| muted text | `dark_foreground` |
| borders | `muted` |
| selection | `selection` |
| your partner's name | Of `orange`, `magenta`, `cyan`, `yellow` and `blue`, the one furthest round the hue circle from `accent`, so the two stand apart (blue against a gold accent, yellow against a blue one) |
| ok, error, warning | `green`, `red`, `orange` (or `yellow`) |
| dialogs and toasts | `dark_background` |
| text on the accent | `background` |
| your bubbles | `background` tinted 20% toward `accent` (14% in a light theme) |
| your partner's bubbles | `lighter_background` |

`accent`, `background` and `foreground` are required; a theme without them is not used. Any other
missing colour comes from the built-in palette of the same mode. The mode is `mode` (`dark` or
`light`), or the background's brightness when that is missing. The TUI never writes to Omarchy's
files.

A theme switch replaces the theme directory as well as the files in it, so the TUI watches both the
theme directory and its parent, makes the watchers again after every change, and reads the colours
once the files have been quiet for 100 ms. While a switch is half done and the file is missing or
broken, it keeps the last theme rather than flicker.

## Files

| Path | What | Written by |
|---|---|---|
| `~/.config/hushhash/identity.json` (or `--identity`, `HUSHHASH_IDENTITY`) | Your private key, mode 0600, shared with the CLI | The welcome screen; the CLI's `init` and `import` |
| `tui-state.json` beside the identity file | Names, last seen, removed conversations and the notification choice, mode 0600, keyed by address so several identities share it. A missing or unreadable file starts empty | The TUI, atomically |
| `~/.local/state/omarchy/current/theme/colors.toml` | The Omarchy theme | Omarchy; the TUI only reads it |
| `/usr/bin/hushhash`, `/usr/lib/hushhash/`, `/usr/share/applications/hushhash.desktop` | The [installed app](#install-as-an-omarchy-app) | pacman |

## What the terminal needs

The TUI runs in any modern terminal, and does less, saying so where it matters, where a feature is
missing:

| Feature | Used for | Without it |
|---|---|---|
| Focus reporting | [Attention](#attention) | Attentive for 5 minutes after input. tmux: `set -g focus-events on` |
| OSC 52 | Copying the address, link and key | The TUI says it cannot copy. tmux: `set -g set-clipboard on` |
| OSC 8 | Clickable links | Links are underlined but not clickable |
| OSC 99 or 777 | Desktop notifications | A bell. tmux: `monitor-bell` and `bell-action` |
| Bracketed paste | Multi-line pastes | Each pasted line is sent on its own |
| 256 colours or truecolor | Avatars | No avatars |
| Background colour reports | `system` following the terminal | Dark |
| Title save and restore (XTWINOPS) | Putting the old title back on quit | The title is cleared |
| Shift+Enter reporting | Shift+Enter for a new line | Alt+Enter or Ctrl+J |

## How it is built

`tui/src/main.ts` parses the options, signs in, then hands the screen to `FirstRun` (no identity
yet) or `App`. The TUI reuses code from the rest of the repository rather than copying it:

| From | What |
|---|---|
| `src/shared` | Addresses, keypairs, the message envelope and protocol, live events |
| `src/cli` | `ChatClient` (HTTP API and sign-in), the identity file, server origins, terminal attention, safe terminal text |
| `src/client/lib` | The browser's framework-free `ConversationSession`, message lifetimes, links and display names |

So run the TUI's checks after changing any of those.

Its own modules, in `tui/src/`:

| Module | Responsibility |
|---|---|
| `main.ts` | Options, sign-in before taking the screen, the title, the theme watcher, cleanup |
| `first-run.ts` | The welcome screen: create or import an identity |
| `identity-session.ts` | `IdentitySession`: the CLI's `ChatClient` for one identity, serving each `ConversationSession` and holding one live event stream with backoff |
| `app.ts` | `App`: the whole client, tying the parts below together |
| `layout.ts` | Sidebar and conversation, side by side or taking turns below 70 columns |
| `sidebar.ts`, `switcher.ts` | The conversation list and its filter; the Ctrl+K switcher and its matching |
| `transcript.ts`, `message-view.ts`, `links.ts` | Messages: grouping, day labels, the new divider, time left, links |
| `outbox.ts` | Sent messages not shown yet: sending, failed, accepted |
| `composer.ts`, `commands.ts`, `command-list.ts` | The composer, what a submitted line means, and command completion |
| `modals.ts`, `help.ts`, `share.ts`, `key-backup.ts`, `lifetime.ts` | Dialogs: help, share with QR code, key backup, the lifetime picker |
| `status-bar.ts`, `hints.ts`, `bar.ts` | The top and bottom lines, and dropping parts in a narrow terminal |
| `toasts.ts` | Notices in the top-right corner |
| `unread.ts`, `notify.ts`, `state.ts` | Unread counts, notifications and the title, `tui-state.json` |
| `avatar.ts` | Mosaic avatars drawn with half blocks |
| `theme.ts`, `omarchy-theme.ts` | Palettes and theme settings; reading and watching the Omarchy theme |

All colours live in `theme.ts`: components read the shared `COLORS` palette whenever they draw, and
switching theme swaps its values in place. A test fails if a colour literal appears in any other
module, and `omarchy-theme.ts` only computes colours from Omarchy's.

## Develop

```sh
cd tui
bun install
bun run typecheck
bun run lint
bun run test
```

Root `bun test` ignores `tui/` (see `bunfig.toml`). Tests run the app in OpenTUI's test renderer
against an in-process server with an in-memory database; `omarchy-theme.test.ts` lays out a theme
in a temporary state directory and switches it the way Omarchy does.

`@opentui/core` is pinned to an exact version: it is pre-1.0 and releases often. Its native library
bundles FFmpeg (LGPL); see [packaging](#install-as-an-omarchy-app).
