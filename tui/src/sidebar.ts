import {
  BoxRenderable, RGBA, SelectRenderable, SelectRenderableEvents, TextAttributes, type CliRenderer, type OptimizedBuffer,
} from '@opentui/core'
import { parseAddress, shortAddress, type Address } from '../../src/shared/address'
import { fmtDay, fmtTime } from '../../src/client/lib/display'
import { terminalText } from '../../src/cli/terminal-text'
import { AVATAR_COLUMNS, avatarGrid, canDrawAvatars, drawAvatar } from './avatar'
import { COLORS, highlightOnFocus, onFocusChange, themeName } from './theme'

export interface ConversationEntry {
  address: Address
  /** Null for a conversation opened here that has no messages yet. */
  last_message_at: number | null
}

/** One conversation as the list shows it. */
export interface ListRow extends ConversationEntry {
  /** Its name, or null to show the short address. */
  name: string | null
  /** The unread count to show, such as 3 or 9+; null when all is read. */
  badge: string | null
}

/**
 * The narrowest and widest the sidebar gets, borders included. 24, not less:
 * the avatar, the unread count and a short address need that.
 */
export const SIDEBAR_MIN_WIDTH = 24
export const SIDEBAR_MAX_WIDTH = 36

/** The sidebar's width beside the conversation in a terminal `columns` wide. */
export function sidebarWidth(columns: number): number {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.floor(columns / 4)))
}

// Each conversation in the list takes two rows: the name and its last activity.
const LIST_ROWS_PER_ITEM = 2

/** How many items fit in `height` rows. */
function visibleItems(height: number): number {
  return Math.max(1, Math.floor(height / LIST_ROWS_PER_ITEM))
}

/**
 * The first item drawn, mirroring how OpenTUI's Select scrolls: it keeps the
 * selected item centred where it can. Keep the two in step.
 */
function listOffset(height: number, count: number, selected: number): number {
  const visible = visibleItems(height)
  return Math.max(0, Math.min(selected - Math.floor(visible / 2), count - visible))
}

/** The list item drawn on `row` (0 is the list's top row), or null for the empty space below the last item. */
export function listItemAt(row: number, height: number, count: number, selected: number): number | null {
  const slot = Math.floor(row / LIST_ROWS_PER_ITEM)
  if (row < 0 || slot >= visibleItems(height)) return null
  const index = listOffset(height, count, selected) + slot
  return index < count ? index : null
}

/** `text` cut to `width` columns, ending in … if it was cut. */
export function fitText(text: string, width: number): string {
  if (width <= 0) return ''
  if (Bun.stringWidth(text) <= width) return text
  let fitted = ''
  for (const char of text) {
    if (Bun.stringWidth(fitted + char) > width - 1) break
    fitted += char
  }
  return `${fitted}…`
}

/** When a conversation was last active, for the list. */
function lastActive(lastMessageAt: number | null): string {
  return lastMessageAt === null ? 'new' : fmtDay(lastMessageAt) ?? fmtTime(lastMessageAt)
}

/** The second row: when it was last active, after the short address of a named one if both fit. */
export function detailText({ address, last_message_at, name }: ListRow, width: number): string {
  const when = lastActive(last_message_at)
  if (name === null) return when
  const both = `${shortAddress(address)} · ${when}`
  return Bun.stringWidth(both) <= width ? both : shortAddress(address)
}

/**
 * A Select that draws each conversation itself: the avatar, the name (bold
 * when unread) with the unread count on the right, and a detail row under it.
 * The Select draws the highlight and the scroll indicator.
 */
class ConversationSelect extends SelectRenderable {
  /** Whether names leave room for avatars; set with the options, so nothing is drawn before them. */
  avatars = false
  /** The rows, in the order of the options. */
  rows: readonly ListRow[] = []

