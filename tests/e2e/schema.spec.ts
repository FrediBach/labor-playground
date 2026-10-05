import { expect, test } from '@playwright/test'
import type { Download, Page } from '@playwright/test'
import { createEmptyDocument, examples, PARTS } from '../../src/lib/circuit'
import { PICO_PINS } from '../../src/lib/pico/profile'
import { buildSchematic } from '../../src/lib/schematic'

const openTab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).click()
const ready = (page: Page) => expect(page.getByRole('status', { name: 'Simulation status', exact: true })).toHaveAttribute('data-state', 'ready', { timeout: 45_000 })
const savedDocument = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('labor-playground.document.v1')!))
const drawing = (page: Page) => page.getByTestId('schematic-drawing')

async function downloadBytes(download: Download) {
  const stream = await download.createReadStream()
  expect(stream).not.toBeNull()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(chunk)
  return Buffer.concat(chunks)
}

function storedZipFiles(zip: Buffer): Map<string, string> {
  const files = new Map<string, string>()
  let offset = 0
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    expect(zip.readUInt16LE(offset + 8)).toBe(0)
    const size = zip.readUInt32LE(offset + 18), nameLength = zip.readUInt16LE(offset + 26), extraLength = zip.readUInt16LE(offset + 28)
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')
    const dataStart = offset + 30 + nameLength + extraLength
    files.set(name, zip.subarray(dataStart, dataStart + size).toString('utf8'))
    offset = dataStart + size
  }
  expect(zip.readUInt32LE(offset)).toBe(0x02014b50)
  return files
}

test('SCH downloads an editable KiCad schematic with its symbols, groups and voltage snapshot', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await openTab(page, 'Schema')
  await page.getByLabel('Schema group', { exact: true }).fill('Output stage')
  await page.getByLabel('Schema group', { exact: true }).press('Enter')
  await page.getByRole('checkbox', { name: 'Show voltages', exact: true }).check()
  await page.getByLabel('Schema time milliseconds', { exact: true }).fill('37.5')
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export schema SCH', exact: true }).click()
  const exported = await downloadEvent
  expect(exported.suggestedFilename()).toMatch(/-schema\.zip$/)
  const files = storedZipFiles(await downloadBytes(exported))
  const basename = exported.suggestedFilename().slice(0, -4)
  const schematic = files.get(`${basename}.sch`)!
  expect(schematic).toMatch(/^EESchema Schematic File Version 4\n/)
  expect(schematic).toContain('RC low-pass filter')
  expect(schematic).toContain('"Output stage"')
  expect(schematic).toContain('Wire Notes Line')
  expect(schematic).toContain('37.500 ms')
  expect(schematic).toContain('V @ 37.500 ms')
  expect(schematic).toContain('"10 kΩ"')
  expect(schematic).toContain('"100 nF"')
  expect(schematic).toMatch(/L PicoLabor:PL_\d+ R1/)
  expect(schematic).toMatch(/L PicoLabor:PL_\d+ C1/)
  expect(files.get(`${basename}-cache.lib`)).toMatch(/^EESchema-LIBRARY Version 2\.4\n/)
  expect(files.get(`${basename}-cache.lib`)).toContain('ALIAS PL_1')
  expect(files.get('sym-lib-table')).toContain(`\${KIPRJMOD}/${basename}-cache.lib`)
  expect(files.get('README.txt')).toContain('Extract every file into the same folder')
  await expect(page.getByRole('region', { name: 'Schema', exact: true })).toContainText('Extract the ZIP')
})

