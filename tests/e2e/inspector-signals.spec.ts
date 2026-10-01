import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

async function ready(page: Page) {
  await expect(page.getByRole('status', { name: 'Simulation status', exact: true })).toHaveAttribute('data-state', 'ready', { timeout: 45_000 })
}

async function openTab(page: Page, name: 'Circuit' | 'Results') {
  await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name, exact: true }).click()
}

function measurements(page: Page, kind: 'Component' | 'Wire' = 'Component') {
  return page.getByLabel(`${kind} recorded measurements`, { exact: true })
}

async function enableTrace(section: Locator, name: string) {
  const toggle = section.getByRole('button', { name, exact: true })
  if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
}

async function traceHeight(section: Locator, id: string) {
  const path = section.locator(`path[data-trace="${id}"]`)
  await expect(path).toBeAttached()
  return path.evaluate(element => {
    const bounds = (element as SVGPathElement).getBBox()
    if (!Number.isFinite(bounds.width) || bounds.width <= 0) throw new Error('The trace must span a finite time interval.')
    return bounds.height
  })
}

async function cursorSeconds(cursor: Locator) {
  return cursor.evaluate(element => Number(element.getAttribute('aria-valuenow') ?? (element as HTMLInputElement).value))
}

test('RC pin and difference waveforms can be toggled and share the recording cursor', async ({ page }, testInfo) => {
  await page.goto('/')
  await ready(page)
  await page.locator('[data-part="R1"]').focus()
  const section = measurements(page)
  const waveform = section.getByLabel('Voltage waveforms', { exact: true })
  const cursor = section.getByRole('slider', { name: 'Inspector recording cursor', exact: true })
  await section.getByLabel('Inspector time window').selectOption('full')

  for (const [id, name] of [
    ['pin-0', 'Toggle pin 1 trace'],
    ['pin-1', 'Toggle pin 2 trace'],
    ['difference', 'Toggle voltage difference trace'],
  ]) {
    await enableTrace(section, name)
    expect(await traceHeight(section, id)).toBeGreaterThan(5)
  }
  const secondPin = section.getByRole('button', { name: 'Toggle pin 2 trace', exact: true })
  await secondPin.click()
  await expect(secondPin).toHaveAttribute('aria-pressed', 'false')
  await expect(section.locator('path[data-trace="pin-1"]')).toHaveCount(0)
  await secondPin.click()
  await expect(section.locator('path[data-trace="pin-1"]')).toBeVisible()

  await cursor.press('End')
  expect(await cursorSeconds(cursor)).toBeCloseTo(0.1, 6)
  await openTab(page, 'Results')
  expect(Number(await page.getByLabel('Recording time milliseconds').inputValue())).toBeCloseTo(100, 3)
  await page.getByLabel('Recording time milliseconds').fill('1')
  const firstVoltage = await page.getByLabel('Recorded pin 1 voltage', { exact: true }).innerText()
  await expect(page.getByLabel('CH1 recorded voltage', { exact: true })).toHaveText(firstVoltage)
  expect(await cursorSeconds(cursor)).toBeCloseTo(0.001, 6)
  await page.getByLabel('Recording time milliseconds').fill('3')
  await expect(page.getByLabel('Recorded pin 1 voltage', { exact: true })).not.toHaveText(firstVoltage)
  expect(await cursorSeconds(cursor)).toBeCloseTo(0.003, 6)

  await cursor.press('Home')
  expect(await cursorSeconds(cursor)).toBeLessThan(0.00001)
  await cursor.press('ArrowRight')
  expect(await cursorSeconds(cursor)).toBeGreaterThan(0.00001)
  await cursor.scrollIntoViewIfNeeded()
  const bounds = (await cursor.boundingBox())!
  await cursor.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } })
  const clickedTime = await cursorSeconds(cursor)
  expect(clickedTime).toBeGreaterThan(0.025)
  expect(clickedTime).toBeLessThan(0.075)
  expect(Number(await page.getByLabel('Recording time milliseconds').inputValue())).toBeCloseTo(clickedTime * 1000, 3)

  const fullPath = await section.locator('path[data-trace="pin-0"]').getAttribute('d')
  await section.getByLabel('Inspector time window').selectOption('0.01')
  await expect(section.locator('path[data-trace="pin-0"]')).not.toHaveAttribute('d', fullPath!)
  const windowStart = Number(await waveform.getAttribute('data-window-start'))
  const windowEnd = Number(await waveform.getAttribute('data-window-end'))
  expect(windowEnd - windowStart).toBeCloseTo(0.01, 6)
  expect(windowStart).toBeLessThanOrEqual(clickedTime)
  expect(windowEnd).toBeGreaterThanOrEqual(clickedTime)

  // Reaching the right edge while dragging must keep the selected 10 ms frame;
  // repeated pointer events must not advance through the rest of the recording.
  await cursor.press('Home')
  await expect(waveform).toHaveAttribute('data-window-start', '0')
  await cursor.scrollIntoViewIfNeeded()
  const zoomedBounds = (await cursor.boundingBox())!
  await page.mouse.move(zoomedBounds.x + zoomedBounds.width / 2, zoomedBounds.y + zoomedBounds.height / 2)
  await page.mouse.down()
  for (let move = 0; move < 4; move++) {
    await page.mouse.move(zoomedBounds.x + zoomedBounds.width - 2, zoomedBounds.y + zoomedBounds.height / 2 + move)
    expect(await cursorSeconds(cursor)).toBeLessThanOrEqual(0.01 + 1e-9)
    await expect(waveform).toHaveAttribute('data-window-start', '0')
    await expect(waveform).toHaveAttribute('data-window-end', '0.01')
  }
  await page.mouse.up()
  if (process.env.LABOR_CAPTURE_SCREENSHOTS) {
    await openTab(page, 'Circuit')
    await page.mouse.move(0, 0)
    await section.screenshot({ path: testInfo.outputPath('inspector-signals-desktop.png'), animations: 'disabled' })
  }
})

