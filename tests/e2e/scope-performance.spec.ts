import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const scopeName = 'Voltage versus time for scope channels 1 and 2'

async function countScopeDraws(page: Page) {
  await page.getByLabel(scopeName).evaluate(canvas => { (canvas as HTMLCanvasElement).dataset.clearCount = '0' })
  await page.evaluate(label => {
    const clearRect = CanvasRenderingContext2D.prototype.clearRect
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.getAttribute('aria-label') === label) {
        this.canvas.dataset.clearCount = String(Number(this.canvas.dataset.clearCount ?? 0) + 1)
      }
      return clearRect.apply(this, args)
    }
  }, scopeName)
}

test('scope hover, measurement cursors and seeking reuse the rendered waveform', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('CAPTURED', { exact: true })).toBeVisible()
  await page.getByLabel('Time per division').selectOption('10')
  await page.locator('.scope-measurements > summary').click()
  const canvas = page.getByLabel(scopeName)
  await canvas.scrollIntoViewIfNeeded()
  await expect(canvas).toHaveAttribute('data-window-start', '0')
  await expect(canvas).toHaveAttribute('data-window-end', '0.1')
  await countScopeDraws(page)

  const bounds = (await canvas.boundingBox())!
  await page.mouse.move(bounds.x + 34 + (bounds.width - 46) * 0.5, bounds.y + bounds.height / 2)
  await expect(page.locator('.scope-channel').first().locator('.measurement')).toContainText('50.00 ms')
  await page.getByLabel('Cursor A milliseconds').fill('17')
  await expect(page.getByLabel('Cursor time difference')).toHaveText('-10.000 ms')
  await page.getByLabel('Differential meter position').selectOption('A')
  await expect(page.getByLabel('Differential voltage', { exact: true })).not.toHaveText('—')
  await expect(canvas).toHaveAttribute('data-clear-count', '0')

  await canvas.click({ position: { x: 34 + (bounds.width - 46) * 0.625, y: bounds.height / 2 } })
  expect(Number(await page.getByLabel('Recording time milliseconds').inputValue())).toBeCloseTo(62.5, 1)
  expect(Number(await page.getByLabel('Cursor A milliseconds').inputValue())).toBeCloseTo(62.5, 1)
  await expect(page.getByTestId('scope-playhead')).toBeVisible()
  await expect(canvas).toHaveAttribute('data-clear-count', '0')
})

test('recording playback moves its overlay without redrawing until the view changes', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('CAPTURED', { exact: true })).toBeVisible()
  await page.getByLabel('Time per division').selectOption('10')
  await page.getByLabel('Recording speed').selectOption('0.1')
  const canvas = page.getByLabel(scopeName)
  await expect(canvas).toHaveAttribute('data-window-end', '0.1')
  await countScopeDraws(page)

  await page.getByRole('button', { name: 'Play recording', exact: true }).click()
  await expect.poll(async () => Number(await page.getByLabel('Recording time milliseconds').inputValue())).toBeGreaterThan(10)
  await page.getByRole('button', { name: 'Pause recording', exact: true }).click()
  expect(Number(await page.getByTestId('scope-playhead').getAttribute('data-time'))).toBeGreaterThan(0.01)
  await expect(canvas).toHaveAttribute('data-clear-count', '0')

  await page.getByLabel('Time per division').selectOption('2')
  await page.getByLabel('Recording time milliseconds').fill('75')
  await expect.poll(async () => Number(await canvas.getAttribute('data-clear-count'))).toBeGreaterThan(0)
  expect(Number(await canvas.getAttribute('data-window-start'))).toBeLessThanOrEqual(0.075)
  expect(Number(await canvas.getAttribute('data-window-end'))).toBeGreaterThanOrEqual(0.075)
  await expect(page.getByTestId('scope-playhead')).toHaveAttribute('data-time', '0.075')
})