test('Schema annotates the current circuit, selects components, and retains its zoom between tabs', async ({ page }, testInfo) => {
  await page.goto('/')
  await ready(page)
  const original = await savedDocument(page)
  await openTab(page, 'Schema')
  await expect(page.getByRole('region', { name: 'Schema', exact: true })).toBeVisible()
  await expect(drawing(page)).toContainText('RC low-pass filter')
  await expect(drawing(page)).toContainText('R1')
  await expect(drawing(page)).toContainText('C1')
  await expect(drawing(page)).toContainText('10 kΩ')
  await expect(drawing(page)).toContainText('100 nF')
  await expect(drawing(page)).toHaveRole('group')
  await expect(drawing(page).getByRole('button', { name: /^R1,/ })).toBeVisible()
  await expect(page.getByTestId('board-viewport')).toBeHidden()

  await drawing(page).locator('[data-schema-part="R1"]').click()
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true })
  await expect(inspector.getByRole('heading', { name: 'Resistor', exact: true })).toBeVisible()
  await expect(inspector.getByLabel('Schema group', { exact: true })).toHaveValue('')
  await drawing(page).locator('[data-schema-part="C1"]').focus()
  await page.keyboard.press('Enter')
  await expect(inspector.getByRole('spinbutton', { name: 'Capacitance', exact: true })).toBeVisible()

  const viewport = page.getByTestId('schema-viewport')
  const initialZoom = Number(await viewport.getAttribute('data-zoom'))
  await page.getByRole('button', { name: 'Zoom in schema', exact: true }).click()
  const zoomed = Number(await viewport.getAttribute('data-zoom'))
  expect(zoomed).toBeGreaterThan(initialZoom)
  await openTab(page, 'Results')
  await openTab(page, 'Circuit')
  await openTab(page, 'Schema')
  await expect(viewport).toHaveAttribute('data-zoom', String(zoomed))
  await page.getByRole('button', { name: 'Zoom out schema', exact: true }).click()
  expect(Number(await viewport.getAttribute('data-zoom'))).toBeLessThan(zoomed)
  await page.getByRole('button', { name: 'Fit schema', exact: true }).click()
  const framed = await viewport.evaluate(element => ({
    width: element.scrollWidth - element.clientWidth,
    height: element.scrollHeight - element.clientHeight,
  }))
  expect(framed.width).toBeLessThanOrEqual(2)
  expect(framed.height).toBeLessThanOrEqual(2)
  expect(await savedDocument(page)).toEqual(original)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await page.screenshot({ path: testInfo.outputPath('schema-desktop.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Fit schema', exact: true }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: testInfo.outputPath('schema-mobile.png'), fullPage: true })
})

test('SVG and PNG exports contain the entire annotated sheet independently of viewport zoom', async ({ page }) => {
  await page.goto('/')
  await openTab(page, 'Schema')
  for (let index = 0; index < 4; index++) await page.getByRole('button', { name: 'Zoom in schema', exact: true }).click()
  const viewBox = await drawing(page).getAttribute('viewBox')
  const svgEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export schema SVG', exact: true }).click()
  const svgDownload = await svgEvent
  expect(svgDownload.suggestedFilename()).toMatch(/\.svg$/)
  const svg = (await downloadBytes(svgDownload)).toString('utf8')
  const exported = await page.evaluate(source => {
    const document = new DOMParser().parseFromString(source, 'image/svg+xml')
    return {
      errors: document.querySelectorAll('parsererror').length,
      tag: document.documentElement.tagName,
      viewBox: document.documentElement.getAttribute('viewBox'),
      text: document.documentElement.textContent,
    }
  }, svg)
  expect(exported.errors).toBe(0)
  expect(exported.tag).toBe('svg')
  expect(exported.viewBox).toBe(viewBox)
  expect(exported.text).toContain('RC low-pass filter')
  expect(exported.text).toContain('R1')
  expect(exported.text).toContain('C1')
  expect(exported.text).toContain('100 nF')
  expect(svg).toContain('http://www.w3.org/2000/svg')

  const pngEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export schema PNG', exact: true }).click()
  const pngDownload = await pngEvent
  expect(pngDownload.suggestedFilename()).toMatch(/\.png$/)
  const png = await downloadBytes(pngDownload)
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const sheetSize = viewBox!.split(/\s+/).map(Number)
  expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(sheetSize[2])
  expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(sheetSize[3])
})

