import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

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
  await expect(page.locator('.scope-footnote')).toHaveText(evidence!)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => localStorage.getItem('labor-playground.document.v1'))).toBe(document)
})

test('hover tooltips and dragging show absolute values without redrawing the waveform', async ({ page }) => {
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
  await page.mouse.down()
  await page.mouse.move(point(0.75), bounds.y + bounds.height / 2, { steps: 8 })
  await page.mouse.up()
  expect(Number(await page.getByLabel('Recording time milliseconds').inputValue())).toBeCloseTo(75, 1)
  await expect(tooltip).toContainText('75 ms')
  await expect(canvas).toHaveAttribute('data-draws', '0')
  await page.mouse.move(bounds.x, bounds.y - 10)
  await expect(tooltip).toHaveCount(0)
})

test('Shift-drag selects a time range and navigation is disabled for stale captures', async ({ page }) => {
  const canvas = await openResults(page)
  await page.getByRole('button', { name: 'Fit entire capture' }).click()
  await canvas.scrollIntoViewIfNeeded()
  const bounds = (await canvas.boundingBox())!
  const point = (fraction: number) => bounds.x + 34 + (bounds.width - 46) * fraction
  await page.keyboard.down('Shift')
  await page.mouse.move(point(0.25), bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(point(0.75), bounds.y + bounds.height / 2, { steps: 5 })
  await expect(page.locator('.scope-zoom-selection')).toBeVisible()
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect(page.locator('.scope-zoom-selection')).toHaveCount(0)
  expect(Number(await canvas.getAttribute('data-window-start'))).toBeCloseTo(0.025, 5)
  expect(Number(await canvas.getAttribute('data-window-end'))).toBeCloseTo(0.075, 5)
  await expect(page.getByLabel('Recording time milliseconds')).toHaveValue('0')

  await page.getByRole('checkbox', { name: 'Auto update' }).uncheck()
  await page.getByRole('button', { name: '220', exact: true }).click()
  await expect(page.getByText('NEEDS SIMULATION', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Zoom in time' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Fit entire capture' })).toBeDisabled()
  await expect(page.getByLabel('Scope time window')).toBeDisabled()
  await expect(page.getByTestId('scope-hover-tooltip')).toHaveCount(0)
})
