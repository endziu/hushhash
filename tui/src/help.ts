import type { ModalOptions } from './modals'

/** The keys and commands, shown by /help and on the empty screen. */
export const HELP = [
  'Keys',
  '  Enter              send',
  '  Alt+Enter, Ctrl+J  new line (Shift+Enter too, where the terminal reports it)',
  '  Tab                switch between list and composer',
  '  Esc                go to the list; close a dialog',
  '  Ctrl+B             hide or show the list (switch screens when narrow)',
  '  F1, ? in the list  this help',
  '  Click              open a conversation from the list',
  '  PageUp/PageDown    scroll (PageUp at the top loads older)',
  '  Ctrl+C             quit',
  '',
  'Commands',
  '  /open ADDRESS      start or switch conversation (also /new)',
  '  /ttl [5m|300]      lifetime of new messages',
  '  /theme [system|light|dark]  colours; system follows the terminal',
  '  /clear             delete all messages for both of you (asks first)',
  '  /retry             retry loading or opening',
  '  /older             load older messages',
  '  /address           show your address',
  '  /log               toggle the debug log',
  '  /help              show or hide this help',
  '  /quit              quit (also /exit)',
  '  //text             send text that starts with /',
  '',
  'Your messages',
  '  ◌ sending          ✗ not sent (its text goes back to an empty composer)',
  '  ○ not opened yet   the time shown is how long it waits: 24h unopened',
  '  ✓ opened           the time shown is how long until it disappears',
  '  Every message shows its time left. It turns amber in its last fifth',
  '  and red in its last 10 seconds, then disappears.',
].join('\n')

/** The Help modal, for /help, F1 and ? in the list. */
export const HELP_MODAL: ModalOptions = { title: 'Help', body: HELP, width: 84 }
