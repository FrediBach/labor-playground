import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

function terminal(page: Page, id: string) { return page.locator(`[data-terminal="${id}"]`) }
function inspector(page: Page) { return page.getByRole('complementary', { name: 'Inspector' }) }
async function recovered(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('labor-playground.document.v1') ?? 'null'))
}
async function ready(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('status', { name: 'Simulation status', exact: true })).toHaveAttribute('data-state', 'ready', { timeout: 45_000 })
}

test('shortening a legacy resistor lead previews beneath its body and commits one reversible edit', async ({ page }) => {
  await ready(page)
  const original = await recovered(page)
  await page.locator('[data-part="R1"]').focus()
  await inspector(page).getByRole('button', { name: 'Move R1 lead 1', exact: true }).click()
  // A9 lies under the existing resistor's transparent hit area.
  await terminal(page, 'a9').hover()
  await expect(page.locator('[data-lead-preview="valid"]')).toBeVisible()
  expect(await recovered(page)).toEqual(original)
  await expect(page.getByRole('status', { name: 'Simulation status', exact: true })).toHaveAttribute('data-state', 'ready')
  await terminal(page, 'a9').click()
  await expect.poll(async () => (await recovered(page)).parts[0].pins).toEqual(['a9', 'a17'])
  const changed = await recovered(page)
  expect(changed.parts[0].value).toBe(original.parts[0].value)
  expect(changed.wires).toEqual(original.wires)
  expect(changed.probes).toEqual(original.probes)
  await expect(page.locator('[data-lead-preview]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(async () => (await recovered(page)).parts[0].pins).toEqual(['a6', 'a17'])
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect.poll(async () => (await recovered(page)).parts[0].pins).toEqual(['a9', 'a17'])
  await page.reload()
  await expect(page.locator('[data-part="R1"]')).toBeVisible()
  expect((await recovered(page)).parts[0].pins).toEqual(['a9', 'a17'])
})

test('lead editing rejects ports, occupied and duplicate holes, and excessive spacing without changing the circuit', async ({ page }) => {
  await ready(page)
  const original = await recovered(page)
  await inspector(page).getByRole('button', { name: 'Move C1 lead 2', exact: true }).click()
  for (const [hole, explanation] of [
    ['gnd', 'instrument ports'], ['e17', 'separate holes'],
    ['a1', '1 and 8'], ['a17', 'occupied'],
  ]) {
    await terminal(page, hole).hover()
    await expect(page.locator('[data-lead-preview="invalid"]')).toBeVisible()
    await terminal(page, hole).click()
    await expect(page.locator('.toast')).toContainText(explanation)
    expect(await recovered(page)).toEqual(original)
  }
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-lead-preview]')).toHaveCount(0)
  await expect(inspector(page).getByRole('heading', { name: 'Capacitor', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
})

test('keyboard lead handles preserve capacitor polarity and cancel when the tool or document changes', async ({ page }) => {
  await ready(page)
  await page.getByRole('combobox', { name: 'Load example' }).selectOption('capacitor-charge')
  await expect(inspector(page).getByRole('heading', { name: 'Electrolytic capacitor', exact: true })).toBeVisible()
  const handle = page.locator('[data-lead-handle="C1-0"]')
  await handle.focus()
  await handle.press('Enter')
  await expect(terminal(page, 'e17')).toBeFocused()
  await terminal(page, 'e17').press('ArrowRight')
  await expect(terminal(page, 'e18')).toBeFocused()
  await terminal(page, 'e18').press('Enter')
  await expect.poll(async () => (await recovered(page)).parts[1].pins).toEqual(['e18', 'f17'])
  expect((await recovered(page)).parts[1]).toMatchObject({ kind: 'electrolytic', value: 1e-6 })
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(async () => (await recovered(page)).parts[1].pins).toEqual(['e17', 'f17'])

  await inspector(page).getByRole('button', { name: 'Move C1 lead +', exact: true }).click()
  await expect(page.locator('[data-lead-preview]')).toBeVisible()
  await inspector(page).getByRole('button', { name: '2.2', exact: true }).click()
  await expect(page.locator('[data-lead-preview]')).toHaveCount(0)
  await expect.poll(async () => (await recovered(page)).parts[1].value).toBe(2.2e-6)
  expect((await recovered(page)).parts[1].pins).toEqual(['e17', 'f17'])

  await inspector(page).getByRole('button', { name: 'Move C1 lead +', exact: true }).click()
  await page.getByRole('button', { name: 'Wire tool', exact: true }).click()
  await expect(page.locator('[data-lead-preview]')).toHaveCount(0)
  await terminal(page, 'b20').click()
  await terminal(page, 'b21').click()
  await expect.poll(async () => (await recovered(page)).wires.length).toBe(4)
  expect((await recovered(page)).parts[1].pins).toEqual(['e17', 'f17'])
})

test('Escape cancels a lead edit and a scope resize in their respective tabs', async ({ page }) => {
  await ready(page)
  const original = await recovered(page)
  await inspector(page).getByRole('button', { name: 'Move C1 lead 2', exact: true }).click()
  await expect(page.locator('[data-lead-preview]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-lead-preview]')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Results', exact: true }).click()
  const resizer = page.getByRole('separator', { name: 'Scope height', exact: true })
  const height = Number(await resizer.getAttribute('aria-valuenow'))
  await resizer.scrollIntoViewIfNeeded()
  const bounds = await resizer.boundingBox()
  expect(bounds).not.toBeNull()
  const x = bounds!.x + bounds!.width / 2, y = bounds!.y + bounds!.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + 50, { steps: 5 })
  await expect.poll(async () => Number(await resizer.getAttribute('aria-valuenow'))).toBeGreaterThan(height + 30)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(resizer).toHaveAttribute('aria-valuenow', String(height))
  await expect(page.locator('[data-lead-preview]')).toHaveCount(0)
  expect(await recovered(page)).toEqual(original)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
})