test('ground pins and ground wires stay flat while a signal wire follows its connected pin', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.locator('[data-part="C1"]').focus()
  const component = measurements(page)
  await enableTrace(component, 'Toggle pin 1 trace')
  await enableTrace(component, 'Toggle pin 2 trace')
  expect(await traceHeight(component, 'pin-0')).toBeGreaterThan(5)
  expect(await traceHeight(component, 'pin-1')).toBeLessThan(0.001)
  await expect(page.getByLabel('Recorded pin 2 voltage', { exact: true })).toHaveText('0.000 V')

  await openTab(page, 'Results')
  await page.getByLabel('Recording time milliseconds').fill('1')
  const sourceVoltage = await page.getByLabel('CH1 recorded voltage', { exact: true }).innerText()
  await openTab(page, 'Circuit')
  await page.locator('[data-wire="W1"]').focus()
  const wire = measurements(page, 'Wire')
  await enableTrace(wire, 'Toggle wire voltage trace')
  expect(await traceHeight(wire, 'wire')).toBeGreaterThan(5)
  await expect(page.getByLabel('Recorded wire voltage', { exact: true })).toHaveText(sourceVoltage)
  await page.locator('[data-wire="W3"]').focus()
  expect(await traceHeight(wire, 'wire')).toBeLessThan(0.001)
  await expect(page.getByLabel('Recorded wire voltage', { exact: true })).toHaveText('0.000 V')
})

test('an eight-pin timer exposes its output and supply traces without overflowing a mobile inspector', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByLabel('Load example').selectOption('555-astable')
  await ready(page)
  await page.locator('[data-part="U1"]').focus()
  const section = measurements(page)
  for (let pin = 1; pin <= 8; pin++) await enableTrace(section, `Toggle pin ${pin} trace`)
  await expect(section.locator('path[data-trace]')).toHaveCount(8)
  expect(await traceHeight(section, 'pin-0')).toBeLessThan(0.001)
  expect(await traceHeight(section, 'pin-2')).toBeGreaterThan(20)
  expect(await traceHeight(section, 'pin-7')).toBeLessThan(0.001)
  await expect(section.getByRole('button', { name: 'Toggle voltage difference trace', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Recorded component power', { exact: true })).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await section.scrollIntoViewIfNeeded()
  const bounds = (await section.boundingBox())!
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await expect(section.getByRole('button', { name: 'Toggle pin 8 trace', exact: true })).toBeVisible()
  if (process.env.LABOR_CAPTURE_SCREENSHOTS) {
    const notification = page.getByRole('button', { name: 'Dismiss notification', exact: true })
    if (await notification.isVisible()) await notification.click()
    await page.setViewportSize({ width: 390, height: 1400 })
    await section.evaluate(element => element.scrollIntoView({ block: 'center' }))
    await page.mouse.move(0, 0)
    await section.screenshot({ path: testInfo.outputPath('inspector-signals-mobile.png'), animations: 'disabled', style: '.project-toolbar, .toast { visibility: hidden !important; }' })
  }
})

test('editing the circuit removes stale inspector traces and a new simulation restores them', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.locator('[data-part="C1"]').focus()
  const section = measurements(page)
  await enableTrace(section, 'Toggle pin 1 trace')
  const originalPath = await section.locator('path[data-trace="pin-0"]').getAttribute('d')
  await openTab(page, 'Results')
  await page.getByText('Auto update', { exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Auto update' })).not.toBeChecked()
  await page.getByRole('complementary', { name: 'Inspector' }).getByRole('button', { name: '220', exact: true }).click()
  await expect(page.getByText('NEEDS SIMULATION', { exact: true })).toBeVisible()
  await expect(section.locator('path[data-trace]')).toHaveCount(0)
  await expect(page.getByLabel('Recorded component power', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Recording timeline')).toBeDisabled()

  await page.getByRole('button', { name: 'Capture', exact: true }).click()
  await ready(page)
  await enableTrace(section, 'Toggle pin 1 trace')
  expect(await traceHeight(section, 'pin-0')).toBeGreaterThan(5)
  await expect(section.locator('path[data-trace="pin-0"]')).not.toHaveAttribute('d', originalPath!)
  await expect(page.getByLabel('Recorded component power', { exact: true })).toBeVisible()
})
