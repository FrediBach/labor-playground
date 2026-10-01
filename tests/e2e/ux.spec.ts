import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

async function captured(page: Page) {
  await expect(page.getByRole('status', { name: 'Simulation status', exact: true })).toHaveAttribute('data-state', 'ready', { timeout: 45_000 })
}

async function outputPeakToPeak(page: Page) {
  await page.getByRole('tab', { name: 'Results', exact: true }).click()
  const scope = page.getByRole('region', { name: 'Oscilloscope' })
  const table = scope.getByRole('table', { name: 'Channel measurements' })
  if (!await table.isVisible()) await scope.locator('.scope-measurements > summary').click()
  const value = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Peak to peak', exact: true }) }).getByRole('cell').nth(1)
  await expect(value).toHaveText(/[\d.]+ V/)
  const result = parseFloat(await value.innerText())
  await page.getByRole('tab', { name: 'Circuit', exact: true }).click()
  return result
}

async function withinPage(control: Locator, width: number) {
  await expect(control).toBeVisible()
  const bounds = await control.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1)
}

test('Simulate updates a changed circuit and the keyboard shortcut commits a focused value', async ({ page }) => {
  await page.goto('/')
  await captured(page)
  const original = await outputPeakToPeak(page)
  await page.getByRole('tab', { name: 'Results', exact: true }).click()
  await page.getByText('Auto update', { exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Auto update' })).not.toBeChecked()
  await page.getByRole('tab', { name: 'Circuit', exact: true }).click()

  await page.getByRole('button', { name: '220', exact: true }).click()
  const status = page.getByRole('status', { name: 'Simulation status', exact: true })
  await expect(status).toHaveAttribute('data-state', 'stale')
  await page.getByRole('button', { name: 'Simulate', exact: true }).click()
  await captured(page)
  expect(await outputPeakToPeak(page)).toBeLessThan(original * 0.7)

  const capacitance = page.getByRole('spinbutton', { name: 'Capacitance', exact: true })
  await capacitance.fill('470')
  await capacitance.press('Control+Enter')
  await captured(page)
  await expect(capacitance).toHaveValue('470')
  expect(await outputPeakToPeak(page)).toBeLessThan(1)
  await expect(page.getByRole('button', { name: 'Wire tool', exact: true })).toHaveAttribute('aria-pressed', 'false')
})

test('Simulate and its status stay reachable while scrolling the Results tab', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await captured(page)
  await page.getByRole('link', { name: 'View results', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Results', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.locator('.app-footer').scrollIntoViewIfNeeded()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200)

  const simulate = page.getByRole('button', { name: 'Simulate', exact: true })
  await expect(simulate).toBeInViewport()
  await expect(page.getByRole('status', { name: 'Simulation status', exact: true })).toBeInViewport()
  const bounds = await simulate.boundingBox()
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(160)
  await expect(simulate).toBeEnabled()
  // A visible button must also be hit-testable above the scrolled workbench.
  expect(await simulate.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2))
  })).toBe(true)
})

test('parts, connections, and Pico remain available at phone, tablet, and laptop widths', async ({ page }) => {
  await page.goto('/')
  await captured(page)
  const library = page.getByRole('complementary', { name: 'Parts library' })
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await withinPage(page.getByRole('button', { name: 'Simulate', exact: true }), width)
    await withinPage(page.getByRole('status', { name: 'Simulation status', exact: true }), width)
    await withinPage(page.getByRole('link', { name: 'View results', exact: true }), width)
    for (const tab of ['Circuit', 'Results', 'Automations', 'Overview']) {
      await withinPage(page.getByRole('tab', { name: tab, exact: true }), width)
    }
    await page.getByRole('tab', { name: 'Overview', exact: true }).click()
    await expect(page.getByRole('table', { name: 'Circuit parts', exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.getByRole('tab', { name: 'Results', exact: true }).click()
    await withinPage(page.getByLabel('Simulation duration', { exact: true }), width)
    await withinPage(page.getByRole('button', { name: 'Capture', exact: true }), width)
    await page.getByRole('tab', { name: 'Circuit', exact: true }).click()
    await withinPage(library.getByRole('button', { name: /Raspberry Pi Pico/ }), width)
    for (const channel of ['CH1', 'CH2']) {
      const probe = library.getByRole('button', { name: `Scope probe ${channel}`, exact: true })
      await withinPage(probe, width)
      await probe.click()
      await expect(page.locator('.board-hint')).toContainText(`attach ${channel}`)
    }
    const color = library.locator('.wire-palette button').last()
    await withinPage(color, width)
    await color.click()
    await expect(color).toHaveAttribute('aria-pressed', 'true')
    if (process.env.LABOR_CAPTURE_SCREENSHOTS) {
      await page.screenshot({ path: `/tmp/labor-ux-${width}.png`, fullPage: true })
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: `/tmp/labor-ux-${width}-top.png` })
    }
  }

  await page.setViewportSize({ width: 390, height: 900 })
  await library.getByRole('button', { name: /Raspberry Pi Pico/ }).click()
  await expect(page.getByRole('region', { name: 'Pico programming', exact: true })).toBeVisible()
  await expect(library.getByRole('button', { name: /Raspberry Pi Pico/ })).toBeDisabled()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  if (process.env.LABOR_CAPTURE_SCREENSHOTS) {
    await page.screenshot({ path: '/tmp/labor-ux-390-pico.png', fullPage: true })
  }
})