  protected override renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
    super.renderSelf(buffer, deltaTime)
    const [x, y] = this._paintOrigin(buffer)
    const rows = this.rows
    const selected = this.getSelectedIndex()
    const offset = listOffset(this.height, rows.length, selected)
    // The scroll indicator takes the last column.
    const end = x + this.width - (rows.length > visibleItems(this.height) ? 1 : 0)
    const theme = themeName()
    const transparent = RGBA.fromValues(0, 0, 0, 0)
    for (let slot = 0; (slot + 1) * LIST_ROWS_PER_ITEM <= this.height; slot++) {
      const index = offset + slot
      const row = rows[index]
      if (!row) break
      const top = y + slot * LIST_ROWS_PER_ITEM
      let left = x + 1
      if (this.avatars) {
        drawAvatar(buffer, avatarGrid(row.address, theme), left, top)
        left += AVATAR_COLUMNS + 1
      }
      let right = end
      if (row.badge) {
        const badge = ` ${row.badge} `
        right -= badge.length
        buffer.drawText(badge, right, top, RGBA.fromHex(COLORS.onAccent), RGBA.fromHex(COLORS.accent), TextAttributes.BOLD)
        right -= 1
      }
      const name = fitText(row.name === null ? shortAddress(row.address) : terminalText(row.name), right - left)
      const color = RGBA.fromHex(index === selected ? COLORS.accent : COLORS.text)
      buffer.drawText(name, left, top, color, transparent, row.badge ? TextAttributes.BOLD : TextAttributes.NONE)
      buffer.drawText(fitText(detailText(row, end - left), end - left), left, top + 1, RGBA.fromHex(COLORS.muted), transparent)
    }
  }
}

/** The conversation list. Enter or a click on a conversation calls `onOpen`. */
export class Sidebar {
  readonly view: BoxRenderable
  private readonly list: ConversationSelect
  private readonly paintFrame: () => void

  constructor(private readonly renderer: CliRenderer, onOpen: (address: Address) => void) {
    this.view = new BoxRenderable(renderer, {
      width: sidebarWidth(renderer.width), flexShrink: 0, border: true, borderStyle: 'rounded', title: ' Conversations ',
    })
    const list = this.list = new ConversationSelect(renderer, {
      flexGrow: 1, options: [], wrapSelection: false, showScrollIndicator: true, showSelectionIndicator: false,
      backgroundColor: 'transparent', focusedBackgroundColor: 'transparent',
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
    this.paintFrame = highlightOnFocus(this.view, list)
    this.applyTheme()
  }

  /** Repaints with the current palette. */
  applyTheme(): void {
    const list = this.list
    list.selectedBackgroundColor = COLORS.selection
    list.textColor = COLORS.text
    list.focusedTextColor = COLORS.text
    list.selectedTextColor = COLORS.accent
    this.view.titleColor = COLORS.text
    this.paintFrame()
    list.requestRender()
  }

  set width(columns: number | '100%') {
    this.view.width = columns
  }

  focus(): void {
    this.list.focus()
  }

  /** Runs `listener` whenever this gains or loses focus. */
  onFocusChange(listener: (focused: boolean) => void): void {
    onFocusChange(this.list, listener)
  }

  get focused(): boolean {
    return this.list.focused
  }

  /** The address of the highlighted conversation, if any. */
  get highlighted(): Address | null {
    return parseAddress(this.list.options[this.list.getSelectedIndex()]?.value)
  }

  /**
   * Shows `rows`, keeping the highlighted one highlighted, or else
   * highlighting `current`.
   */
  render(rows: readonly ListRow[], current: Address | null): void {
    const list = this.list
    list.avatars = canDrawAvatars(this.renderer.capabilities)
    // ConversationSelect draws the text.
    const options = rows.map(({ address }) => ({ name: '', description: '', value: address }))
    const highlighted = list.options[list.getSelectedIndex()]?.value
    list.rows = rows
    list.options = options
    // Names and counts can change while the options stay the same.
    list.requestRender()
    const index = options.findIndex(option => option.value === (highlighted ?? current))
    if (index >= 0 && index !== list.getSelectedIndex()) list.setSelectedIndex(index)
  }
}
