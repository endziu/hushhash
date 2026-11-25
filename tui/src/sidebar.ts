import { BoxRenderable, RenderableEvents, SelectRenderable, SelectRenderableEvents, type CliRenderer } from '@opentui/core'
import { parseAddress, shortAddress, type Address } from '../../src/shared/address'
import { fmtDay, fmtTime } from '../../src/client/lib/display'
import { COLORS, highlightOnFocus } from './theme'

export interface ConversationEntry {
  address: Address
  /** Null for a conversation opened here that has no messages yet. */
  last_message_at: number | null
}

/** The sidebar is this many columns wide, borders included. */
export const SIDEBAR_WIDTH = 26

// Each conversation in the list takes two rows: the address and its last activity.
const LIST_ROWS_PER_ITEM = 2

/**
 * The list item drawn on `row` (0 is the list's top row), or null for the
 * empty space below the last item. Mirrors how OpenTUI's Select scrolls: it
 * keeps the selected item centred where it can. Keep the two in step.
 */
export function listItemAt(row: number, height: number, count: number, selected: number): number | null {
  const visible = Math.max(1, Math.floor(height / LIST_ROWS_PER_ITEM))
  const offset = Math.max(0, Math.min(selected - Math.floor(visible / 2), count - visible))
  const slot = Math.floor(row / LIST_ROWS_PER_ITEM)
  if (row < 0 || slot >= visible) return null
  const index = offset + slot
  return index < count ? index : null
}

/** The conversation list. Enter or a click on a conversation calls `onOpen`. */
export class Sidebar {
  readonly view: BoxRenderable
  private readonly list: SelectRenderable

  constructor(renderer: CliRenderer, onOpen: (address: Address) => void) {
    this.view = new BoxRenderable(renderer, {
      width: SIDEBAR_WIDTH, border: true, borderStyle: 'rounded', borderColor: COLORS.border, title: ' Conversations ',
    })
    const list = this.list = new SelectRenderable(renderer, {
      flexGrow: 1, options: [], wrapSelection: false, showScrollIndicator: true,
      backgroundColor: 'transparent', focusedBackgroundColor: 'transparent', selectedBackgroundColor: COLORS.selection,
      textColor: COLORS.text, selectedTextColor: COLORS.accent, descriptionColor: COLORS.muted,
      onMouseDown: event => {
        if (event.button !== 0) return
        const index = listItemAt(event.y - list.screenY, list.height, list.options.length, list.getSelectedIndex())
        const address = index === null ? null : parseAddress(list.options[index]?.value)
        if (index === null || !address) return
        event.preventDefault()
        list.setSelectedIndex(index)
        onOpen(address)
      },
      onMouseScroll: event => {
        if (event.scroll?.direction === 'up') list.moveUp()
        else if (event.scroll?.direction === 'down') list.moveDown()
      },
    })
    list.on(SelectRenderableEvents.ITEM_SELECTED, (_index: number, option: { value?: unknown }) => {
      const address = parseAddress(option.value)
      if (address) onOpen(address)
    })
    this.view.add(list)
    highlightOnFocus(this.view, list)
  }

  focus(): void {
    this.list.focus()
  }

  /** Runs `listener` whenever this gains or loses focus. */
  onFocusChange(listener: () => void): void {
    this.list.on(RenderableEvents.FOCUSED, listener)
    this.list.on(RenderableEvents.BLURRED, listener)
  }

  get focused(): boolean {
    return this.list.focused
  }

  /**
   * Shows `conversations`, keeping the highlighted one highlighted, or else
   * highlighting `current`.
   */
  render(conversations: readonly ConversationEntry[], unread: ReadonlySet<Address>, current: Address | null): void {
    const options = conversations.map(({ address, last_message_at }) => ({
      name: `${unread.has(address) ? '● ' : '  '}${shortAddress(address)}`,
      description: last_message_at === null ? '  new' : `  ${fmtDay(last_message_at) ?? fmtTime(last_message_at)}`,
      value: address,
    }))
    const list = this.list
    const highlighted = list.options[list.getSelectedIndex()]?.value
    list.options = options
    const index = options.findIndex(option => option.value === (highlighted ?? current))
    if (index >= 0 && index !== list.getSelectedIndex()) list.setSelectedIndex(index)
  }
}
