import { expect, test, type Page } from '@playwright/test'

const recoveryKey = 'labor-playground.document.v1'

function terminal(page: Page, id: string) {
  return page.getByRole('button', { name: new RegExp(`^${id.toUpperCase()}, (?:available|occupied)$`) })
}

async function recovered(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), recoveryKey)
}

test('555 and TL074 parts share IC numbering and expose their real package pins', async ({ page }) => {
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
  const thumbnailFits = await library.getByRole('button', { name: /TL074/ }).locator('svg').first().evaluate(element => {
    const svg = element as SVGSVGElement
    const glyph = svg.getBBox(), frame = svg.viewBox.baseVal
    return glyph.x >= frame.x && glyph.y >= frame.y && glyph.x + glyph.width <= frame.x + frame.width && glyph.y + glyph.height <= frame.y + frame.height
  })
  expect(thumbnailFits).toBe(true)
  if (process.env.LABOR_CAPTURE_SCREENSHOTS) {
    await page.getByRole('button', { name: 'Select tool', exact: true }).click()
    await page.locator('[data-part="U2"]').focus()
    await page.screenshot({ path: '/tmp/labor-ic-parts.png', fullPage: true })
  }

  await page.reload()
  await page.locator('[data-part="U2"]').focus()
  await expect(inspector.locator('.ic-pin-list .pin-row')).toHaveCount(14)
  await expect(inspector.getByRole('heading', { name: /TL074/ })).toBeVisible()
})

test('DIP-14 placement, movement, undo, and probes cover both seven-pin rows', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Clear board', exact: true }).click()
  const library = page.getByRole('complementary', { name: 'Parts library' })
  await library.getByRole('button', { name: /TL074/ }).click()
  await terminal(page, 'e25').click()
  await expect(page.getByText('0 / 30 parts placed', { exact: true })).toBeVisible()
  await expect(page.getByRole('status', { name: 'Workbench notification', exact: true })).toContainText('Place all 14 IC pins across the center trench')

  await terminal(page, 'e7').hover()
  await expect(page.locator('[data-part-preview="quadopamp"] [data-pin]')).toHaveCount(14)
  await terminal(page, 'e7').click()
  const first = ['e7', 'e8', 'e9', 'e10', 'e11', 'e12', 'e13', 'f13', 'f12', 'f11', 'f10', 'f9', 'f8', 'f7']
  await expect.poll(async () => (await recovered(page))?.parts[0]?.pins).toEqual(first)
  await page.getByRole('button', { name: 'Rotate placement', exact: true }).click()
  await terminal(page, 'f26').click()
  const rotatedPins = ['f26', 'f25', 'f24', 'f23', 'f22', 'f21', 'f20', 'e20', 'e21', 'e22', 'e23', 'e24', 'e25', 'e26']
  await expect.poll(async () => (await recovered(page))?.parts[1]?.pins).toEqual(rotatedPins)
  await expect(page.locator('[data-part="U2"] [data-pin]')).toHaveCount(14)
  await page.getByRole('button', { name: 'Select tool', exact: true }).click()
  const rotated = page.locator('[data-part="U2"]')
  await rotated.focus()
  await rotated.press('ArrowRight')
  const moved = ['f27', 'f26', 'f25', 'f24', 'f23', 'f22', 'f21', 'e21', 'e22', 'e23', 'e24', 'e25', 'e26', 'e27']
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
})
