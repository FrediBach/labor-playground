import { expect, test, type Page } from '@playwright/test'

const recoveryKey = 'labor-playground.document.v1'

function terminal(page: Page, id: string) {
  return page.getByRole('button', { name: new RegExp(`^${id.toUpperCase()}, (?:available|occupied)$`) })
}

async function recovered(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), recoveryKey)
}

test('555, TL074, LM13700, and TL072 parts share IC numbering and expose their package pins', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Clear board', exact: true }).click()
  const library = page.getByRole('complementary', { name: 'Parts library' })
  const inspector = page.getByRole('complementary', { name: 'Inspector' })
  await library.getByRole('button', { name: '555 timer', exact: true }).click()
  await terminal(page, 'e3').click()
  await expect.poll(async () => (await recovered(page))?.parts[0]?.pins).toEqual(['e3', 'e4', 'e5', 'e6', 'f6', 'f5', 'f4', 'f3'])
  await expect(page.locator('[data-part="U1"] [data-pin]')).toHaveCount(8)
  await expect(inspector).toContainText('EDUCATIONAL MODEL · DIP-8')
  await expect(inspector.locator('.ic-pin-list .pin-row')).toHaveCount(8)
  await expect(inspector.locator('.component-dc')).toContainText('Current and power are unavailable')
  await expect(inspector.getByRole('button', { name: /^Move U1 lead/ })).toHaveCount(0)

  await library.getByRole('button', { name: /TL074/ }).click()
  await terminal(page, 'e12').click()
  await expect.poll(async () => (await recovered(page))?.parts[1]?.id).toBe('U2')
  await expect(page.locator('[data-part="U2"] [data-pin]')).toHaveCount(14)
  await expect(inspector).toContainText('EDUCATIONAL MODEL · DIP-14')
  await expect(inspector.locator('.ic-pin-list .pin-row')).toHaveCount(14)
  await expect(inspector.locator('.ic-pin-list .pin-row').nth(3)).toContainText('V+')
  await expect(inspector.locator('.ic-pin-list .pin-row').nth(10)).toContainText('V−')
  await expect(inspector.getByRole('button', { name: /^Move U2 lead/ })).toHaveCount(0)
  await library.getByRole('button', { name: /LM13700/ }).click()
  await terminal(page, 'e21').click()
  await expect.poll(async () => (await recovered(page))?.parts[2]?.id).toBe('U3')
  await expect(page.locator('[data-part="U3"] [data-pin]')).toHaveCount(16)
  await expect(inspector).toContainText('EDUCATIONAL MODEL · DIP-16')
  const otaPins = inspector.locator('.ic-pin-list .pin-row')
  await expect(otaPins).toHaveCount(16)
  for (const [index, label] of ['IABC A', 'DIODE A', 'IN+ A', 'IN− A', 'OUT A', 'V−', 'BUF IN A', 'BUF OUT A', 'BUF OUT B', 'BUF IN B', 'V+', 'OUT B', 'IN− B', 'IN+ B', 'DIODE B', 'IABC B'].entries()) {
    await expect(otaPins.nth(index)).toContainText(label)
    await expect(page.locator(`[data-part="U3"] [data-pin="${index + 1}"] title`)).toHaveText(`${index + 1}: ${label}`)
  }
  await expect(inspector.getByRole('button', { name: /^Move U3 lead/ })).toHaveCount(0)
  for (const icon of [
    library.getByRole('button', { name: /TL074/ }).locator('svg').first(),
    library.getByRole('button', { name: /LM13700/ }).locator('svg').first(),
    inspector.locator('.selected-part-art svg'),
  ]) {
    const fits = await icon.evaluate(element => {
      const svg = element as SVGSVGElement
      const glyph = svg.getBBox(), frame = svg.viewBox.baseVal
      return glyph.x >= frame.x && glyph.y >= frame.y && glyph.x + glyph.width <= frame.x + frame.width && glyph.y + glyph.height <= frame.y + frame.height
    })
    expect(fits).toBe(true)
  }
  if (process.env.LABOR_CAPTURE_SCREENSHOTS) {
    await page.getByRole('button', { name: 'Select tool', exact: true }).click()
    await page.locator('[data-part="U3"]').focus()
    await page.screenshot({ path: '/tmp/labor-ic-parts.png', fullPage: true })
  }

  await library.getByRole('button', { name: /TL072-style dual op-amp/ }).click()
  await terminal(page, 'e7').click()
  await expect.poll(async () => (await recovered(page))?.parts[3]).toMatchObject({ id: 'U4', kind: 'opamp' })
  await expect(page.locator('[data-part="U4"]')).toContainText('TL072 STYLE')
  await page.reload()
  await page.locator('[data-part="U3"]').focus()
  await expect(inspector.locator('.ic-pin-list .pin-row')).toHaveCount(16)
  await expect(inspector.getByRole('heading', { name: /LM13700/ })).toBeVisible()
  await page.locator('[data-part="U4"]').focus()
  await expect(inspector.getByRole('heading', { name: /TL072-style dual op-amp/ })).toBeVisible()
})

