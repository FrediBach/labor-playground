import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

const scopeLabel = 'Voltage versus time for scope channels 1 and 2'

async function openResults(page: Page) {
  await page.goto('/')
  await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Results', exact: true }).click()
  await expect(page.getByText('CAPTURED', { exact: true })).toBeVisible()
  return page.getByLabel(scopeLabel, { exact: true })
}

async function countDraws(page: Page) {
  await page.evaluate(label => {
    const original = CanvasRenderingContext2D.prototype.clearRect
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.getAttribute('aria-label') === label) this.canvas.dataset.draws = String(Number(this.canvas.dataset.draws ?? 0) + 1)
      return original.apply(this, args)
    }
    document.querySelector<HTMLCanvasElement>(`canvas[aria-label="${label}"]`)!.dataset.draws = '0'
  }, scopeLabel)
}

async function plotBounds(canvas: Locator) {
  await canvas.scrollIntoViewIfNeeded()
  const bounds = (await canvas.boundingBox())!
  return { x: bounds.x + 34, y: bounds.y + 12, width: bounds.width - 46, height: bounds.height - 32 }
}

async function expectView(canvas: Locator, start: number, end: number, top: number, height: number) {
  for (const [attribute, value] of Object.entries({ 'data-window-start': start, 'data-window-end': end, 'data-view-top': top, 'data-view-height': height })) {
    await expect.poll(async () => Number(await canvas.getAttribute(attribute))).toBeCloseTo(value, 5)
  }
}

test('time zoom, panning and keyboard seeking inspect the same capture without editing the project', async ({ page }) => {
  const canvas = await openResults(page)
  const document = await page.evaluate(() => localStorage.getItem('labor-playground.document.v1'))
  const evidence = await page.locator('.scope-footnote').textContent()
  await page.getByRole('button', { name: 'Fit entire capture' }).click()
  await expect(canvas).toHaveAttribute('data-window-start', '0')
  await expect(canvas).toHaveAttribute('data-window-end', '0.1')
  await expect(page.getByRole('button', { name: 'Zoom out time' })).toBeDisabled()

  await page.getByRole('button', { name: 'Zoom in time' }).click()
  await expect(canvas).toHaveAttribute('data-window-end', '0.05')
  await page.getByRole('button', { name: 'Pan scope later' }).click()
  expect(Number(await canvas.getAttribute('data-window-start'))).toBeCloseTo(0.025, 6)
  expect(Number(await canvas.getAttribute('data-window-end'))).toBeCloseTo(0.075, 6)
  await expect(page.getByLabel('Scope time window')).toHaveAttribute('aria-valuetext', '25 ms to 75 ms')

  await canvas.press('End')
  await expect(page.getByLabel('Recording time milliseconds')).toHaveValue('100')
  expect(Number(await canvas.getAttribute('data-window-end'))).toBeCloseTo(0.1, 6)
  await canvas.press('Home')
  await expect(page.getByLabel('Recording time milliseconds')).toHaveValue('0')
  await canvas.press('ArrowRight')
  expect(Number(await page.getByLabel('Recording time milliseconds').inputValue())).toBeCloseTo(0.5, 3)
  await canvas.press('Shift+ArrowRight')
  expect(Number(await page.getByLabel('Recording time milliseconds').inputValue())).toBeCloseTo(5.5, 3)
  await canvas.press('+')
  expect(Number(await canvas.getAttribute('data-window-end')) - Number(await canvas.getAttribute('data-window-start'))).toBeCloseTo(0.025, 6)
  await canvas.press('-')
  expect(Number(await canvas.getAttribute('data-window-end')) - Number(await canvas.getAttribute('data-window-start'))).toBeCloseTo(0.05, 6)
  const plot = await plotBounds(canvas)
  await page.mouse.dblclick(plot.x + plot.width / 2, plot.y + plot.height / 2)
  await expectView(canvas, 0, 0.1, 0, 1)
  expect(Number(await page.getByLabel('Recording time milliseconds').inputValue())).toBeCloseTo(5.5, 3)
  await expect(page.locator('.scope-footnote')).toHaveText(evidence!)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => localStorage.getItem('labor-playground.document.v1'))).toBe(document)
})

