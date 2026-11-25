import { afterEach, beforeEach, expect, test } from 'bun:test'
import { BoxRenderable, TextareaRenderable, type KeyEvent } from '@opentui/core'
import { createTestRenderer } from '@opentui/core/testing'
import { Modals } from './modals'

let setup: Awaited<ReturnType<typeof createTestRenderer>>
let modals: Modals
let underneath: TextareaRenderable
let keysUnderneath: string[]

beforeEach(async () => {
  setup = await createTestRenderer({ width: 80, height: 24 })
  const root = new BoxRenderable(setup.renderer, { width: '100%', height: '100%' })
  setup.renderer.root.add(root)
  underneath = new TextareaRenderable(setup.renderer, { width: '100%', height: 3 })
  root.add(underneath)
  underneath.focus()
  modals = new Modals(setup.renderer, root)
  keysUnderneath = []
  // As the app does: an open modal takes the key, otherwise it is the app's.
  setup.renderer.keyInput.on('keypress', (key: KeyEvent) => {
    if (!modals.handleKey(key)) keysUnderneath.push(key.name)
  })
})

afterEach(() => setup.renderer.destroy())

async function frame(): Promise<string> {
  await setup.renderOnce()
  return setup.captureCharFrame()
}

/** Clicks the first cell showing `text`. */
async function click(text: string) {
  const lines = (await frame()).split('\n')
  const y = lines.findIndex(line => line.includes(text))
  if (y < 0) throw new Error(`${text} is not on screen\n${lines.join('\n')}`)
  await setup.mockMouse.click(lines[y]!.indexOf(text), y)
}

test('a modal shows its title and body, takes keys and gives focus back on Esc', async () => {
  const closed = modals.show({ title: 'Help', body: 'Some help text' })
  expect(await frame()).toContain(' Help ')
  expect(await frame()).toContain('Some help text')
  expect(modals.isOpen).toBe(true)
  expect(underneath.focused).toBe(false)

  await setup.mockInput.typeText('ab')
  expect(underneath.plainText).toBe('')
  expect(keysUnderneath).toEqual([])

  setup.mockInput.pressEscape()
  await closed
  expect(modals.isOpen).toBe(false)
  expect(await frame()).not.toContain('Some help text')
  expect(underneath.focused).toBe(true)
  await setup.mockInput.typeText('c')
  expect(underneath.plainText).toBe('c')
})

test('a long body scrolls inside a modal that fits the screen', async () => {
  void modals.show({ title: 'Long', body: Array.from({ length: 60 }, (_, i) => `row ${i}`).join('\n') })
  const lines = (await frame()).split('\n')
  expect(lines.filter(line => line.includes('╭')).length).toBe(1)
  expect(lines.some(line => line.includes('row 0 '))).toBe(true)
  expect(lines.some(line => line.includes('row 59'))).toBe(false)
  setup.mockInput.pressKey('PAGEDOWN' as never)
  for (let i = 0; i < 60; i++) setup.mockInput.pressArrow('down')
  expect(await frame()).toContain('row 59')
})

test('confirm starts on Cancel, so Enter cancels', async () => {
  const answer = modals.confirm({ title: 'Clear conversation', body: 'Delete everything?', action: 'Delete' })
  expect(await frame()).toContain('[ Cancel ]')
  expect(await frame()).toContain('[ Delete ]')
  setup.mockInput.pressEnter()
  expect(await answer).toBe(false)
  expect(modals.isOpen).toBe(false)
})

test('confirm: → then Enter, or y, chooses the action', async () => {
  let answer = modals.confirm({ title: 'Clear', body: 'Sure?', action: 'Delete' })
  setup.mockInput.pressArrow('right')
  setup.mockInput.pressEnter()
  expect(await answer).toBe(true)

  answer = modals.confirm({ title: 'Clear', body: 'Sure?', action: 'Delete' })
  await setup.mockInput.typeText('y')
  expect(await answer).toBe(true)
})