test('top Simulate and both editor shortcuts execute Pico code without changing its source', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Load example' }).selectOption('pico-console')
  const editor = page.getByRole('textbox', { name: 'Pico main.py editor', exact: true })
  await expect(editor).toBeVisible({ timeout: 45_000 })
  const source = await page.evaluate(() => JSON.parse(localStorage.getItem('labor-playground.document.v1')!).pico.source)
  const serial = page.getByLabel('Pico serial console', { exact: true })
  await page.getByRole('button', { name: 'Simulate', exact: true }).click()
  await captured(page)
  await expect(serial).toContainText('LED 0')
  await expect(serial).toContainText('LED 4')

  for (const shortcut of ['Control+Enter', 'Meta+Enter']) {
    // Clear the previous run so the next assertion proves the shortcut executed.
    await page.getByRole('region', { name: 'Pico programming', exact: true }).getByRole('button', { name: 'Reset', exact: true }).click()
    await expect(serial).not.toContainText('LED 0')
    await expect(page.getByRole('status', { name: 'Simulation status', exact: true })).toHaveAttribute('data-state', 'stale')
    await editor.focus()
    await editor.press(shortcut)
    await captured(page)
    await expect(serial).toContainText('LED 0')
    await expect(serial).toContainText('LED 4')
    await expect(editor).toBeFocused()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('labor-playground.document.v1')!).pico.source)).toBe(source)
  }
})

test('circuit errors remain visible with Inspector closed and correction restores Simulate', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Load example' }).selectOption('opamp-amplifier')
  await captured(page)
  await page.getByRole('button', { name: 'Toggle inspector', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Inspector', exact: true })).toHaveCount(0)
  const supply = page.locator('[data-wire="W2"]')
  await supply.focus()
  await supply.press('Delete')

  const status = page.getByRole('status', { name: 'Simulation status', exact: true })
  await expect(status).toHaveAttribute('data-state', 'invalid')
  await expect(status).toBeInViewport()
  await expect(page.getByRole('alert')).toContainText('U1 V+ (pin 8) has no connected supply')
  await expect(page.getByRole('button', { name: 'Simulate', exact: true })).toBeDisabled()
  await expect(page.getByRole('complementary', { name: 'Inspector', exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'View circuit details', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('complementary', { name: 'Inspector', exact: true })).toHaveCount(0)
  const checks = page.getByRole('region', { name: 'Circuit checks', exact: true })
  await expect(checks).toContainText('U1 V+ (pin 8) has no connected supply')
  await page.screenshot({ path: testInfo.outputPath('overview-error.png'), fullPage: true })
  await checks.getByRole('listitem').filter({ hasText: 'U1 V+ (pin 8) has no connected supply' }).getByRole('button', { name: 'Inspect U1', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Circuit', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('complementary', { name: 'Inspector', exact: true })).toContainText('U1')
  await expect(page.getByRole('complementary', { name: 'Inspector', exact: true }).getByRole('heading', { name: 'TL072-style dual op-amp', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await captured(page)
  await expect(page.getByRole('button', { name: 'Simulate', exact: true })).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('an empty component search explains the result and can be cleared', async ({ page }) => {
  await page.goto('/')
  const library = page.getByRole('complementary', { name: 'Parts library', exact: true })
  const search = library.getByRole('textbox', { name: 'Find a component', exact: true })
  await search.fill('no such component')
  await expect(library.getByRole('status')).toContainText('No components match')
  await expect(library.locator('.part-item')).toHaveCount(0)
  await library.getByRole('button', { name: 'Clear search', exact: true }).click()
  await expect(search).toHaveValue('')
  await expect(library.locator('.part-item')).toHaveCount(16)
  await library.getByRole('button', { name: /Resistor/ }).click()
  await expect(library.getByRole('button', { name: /Resistor/ })).toHaveAttribute('aria-pressed', 'true')
})
