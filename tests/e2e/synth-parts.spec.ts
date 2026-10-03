import { expect, test } from '@playwright/test'

const recoveryKey = 'labor-playground.document.v1'

test('synth parts expose real package labels, move, undo and recover', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('button', { name: 'Clear board', exact: true }).click()
  const library = page.getByRole('complementary', { name: 'Parts library', exact: true })
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true })
  const search = library.getByRole('textbox', { name: 'Find a component', exact: true })
  for (const [query, label, id, hole, count] of [
    ['jfet', 'N-channel JFET', 'J1', 'C5', 3],
    ['mosfet', 'N-channel MOSFET', 'M1', 'C21', 3],
    ['comparator', 'LM393-style dual comparator', 'U1', 'E5', 8],
    ['sample hold', 'CD4066-style analog switch', 'U2', 'E18', 14],
  ] as const) {
    await search.fill(query)
    await library.getByRole('button', { name: label, exact: true }).click()
    await page.getByRole('button', { name: `${hole}, available`, exact: true }).click()
    await expect(inspector.getByRole('heading', { name: label, exact: true })).toBeVisible()
    await expect(inspector.locator('.pin-row')).toHaveCount(count)
    await expect(page.locator(`[data-part="${id}"] [data-pin]`)).toHaveCount(count)
    if (count === 3) {
      for (const [i, pin] of ['Drain', 'Gate', 'Source'].entries()) await expect(inspector.locator('.pin-row').nth(i)).toContainText(pin)
      await expect(inspector).toContainText('D / G / S')
    }
    const icon = inspector.locator('.selected-part-art svg')
    expect(await icon.evaluate(element => {
      const svg = element as SVGSVGElement, bounds = svg.getBBox(), frame = svg.viewBox.baseVal
      return bounds.x >= frame.x && bounds.y >= frame.y && bounds.x + bounds.width <= frame.x + frame.width && bounds.y + bounds.height <= frame.y + frame.height
    })).toBe(true)
  }
  await search.fill('')
  await page.getByRole('button', { name: 'Select tool', exact: true }).click()
  const fet = page.locator('[data-part="J1"]')
  await fet.focus()
  await fet.press('ArrowRight')
  const pins = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).parts.find((p: { id: string }) => p.id === 'J1').pins, recoveryKey)
  await expect.poll(pins).toEqual(['c6', 'c7', 'c8'])
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(pins).toEqual(['c5', 'c6', 'c7'])
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect.poll(pins).toEqual(['c6', 'c7', 'c8'])
  await page.reload()
  await page.locator('[data-part="U2"]').focus()
  await expect(inspector.getByRole('heading', { name: 'CD4066-style analog switch', exact: true })).toBeVisible()
  await expect(inspector.locator('.pin-row').nth(12)).toContainText('EN A')
  await expect(inspector.locator('.pin-row').nth(13)).toContainText('VDD')
  await page.screenshot({ path: '/tmp/labor-synth-parts.png', fullPage: true })
  expect(errors).toEqual([])
})

for (const id of ['jfet-buffer', 'mosfet-gate-inverter', 'comparator-gate', 'analog-track-hold']) {
  test(`${id} loads and captures in the browser worker`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/')
    await page.getByRole('combobox', { name: 'Load example', exact: true }).selectOption(id)
    await expect(page.getByRole('status', { name: 'Simulation status', exact: true })).toHaveAttribute('data-state', 'ready', { timeout: 45_000 })
    if (id === 'jfet-buffer') {
      await page.locator('[data-part="J1"]').focus()
      await expect(page.getByLabel('DC current Drain → Source', { exact: true })).toBeVisible()
      await expect(page.getByLabel('DC component power', { exact: true })).not.toContainText('—')
    }
    if (id === 'analog-track-hold') await page.screenshot({ path: '/tmp/labor-track-hold.png', fullPage: true })
    expect(errors).toEqual([])
  })
}
