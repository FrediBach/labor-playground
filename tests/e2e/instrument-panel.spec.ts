import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const documentKey = 'labor-playground.document.v1'
const densityKey = 'labor.instrument-density'
const compactToggle = (page: Page) => page.getByRole('button', { name: 'Compact instruments', exact: true })
const ready = (page: Page) => expect(page.getByRole('status', { name: 'Simulation status', exact: true })).toHaveAttribute('data-state', 'ready', { timeout: 45_000 })
const savedDocument = (page: Page) => page.evaluate(key => localStorage.getItem(key), documentKey)

async function observeAudio(page: Page) {
  await page.addInitScript(() => {
    const events: Array<{ type: string; loop: boolean }> = []
    ;(window as unknown as { instrumentAudioEvents: typeof events }).instrumentAudioEvents = events
    const create = AudioContext.prototype.createBufferSource
    AudioContext.prototype.createBufferSource = function () {
      const source = create.call(this)
      const start = source.start.bind(source), stop = source.stop.bind(source)
      source.start = (...args) => { events.push({ type: 'start', loop: source.loop }); start(...args) }
      source.stop = (...args) => { events.push({ type: 'stop', loop: source.loop }); stop(...args) }
      return source
    }
  })
}

const audioEvents = (page: Page) => page.evaluate(() => (window as unknown as { instrumentAudioEvents: Array<{ type: string; loop: boolean }> }).instrumentAudioEvents)

test('keyboard density changes preserve the circuit, capture, history and active listening', async ({ page }) => {
  await observeAudio(page)
  await page.goto('/')
  await ready(page)
  const toggle = compactToggle(page)
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  const frequency = page.getByRole('spinbutton', { name: 'Frequency in Hz', exact: true })
  const originalFrequency = await frequency.inputValue()
  await frequency.fill('660')
  await frequency.press('Tab')
  await ready(page)
  await expect.poll(async () => JSON.parse(await savedDocument(page) ?? '{}').instruments?.frequency).toBe(660)
  const document = await savedDocument(page)
  const capture = await page.locator('.scope-footnote').textContent()
  await page.getByLabel('Audio preview mode', { exact: true }).selectOption('loop')
  await page.getByRole('button', { name: 'Listen', exact: true }).click()
  await expect.poll(() => audioEvents(page)).toEqual([{ type: 'start', loop: true }])

  await toggle.focus()
  await toggle.press('Enter')
  await expect(toggle).toBeFocused()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.instrument-rack')).toHaveClass(/\bis-compact\b/)
  await expect(page.getByRole('button', { name: 'Stop listening', exact: true })).toBeVisible()
  await toggle.press('Space')
  await expect(toggle).toBeFocused()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.instrument-rack')).not.toHaveClass(/\bis-compact\b/)
  // Allow a mistakenly scheduled auto-capture or audio cleanup to become observable.
  await page.waitForTimeout(400)
  await expect(page.getByRole('button', { name: 'Stop listening', exact: true })).toBeVisible()
  expect(await audioEvents(page)).toEqual([{ type: 'start', loop: true }])
  expect(await savedDocument(page)).toBe(document)
  await expect(page.locator('.scope-footnote')).toHaveText(capture!)
  await ready(page)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(frequency).toHaveValue(originalFrequency)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
})

