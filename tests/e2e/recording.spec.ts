import { expect, test } from '@playwright/test'
import { createEmptyDocument, examples } from '../../src/lib/circuit'

test('a long recording can be inspected, played, looped, and invalidated by edits', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Load example').selectOption('voltage-divider')
  await expect(page.getByText('CAPTURED', { exact: true })).toBeVisible()
  await page.getByLabel('Simulation duration').selectOption('10')
  await expect(page.getByText('CAPTURED', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Recording time milliseconds')).toHaveAttribute('max', '10000')
  await page.getByLabel('Recording time milliseconds').fill('7890.25')
  await expect(page.getByLabel('CH2 recorded voltage', { exact: true })).toHaveText('2.500 V')
  await page.locator('[data-part="R1"]').focus()
  await expect(page.getByLabel('Recorded current 1 → 2', { exact: true })).toHaveText('250.000 µA')
  await expect(page.getByLabel('Recorded component power', { exact: true })).toHaveText('625.000 µW')
  const before = await page.evaluate(() => localStorage.getItem('labor-playground.document.v1'))
  await page.getByLabel('Recording time milliseconds').fill('9900')
  await page.getByRole('button', { name: 'Play recording', exact: true }).click()
  await expect.poll(async () => Number(await page.getByLabel('Recording time milliseconds').inputValue())).toBeLessThan(1000)
  await page.getByRole('button', { name: 'Pause recording', exact: true }).click()
  await page.getByRole('button', { name: 'Loop recording', exact: true }).click()
  await page.getByLabel('Recording time milliseconds').fill('9900')
  await page.getByRole('button', { name: 'Play recording', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toBeVisible()
  await expect(page.getByLabel('Recording time milliseconds')).toHaveValue('10000')
  expect(await page.evaluate(() => localStorage.getItem('labor-playground.document.v1'))).toBe(before)
  await page.getByText('Auto update', { exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Resistance', exact: true }).fill('20')
  await page.getByRole('spinbutton', { name: 'Resistance', exact: true }).press('Tab')
  await expect(page.getByLabel('Recording timeline')).toBeDisabled()
  await expect(page.getByLabel('CH2 recorded voltage', { exact: true })).toHaveText('—')
  await expect(page.getByLabel('Recorded component power', { exact: true })).toHaveCount(0)
})

test('LED glow, pin voltage and measured current follow the selected recording time', async ({ page }, testInfo) => {
  const circuit = structuredClone(examples.find(example => example.id === 'voltage-divider')!.document)
  circuit.title = 'Recorded LED pulse'
  circuit.stimulus = 'step'
  circuit.parts[0].value = 1000
  circuit.parts[1] = { ...circuit.parts[1], id: 'LED1', kind: 'led', value: 1 }
  circuit.wires.find(wire => wire.from === 'cv')!.from = 'osc'
  await page.addInitScript(document => localStorage.setItem('labor-playground.document.v1', JSON.stringify(document)), circuit)
  await page.goto('/')
  await expect(page.getByText('CAPTURED', { exact: true })).toBeVisible()
  await page.locator('[data-part="LED1"]').focus()
  await page.getByLabel('Recording time milliseconds').fill('20')
  await expect(page.locator('[data-led="LED1"]')).toHaveAttribute('data-led-state', 'on')
  await expect(page.getByLabel('Recorded component state')).toHaveText('On')
  expect(parseFloat(await page.getByLabel('Recorded current Anode → Cathode').innerText())).toBeGreaterThan(1)
  await page.screenshot({ path: testInfo.outputPath('recording-desktop.png'), fullPage: true })
  await page.getByLabel('Recording time milliseconds').fill('90')
  await expect(page.locator('[data-led="LED1"]')).toHaveAttribute('data-led-state', 'off')
  await expect(page.getByLabel('Recorded component state')).toHaveText('Off')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByLabel('Recording timeline').scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: testInfo.outputPath('recording-mobile.png'), fullPage: true })
})

test('capacitor recording exposes charge current distinct from initial DC current', async ({ page }) => {
  const circuit = { ...createEmptyDocument(), ...structuredClone(examples.find(example => example.id === 'rc-filter')!.document), stimulus: 'step' as const }
  await page.addInitScript(document => localStorage.setItem('labor-playground.document.v1', JSON.stringify(document)), circuit)
  await page.goto('/')
  await expect(page.getByText('CAPTURED', { exact: true })).toBeVisible()
  await page.locator('[data-part="C1"]').focus()
  await page.getByLabel('Recording time milliseconds').fill('2')
  await expect(page.getByLabel('DC current 1 → 2 (ideal DC)', { exact: true })).toHaveText('0.000 A')
  const current = await page.getByLabel('Recorded current 1 → 2', { exact: true }).innerText()
  expect(current).not.toBe('0.000 A')
  await expect(page.getByLabel('Recorded stored energy')).not.toHaveText('—')
})

test('long Pico recordings preserve GPIO states and drive the onboard LED during scrubbing', async ({ page }) => {
  const circuit = structuredClone(examples.find(example => example.id === 'pico-console')!.document)
  circuit.pico!.captureMs = 500
  circuit.pico!.source = 'from machine import Pin\nimport time\nled = Pin(25, Pin.OUT)\nled.off()\ntime.sleep_ms(250)\nled.on()\ntime.sleep_ms(250)\n'
  await page.addInitScript(document => localStorage.setItem('labor-playground.document.v1', JSON.stringify(document)), circuit)
  await page.goto('/')
  await expect(page.getByLabel('Simulation duration')).toHaveValue('0.5')
  await page.getByRole('button', { name: 'Simulate', exact: true }).click()
  await expect(page.getByText('CAPTURED', { exact: true })).toBeVisible({ timeout: 45_000 })
  await expect(page.getByLabel('Recording time milliseconds')).toHaveAttribute('max', '500')
  await page.locator('.recording-gpio > summary').click()
  await page.getByLabel('Recording time milliseconds').fill('100')
  await expect(page.locator('[data-pico-led-state]')).toHaveAttribute('data-pico-led-state', 'off')
  await expect(page.getByLabel('Recorded GP25 state')).toHaveText('Low')
  await page.getByLabel('Recording time milliseconds').fill('400')
  await expect(page.locator('[data-pico-led-state]')).toHaveAttribute('data-pico-led-state', 'on')
  await expect(page.getByLabel('Recorded GP25 state')).toHaveText('High')
  await page.getByLabel('Simulation duration').selectOption('1')
  await expect(page.getByLabel('Recording timeline')).toBeDisabled()
  await expect(page.locator('[data-pico-led-state]')).toHaveAttribute('data-pico-led-state', 'unavailable')
})
