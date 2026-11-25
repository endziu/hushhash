import { BoxRenderable, type CliRenderer, type Renderable } from '@opentui/core'

export interface LayoutParts {
  statusBar: Renderable
  sidebar: Renderable
  pane: Renderable
  composer: Renderable
  hintBar: Renderable
}

/**
 * Arranges the parts on screen: the status bar on top, the sidebar beside
 * the pane and composer, and the hint bar at the bottom. `onMouse` hears every
 * click and scroll, since mouse events bubble to the root. Returns the root,
 * where overlays go so their mouse events bubble there too.
 */
export function mountLayout(renderer: CliRenderer, parts: LayoutParts, onMouse: () => void): BoxRenderable {
  const root = new BoxRenderable(renderer, {
    width: '100%', height: '100%', flexDirection: 'column',
    onMouseDown: onMouse,
    onMouseScroll: onMouse,
  })
  const body = new BoxRenderable(renderer, { flexGrow: 1, flexDirection: 'row' })
  const main = new BoxRenderable(renderer, { flexGrow: 1, flexDirection: 'column' })
  main.add(parts.pane)
  main.add(parts.composer)
  body.add(parts.sidebar)
  body.add(main)
  root.add(parts.statusBar)
  root.add(body)
  root.add(parts.hintBar)
  renderer.root.add(root)
  return root
}