test('compact source controls keep numeric editing, waveform selection and undo', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await compactToggle(page).click()
  for (const [label, value] of [
    ['Frequency in Hz', '880'], ['Amplitude', '3.5'], ['CV output', '-1.5'], ['Envelope decay', '12'],
  ]) {
    const control = page.getByRole('spinbutton', { name: label, exact: true })
    await expect(control).toBeVisible()
    const original = await control.inputValue()
    await control.fill(value)
    await control.press('Tab')
    await expect(control).toHaveValue(value)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(control).toHaveValue(original)
    await expect(compactToggle(page)).toHaveAttribute('aria-pressed', 'true')
  }
  const waveforms = page.locator('.instrument-panel .waveform-buttons')
  const originalWaveform = await waveforms.locator('[aria-pressed="true"]').getAttribute('aria-label')
  const waveform = waveforms.getByRole('button', { name: originalWaveform === 'triangle wave' ? 'square wave' : 'triangle wave', exact: true })
  await waveform.click()
  await expect(waveform).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(waveforms.getByRole('button', { name: originalWaveform!, exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('Envelope mode', { exact: true }).selectOption('gate')
  await page.getByRole('button', { name: 'Gate high', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Gate high', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Gate high', exact: true })).toHaveAttribute('aria-pressed', 'false')
})

test('instrument density survives workspace tabs and browser reload independently of the project', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await expect.poll(() => savedDocument(page)).not.toBeNull()
  const document = await savedDocument(page)
  await compactToggle(page).click()
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), densityKey)).toBe('compact')
  await page.getByRole('tab', { name: 'Results', exact: true }).click()
  await page.getByRole('tab', { name: 'Circuit', exact: true }).click()
  await expect(compactToggle(page)).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await expect(compactToggle(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.instrument-rack')).toHaveClass(/\bis-compact\b/)
  expect(JSON.parse((await savedDocument(page))!)).toEqual(JSON.parse(document!))
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await compactToggle(page).click()
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), densityKey)).toBe('full')
  await page.reload()
  await expect(compactToggle(page)).toHaveAttribute('aria-pressed', 'false')
  expect(JSON.parse((await savedDocument(page))!)).toEqual(JSON.parse(document!))
})

async function checkPanelGeometry(page: Page, width: number) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  const panel = page.locator('.instrument-panel')
  const rectangles = await panel.locator('button, input, select').evaluateAll(controls => controls.flatMap(control => {
    const bounds = control.getBoundingClientRect()
    const style = getComputedStyle(control)
    if (!bounds.width || !bounds.height || style.visibility === 'hidden' || style.display === 'none') return []
    const module = control.closest('.hardware-panel, .scope-module')!.getBoundingClientRect()
    return [{
      label: control.getAttribute('aria-label') ?? control.textContent,
      x: bounds.x, y: bounds.y, right: bounds.right, bottom: bounds.bottom,
      module: { x: module.x, y: module.y, right: module.right, bottom: module.bottom },
    }]
  }))
  for (const [index, control] of rectangles.entries()) {
    expect(control.x, `${control.label} stays inside its module`).toBeGreaterThanOrEqual(control.module.x - 1)
    expect(control.right, `${control.label} stays inside its module`).toBeLessThanOrEqual(control.module.right + 1)
    expect(control.y, `${control.label} stays inside its module`).toBeGreaterThanOrEqual(control.module.y - 1)
    expect(control.bottom, `${control.label} stays inside its module`).toBeLessThanOrEqual(control.module.bottom + 1)
    for (const other of rectangles.slice(index + 1)) {
      const overlapX = Math.min(control.right, other.right) - Math.max(control.x, other.x)
      const overlapY = Math.min(control.bottom, other.bottom) - Math.max(control.y, other.y)
      expect(overlapX > 1 && overlapY > 1, `${control.label} does not overlap ${other.label}`).toBe(false)
    }
  }
  for (const label of ['Frequency in Hz', 'Amplitude', 'CV output', 'Envelope decay', 'Envelope mode', 'Audio preview channel', 'Audio preview mode']) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible()
  }
}

test('both instrument layouts fit desktop and mobile, with compact desktop near one third height', async ({ page }, testInfo) => {
  await page.goto('/')
  await ready(page)
  for (const width of [1920, 1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1120 })
    await expect(compactToggle(page)).toHaveAttribute('aria-pressed', 'false')
    await checkPanelGeometry(page, width)
    const fullHeight = (await page.locator('.instrument-panel').boundingBox())!.height
    await page.locator('.instrument-rack').screenshot({ path: testInfo.outputPath(`instruments-full-${width}.png`) })
    await compactToggle(page).click()
    await expect(compactToggle(page)).toHaveAttribute('aria-pressed', 'true')
    await checkPanelGeometry(page, width)
    const compactHeight = (await page.locator('.instrument-panel').boundingBox())!.height
    await page.locator('.instrument-rack').screenshot({ path: testInfo.outputPath(`instruments-compact-${width}.png`) })
    await testInfo.attach(`instrument-heights-${width}`, { body: JSON.stringify({ fullHeight, compactHeight }), contentType: 'application/json' })
    expect(compactHeight).toBeLessThan(fullHeight * (width >= 1440 ? 0.45 : 0.85))
    await compactToggle(page).click()
  }
})
