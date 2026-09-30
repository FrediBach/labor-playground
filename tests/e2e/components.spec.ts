import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const recoveryKey = 'labor-playground.document.v1'

async function captured(page: Page) {
  await expect(page.getByText('CAPTURED', { exact: true })).toBeVisible({ timeout: 45_000 })
}

function terminal(page: Page, id: string) {
  return page.getByRole('button', { name: new RegExp(`^${id.toUpperCase()}, (?:available|occupied)$`) })
}

async function recovered(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), recoveryKey)
}

async function peakToPeak(page: Page, channel: 'CH1' | 'CH2') {
  const scope = page.getByRole('region', { name: 'Oscilloscope' })
  const text = await scope.getByRole('button', { name: channel, exact: true }).locator('..').locator('.measurement').innerText()
  const match = /([\d.]+) Vpp/.exec(text)
  expect(match, `Expected ${channel} voltage, got ${text}`).not.toBeNull()
  return Number(match![1])
}

async function screenshot(page: Page, name: string) {
  if (process.env.LABOR_CAPTURE_SCREENSHOTS) {
    const notification = page.getByRole('button', { name: 'Dismiss notification', exact: true })
    if (await notification.isVisible()) await notification.click()
    await page.setViewportSize({ width: 1440, height: 1120 })
    await page.screenshot({ path: `/tmp/labor-${name}.png`, fullPage: true })
  }
}

test('the powered dual op-amp doubles a real signal and feedback changes its gain', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Load example' }).selectOption('opamp-amplifier')
  await captured(page)
  const input = await peakToPeak(page, 'CH1')
  const output = await peakToPeak(page, 'CH2')
  expect(input).toBeGreaterThan(4.9)
  expect(output / input).toBeCloseTo(2, 1)
  await expect(page.locator('[data-part="U1"] [data-pin]')).toHaveCount(8)
  await screenshot(page, 'opamp')
  await screenshot(page, 'expanded-library')

  await page.locator('[data-part="R1"]').focus()
  const resistance = page.getByRole('spinbutton', { name: 'Resistance', exact: true })
  await resistance.fill('20')
  await resistance.press('Tab')
  await captured(page)
  expect(await peakToPeak(page, 'CH2') / await peakToPeak(page, 'CH1')).toBeCloseTo(3, 1)
  expect(errors).toEqual([])
})

test('disconnecting an IC supply blocks capture and undo restores the powered circuit', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Load example' }).selectOption('opamp-amplifier')
  await captured(page)
  await page.locator('[data-wire="W2"]').focus()
  await page.getByRole('button', { name: 'Remove wire' }).click()
  await expect(page.getByText('INVALID', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /U1 V\+ \(pin 8\) has no connected supply/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await captured(page)
  expect(await peakToPeak(page, 'CH2') / await peakToPeak(page, 'CH1')).toBeCloseTo(2, 1)
})

test('a three-pin potentiometer commits one wiper drag and survives browser recovery', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Clear board', exact: true }).click()
  const library = page.getByRole('complementary', { name: 'Parts library' })
  await library.getByRole('button', { name: /Potentiometer/ }).click()
  await terminal(page, 'c12').click()
  await expect(page.getByText('1 / 30 parts placed', { exact: true })).toBeVisible()
  await expect.poll(async () => (await recovered(page))?.parts[0]?.pins).toEqual(['c12', 'c13', 'c14'])
  for (const id of ['c12', 'c13', 'c14']) await expect(terminal(page, id)).toHaveAttribute('aria-label', `${id.toUpperCase()}, occupied`)

  const inspector = page.getByRole('complementary', { name: 'Inspector' })
  await inspector.getByRole('button', { name: '22', exact: true }).click()
  await expect.poll(async () => (await recovered(page))?.parts[0]?.value).toBe(22_000)
  const slider = page.getByRole('slider', { name: 'Wiper position', exact: true })
  await slider.scrollIntoViewIfNeeded()
  const bounds = await slider.boundingBox()
  expect(bounds).not.toBeNull()
  const y = bounds!.y + bounds!.height / 2
  await page.mouse.move(bounds!.x + bounds!.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(bounds!.x + bounds!.width * 0.85, y, { steps: 12 })
  expect((await recovered(page)).parts[0].position).toBe(0.5)
  await page.mouse.up()
  await expect.poll(async () => (await recovered(page))?.parts[0]?.position).toBeGreaterThan(0.8)
  const position = (await recovered(page)).parts[0].position
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(slider).toHaveValue('50')
  await expect(inspector.getByRole('spinbutton', { name: 'Resistance', exact: true })).toHaveValue('22')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(inspector.getByRole('spinbutton', { name: 'Resistance', exact: true })).toHaveValue('10')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect.poll(async () => (await recovered(page))?.parts[0]?.position).toBe(position)
  await page.reload()
  await page.locator('[data-part="P1"]').focus()
  await expect(page.getByRole('slider', { name: 'Wiper position', exact: true })).toHaveValue(String(position * 100))
  await expect(page.getByRole('spinbutton', { name: 'Resistance', exact: true })).toHaveValue('22')
})

test('DIP-8 placement and movement preserve every pin and probes can reach the second amplifier', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Clear board', exact: true }).click()
  const library = page.getByRole('complementary', { name: 'Parts library' })
  await library.getByRole('button', { name: /TL072-style dual op-amp/ }).click()
  await terminal(page, 'a6').click()
  await expect(page.getByText('0 / 30 parts placed', { exact: true })).toBeVisible()
  await terminal(page, 'e6').click()
  await expect.poll(async () => (await recovered(page))?.parts[0]?.pins).toEqual(['e6', 'e7', 'e8', 'e9', 'f9', 'f8', 'f7', 'f6'])
  await page.getByRole('button', { name: 'Rotate placement', exact: true }).click()
  await terminal(page, 'f21').click()
  await expect.poll(async () => (await recovered(page))?.parts[1]?.pins).toEqual(['f21', 'f20', 'f19', 'f18', 'e18', 'e19', 'e20', 'e21'])
  await page.getByRole('button', { name: 'Select tool', exact: true }).click()
  const rotated = page.locator('[data-part="U2"]')
  await rotated.focus()
  await rotated.press('ArrowRight')
  const moved = ['f22', 'f21', 'f20', 'f19', 'e19', 'e20', 'e21', 'e22']
  await expect.poll(async () => (await recovered(page))?.parts[1]?.pins).toEqual(moved)
  for (const id of moved) await expect(terminal(page, id)).toHaveAttribute('aria-label', `${id.toUpperCase()}, occupied`)
  await rotated.press('ArrowUp')
  await expect(page.getByRole('status', { name: 'Workbench notification', exact: true })).toContainText('No free placement in that direction.')
  expect((await recovered(page)).parts[1].pins).toEqual(moved)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(async () => (await recovered(page))?.parts[1]?.pins[0]).toBe('f21')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect.poll(async () => (await recovered(page))?.parts[1]?.pins).toEqual(moved)

  await library.getByRole('button', { name: 'Scope probe CH1', exact: true }).click()
  // Click the physical pin under the rendered IC; the IC must resolve all eight leads.
  const pin = await terminal(page, 'e19').boundingBox()
  expect(pin).not.toBeNull()
  await page.mouse.click(pin!.x + pin!.width / 2, pin!.y + pin!.height / 2)
  await expect.poll(async () => (await recovered(page))?.probes.CH1).toBe('e19')
})

