import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

test('hardware modules remain accessible without page overflow across screen sizes', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.getByRole('status', { name: 'Simulation status', exact: true })).toHaveAttribute('data-state', 'ready', { timeout: 45_000 })
  for (const width of [320, 390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    for (const label of ['Frequency in Hz', 'Amplitude', 'CV output', 'Envelope mode', 'Audio preview channel', 'Audio preview mode']) {
      const control = page.getByLabel(label, { exact: true })
      await expect(control).toBeVisible()
      const bounds = await control.boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    }
    await page.screenshot({ path: testInfo.outputPath(`hardware-${width}.png`), fullPage: true })
  }
})

function terminal(page: Page, id: string) {
  return page.getByRole('button', { name: new RegExp(`^${id.toUpperCase()}, (?:available|occupied)$`) })
}

test('the control board places a potentiometer and commits one knob drag to the Inspector and Undo', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Clear board', exact: true }).click()
  const carrier = page.getByRole('region', { name: 'Multipurpose control board' })
  const inspector = page.getByRole('complementary', { name: 'Inspector' })

  // Front-panel placement starts a fresh horizontal part, even after another tool was rotated.
  await page.getByRole('button', { name: 'Rotate placement', exact: true }).click()
  await carrier.getByRole('button', { name: 'Place potentiometer on breadboard' }).click()
  await terminal(page, 'c12').click()
  await expect(page.getByText('1 / 30 parts placed', { exact: true })).toBeVisible()
  await expect(carrier.getByText('C12 · C13 · C14', { exact: true })).toBeVisible()
  await carrier.getByRole('button', { name: /^P1 / }).click()
  await expect(inspector.getByRole('heading', { name: 'Potentiometer', exact: true })).toBeVisible()
  const percentage = inspector.getByRole('spinbutton', { name: 'Wiper percentage' })
  await expect(percentage).toHaveValue('50')

  const knob = carrier.getByRole('slider', { name: 'P1 wiper knob', exact: true })
  await knob.scrollIntoViewIfNeeded()
  const bounds = await knob.boundingBox()
  expect(bounds).not.toBeNull()
  const x = bounds!.x + bounds!.width / 2
  const y = bounds!.y + bounds!.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 45, y, { steps: 12 })
  await expect(percentage).toHaveValue('50')
  await page.mouse.up()
  await expect(percentage).toHaveValue('80')
  await expect(carrier.getByRole('spinbutton', { name: 'P1 wiper', exact: true })).toHaveValue('80')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(percentage).toHaveValue('50')
  await expect(knob).toHaveAttribute('aria-valuenow', '50')
  await expect(page.getByText('1 / 30 parts placed', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(percentage).toHaveValue('80')
})

test('the control board switch shares its state with the Inspector and Undo', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Clear board', exact: true }).click()
  const carrier = page.getByRole('region', { name: 'Multipurpose control board' })
  const inspector = page.getByRole('complementary', { name: 'Inspector' })
  await carrier.getByRole('button', { name: 'Place switch on breadboard' }).click()
  await terminal(page, 'c18').click()
  await expect(page.getByText('1 / 30 parts placed', { exact: true })).toBeVisible()
  await carrier.getByRole('button', { name: /^S1 / }).filter({ hasText: 'SPST' }).click()
  await expect(inspector.getByRole('heading', { name: 'Switch', exact: true })).toBeVisible()
  const toggle = carrier.getByRole('button', { name: 'S1 closed', exact: true })
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(inspector.getByRole('checkbox', { name: 'Closed (on)' })).toBeChecked()

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(inspector.getByRole('checkbox', { name: 'Open (off)' })).not.toBeChecked()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(inspector.getByRole('checkbox', { name: 'Closed (on)' })).toBeChecked()

  await inspector.getByRole('checkbox', { name: 'Closed (on)' }).uncheck()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
})

test('the integrated scope patches the chosen channel and measures the corresponding terminal', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Clear board', exact: true }).click()
  const module = page.getByRole('region', { name: 'Integrated EDU oscilloscope' })
  const scope = page.getByRole('region', { name: 'Oscilloscope', exact: true })
  const ch1 = module.getByRole('button', { name: 'Patch scope CH1', exact: true })
  const ch2 = module.getByRole('button', { name: 'Patch scope CH2', exact: true })
  await ch2.click()
  await terminal(page, 'cv').click()
  await expect(ch2).toHaveAttribute('title', 'CH2: CV · click to patch')
  await expect(ch1).toHaveAttribute('title', 'CH1: unpatched · click to patch')
  await ch1.click()
  await terminal(page, 'gnd').click()
  await expect(ch1).toHaveAttribute('title', 'CH1: GND · click to patch')
  await expect(ch2).toHaveAttribute('title', 'CH2: CV · click to patch')
  await expect(page.getByRole('status', { name: 'Simulation status', exact: true })).toHaveAttribute('data-state', 'ready', { timeout: 45_000 })
  await expect(module.getByRole('img', { name: 'Current captured voltage traces' })).toBeVisible()
  await page.getByRole('tab', { name: 'Results', exact: true }).click()
  await scope.locator('.scope-measurements > summary').click()
  const measurements = scope.getByRole('table', { name: 'Channel measurements' })
  await expect(measurements.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Peak to peak', exact: true }) }).getByRole('cell')).toHaveText(['0.000 V', '0.000 V'])
  await expect(measurements.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Capture mean', exact: true }) }).getByRole('cell')).toHaveText(['0.000 V', '5.000 V'])

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await page.getByRole('tab', { name: 'Circuit', exact: true }).click()
  await expect(ch1).toHaveAttribute('title', 'CH1: unpatched · click to patch')
  await expect(ch2).toHaveAttribute('title', 'CH2: CV · click to patch')
})
