import { expect, test } from '@playwright/test'

const recoveryKey = 'labor-playground.document.v1'

test('optical, CMOS and P-channel packages place, move, undo and recover with the correct pins', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('button', { name: 'Clear board', exact: true }).click()
  const library = page.getByRole('complementary', { name: 'Parts library', exact: true })
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true })
  const search = library.getByRole('textbox', { name: 'Find a component', exact: true })
  for (const [query, label, id, hole, labels] of [
    ['optical', 'LED/LDR optocoupler', 'O1', 'E3', ['LED A', 'LED K', 'LDR 2', 'LDR 1']],
    ['schmitt oscillator', 'CD40106-style Schmitt inverter', 'U1', 'E8', ['IN A', 'OUT A', 'IN B', 'OUT B', 'IN C', 'OUT C', 'VSS', 'OUT D', 'IN D', 'OUT E', 'IN E', 'OUT F', 'IN F', 'VDD']],
    ['multiplexer', 'CD4053-style signal selector', 'U2', 'E19', ['BY', 'BX', 'CY', 'COM C', 'CX', 'INH', 'VEE', 'VSS', 'SEL C', 'SEL B', 'SEL A', 'AX', 'AY', 'COM A', 'COM B', 'VDD']],
    ['high side', 'P-channel MOSFET', 'M1', 'C18', ['Drain', 'Gate', 'Source']],
  ] as const) {
    await search.fill(query)
    await library.getByRole('button', { name: label, exact: true }).click()
    await page.getByRole('button', { name: `${hole}, available`, exact: true }).click()
    await expect(inspector.getByRole('heading', { name: label, exact: true })).toBeVisible()
    await expect(page.locator(`[data-part="${id}"] [data-pin]`)).toHaveCount(labels.length)
    for (const [i, label] of labels.entries()) {
      await expect(inspector.locator('.pin-row').nth(i)).toContainText(label)
      await expect(page.locator(`[data-part="${id}"] [data-pin="${i + 1}"] title`)).toHaveText(`${i + 1}: ${label}`)
    }
    expect(await inspector.locator('.selected-part-art svg').evaluate(element => {
      const svg = element as SVGSVGElement, b = svg.getBBox(), f = svg.viewBox.baseVal
      return b.x >= f.x && b.y >= f.y && b.x + b.width <= f.x + f.width && b.y + b.height <= f.y + f.height
    })).toBe(true)
  }
  await search.fill('')
  await page.getByRole('button', { name: 'Select tool', exact: true }).click()
  const optical = page.locator('[data-part="O1"]')
  await optical.focus()
  await optical.press('ArrowRight')
  const pins = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).parts.find((p: { id: string }) => p.id === 'O1').pins, recoveryKey)
  await expect.poll(pins).toEqual(['e4', 'e5', 'f5', 'f4'])
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(pins).toEqual(['e3', 'e4', 'f4', 'f3'])
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect.poll(pins).toEqual(['e4', 'e5', 'f5', 'f4'])
  await page.reload()
  await expect.poll(pins).toEqual(['e4', 'e5', 'f5', 'f4'])
  await page.locator('[data-part="O1"]').focus()
  await expect(inspector.getByRole('heading', { name: 'LED/LDR optocoupler', exact: true })).toBeVisible()
  await expect(inspector).toContainText('Virtual four-pin carrier')
  await page.screenshot({ path: '/tmp/labor-synth-utilities.png', fullPage: true })
  expect(errors).toEqual([])
})

for (const id of ['schmitt-oscillator', 'signal-selector', 'optical-gain', 'pmos-high-side']) {
  test(`${id} captures in the browser worker and exposes its guide`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/')
    await page.getByRole('combobox', { name: 'Load example', exact: true }).selectOption(id)
    await expect(page.getByRole('status', { name: 'Simulation status', exact: true })).toHaveAttribute('data-state', 'ready', { timeout: 45_000 })
    await expect(page.locator('.diagnostic, .error-copy')).toHaveCount(0)
    if (id === 'optical-gain') {
      await page.locator('[data-part="O1"]').focus()
      await expect(page.getByLabel('DC current LED A → K', { exact: true })).toBeVisible()
      await expect(page.getByLabel('DC current LDR 1 → 2', { exact: true })).toBeVisible()
      await expect(page.getByLabel('DC component power', { exact: true })).not.toContainText('—')
      await page.screenshot({ path: '/tmp/labor-optical-gate.png', fullPage: true })
    }
    await page.getByRole('tab', { name: 'Overview', exact: true }).click()
    const guide = page.getByRole('region', { name: 'Example guide', exact: true })
    await expect(guide.getByRole('heading', { name: 'What to try', exact: true })).toBeVisible()
    expect(errors).toEqual([])
  })
}