test('the charging example measures its exponential response and warns on reversed polarity', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Load example' }).selectOption('capacitor-charge')
  await captured(page)
  await expect(page.getByRole('combobox', { name: 'Capture stimulus' })).toHaveValue('step')
  await expect(page.getByRole('spinbutton', { name: 'Frequency in Hz' })).toBeDisabled()
  await screenshot(page, 'charge')
  await page.locator('.scope-measurements > summary').click()
  await page.getByRole('spinbutton', { name: 'Cursor A milliseconds' }).fill('11.1')
  await page.getByRole('spinbutton', { name: 'Cursor B milliseconds' }).fill('61.1')
  const measurements = page.getByRole('table', { name: 'Channel measurements' })
  const ch2AtA = measurements.getByRole('row', { name: /^At cursor A/ }).getByRole('cell').nth(1)
  const ch2AtB = measurements.getByRole('row', { name: /^At cursor B/ }).getByRole('cell').nth(1)
  expect(parseFloat(await ch2AtA.innerText())).toBeCloseTo(3.16, 1)
  expect(parseFloat(await ch2AtB.innerText())).toBeCloseTo(1.83, 1)
  await expect(measurements.getByRole('row', { name: /^Frequency/ }).getByRole('cell').nth(1)).toHaveText('Unavailable')

  await page.getByRole('complementary', { name: 'Inspector' }).getByRole('button', { name: '2.2', exact: true }).click()
  await captured(page)
  expect(parseFloat(await ch2AtA.innerText())).toBeLessThan(2)
  await page.getByRole('button', { name: 'Reverse polarity', exact: true }).click()
  await captured(page)
  await expect(page.locator('.diagnostic.warning').filter({ hasText: /C1.*revers/i })).toBeVisible()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await captured(page)
  await expect(page.locator('.diagnostic.warning').filter({ hasText: /C1.*revers/i })).toHaveCount(0)
})

test('frequency editing normalizes invalid drafts and stays consistent through undo', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('CAPTURED', { exact: true })).toBeVisible({ timeout: 45_000 })
  const frequency = page.getByRole('spinbutton', { name: 'Frequency in Hz' })
  const knob = page.getByRole('slider', { name: 'Oscillator frequency', exact: true })
  await frequency.fill('0')
  await frequency.press('Tab')
  await expect(frequency).toHaveValue('220')
  await expect(knob).toHaveAttribute('aria-valuenow', '220')
  await frequency.fill('20')
  await frequency.press('Enter')
  await frequency.fill('10')
  await frequency.press('Tab')
  await expect(frequency).toHaveValue('20')
  await frequency.fill('1000')
  await frequency.press('Escape')
  await expect(frequency).toHaveValue('20')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(frequency).toHaveValue('220')
  await expect(knob).toHaveAttribute('aria-valuenow', '220')
})
