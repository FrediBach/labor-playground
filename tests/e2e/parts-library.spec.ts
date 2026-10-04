import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import type { CircuitDocument } from '../../src/lib/circuit'

function library(page: Page) {
  return page.getByRole('complementary', { name: 'Parts library', exact: true })
}

function inspector(page: Page) {
  return page.getByRole('complementary', { name: 'Inspector', exact: true })
}

function terminal(page: Page, id: string) {
  return page.getByRole('button', { name: new RegExp(`^${id.toUpperCase()}, (?:available|occupied)$`) })
}

async function recovered(page: Page): Promise<CircuitDocument> {
  await expect.poll(() => page.evaluate(() => localStorage.getItem('labor-playground.document.v1'))).not.toBeNull()
  return page.evaluate(() => JSON.parse(localStorage.getItem('labor-playground.document.v1')!))
}

async function captured(page: Page) {
  await expect(page.getByRole('status', { name: 'Simulation status', exact: true })).toHaveAttribute('data-state', 'ready', { timeout: 45_000 })
}

async function withinPage(control: Locator, width: number) {
  await expect(control).toBeVisible()
  const bounds = await control.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1)
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 900, height: 800 }]) {
  test(`the catalog scrolls while Pico, wires, and probes stay reachable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await captured(page)
    const tray = library(page)
    await expect(tray.locator('.part-item')).toHaveCount(39)
    const controls = [
      tray.getByRole('button', { name: /Raspberry Pi Pico/ }),
      tray.getByRole('button', { name: /Jumper wire/ }),
      tray.getByRole('button', { name: 'Scope probe CH1', exact: true }),
      tray.getByRole('button', { name: 'Scope probe CH2', exact: true }),
    ]
    const positions = []
    for (const control of controls) {
      await expect(control).toBeInViewport()
      positions.push(await control.boundingBox())
    }

    const catalog = tray.locator('.parts-catalog')
    await catalog.hover()
    await page.mouse.wheel(0, 800)
    await expect.poll(() => catalog.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    for (const [index, control] of controls.entries()) {
      await expect(control).toBeInViewport()
      const bounds = await control.boundingBox()
      expect(bounds!.y).toBeCloseTo(positions[index]!.y, 0)
    }
    await controls[3].click()
    await expect(controls[3]).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.board-hint')).toContainText('attach CH2')
    await controls[1].click()
    await expect(controls[1]).toHaveAttribute('aria-pressed', 'true')
  })
}

test('component search combines with categories and clears without losing the selected category', async ({ page }) => {
  await page.goto('/')
  const tray = library(page)
  const search = tray.getByRole('textbox', { name: 'Find a component', exact: true })
  const category = tray.getByRole('combobox', { name: 'Component category', exact: true })
  await category.selectOption('transistors')
  await expect(tray.locator('.part-item')).toHaveCount(5)
  await expect(tray.getByRole('button', { name: 'NPN transistor', exact: true })).toBeVisible()
  await expect(tray.getByRole('button', { name: 'PNP transistor', exact: true })).toBeVisible()

  await search.fill('NPN')
  await expect(tray.locator('.part-item')).toHaveCount(1)
  await expect(tray.getByRole('button', { name: 'NPN transistor', exact: true })).toBeVisible()
  await search.fill('Schottky')
  await expect(tray.locator('.part-item')).toHaveCount(0)
  await expect(tray.getByRole('status')).toContainText('No components match')
  await expect(tray.getByRole('button', { name: 'Scope probe CH1', exact: true })).toBeVisible()
  await tray.getByRole('button', { name: 'Clear search', exact: true }).click()
  await expect(search).toHaveValue('')
  await expect(category).toHaveValue('transistors')
  await expect(tray.locator('.part-item')).toHaveCount(5)

  await category.selectOption('diodes')
  await search.fill('Schottky')
  await expect(tray.locator('.part-item')).toHaveCount(1)
  const schottky = tray.getByRole('button', { name: 'Schottky diode', exact: true })
  await schottky.click()
  await expect(schottky).toHaveAttribute('aria-pressed', 'true')
  await search.fill('')
  await category.selectOption('all')
  await expect(tray.locator('.part-item')).toHaveCount(39)
})

test('the expanded catalog and its controls fit a phone without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('/')
  await captured(page)
  const tray = library(page)
  await expect(tray.locator('.part-item')).toHaveCount(39)
  for (const control of [
    tray.getByRole('textbox', { name: 'Find a component', exact: true }),
    tray.getByRole('combobox', { name: 'Component category', exact: true }),
    tray.getByRole('button', { name: /Raspberry Pi Pico/ }),
    tray.getByRole('button', { name: /Jumper wire/ }),
    tray.getByRole('button', { name: 'Scope probe CH1', exact: true }),
    tray.getByRole('button', { name: 'Scope probe CH2', exact: true }),
  ]) await withinPage(control, 390)
  await tray.locator('.part-item').last().scrollIntoViewIfNeeded()
  await withinPage(tray.locator('.part-item').last(), 390)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('inductors and the added diodes can be placed, edited, and recovered', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Clear board', exact: true }).click()
  const tray = library(page)
  await tray.getByRole('button', { name: 'Inductor', exact: true }).click()
  await terminal(page, 'a4').click()
  await expect(inspector(page).getByRole('heading', { name: 'Inductor', exact: true })).toBeVisible()
  const inductance = inspector(page).getByRole('spinbutton', { name: 'Inductance', exact: true })
  await expect(inductance).toHaveValue('10')
  await inductance.fill('22')
  await inductance.press('Tab')
  await expect.poll(async () => (await recovered(page)).parts.find(part => part.id === 'L1')?.value).toBe(0.022)

  await tray.getByRole('button', { name: 'Schottky diode', exact: true }).click()
  await terminal(page, 'c4').click()
  await expect(inspector(page).getByRole('heading', { name: 'Schottky diode', exact: true })).toBeVisible()
  await expect.poll(async () => (await recovered(page)).parts.find(part => part.id === 'D1')?.kind).toBe('schottky')
  await tray.getByRole('button', { name: 'Zener diode', exact: true }).click()
  await terminal(page, 'c14').click()
  await expect(inspector(page).getByRole('heading', { name: 'Zener diode', exact: true })).toBeVisible()
  const voltage = inspector(page).getByRole('spinbutton', { name: 'Zener voltage', exact: true })
  await expect(voltage).toHaveValue('5.1')
  await voltage.fill('6.8')
  await voltage.press('Tab')
  await expect.poll(async () => (await recovered(page)).parts.find(part => part.id === 'D2')?.value).toBe(6.8)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(voltage).toHaveValue('5.1')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(voltage).toHaveValue('6.8')
  await expect(tray.getByText('3 / 128 parts placed', { exact: true })).toBeVisible()

  await page.reload()
  await page.locator('[data-part="L1"]').focus()
  await expect(inspector(page).getByRole('spinbutton', { name: 'Inductance', exact: true })).toHaveValue('22')
  await page.locator('[data-part="D2"]').focus()
  await expect(inspector(page).getByRole('spinbutton', { name: 'Zener voltage', exact: true })).toHaveValue('6.8')
})

test('both transistor types preserve collector, base, and emitter while moving and recovering', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Clear board', exact: true }).click()
  const tray = library(page)
  for (const [label, id, start, pins] of [
    ['NPN transistor', 'Q1', 'c6', ['c6', 'c7', 'c8']],
    ['PNP transistor', 'Q2', 'h18', ['h18', 'h19', 'h20']],
  ] as const) {
    await tray.getByRole('button', { name: label, exact: true }).click()
    await terminal(page, start).click()
    await expect(inspector(page).getByRole('heading', { name: label, exact: true })).toBeVisible()
    await expect.poll(async () => (await recovered(page)).parts.find(part => part.id === id)?.pins).toEqual(pins)
    const connections = inspector(page).locator('.pin-row')
    await expect(connections).toHaveCount(3)
    for (const [index, name] of ['Collector', 'Base', 'Emitter'].entries()) {
      await expect(connections.nth(index)).toContainText(name)
      await expect(connections.nth(index)).toContainText(pins[index].toUpperCase())
      await expect(terminal(page, pins[index])).toHaveAttribute('aria-label', `${pins[index].toUpperCase()}, occupied`)
    }
  }

  await page.getByRole('button', { name: 'Select tool', exact: true }).click()
  const npn = page.locator('[data-part="Q1"]')
  await npn.focus()
  await npn.press('ArrowRight')
  await expect.poll(async () => (await recovered(page)).parts.find(part => part.id === 'Q1')?.pins).toEqual(['c7', 'c8', 'c9'])
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(async () => (await recovered(page)).parts.find(part => part.id === 'Q1')?.pins).toEqual(['c6', 'c7', 'c8'])
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect.poll(async () => (await recovered(page)).parts.find(part => part.id === 'Q1')?.pins).toEqual(['c7', 'c8', 'c9'])
  await page.reload()
  await page.locator('[data-part="Q1"]').focus()
  const connections = inspector(page).locator('.pin-row')
  for (const [index, [name, pin]] of [['Collector', 'C7'], ['Base', 'C8'], ['Emitter', 'C9']].entries()) {
    await expect(connections.nth(index)).toContainText(name)
    await expect(connections.nth(index)).toContainText(pin)
  }
  expect((await recovered(page)).parts.map(part => part.kind)).toEqual(['npn', 'pnp'])
})

test('a wired NPN circuit moves from cutoff to conduction with solved current, power, and scope readings', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const document: CircuitDocument = {
    schemaVersion: 1, boardVersion: 'virtual-1', title: 'NPN base bias',
    parts: [
      { id: 'Q1', kind: 'npn', value: 1, pins: ['a10', 'a11', 'a12'] },
      { id: 'RC', kind: 'resistor', value: 1_000, pins: ['c5', 'c10'] },
      { id: 'RB', kind: 'resistor', value: 100_000, pins: ['c20', 'c11'] },
    ],
    wires: [
      { id: 'W1', from: 'vplus', to: 'b5', color: '#e75e51' },
      { id: 'W2', from: 'cv', to: 'b20', color: '#e1b842' },
      { id: 'W3', from: 'gnd', to: 'b12', color: '#ffffff' },
    ],
    probes: { CH1: 'd11', CH2: 'd10' },
    instruments: { frequency: 220, amplitude: 2.5, waveform: 'sine', cv: 0 },
  }
  await page.addInitScript(circuit => localStorage.setItem('labor-playground.document.v1', JSON.stringify(circuit)), document)
  await page.goto('/')
  await captured(page)
  await page.locator('[data-part="Q1"]').focus()
  await page.getByRole('tab', { name: 'Results', exact: true }).click()
  await page.locator('.operating-point-panel > summary').click()
  await page.locator('.scope-measurements > summary').click()
  const captureMeans = page.getByRole('table', { name: 'Channel measurements' })
    .getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Capture mean', exact: true }) })
    .getByRole('cell')
  async function reading(label: string) {
    const text = await page.getByLabel(label, { exact: true }).innerText()
    const match = /^(-?[\d.]+) ([mµn]?)[VAW]$/.exec(text)
    expect(match, `Expected an electrical reading for ${label}, received ${text}`).not.toBeNull()
    const factor: Record<string, number> = { '': 1, m: 1e-3, 'µ': 1e-6, n: 1e-9 }
    return Number(match![1]) * factor[match![2]]
  }
  await expect(page.getByLabel('CH2 DC voltage', { exact: true })).toHaveText('12.000 V')
  await expect(captureMeans.nth(1)).toHaveText('12.000 V')
  expect(Math.abs(await reading('DC current Collector → Emitter'))).toBeLessThan(1e-8)
  expect(Math.abs(await reading('DC component power'))).toBeLessThan(1e-7)

  await page.getByText('Auto update', { exact: true }).click()
  await page.getByRole('tab', { name: 'Circuit', exact: true }).click()
  const bias = page.getByRole('spinbutton', { name: 'CV output', exact: true })
  await bias.fill('5')
  await bias.press('Tab')
  await expect(page.getByRole('status', { name: 'Simulation status', exact: true })).toHaveAttribute('data-state', 'stale')
  await page.getByRole('tab', { name: 'Results', exact: true }).click()
  await expect(page.getByLabel('CH2 DC voltage', { exact: true })).toHaveText('—')
  await expect(page.getByLabel('DC component power', { exact: true })).toHaveCount(0)
  await expect(captureMeans.nth(1)).toHaveText('—')
  await page.getByRole('button', { name: 'Simulate', exact: true }).click()
  await captured(page)

  const collector = await reading('CH2 DC voltage')
  const base = await reading('CH1 DC voltage')
  const collectorCurrent = await reading('DC current Collector → Emitter')
  const baseCurrent = await reading('DC current Base → Emitter')
  const power = await reading('DC component power')
  expect(collector).toBeGreaterThan(6)
  expect(collector).toBeLessThan(9)
  expect(base).toBeGreaterThan(0.6)
  expect(base).toBeLessThan(0.8)
  expect(Math.abs(collectorCurrent - (12 - collector) / 1_000)).toBeLessThan(2e-6)
  expect(Math.abs(baseCurrent - (5 - base) / 100_000)).toBeLessThan(2e-8)
  expect(collectorCurrent / baseCurrent).toBeGreaterThan(100)
  expect(collectorCurrent / baseCurrent).toBeLessThan(115)
  expect(power).toBeGreaterThan(0.02)
  expect(Math.abs(power - collector * collectorCurrent - base * baseCurrent)).toBeLessThan(1e-5)
  expect(parseFloat(await captureMeans.nth(0).innerText())).toBeCloseTo(base, 3)
  expect(parseFloat(await captureMeans.nth(1).innerText())).toBeCloseTo(collector, 3)
  expect((await recovered(page)).instruments.cv).toBe(5)
  expect(errors).toEqual([])

  if (process.env.LABOR_CAPTURE_SCREENSHOTS) {
    await library(page).getByRole('combobox', { name: 'Component category', exact: true }).selectOption('transistors')
    const notification = page.getByRole('button', { name: 'Dismiss notification', exact: true })
    if (await notification.isVisible()) await notification.click()
    await page.setViewportSize({ width: 1440, height: 1120 })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: '/tmp/labor-new-transistor.png', fullPage: true })
  }
})
