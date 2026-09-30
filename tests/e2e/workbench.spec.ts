import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function captured(page: Page) {
  await expect(page.getByText('CAPTURED', { exact: true })).toBeVisible({ timeout: 45_000 })
}

function channelMeasurement(page: Page, channel: 'CH1' | 'CH2') {
  return page.getByRole('region', { name: 'Oscilloscope' }).getByRole('button', { name: channel, exact: true }).locator('..').locator('.measurement')
}

async function peakToPeak(page: Page, channel: 'CH1' | 'CH2') {
  const text = await channelMeasurement(page, channel).innerText()
  const result = /([\d.]+) Vpp/.exec(text)
  expect(result, `Expected a voltage measurement for ${channel}, got ${text}`).not.toBeNull()
  return Number(result![1])
}

function terminal(page: Page, id: string) {
  return page.getByRole('button', { name: new RegExp(`^${id.toUpperCase()}, (?:available|occupied)$`) })
}

test('component selection survives pointer release and a later background click clears it', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Select tool', exact: true }).click()
  const inspector = page.getByRole('complementary', { name: 'Inspector' })
  const part = page.locator('[data-part="R1"]')
  const bounds = await part.boundingBox()
  expect(bounds).toBeTruthy()
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + 15)
  await page.mouse.down()
  await expect(inspector.getByText('A closer look.', { exact: true })).toBeHidden()
  await page.mouse.up()
  await expect(inspector.getByText('A closer look.', { exact: true })).toBeHidden()
  await expect(part).toBeFocused()
  await page.locator('.breadboard-svg').click({ position: { x: 2, y: 2 } })
  await expect(inspector.getByText('A closer look.', { exact: true })).toBeVisible()
})

test('real ngspice capture changes when capacitance changes, and Undo restores it', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await captured(page)
  if (process.env.LABOR_CAPTURE_SCREENSHOTS) {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({ path: '/tmp/labor-initial.png', fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: '/tmp/labor-mobile.png', fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1120 })
  }
  const input = await peakToPeak(page, 'CH1')
  const original = await peakToPeak(page, 'CH2')
  expect(input).toBeGreaterThan(4.5)
  expect(original).toBeGreaterThan(2)
  expect(original).toBeLessThan(input)

  const canvas = page.getByLabel('Voltage versus time for scope channels 1 and 2')
  const visibleTracePixels = await canvas.evaluate((element: HTMLCanvasElement) => {
    const data = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data
    let count = 0
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] > 180 && data[index + 1] > 100 && data[index + 2] < 160 && data[index + 3] > 150) count++
    }
    return count
  })
  expect(visibleTracePixels).toBeGreaterThan(50)

  await page.getByRole('button', { name: '220', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: 'Capacitance' })).toHaveValue('220')
  await captured(page)
  const filtered = await peakToPeak(page, 'CH2')
  expect(filtered).toBeLessThan(original * 0.7)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: 'Capacitance' })).toHaveValue('100')
  await captured(page)
  expect(await peakToPeak(page, 'CH2')).toBeCloseTo(original, 1)
  expect(errors).toEqual([])
})

test('build a divider with placement, wiring and probes, then undo a component move', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Clear board', exact: true }).click()
  await expect(page.getByText('0 / 30 parts placed', { exact: true })).toBeVisible()
  const library = page.getByRole('complementary', { name: 'Parts library' })
  await library.getByRole('button', { name: /Resistor/ }).click()
  await terminal(page, 'a6').click()
  await terminal(page, 'c9').click()
  await expect(page.getByText('2 / 30 parts placed', { exact: true })).toBeVisible()

  // Every lead uses its own hole. Vertical strips provide the connections.
  await page.getByRole('button', { name: 'Wire tool', exact: true }).click()
  await terminal(page, 'cv').click()
  await terminal(page, 'b6').click()
  await terminal(page, 'gnd').click()
  await terminal(page, 'e12').click()
  await expect(page.getByText('2 wires', { exact: true })).toBeVisible()
  await library.getByRole('button', { name: 'Scope probe CH1', exact: true }).click()
  await terminal(page, 'd6').click()
  await library.getByRole('button', { name: 'Scope probe CH2', exact: true }).click()
  await terminal(page, 'd9').click()
  await captured(page)
  await expect(channelMeasurement(page, 'CH1')).toHaveText('0.00 Vpp  ·  5.00 V mean')
  await expect(channelMeasurement(page, 'CH2')).toHaveText('0.00 Vpp  ·  2.50 V mean')

  await page.getByRole('button', { name: 'Select tool', exact: true }).click()
  const resistor = page.getByRole('button', { name: /^R2 · .*Drag to move or select to edit/ })
  await resistor.focus()
  await resistor.press('ArrowRight')
  const inspector = page.getByRole('complementary', { name: 'Inspector' })
  await expect(inspector.getByText('C10', { exact: true })).toBeVisible()
  await expect(inspector.getByText('C13', { exact: true })).toBeVisible()
  await expect(page.getByText('2 wires', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(inspector.getByText('C9', { exact: true })).toBeVisible()
  await captured(page)
  await expect(channelMeasurement(page, 'CH2')).toHaveText('0.00 Vpp  ·  2.50 V mean')

  // Pointer dragging commits a single move and leaves jumpers on their holes.
  const partBounds = await resistor.boundingBox()
  const firstHole = await terminal(page, 'c9').boundingBox()
  const nextHole = await terminal(page, 'c10').boundingBox()
  expect(partBounds && firstHole && nextHole).toBeTruthy()
  const x = partBounds!.x + partBounds!.width / 2
  const y = partBounds!.y + 15
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + nextHole!.x - firstHole!.x, y, { steps: 8 })
  await page.mouse.up()
  await expect(inspector.getByText('C10', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'W1, jumper from cv to b6', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'W2, jumper from gnd to e12', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(inspector.getByText('C9', { exact: true })).toBeVisible()
})

test('manual capture marks old results stale and Reset recovers the worker', async ({ page }) => {
  await page.goto('/')
  await captured(page)
  await page.getByText('Auto update', { exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Auto update' })).not.toBeChecked()
  await page.getByRole('button', { name: '470', exact: true }).click()
  await expect(page.getByText('STALE', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Capture', exact: true }).click()
  await captured(page)
  expect(await peakToPeak(page, 'CH2')).toBeLessThan(1)
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await captured(page)
  expect(await peakToPeak(page, 'CH2')).toBeLessThan(1)
})

test('malformed import preserves the circuit; export imports and recovery survive a reload', async ({ page }) => {
  await page.goto('/')
  await captured(page)
  const original = await peakToPeak(page, 'CH2')
  await page.locator('input[type="file"]').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{ "schemaVersion": 99 }') })
  await expect(page.getByRole('status', { name: 'Workbench notification', exact: true })).toContainText('Import failed: Unsupported circuit or board version.')
  await expect(page.getByRole('spinbutton', { name: 'Capacitance' })).toHaveValue('100')
  expect(await peakToPeak(page, 'CH2')).toBe(original)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export circuit', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('rc-low-pass-filter.json')
  const path = await download.path()
  expect(path).not.toBeNull()
  await page.getByRole('button', { name: 'Clear board', exact: true }).click()
  await page.locator('input[type="file"]').setInputFiles(path!)
  await expect(page.getByRole('status', { name: 'Workbench notification', exact: true })).toContainText('Imported RC low-pass filter.')
  await expect(page.getByText('2 / 30 parts placed', { exact: true })).toBeVisible()
  await page.reload()
  await captured(page)
  expect(await peakToPeak(page, 'CH2')).toBeCloseTo(original, 1)
})
