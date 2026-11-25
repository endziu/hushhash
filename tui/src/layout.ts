import { BoxRenderable, type CliRenderer, type Renderable } from '@opentui/core'

export interface LayoutParts {
  header: Renderable
  sidebar: Renderable
  pane: Renderable
  composer: Renderable
  footer: Renderable
}

/**
 * Arranges the parts on screen: the header on top, the sidebar beside the
 * pane and composer, and the footer at the bottom. `onMouse` hears every
 * click and scroll, since mouse events bubble to the root.
 */
export function mountLayout(renderer: CliRenderer, parts: LayoutParts, onMouse: () => void): void {
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
  root.add(parts.header)
  root.add(body)
  root.add(parts.footer)
  renderer.root.add(root)
}
