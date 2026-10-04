import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function captured(page: Page) {
  await expect(page.getByRole('status', { name: 'Simulation status', exact: true })).toHaveAttribute('data-state', 'ready', { timeout: 45_000 })
}

async function observeAudio(page: Page) {
  await page.addInitScript(() => {
    const events: Array<{ type: string; loop: boolean }> = []
    ;(window as unknown as { audioEvents: typeof events }).audioEvents = events
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

async function audioEvents(page: Page) {
  return page.evaluate(() => (window as unknown as { audioEvents: Array<{ type: string; loop: boolean }> }).audioEvents)
}

test('steady listening is explicit, volume leaves the circuit unchanged, and mute or edits stop the loop', async ({ page }) => {
  await observeAudio(page)
  await page.goto('/')
  await captured(page)
  expect(await audioEvents(page)).toEqual([])
  await page.getByLabel('Audio preview mode', { exact: true }).selectOption('loop')
  await page.getByRole('button', { name: 'Listen', exact: true }).click()
  await expect.poll(async () => (await audioEvents(page)).filter(event => event.type === 'start')).toEqual([{ type: 'start', loop: true }])
  // A loop must remain active after the original 100 ms capture has elapsed.
  await page.waitForTimeout(180)
  await expect(page.getByRole('button', { name: 'Stop listening', exact: true })).toBeVisible()
  const before = await page.evaluate(() => localStorage.getItem('labor-playground.document.v1'))
  const capture = await page.locator('.scope-footnote').textContent()
  const volume = page.getByRole('slider', { name: 'Monitor volume', exact: true })
  await volume.focus()
  await volume.press('Home')
  await volume.press('ArrowRight')
  await expect(volume).toHaveValue('1')
  await expect(page.getByRole('button', { name: 'Stop listening', exact: true })).toBeVisible()
  expect((await audioEvents(page)).filter(event => event.type === 'start')).toHaveLength(1)
  expect(await page.evaluate(() => localStorage.getItem('labor-playground.document.v1'))).toBe(before)
  await expect(page.locator('.scope-footnote')).toHaveText(capture!)
  await page.getByRole('button', { name: 'Mute audio', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeVisible()
  await expect.poll(async () => (await audioEvents(page)).filter(event => event.type === 'stop').length).toBe(1)

  await page.getByRole('button', { name: 'Listen', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop listening', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '220', exact: true }).click()
  await captured(page)
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeVisible()
  expect((await audioEvents(page)).filter(event => event.type === 'start')).toHaveLength(2)
  await expect.poll(async () => (await audioEvents(page)).filter(event => event.type === 'stop').length).toBe(2)
})

test('a one-shot envelope cannot loop, plays once, and stops from the actual audio end event', async ({ page }) => {
  await observeAudio(page)
  await page.goto('/')
  await page.getByLabel('Load example').selectOption('envelope-shaping')
  await captured(page)
  await expect(page.getByLabel('Audio preview mode', { exact: true })).toHaveValue('once')
  await expect(page.getByLabel('Audio preview mode').locator('option[value="loop"]')).toBeDisabled()
  await page.getByRole('button', { name: 'Listen', exact: true }).click()
  await expect.poll(async () => (await audioEvents(page)).filter(event => event.type === 'start')).toEqual([{ type: 'start', loop: false }])
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeVisible()
  expect((await audioEvents(page)).filter(event => event.type === 'start')).toHaveLength(1)
})

test('the scope resizes by keyboard and drag without changing cursors, capture, or undo', async ({ page }, testInfo) => {
  await page.goto('/')
  await captured(page)
  const original = await page.evaluate(() => localStorage.getItem('labor-playground.document.v1'))
  const capture = await page.locator('.scope-footnote').textContent()
  await page.getByRole('tab', { name: 'Results', exact: true }).click()
  const canvas = page.getByLabel('Voltage versus time for scope channels 1 and 2')
  const separator = page.getByRole('separator', { name: 'Scope height', exact: true })
  const initial = (await canvas.boundingBox())!.height
  await separator.focus()
  await separator.press('ArrowDown')
  await expect(separator).toHaveAttribute('aria-valuenow', String(initial + 20))
  const grip = (await separator.boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 80, { steps: 6 })
  await page.mouse.up()
  await expect(separator).toHaveAttribute('aria-valuenow', String(initial + 100))
  await page.locator('.scope-measurements > summary').click()
  await page.getByRole('spinbutton', { name: 'Cursor A milliseconds' }).fill('3')
  await separator.press('End')
  await expect(separator).toHaveAttribute('aria-valuenow', '640')
  await expect(page.getByRole('spinbutton', { name: 'Cursor A milliseconds' })).toHaveValue('3')
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => localStorage.getItem('labor-playground.document.v1'))).toBe(original)
  await expect(page.locator('.scope-footnote')).toHaveText(capture!)
  await separator.press('Enter')
  await expect(separator).toHaveAttribute('aria-valuenow', String(initial))
  await page.locator('.scope-measurements > summary').click()
  await page.screenshot({ path: testInfo.outputPath('workbench-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: testInfo.outputPath('workbench-mobile.png'), fullPage: true })
})
