import { BoxRenderable, type CliRenderer, type Renderable } from '@opentui/core'
import { sidebarWidth } from './sidebar'

export interface LayoutParts {
  statusBar: Renderable
  /** Takes a width, as it changes with the terminal's. */
  sidebar: { view: Renderable; width: number | '100%' }
  pane: Renderable
  composer: Renderable
  hintBar: Renderable
}

/** Narrower than this, the list and the conversation take turns on screen. */
export const COLLAPSE_BELOW = 70

/**
 * Arranges the parts on screen: the status bar on top, the sidebar beside
 * the pane and composer, and the hint bar at the bottom. In a narrow
 * terminal, or with the sidebar hidden, the list is a screen of its own
 * instead of a sidebar. `onMouse` hears every click and scroll, since mouse
 * events bubble to the root, where overlays go so theirs bubble there too.
 */
export class Layout {
  readonly root: BoxRenderable
  private readonly main: BoxRenderable
  private hidden = false
  private listScreen = false

  constructor(private readonly renderer: CliRenderer, private readonly parts: LayoutParts, onMouse: () => void) {
    this.root = new BoxRenderable(renderer, {
      width: '100%', height: '100%', flexDirection: 'column',
      onMouseDown: onMouse,
      onMouseScroll: onMouse,
    })
    const body = new BoxRenderable(renderer, { flexGrow: 1, flexDirection: 'row' })
    this.main = new BoxRenderable(renderer, { flexGrow: 1, flexDirection: 'column' })
    this.main.add(parts.pane)
    this.main.add(parts.composer)
    body.add(parts.sidebar.view)
    body.add(this.main)
    this.root.add(parts.statusBar)
    this.root.add(body)
    this.root.add(parts.hintBar)
    renderer.root.add(this.root)
    this.apply()
  }

  /** Too narrow for a sidebar. */
  get narrow(): boolean {
    return this.renderer.width < COLLAPSE_BELOW
  }

  /** The list is a screen of its own rather than a sidebar. */
  get collapsed(): boolean {
    return this.hidden || this.narrow
  }

  /** Whether the list is on screen. */
  get listVisible(): boolean {
    return !this.collapsed || this.listScreen
  }

  /** Hides or shows the sidebar; in a narrow terminal it is always hidden. */
  toggleSidebar(): void {
    this.hidden = !this.hidden
    this.apply()
  }

  /** Which screen a collapsed layout shows: the list, or the conversation. */
  showList(list: boolean): void {
    this.listScreen = list
    this.apply()
  }

  /** Fits the parts to the terminal's size; for after a resize. */
  apply(): void {
    const { sidebar } = this.parts
    if (!this.collapsed) {
      sidebar.width = sidebarWidth(this.renderer.width)
      sidebar.view.visible = true
      this.main.visible = true
      return
    }
    sidebar.width = '100%'
    sidebar.view.visible = this.listScreen
    this.main.visible = !this.listScreen
  }
}
