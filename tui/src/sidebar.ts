import {
  BoxRenderable, SelectRenderable, SelectRenderableEvents, type CliRenderer, type OptimizedBuffer,
} from '@opentui/core'
import { parseAddress, shortAddress, type Address } from '../../src/shared/address'
import { fmtDay, fmtTime } from '../../src/client/lib/display'
import { AVATAR_COLUMNS, avatarGrid, canDrawAvatars, drawAvatar } from './avatar'
import { COLORS, highlightOnFocus, onFocusChange, themeName } from './theme'

export interface ConversationEntry {
  address: Address
  /** Null for a conversation opened here that has no messages yet. */
  last_message_at: number | null
}

/**
 * The narrowest and widest the sidebar gets, borders included. 24, not less:
 * the avatar, the unread mark and a short address need that.
 */
export const SIDEBAR_MIN_WIDTH = 24
export const SIDEBAR_MAX_WIDTH = 36

/** The sidebar's width beside the conversation in a terminal `columns` wide. */
export function sidebarWidth(columns: number): number {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.floor(columns / 4)))
}

// Each conversation in the list takes two rows: the address and its last activity.
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

/** A Select that draws each conversation's avatar left of its two rows. */
class ConversationSelect extends SelectRenderable {
  /** Whether names leave room for avatars; set with the options, so nothing is drawn before them. */
  avatars = false

  protected override renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
    super.renderSelf(buffer, deltaTime)
    if (!this.avatars) return
    const [x, y] = this._paintOrigin(buffer)
    const options = this.options
    const offset = listOffset(this.height, options.length, this.getSelectedIndex())
    const theme = themeName()
    for (let slot = 0; (slot + 1) * LIST_ROWS_PER_ITEM <= this.height; slot++) {
      const address = parseAddress(options[offset + slot]?.value)
      if (!address) break
      drawAvatar(buffer, avatarGrid(address, theme), x + 1, y + slot * LIST_ROWS_PER_ITEM)
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
    list.descriptionColor = COLORS.muted
    list.selectedDescriptionColor = COLORS.muted
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

  /**
   * Shows `conversations`, keeping the highlighted one highlighted, or else
   * highlighting `current`.
   */
  render(conversations: readonly ConversationEntry[], unread: { has(address: Address): boolean }, current: Address | null): void {
    const list = this.list
    list.avatars = canDrawAvatars(this.renderer.capabilities)
    const indent = list.avatars ? ' '.repeat(AVATAR_COLUMNS + 1) : ''
    const options = conversations.map(({ address, last_message_at }) => ({
      name: `${indent}${unread.has(address) ? '● ' : ''}${shortAddress(address)}`,
      description: `${indent}${last_message_at === null ? 'new' : fmtDay(last_message_at) ?? fmtTime(last_message_at)}`,
      value: address,
    }))
    const highlighted = list.options[list.getSelectedIndex()]?.value
    list.options = options
    const index = options.findIndex(option => option.value === (highlighted ?? current))
    if (index >= 0 && index !== list.getSelectedIndex()) list.setSelectedIndex(index)
  }
}