test('confirm: Esc and n cancel', async () => {
  let answer = modals.confirm({ title: 'Clear', body: 'Sure?', action: 'Delete' })
  setup.mockInput.pressEscape()
  expect(await answer).toBe(false)

  answer = modals.confirm({ title: 'Clear', body: 'Sure?', action: 'Delete' })
  await setup.mockInput.typeText('n')
  expect(await answer).toBe(false)
})

test('confirm by mouse: a click on the action confirms, a click outside cancels', async () => {
  let answer = modals.confirm({ title: 'Clear', body: 'Sure?', action: 'Delete' })
  await click('[ Delete ]')
  expect(await answer).toBe(true)

  answer = modals.confirm({ title: 'Clear', body: 'Sure?', action: 'Delete' })
  await frame() // clicks hit what was last drawn
  await setup.mockMouse.click(0, 23)
  expect(await answer).toBe(false)
  expect(underneath.focused).toBe(true)
})

test('prompt returns the text on Enter and null on Esc', async () => {
  let answer = modals.prompt({ title: 'Name', label: 'Name this contact', value: 'Al' })
  expect(await frame()).toContain('Name this contact')
  await setup.mockInput.typeText('ice')
  setup.mockInput.pressEnter()
  expect(await answer).toBe('Alice')
  expect(underneath.plainText).toBe('')

  answer = modals.prompt({ title: 'Name' })
  await setup.mockInput.typeText('Bob')
  setup.mockInput.pressEscape()
  expect(await answer).toBeNull()
  expect(underneath.focused).toBe(true)
})

test('prompt keeps asking while the text is invalid', async () => {
  const answer = modals.prompt({ title: 'Open', validate: value => value.startsWith('0x') ? null : 'Enter an address starting with 0x' })
  await setup.mockInput.typeText('nope')
  setup.mockInput.pressEnter()
  expect(await frame()).toContain('Enter an address starting with 0x')
  expect(modals.isOpen).toBe(true)
  for (let i = 0; i < 4; i++) setup.mockInput.pressBackspace()
  await setup.mockInput.typeText('0xabc')
  expect(await frame()).not.toContain('Enter an address starting with 0x')
  setup.mockInput.pressEnter()
  expect(await answer).toBe('0xabc')
})

test('opening a modal cancels the one already open', async () => {
  const first = modals.confirm({ title: 'First', body: 'one', action: 'Do' })
  const second = modals.show({ title: 'Second', body: 'two' })
  expect(await first).toBe(false)
  expect(await frame()).not.toContain(' First ')
  expect(await frame()).toContain(' Second ')
  setup.mockInput.pressEscape()
  await second
  expect(underneath.focused).toBe(true)
})

test('Alt or Ctrl with a key does not answer a confirm', async () => {
  const answer = modals.confirm({ title: 'Clear', body: 'Sure?', action: 'Delete' })
  setup.mockInput.pressKey('y', { meta: true })
  setup.mockInput.pressEnter({ meta: true })
  expect(modals.isOpen).toBe(true)
  await setup.mockInput.typeText('n')
  expect(await answer).toBe(false)
})

test('only a left click outside cancels, and clicks inside take no focus', async () => {
  const answer = modals.confirm({ title: 'Clear', body: 'Sure? Click me', action: 'Delete' })
  await frame()
  await setup.mockMouse.click(0, 23, 2)
  expect(modals.isOpen).toBe(true)
  await click('Click me')
  expect(modals.isOpen).toBe(true)
  expect(setup.renderer.currentFocusedRenderable).toBeNull()
  await setup.mockMouse.click(0, 23)
  expect(await answer).toBe(false)
})

test('a modal fits its body again when the terminal is resized', async () => {
  void modals.show({ title: 'Help', body: Array.from({ length: 12 }, (_, i) => `row ${i}`).join('\n') })
  expect(await frame()).toContain('row 11')
  setup.resize(80, 10)
  expect(await frame()).not.toContain('row 11')
  setup.resize(80, 24)
  expect(await frame()).toContain('row 11')
})
