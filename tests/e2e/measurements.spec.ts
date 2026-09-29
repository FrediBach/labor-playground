import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function captured(page: Page) {
  await expect(page.getByText('CAPTURED', { exact: true })).toBeVisible({ timeout: 45_000 })
}

async function openMeasurements(page: Page) {
  await page.locator('.scope-measurements > summary').click()
  await expect(page.getByRole('table', { name: 'Channel measurements' })).toBeVisible()
}

function measurementCells(page: Page, label: string) {
  return page.getByRole('table', { name: 'Channel measurements' })
    .getByRole('row').filter({ has: page.getByRole('rowheader', { name: label, exact: true }) })
    .getByRole('cell')
}

test('real RC frequency and A/B cursor measurements persist when capacitance changes', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await captured(page)
  await openMeasurements(page)
  await expect(measurementCells(page, 'Frequency')).toHaveText(['220.0 Hz', '220.0 Hz'])

  await page.getByRole('spinbutton', { name: 'Cursor A milliseconds' }).fill('1')
  await page.getByRole('spinbutton', { name: 'Cursor B milliseconds' }).fill('3')
  await expect(page.getByLabel('Cursor time difference')).toHaveText('2.000 ms')
  const firstOutput = Number.parseFloat(await measurementCells(page, 'At cursor A').nth(1).innerText())
  const outputAtB = Number.parseFloat(await measurementCells(page, 'At cursor B').nth(1).innerText())
  const deltaVoltage = Number.parseFloat(await measurementCells(page, 'ΔV · B − A').nth(1).innerText())
  expect(deltaVoltage).toBeCloseTo(outputAtB - firstOutput, 2)

  await page.getByRole('button', { name: '220', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: 'Capacitance' })).toHaveValue('220')
  await captured(page)
  await expect(page.getByRole('spinbutton', { name: 'Cursor A milliseconds' })).toHaveValue('1')
  await expect(page.getByRole('spinbutton', { name: 'Cursor B milliseconds' })).toHaveValue('3')
  await expect(page.getByLabel('Cursor time difference')).toHaveText('2.000 ms')
  await expect(measurementCells(page, 'Frequency')).toHaveText(['220.0 Hz', '220.0 Hz'])
  const changedOutput = Number.parseFloat(await measurementCells(page, 'At cursor A').nth(1).innerText())
  expect(Math.abs(changedOutput - firstOutput)).toBeGreaterThan(0.1)
  expect(errors).toEqual([])
})

test('DC divider has no frequency reading and measures a 2.500 V difference', async ({ page }) => {
  await page.goto('/')
  await captured(page)
  await page.getByLabel('Load example').selectOption('voltage-divider')
  await captured(page)
  await openMeasurements(page)
  await expect(measurementCells(page, 'Frequency')).toHaveText(['Unavailable', 'Unavailable'])
  await expect(measurementCells(page, 'Capture mean')).toHaveText(['5.000 V', '2.500 V'])
  await expect(page.getByLabel('Differential meter position')).toHaveValue('mean')
  await expect(page.getByLabel('Differential voltage')).toHaveText('2.500 V')

  await page.getByRole('spinbutton', { name: 'Cursor A milliseconds' }).fill('12.5')
  await page.getByRole('spinbutton', { name: 'Cursor B milliseconds' }).fill('37.5')
  await expect(page.getByLabel('Cursor time difference')).toHaveText('25.000 ms')
  await page.getByLabel('Differential meter position').selectOption('A')
  await expect(page.getByLabel('Differential voltage')).toHaveText('2.500 V')
  await page.getByLabel('Differential meter position').selectOption('B')
  await expect(page.getByLabel('Differential voltage')).toHaveText('2.500 V')
  await expect(measurementCells(page, 'ΔV · B − A')).toHaveText(['0.000 V', '0.000 V'])
})

test('stale edits clear electrical readings and disable cursors until a new capture', async ({ page }) => {
  await page.goto('/')
  await captured(page)
  await openMeasurements(page)
  await page.getByRole('spinbutton', { name: 'Cursor A milliseconds' }).fill('4')
  await page.getByText('Auto update', { exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Auto update' })).not.toBeChecked()
  await page.getByRole('button', { name: '220', exact: true }).click()
  await expect(page.getByText('STALE', { exact: true })).toBeVisible()

  await expect(measurementCells(page, 'Capture mean')).toHaveText(['—', '—'])
  await expect(measurementCells(page, 'At cursor A')).toHaveText(['—', '—'])
  await expect(measurementCells(page, 'ΔV · B − A')).toHaveText(['—', '—'])
  await expect(measurementCells(page, 'Frequency')).toHaveText(['Unavailable', 'Unavailable'])
  await expect(page.getByLabel('Differential voltage')).toHaveText('—')
  await expect(page.getByLabel('Cursor time difference')).toHaveText('—')
  await expect(page.getByRole('slider', { name: 'Cursor A time' })).toBeDisabled()
  await expect(page.getByRole('spinbutton', { name: 'Cursor A milliseconds' })).toBeDisabled()
  await expect(page.getByRole('slider', { name: 'Cursor B time' })).toBeDisabled()

  await page.getByRole('button', { name: 'Capture', exact: true }).click()
  await captured(page)
  await expect(page.getByRole('slider', { name: 'Cursor A time' })).toBeEnabled()
  await expect(page.getByRole('spinbutton', { name: 'Cursor A milliseconds' })).toHaveValue('4')
  await expect(measurementCells(page, 'Frequency')).toHaveText(['220.0 Hz', '220.0 Hz'])
  await expect(page.getByLabel('Differential voltage')).not.toHaveText('—')
})