test('component groups persist, synchronize with the inspector, and support undo without invalidating a capture', async ({ page }, testInfo) => {
  await page.goto('/')
  await ready(page)
  await openTab(page, 'Results')
  await page.getByRole('checkbox', { name: 'Auto update', exact: true }).uncheck()
  await openTab(page, 'Schema')
  await page.getByRole('checkbox', { name: 'Show voltages', exact: true }).check()
  await page.getByLabel('Schema time milliseconds', { exact: true }).fill('37.5')
  await page.getByText('Component groups', { exact: true }).click()
  await page.getByLabel('Group name', { exact: true }).fill('Low-pass stage')
  await page.getByRole('checkbox', { name: 'Group R1', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Group C1', exact: true }).check()
  await page.getByRole('button', { name: 'Apply group', exact: true }).click()
  await expect.poll(async () => (await savedDocument(page)).parts.map((part: { schemaGroup?: string }) => part.schemaGroup)).toEqual(['Low-pass stage', 'Low-pass stage'])
  await expect(drawing(page)).toContainText('Low-pass stage')
  await expect(page.getByLabel('Schema group', { exact: true })).toHaveValue('Low-pass stage')
  await ready(page)
  await expect(page.getByLabel('Schema time milliseconds', { exact: true })).toHaveValue('37.5')
  await expect(page.getByLabel('Schema time milliseconds', { exact: true })).toBeEnabled()
  await page.getByTestId('schema-viewport').screenshot({ path: testInfo.outputPath('schema-group-voltages.png') })

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(async () => (await savedDocument(page)).parts.some((part: { schemaGroup?: string }) => part.schemaGroup)).toBe(false)
  await expect(drawing(page)).not.toContainText('Low-pass stage')
  await ready(page)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(drawing(page)).toContainText('Low-pass stage')
  await ready(page)

  await drawing(page).locator('[data-schema-part="R1"]').click()
  await expect(page.getByLabel('Schema group', { exact: true })).toHaveValue('Low-pass stage')
  await page.getByLabel('Schema group', { exact: true }).fill('Input stage')
  await page.getByLabel('Schema group', { exact: true }).press('Tab')
  await expect(drawing(page)).toContainText('Input stage')
  await expect.poll(async () => (await savedDocument(page)).parts.find((part: { id: string }) => part.id === 'R1').schemaGroup).toBe('Input stage')
  await ready(page)
  await expect(page.getByLabel('Schema time milliseconds', { exact: true })).toHaveValue('37.5')
  await expect(page.getByLabel('Schema time milliseconds', { exact: true })).toBeEnabled()

  await page.reload()
  await openTab(page, 'Schema')
  await expect(drawing(page)).toContainText('Low-pass stage')
  await expect(drawing(page)).toContainText('Input stage')
  await drawing(page).locator('[data-schema-part="R1"]').click()
  await expect(page.getByLabel('Schema group', { exact: true })).toHaveValue('Input stage')
})

test('voltage overlays follow the shared recording cursor and disappear when electrical edits make it stale', async ({ page }) => {
  const circuit = structuredClone(examples.find(example => example.id === 'rc-filter')!.document)
  circuit.stimulus = 'step'
  await page.addInitScript(document => localStorage.setItem('labor-playground.document.v1', JSON.stringify(document)), circuit)
  await page.goto('/')
  await ready(page)
  await openTab(page, 'Schema')
  const voltages = drawing(page).locator('[data-schema-voltage]')
  await expect(voltages).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Show voltages', exact: true }).check()
  await page.getByLabel('Schema time milliseconds', { exact: true }).fill('1')
  expect(await voltages.count()).toBeGreaterThan(0)
  const earlyVoltages = await voltages.allTextContents()
  expect(earlyVoltages.some(value => /[\d.]\s*[mun]?V/.test(value))).toBe(true)
  await openTab(page, 'Results')
  await expect(page.getByLabel('Recording time milliseconds', { exact: true })).toHaveValue('1')
  await page.getByLabel('Recording time milliseconds', { exact: true }).fill('3')
  await page.getByRole('checkbox', { name: 'Auto update', exact: true }).uncheck()
  await openTab(page, 'Schema')
  await expect(page.getByLabel('Schema time milliseconds', { exact: true })).toHaveValue('3')
  expect(await voltages.allTextContents()).not.toEqual(earlyVoltages)
  await page.getByRole('complementary', { name: 'Inspector', exact: true }).getByRole('button', { name: '220', exact: true }).click()
  await expect(page.getByLabel('Schema time milliseconds', { exact: true })).toBeDisabled()
  await expect(voltages).toHaveCount(0)
  await openTab(page, 'Results')
  await page.getByRole('button', { name: 'Capture', exact: true }).click()
  await ready(page)
  await openTab(page, 'Schema')
  await expect(page.getByLabel('Schema time milliseconds', { exact: true })).toBeEnabled()
  expect(await voltages.count()).toBeGreaterThan(0)
})

test('Pico external LED renders and exports wires attached to its physical pins', async ({ page }, testInfo) => {
  const circuit = examples.find(example => example.id === 'pico-led')!.document
  await page.goto('/')
  await page.getByLabel('Load example', { exact: true }).selectOption('pico-led')
  await openTab(page, 'Schema')
  const sheet = drawing(page)
  await expect(sheet.locator('[data-schema-part]')).toHaveCount(3)
  const pico = sheet.locator('[data-schema-part="Pico"]')
  await expect(pico.getByText('GP0', { exact: true })).toBeVisible()
  await expect(pico.locator('[data-schema-pin]')).toHaveText(['1', '3', '8'])
  await expect(pico.locator('[data-schema-pin="1"]')).toHaveAttribute('data-schema-terminal', 'pico:1')

  const renderedWires = await sheet.locator('polyline.sch-wire[data-schema-net]').evaluateAll(elements => elements.map(element => ({
    node: element.getAttribute('data-schema-net'),
    points: element.getAttribute('points')!.trim().split(/\s+/).map(point => point.split(',').map(Number)),
  })))
  const layout = buildSchematic(circuit)
  for (const symbol of layout.symbols) {
    for (const pin of symbol.pins) {
      expect(renderedWires.some(wire => wire.node === pin.node && wire.points.some(([x, y]) => x === pin.x && y === pin.y)), `${symbol.id} pin ${pin.number} has a visible wire`).toBe(true)
    }
  }
  expect(new Set(renderedWires.map(wire => wire.node)).size).toBe(3)

  await sheet.locator('[data-schema-part="R1"]').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('complementary', { name: 'Inspector', exact: true }).getByRole('heading', { name: 'Resistor', exact: true })).toBeVisible()
  await expect(sheet.locator('[data-schema-part="R1"]')).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Fit schema', exact: true }).click()
  await page.getByTestId('schema-viewport').screenshot({ path: testInfo.outputPath('schema-pico-led.png') })

  const svgEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export schema SVG', exact: true }).click()
  const svg = (await downloadBytes(await svgEvent)).toString('utf8')
  const exportedWires = await page.evaluate(source => {
    const document = new DOMParser().parseFromString(source, 'image/svg+xml')
    return Array.from(document.querySelectorAll('polyline.sch-wire[data-schema-net]'), element => ({
      node: element.getAttribute('data-schema-net'),
      points: element.getAttribute('points')!.trim().split(/\s+/).map(point => point.split(',').map(Number)),
    }))
  }, svg)
  expect(exportedWires).toEqual(renderedWires)
})

test('IC and Pico schemas preserve physical pin numbers and allow component inspection', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByLabel('Load example', { exact: true }).selectOption('555-astable')
  await openTab(page, 'Schema')
  const timer = drawing(page).locator('[data-schema-part="U1"]')
  await expect(timer).toContainText('NE555')
  await expect(timer.locator('[data-schema-pin]')).toHaveText(['1', '2', '3', '4', '5', '6', '7', '8'])
  for (const name of PARTS.timer555.pinNames) await expect(timer.getByText(name, { exact: true })).toBeVisible()
  await timer.click()
  await expect(page.getByRole('complementary', { name: 'Inspector', exact: true }).getByRole('heading', { name: '555 timer', exact: true })).toBeVisible()
  await page.getByLabel('Schema group', { exact: true }).fill('Clock generator')
  await page.getByLabel('Schema group', { exact: true }).press('Enter')
  await expect(drawing(page).locator('[data-schema-group="Clock generator"]')).toBeVisible()
  await expect(timer.locator('[data-schema-pin]')).toHaveCount(8)
  await page.getByRole('button', { name: 'Fit schema', exact: true }).click()
  await page.getByTestId('schema-viewport').screenshot({ path: testInfo.outputPath('schema-555.png') })

  await page.getByLabel('Load example', { exact: true }).selectOption('pico-pwm')
  await openTab(page, 'Schema')
  const pico = drawing(page).locator('[data-schema-part="Pico"]')
  await expect(pico).toContainText('Raspberry Pi Pico')
  const picoCircuit = examples.find(example => example.id === 'pico-pwm')!.document
  const connectedTerminals = new Set(picoCircuit.wires.flatMap(wire => [wire.from, wire.to]))
  const connectedPins = PICO_PINS.filter(pin => connectedTerminals.has(pin.id))
  await expect(pico.locator('[data-schema-pin]')).toHaveText(connectedPins.map(pin => String(pin.number)))
  for (const name of new Set(connectedPins.map(pin => pin.label))) await expect(pico.getByText(name, { exact: true }).first()).toBeVisible()
  await expect(drawing(page).locator('[data-schema-part]')).toHaveCount(picoCircuit.parts.length + 1)
  await expect(drawing(page)).toContainText('CH1')
  await expect(drawing(page)).toContainText('CH2')
  await page.getByTestId('schema-viewport').screenshot({ path: testInfo.outputPath('schema-pico.png') })
  expect(errors).toEqual([])
})

