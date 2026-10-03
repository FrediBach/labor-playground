import { expect, test } from '@playwright/test'

const key = 'labor-playground.document.v1'

test('logic and optocoupler packages expose their pins and retain edited CTR through undo and reload', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('button', { name: 'Clear board', exact: true }).click()
  const library = page.getByRole('complementary', { name: 'Parts library', exact: true })
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true })
  const search = library.getByRole('textbox', { name: 'Find a component', exact: true })
  for (const [query, label, id, hole, labels] of [
    ['flip flop', 'CD4013-style dual flip-flop', 'U1', 'E2', ['Q A', '/Q A', 'CLK A', 'RST A', 'D A', 'SET A', 'VSS', 'SET B', 'D B', 'RST B', 'CLK B', '/Q B', 'Q B', 'VDD']],
    ['xor', 'CD4070-style XOR gates', 'U2', 'E10', ['A1', 'B1', 'Y1', 'Y2', 'A2', 'B2', 'VSS', 'A3', 'B3', 'Y3', 'Y4', 'A4', 'B4', 'VDD']],
    ['and logic', 'CD4081-style AND gates', 'U3', 'E18', ['A1', 'B1', 'Y1', 'Y2', 'A2', 'B2', 'VSS', 'A3', 'B3', 'Y3', 'Y4', 'A4', 'B4', 'VDD']],
    ['ctr', 'PC817-style optocoupler', 'O1', 'E27', ['LED A', 'LED K', 'Emitter', 'Collector']],
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
  }
  const ctr = inspector.getByRole('spinbutton', { name: 'Current transfer ratio', exact: true })
  await expect(ctr).toHaveValue('100')
  await ctr.fill('200')
  await ctr.press('Tab')
  const saved = () => page.evaluate(k => JSON.parse(localStorage.getItem(k)!).parts.find((p: { id: string }) => p.id === 'O1').value, key)
  await expect.poll(saved).toBe(200)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(ctr).toHaveValue('100')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect.poll(saved).toBe(200)
  await search.fill('')
  await page.reload()
  await page.locator('[data-part="O1"]').focus()
  await expect(ctr).toHaveValue('200')
  await page.screenshot({ path: '/tmp/labor-synth-logic.png', fullPage: true })
  expect(errors).toEqual([])
})

for (const id of ['clock-divider', 'xor-ring-modulator', 'and-clock-gate', 'opto-gate-input']) {
  test(`${id} captures and has an editable example guide`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/')
    await page.getByRole('combobox', { name: 'Load example', exact: true }).selectOption(id)
    await expect(page.getByRole('status', { name: 'Simulation status', exact: true })).toHaveAttribute('data-state', 'ready', { timeout: 45_000 })
    await expect(page.locator('.diagnostic, .error-copy')).toHaveCount(0)
    if (id === 'clock-divider') await page.screenshot({ path: '/tmp/labor-clock-divider.png', fullPage: true })
    if (id === 'opto-gate-input') {
      await page.locator('[data-part="O1"]').focus()
      await expect(page.getByLabel('DC current LED A → K', { exact: true })).toBeVisible()
      await expect(page.getByLabel('DC current Collector → Emitter', { exact: true })).toBeVisible()
      const ctr = page.getByRole('spinbutton', { name: 'Current transfer ratio', exact: true })
      await ctr.fill('50')
      await ctr.press('Tab')
      await expect(page.getByRole('status', { name: 'Simulation status', exact: true })).toHaveAttribute('data-state', 'ready')
    }
    await page.getByRole('tab', { name: 'Overview', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Example guide', exact: true }).getByRole('heading', { name: 'What to try', exact: true })).toBeVisible()
    expect(errors).toEqual([])
  })
}