test('hover tooltips and Shift-drag scrubbing show absolute values without redrawing the waveform', async ({ page }) => {
  const canvas = await openResults(page)
  await page.getByLabel('Load example').selectOption('voltage-divider')
  await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Results', exact: true }).click()
  await expect(page.getByText('CAPTURED', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Fit entire capture' }).click()
  await canvas.scrollIntoViewIfNeeded()
  await countDraws(page)
  const bounds = (await canvas.boundingBox())!
  const point = (fraction: number) => bounds.x + 34 + (bounds.width - 46) * fraction
  await page.mouse.move(point(0.25), bounds.y + bounds.height / 2)
  const tooltip = page.getByTestId('scope-hover-tooltip')
  await expect(tooltip).toContainText('25 ms')
  await expect(tooltip).toContainText('CH15.000 V')
  await expect(tooltip).toContainText('CH22.500 V')
  await page.keyboard.down('Shift')
  await page.mouse.down()
  await page.mouse.move(point(0.75), bounds.y + bounds.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  expect(Number(await page.getByLabel('Recording time milliseconds').inputValue())).toBeCloseTo(75, 1)
  await expect(tooltip).toContainText('75 ms')
  await expect(canvas).toHaveAttribute('data-draws', '0')
  await page.mouse.move(bounds.x, bounds.y - 10)
  await expect(tooltip).toHaveCount(0)
})

test('dragging a rectangle zooms both axes and double-click restores each previous view without changing the capture', async ({ page }, testInfo) => {
  const canvas = await openResults(page)
  const scope = page.getByRole('region', { name: 'Oscilloscope', exact: true })
  const document = await page.evaluate(() => localStorage.getItem('labor-playground.document.v1'))
  const evidence = await page.locator('.scope-footnote').textContent()
  await page.getByRole('button', { name: 'Fit entire capture' }).click()
  const plot = await plotBounds(canvas)
  const scrollPosition = await page.evaluate(() => ({ left: window.scrollX, top: window.scrollY }))
  await page.mouse.move(plot.x + plot.width * 0.25, plot.y + plot.height * 0.25)
  await page.mouse.down()
  await page.mouse.move(plot.x + plot.width * 0.75, plot.y + plot.height * 0.75, { steps: 5 })
  const selection = page.locator('.scope-zoom-selection')
  await expect(selection).toBeVisible()
  const rectangle = (await selection.boundingBox())!
  expect(Math.abs(rectangle.x - (plot.x + plot.width * 0.25))).toBeLessThan(1)
  expect(Math.abs(rectangle.y - (plot.y + plot.height * 0.25))).toBeLessThan(1)
  expect(Math.abs(rectangle.width - plot.width * 0.5)).toBeLessThan(1)
  expect(Math.abs(rectangle.height - plot.height * 0.5)).toBeLessThan(1)
  await scope.screenshot({ path: testInfo.outputPath('scope-rectangle-selection.png'), style: '.project-toolbar { visibility: hidden !important; }' })
  await page.evaluate(position => window.scrollTo(position), scrollPosition)
  await page.mouse.up()
  await expect(selection).toHaveCount(0)
  await expectView(canvas, 0.025, 0.075, 0.25, 0.5)
  await expect(page.getByLabel('Recording time milliseconds')).toHaveValue('0')
  await scope.screenshot({ path: testInfo.outputPath('scope-rectangle-zoom.png'), style: '.project-toolbar { visibility: hidden !important; }' })
  await page.evaluate(position => window.scrollTo(position), scrollPosition)

  // Reverse-direction rectangles and repeated zoom-out restore the complete view.
  await page.mouse.move(plot.x + plot.width * 0.75, plot.y + plot.height * 0.75)
  await page.mouse.down()
  await page.mouse.move(plot.x + plot.width * 0.25, plot.y + plot.height * 0.25, { steps: 5 })
  await page.mouse.up()
  await expectView(canvas, 0.0375, 0.0625, 0.375, 0.25)
  await page.mouse.dblclick(plot.x + plot.width / 2, plot.y + plot.height / 2)
  await expectView(canvas, 0.025, 0.075, 0.25, 0.5)
  await page.mouse.dblclick(plot.x + plot.width / 2, plot.y + plot.height / 2)
  await expectView(canvas, 0, 0.1, 0, 1)
  await expect(page.getByLabel('Recording time milliseconds')).toHaveValue('0')
  await expect(page.locator('.scope-footnote')).toHaveText(evidence!)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => localStorage.getItem('labor-playground.document.v1'))).toBe(document)

  await page.mouse.click(plot.x + plot.width * 0.4, plot.y + plot.height / 2)
  await expect(page.getByLabel('Recording time milliseconds')).toHaveValue('40')
  await expectView(canvas, 0, 0.1, 0, 1)
})

test('Space-drag pans both axes before canvas focus, clamps to the capture, and cancels cleanly', async ({ page }) => {
  const canvas = await openResults(page)
  await page.getByRole('button', { name: 'Fit entire capture' }).click()
  const plot = await plotBounds(canvas)
  await page.mouse.move(plot.x + plot.width * 0.25, plot.y + plot.height * 0.25)
  await page.mouse.down()
  await page.mouse.move(plot.x + plot.width * 0.75, plot.y + plot.height * 0.75, { steps: 5 })
  await page.mouse.up()
  await expectView(canvas, 0.025, 0.075, 0.25, 0.5)
  await canvas.evaluate(element => element.blur())
  await expect(canvas).not.toBeFocused()
  await page.mouse.move(plot.x + plot.width * 0.5, plot.y + plot.height * 0.5)
  const scrollTop = await page.evaluate(() => window.scrollY)
  await page.keyboard.down('Space')
  await page.mouse.down()
  await page.mouse.move(plot.x + plot.width * 0.7, plot.y + plot.height * 0.7, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Space')
  await expectView(canvas, 0.015, 0.065, 0.15, 0.5)
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollTop)
  await expect(page.getByLabel('Recording time milliseconds')).toHaveValue('0')

  await page.mouse.move(plot.x + plot.width * 0.25, plot.y + plot.height * 0.25)
  await page.mouse.down()
  await page.mouse.move(plot.x + plot.width * 0.75, plot.y + plot.height * 0.75, { steps: 5 })
  await expect(page.locator('.scope-zoom-selection')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(page.locator('.scope-zoom-selection')).toHaveCount(0)
  await expectView(canvas, 0.015, 0.065, 0.15, 0.5)

  await page.mouse.move(plot.x + plot.width * 0.1, plot.y + plot.height * 0.5)
  await page.keyboard.down('Space')
  await page.mouse.down()
  await page.mouse.move(plot.x + plot.width * 0.9, plot.y + plot.height * 0.5, { steps: 5 })
  await expectView(canvas, 0, 0.05, 0.15, 0.5)
  await page.keyboard.press('Escape')
  await expectView(canvas, 0.015, 0.065, 0.15, 0.5)
  await page.mouse.up()
  await page.keyboard.up('Space')

  // Losing the window clears the held modifier, even if its keyup was missed.
  await page.keyboard.down('Space')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.mouse.move(plot.x + plot.width * 0.25, plot.y + plot.height * 0.25)
  await page.mouse.down()
  await page.mouse.move(plot.x + plot.width * 0.75, plot.y + plot.height * 0.75, { steps: 5 })
  await expect(page.locator('.scope-zoom-selection')).toBeVisible()
  await page.mouse.up()
  await page.keyboard.up('Space')
  await expectView(canvas, 0.0275, 0.0525, 0.275, 0.25)
  await expect(page.getByLabel('Recording time milliseconds')).toHaveValue('0')
})

test('scope navigation is disabled for stale captures', async ({ page }) => {
  const canvas = await openResults(page)
  await page.getByRole('button', { name: 'Fit entire capture' }).click()
  await page.getByRole('checkbox', { name: 'Auto update' }).uncheck()
  await page.getByRole('button', { name: '220', exact: true }).click()
  await expect(page.getByText('NEEDS SIMULATION', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Zoom in time' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Fit entire capture' })).toBeDisabled()
  await expect(page.getByLabel('Scope time window')).toBeDisabled()
  const plot = await plotBounds(canvas)
  await page.mouse.move(plot.x + plot.width * 0.25, plot.y + plot.height * 0.25)
  await page.mouse.down()
  await page.mouse.move(plot.x + plot.width * 0.75, plot.y + plot.height * 0.75, { steps: 5 })
  await page.mouse.up()
  await expect(page.locator('.scope-zoom-selection')).toHaveCount(0)
  await expect(page.getByTestId('scope-hover-tooltip')).toHaveCount(0)
})

test('Space still activates a focused control while the pointer hovers over the scope', async ({ page }) => {
  const canvas = await openResults(page)
  const channel = page.getByRole('region', { name: 'Oscilloscope', exact: true }).getByRole('button', { name: 'CH1', exact: true })
  await channel.focus()
  const plot = await plotBounds(canvas)
  await page.mouse.move(plot.x + plot.width / 2, plot.y + plot.height / 2)
  await page.keyboard.press('Space')
  await expect(channel).toHaveAttribute('aria-pressed', 'false')
  await expect(canvas).toHaveAttribute('data-pan', 'false')
  await expect(page.getByLabel('Recording time milliseconds')).toHaveValue('0')
})