test('Fit contains a thirty-group sheet and an empty circuit redraws and undoes correctly', async ({ page }) => {
  const circuit = createEmptyDocument()
  circuit.title = 'Thirty independent stages'
  circuit.parts = Array.from({ length: 30 }, (_, index) => ({
    id: `R${index + 1}`, kind: 'resistor' as const, value: 1000,
    pins: [`a${index + 1}`, `f${index + 1}`], schemaGroup: `Stage ${index + 1}`,
  }))
  await page.addInitScript(document => localStorage.setItem('labor-playground.document.v1', JSON.stringify(document)), circuit)
  await page.goto('/')
  await openTab(page, 'Schema')
  await expect(drawing(page).locator('[data-schema-group]')).toHaveCount(30)
  await expect(drawing(page).locator('[data-schema-part]')).toHaveCount(30)
  await page.getByRole('button', { name: 'Fit schema', exact: true }).click()
  const viewport = page.getByTestId('schema-viewport')
  await expect.poll(() => viewport.evaluate(element => Math.max(element.scrollWidth - element.clientWidth, element.scrollHeight - element.clientHeight))).toBeLessThanOrEqual(2)
  const sheet = await drawing(page).boundingBox()
  const frame = await viewport.boundingBox()
  expect(sheet!.x).toBeGreaterThanOrEqual(frame!.x)
  expect(sheet!.y).toBeGreaterThanOrEqual(frame!.y)
  expect(sheet!.x + sheet!.width).toBeLessThanOrEqual(frame!.x + frame!.width)
  expect(sheet!.y + sheet!.height).toBeLessThanOrEqual(frame!.y + frame!.height)

  await page.getByRole('button', { name: 'Clear board', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Circuit', exact: true })).toHaveAttribute('aria-selected', 'true')
  await openTab(page, 'Schema')
  await expect(drawing(page).locator('[data-schema-part]')).toHaveCount(0)
  await expect(drawing(page).locator('[data-schema-group]')).toHaveCount(0)
  await expect(drawing(page)).toContainText('Add components to the breadboard')
  await expect(drawing(page)).toHaveAttribute('viewBox', /^0 0 \d+ \d+$/)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(drawing(page).locator('[data-schema-group]')).toHaveCount(30)
  await expect(drawing(page).locator('[data-schema-part]')).toHaveCount(30)
  await expect(drawing(page)).toContainText('Thirty independent stages')
})
