import { expect, test } from '@playwright/test'

test('timing components expose real pin labels and survive moving, undo, and reload', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('button', { name: 'Clear board', exact: true }).click()
  const library = page.getByRole('complementary', { name: 'Parts library', exact: true })
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true })
  const search = library.getByRole('textbox', { name: 'Find a component', exact: true })
  for (const [query, name, id, hole, pins] of [
    ['ripple', 'CD4024-style ripple counter', 'U1', 'E2', ['CLK', 'RESET', 'Q7', 'Q6', 'Q5', 'Q4', 'VSS', 'NC', 'Q3', 'NC', 'Q2', 'Q1', 'NC', 'VDD']],
    ['nand', 'CD4093-style Schmitt NAND gates', 'U2', 'E10', ['A1', 'B1', 'Y1', 'Y2', 'A2', 'B2', 'VSS', 'A3', 'B3', 'Y3', 'Y4', 'A4', 'B4', 'VDD']],
    ['nor', 'CD4001-style NOR gates', 'U3', 'E18', ['A1', 'B1', 'Y1', 'Y2', 'A2', 'B2', 'VSS', 'A3', 'B3', 'Y3', 'Y4', 'A4', 'B4', 'VDD']],
    ['shunt reference', 'LM4040-style 2.5 V reference', 'U4', 'A26', ['NC / A', 'Cathode', 'Anode']],
  ] as const) {
    await search.fill(query)
    await library.getByRole('button', { name, exact: true }).click()
    await page.getByRole('button', { name: `${hole}, available`, exact: true }).click()
    await expect(inspector.getByRole('heading', { name, exact: true })).toBeVisible()
    for (const [i, label] of pins.entries()) {
      await expect(inspector.locator('.pin-row').nth(i)).toContainText(label)
      await expect(page.locator(`[data-part="${id}"] [data-pin="${i + 1}"] title`)).toHaveText(`${i + 1}: ${label}`)
    }
  }
  await search.fill('')
  await page.getByRole('button', { name: 'Select tool', exact: true }).click()
  await page.locator('[data-part="U4"]').focus()
  await page.keyboard.press('ArrowDown')
  await expect(inspector.locator('.pin-row').first()).toContainText('B26')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(inspector.locator('.pin-row').first()).toContainText('A26')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('labor-playground.document.v1')!).parts.find((p: { id: string }) => p.id === 'U4').pins[0])).toBe('b26')
  await page.reload()
  await page.locator('[data-part="U4"]').focus()
  await expect(inspector.locator('.pin-row').first()).toContainText('B26')
  await page.screenshot({ path: '/tmp/labor-timing-parts.png', fullPage: true })
  expect(errors).toEqual([])
})

for (const id of ['ripple-divider', 'nand-oscillator', 'nor-clock-inhibit', 'precision-cv-reference']) {
  test(`${id} simulates and exposes its guide`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/')
    await page.getByRole('combobox', { name: 'Load example', exact: true }).selectOption(id)
    await expect(page.getByRole('status', { name: 'Simulation status', exact: true })).toHaveAttribute('data-state', 'ready', { timeout: 45_000 })
    await expect(page.locator('.diagnostic, .error-copy')).toHaveCount(0)
    if (id === 'precision-cv-reference') {
      await page.locator('[data-part="U1"]').focus()
      await expect(page.getByLabel('DC current Cathode → Anode', { exact: true })).toContainText('mA')
      await expect(page.getByLabel('DC component power', { exact: true })).toContainText('mW')
      await page.screenshot({ path: '/tmp/labor-cv-reference.png', fullPage: true })
    }
    if (id === 'ripple-divider' || id === 'nand-oscillator') {
      await expect(page.getByRole('region', { name: 'Integrated EDU oscilloscope', exact: true })).toContainText('12.5 ms/div')
      await page.screenshot({ path: `/tmp/labor-${id}.png`, fullPage: true })
    }
    await page.getByRole('tab', { name: 'Overview', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Example guide', exact: true }).getByRole('heading', { name: 'What to try', exact: true })).toBeVisible()
    expect(errors).toEqual([])
  })
}