for (const { kind, label, pinsPerRow } of [
  { kind: 'quadopamp', label: /TL074/, pinsPerRow: 7 },
  { kind: 'lm13700', label: /LM13700/, pinsPerRow: 8 },
]) test(`DIP-${pinsPerRow * 2} placement, movement, import, undo, and probes preserve both rows`, async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Clear board', exact: true }).click()
  const library = page.getByRole('complementary', { name: 'Parts library' })
  await library.getByRole('button', { name: label }).click()
  await terminal(page, `e${32 - pinsPerRow}`).click()
  await expect(page.getByText('0 / 128 parts placed', { exact: true })).toBeVisible()
  await expect(page.getByRole('status', { name: 'Workbench notification', exact: true })).toContainText(`Place all ${pinsPerRow * 2} IC pins across the center trench`)

  await terminal(page, 'e7').hover()
  await expect(page.locator(`[data-part-preview="${kind}"] [data-pin]`)).toHaveCount(pinsPerRow * 2)
  await terminal(page, 'e7').click()
  const first = [...Array.from({ length: pinsPerRow }, (_, index) => `e${7 + index}`), ...Array.from({ length: pinsPerRow }, (_, index) => `f${6 + pinsPerRow - index}`)]
  await expect.poll(async () => (await recovered(page))?.parts[0]?.pins).toEqual(first)
  await page.getByRole('button', { name: 'Rotate placement', exact: true }).click()
  await terminal(page, 'f26').click()
  const rotatedPins = [...Array.from({ length: pinsPerRow }, (_, index) => `f${26 - index}`), ...Array.from({ length: pinsPerRow }, (_, index) => `e${27 - pinsPerRow + index}`)]
  await expect.poll(async () => (await recovered(page))?.parts[1]?.pins).toEqual(rotatedPins)
  await expect(page.locator('[data-part="U2"] [data-pin]')).toHaveCount(pinsPerRow * 2)
  await page.getByRole('button', { name: 'Select tool', exact: true }).click()
  const rotated = page.locator('[data-part="U2"]')
  await rotated.focus()
  await rotated.press('ArrowRight')
  const moved = [...Array.from({ length: pinsPerRow }, (_, index) => `f${27 - index}`), ...Array.from({ length: pinsPerRow }, (_, index) => `e${28 - pinsPerRow + index}`)]
  await expect.poll(async () => (await recovered(page))?.parts[1]?.pins).toEqual(moved)
  for (const id of moved) await expect(terminal(page, id)).toHaveAttribute('aria-label', `${id.toUpperCase()}, occupied`)
  await rotated.press('ArrowUp')
  await expect(page.getByRole('status', { name: 'Workbench notification', exact: true })).toContainText('No free placement in that direction.')
  expect((await recovered(page)).parts[1].pins).toEqual(moved)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(async () => (await recovered(page))?.parts[1]?.pins).toEqual(rotatedPins)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect.poll(async () => (await recovered(page))?.parts[1]?.pins).toEqual(moved)

  await library.getByRole('button', { name: 'Scope probe CH1', exact: true }).click()
  // The final lead is under the rotated package hit area and must remain reachable.
  const pin = await terminal(page, 'e27').boundingBox()
  expect(pin).not.toBeNull()
  await page.mouse.click(pin!.x + pin!.width / 2, pin!.y + pin!.height / 2)
  await expect.poll(async () => (await recovered(page))?.probes.CH1).toBe('e27')

  const document = await recovered(page)
  await page.getByRole('button', { name: 'Clear board', exact: true }).click()
  await page.locator('input[type="file"]').setInputFiles({ name: `${kind}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) })
  await expect(page.locator('[data-part="U2"] [data-pin]')).toHaveCount(pinsPerRow * 2)
  await expect.poll(async () => (await recovered(page))?.parts[1]?.pins).toEqual(moved)
  await expect.poll(async () => (await recovered(page))?.probes.CH1).toBe('e27')
  await page.reload()
  await expect(page.locator('[data-part="U2"] [data-pin]')).toHaveCount(pinsPerRow * 2)
  expect((await recovered(page)).parts[1].pins).toEqual(moved)
})

test('the LM13700 is discoverable by its synth uses in Controls & ICs', async ({ page }) => {
  await page.goto('/')
  const library = page.getByRole('complementary', { name: 'Parts library' })
  await library.getByRole('combobox', { name: 'Component category', exact: true }).selectOption('controls')
  const search = library.getByRole('textbox', { name: 'Find a component', exact: true })
  for (const term of ['lm13700', 'ota', 'transconductance', 'vca', 'voltage controlled amplifier', 'filter']) {
    await search.fill(term)
    await expect(library.getByRole('button', { name: /LM13700/ })).toBeVisible()
  }
  await expect(library.getByRole('button', { name: 'Scope probe CH1', exact: true })).toBeVisible()
})
