import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function captured(page: Page) {
  await expect(page.getByText('CAPTURED', { exact: true })).toBeVisible({ timeout: 45_000 })
}

function cells(page: Page, label: string) {
  return page.getByRole('table', { name: 'Channel measurements' }).getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: label, exact: true }) }).getByRole('cell')
}

async function recovery(page: Page) {
  return page.evaluate(() => localStorage.getItem('labor-playground.document.v1'))
}

test('edge triggering reframes a real capture while absolute cursors and undo remain unchanged', async ({ page }) => {
  await page.goto('/')
  await captured(page)
  await page.getByRole('checkbox', { name: 'Auto update' }).uncheck()
  await page.locator('.scope-measurements > summary').click()
  await page.getByRole('spinbutton', { name: 'Cursor A milliseconds' }).fill('1')
  await page.getByRole('spinbutton', { name: 'Cursor B milliseconds' }).fill('3')
  const voltages = await cells(page, 'At cursor A').allTextContents()
  const document = await recovery(page)
  const captureFootnote = await page.locator('.scope-footnote').textContent()

  await page.locator('.scope-trigger > summary').click()
  await page.getByRole('combobox', { name: 'Trigger source' }).selectOption('CH1')
  await expect(page.getByTestId('trigger-status')).toContainText('Rising CH1 crossing at')
  const canvas = page.getByLabel('Voltage versus time for scope channels 1 and 2')
  const trigger = Number(await canvas.getAttribute('data-trigger-time'))
  const start = Number(await canvas.getAttribute('data-window-start'))
  expect(trigger).toBeGreaterThan(0.0044)
  expect(trigger).toBeLessThan(0.0047)
  expect(start).toBeCloseTo(trigger - 0.002, 6)
  await expect(cells(page, 'At cursor A')).toHaveText(voltages)
  await expect(page.getByRole('spinbutton', { name: 'Cursor A milliseconds' })).toHaveValue('1')
  await expect(page.getByRole('spinbutton', { name: 'Cursor B milliseconds' })).toHaveValue('3')
  await expect(page.getByText('A cursor is outside the displayed time window.', { exact: true })).toBeVisible()

  // Hover and click use absolute capture time after the view has moved.
  await canvas.scrollIntoViewIfNeeded()
  const bounds = await canvas.boundingBox()
  expect(bounds).not.toBeNull()
  const middleX = bounds!.x + 34 + (bounds!.width - 46) * 0.5
  await page.mouse.move(middleX, bounds!.y + bounds!.height / 2)
  const live = page.locator('.scope-channel').first().locator('.measurement')
  expect(parseFloat(await live.innerText())).toBeCloseTo((start + 0.01) * 1000, 1)
  await page.mouse.click(middleX, bounds!.y + bounds!.height / 2)
  // Cursor B was the most recently edited cursor.
  expect(Number(await page.getByRole('spinbutton', { name: 'Cursor B milliseconds' }).inputValue())).toBeCloseTo((start + 0.01) * 1000, 1)

  await page.getByRole('combobox', { name: 'Trigger edge' }).selectOption('falling')
  await expect(page.getByTestId('trigger-status')).toContainText('Falling CH1 crossing at')
  const falling = Number(await canvas.getAttribute('data-trigger-time'))
  expect(falling).toBeGreaterThan(0.0021)
  expect(falling).toBeLessThan(0.0024)
  expect(Number(await canvas.getAttribute('data-window-start'))).toBeCloseTo(falling - 0.002, 6)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await expect(page.locator('.scope-footnote')).toHaveText(captureFootnote!)
  expect(await recovery(page)).toBe(document)
  await captured(page)
})

test('unreachable trigger levels and a DC trace report no crossing without inventing a trigger', async ({ page }) => {
  await page.goto('/')
  await captured(page)
  await page.locator('.scope-trigger > summary').click()
  await page.getByRole('combobox', { name: 'Trigger source' }).selectOption('CH2')
  await page.getByRole('spinbutton', { name: 'Trigger level' }).fill('100')
  await expect(page.getByTestId('trigger-status')).toHaveText('No crossing found · showing capture start.')
  const canvas = page.getByLabel('Voltage versus time for scope channels 1 and 2')
  await expect(canvas).not.toHaveAttribute('data-trigger-time')
  expect(Number(await canvas.getAttribute('data-window-start'))).toBeLessThan(0.000001)

  await page.getByRole('combobox', { name: 'Load example' }).selectOption('voltage-divider')
  await captured(page)
  await page.locator('.scope-trigger > summary').click()
  await expect(page.getByRole('combobox', { name: 'Trigger source' })).toHaveValue('off')
  await page.getByRole('combobox', { name: 'Trigger source' }).selectOption('CH2')
  await page.getByRole('spinbutton', { name: 'Trigger level' }).fill('2.5')
  await expect(page.getByTestId('trigger-status')).toHaveText('No crossing found · showing capture start.')
  await expect(canvas).not.toHaveAttribute('data-trigger-time')
  await captured(page)
})

test('scope terminal labels highlight connections and a separate control moves the probe', async ({ page }) => {
  await page.goto('/')
  await captured(page)
  const scope = page.getByRole('region', { name: 'Oscilloscope' })
  const document = await recovery(page)
  await scope.getByRole('button', { name: 'D6', exact: true }).click()
  await expect(page.locator('.breadboard-svg path[stroke="#bfd77d"]')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Select tool', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(await recovery(page)).toBe(document)
  await scope.getByRole('button', { name: 'Move CH1 probe', exact: true }).click()
  await page.getByRole('button', { name: 'D9, available', exact: true }).click()
  await expect(scope.getByRole('button', { name: 'D9', exact: true })).toBeVisible()
  await expect.poll(async () => JSON.parse((await recovery(page))!).probes.CH1).toBe('d9')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(scope.getByRole('button', { name: 'D6', exact: true })).toBeVisible()
})
