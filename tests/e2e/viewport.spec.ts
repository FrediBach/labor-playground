import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

function viewport(page: Page) { return page.getByTestId('board-viewport') }
function terminal(page: Page, id: string) { return page.locator(`[data-terminal="${id}"]`) }
async function recovered(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('labor-playground.document.v1') ?? 'null'))
}
async function ready(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('status', { name: 'Simulation status', exact: true })).toHaveAttribute('data-state', 'ready', { timeout: 45_000 })
}
async function viewGeometry(page: Page) {
  return viewport(page).evaluate(element => {
    const bounds = element.getBoundingClientRect()
    const svg = element.querySelector('svg')!
    const matrix = svg.getScreenCTM()!
    const point = new DOMPoint(bounds.x + element.clientWidth / 2, bounds.y + element.clientHeight / 2).matrixTransform(matrix.inverse())
    return {
      x: element.scrollLeft, y: element.scrollTop,
      maxX: element.scrollWidth - element.clientWidth, maxY: element.scrollHeight - element.clientHeight,
      scale: matrix.a,
      center: { x: point.x, y: point.y },
    }
  })
}
async function zoomIn(page: Page, times = 4) {
  for (let step = 0; step < times; step++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
}
async function dragView(page: Page, button: 'left' | 'middle' = 'left', delta = { x: -70, y: -35 }) {
  const bounds = await viewport(page).boundingBox()
  const start = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down({ button })
  await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 5 })
  await page.mouse.up({ button })
}

test('fit frames the breadboard and workbench, and zoom keeps the visible center', async ({ page }) => {
  await ready(page)
  const original = await recovered(page)
  await expect(viewport(page)).toHaveAttribute('data-zoom', '1')
  const originalView = await viewGeometry(page)
  expect(originalView.maxX).toBeLessThanOrEqual(1)
  expect(originalView.maxY).toBeLessThanOrEqual(1)
  await zoomIn(page)
  const zoomed = await viewGeometry(page)
  expect(zoomed.maxY).toBeGreaterThan(100)
  // Native scroll positions round to CSS pixels. Four zoom steps may each
  // contribute half a pixel, so compare the resulting visible displacement.
  expect(Math.abs(zoomed.center.x - originalView.center.x) * zoomed.scale).toBeLessThanOrEqual(2)
  expect(Math.abs(zoomed.center.y - originalView.center.y) * zoomed.scale).toBeLessThanOrEqual(2)

  await page.getByRole('button', { name: 'Fit breadboard', exact: true }).click()
  expect(Number(await viewport(page).getAttribute('data-zoom'))).toBeGreaterThan(1)
  const boardFramed = await viewport(page).evaluate(element => {
    const bounds = element.getBoundingClientRect()
    const matrix = element.querySelector('svg')!.getScreenCTM()!
    const topLeft = new DOMPoint(46, 79).matrixTransform(matrix)
    const bottomRight = new DOMPoint(874, 529).matrixTransform(matrix)
    return topLeft.x >= bounds.left - 1 && topLeft.y >= bounds.top - 1
      && bottomRight.x <= bounds.left + element.clientWidth + 1 && bottomRight.y <= bounds.top + element.clientHeight + 1
  })
  expect(boardFramed).toBe(true)
  await page.getByRole('button', { name: 'Fit workbench', exact: true }).click()
  await expect(viewport(page)).toHaveAttribute('data-zoom', '1')
  expect((await viewGeometry(page)).y).toBe(0)
  await expect(terminal(page, 'eg')).toBeInViewport()
  await page.setViewportSize({ width: 1100, height: 900 })
  await page.getByRole('button', { name: 'Fit workbench', exact: true }).click()
  await expect.poll(async () => (await viewGeometry(page)).maxY).toBeLessThanOrEqual(1)
  await expect.poll(async () => (await viewGeometry(page)).maxX).toBeLessThanOrEqual(1)
  expect(await recovered(page)).toEqual(original)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
})

test('Pan, Space-drag and middle-button drag navigate without editing parts or history', async ({ page }) => {
  await ready(page)
  const original = await recovered(page)
  await zoomIn(page, 6)
  await page.getByRole('button', { name: 'Pan tool', exact: true }).click()
  const beforePan = await viewGeometry(page)
  await dragView(page)
  expect((await viewGeometry(page)).y).toBeGreaterThan(beforePan.y + 25)
  await viewport(page).focus()
  const beforeKey = await viewGeometry(page)
  await page.keyboard.press('ArrowUp')
  expect((await viewGeometry(page)).y).toBeLessThan(beforeKey.y - 40)
  await page.getByRole('button', { name: 'Pan tool', exact: true }).click()

  const beforeMiddle = await viewGeometry(page)
  await dragView(page, 'middle', { x: 30, y: 35 })
  expect((await viewGeometry(page)).y).toBeLessThan(beforeMiddle.y - 25)
  await page.locator('[data-part="C1"]').focus()
  const bounds = await viewport(page).boundingBox()
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
  const beforeSpace = await viewGeometry(page)
  await page.keyboard.down('Space')
  await dragView(page)
  await page.keyboard.up('Space')
  expect((await viewGeometry(page)).y).toBeGreaterThan(beforeSpace.y + 25)
  expect(await recovered(page)).toEqual(original)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
})

test('Escape restores a pan and releasing the mouse cannot place a wire or move a part', async ({ page }) => {
  await ready(page)
  const original = await recovered(page)
  await zoomIn(page, 5)
  await page.getByRole('button', { name: 'Pan tool', exact: true }).click()
  const before = await viewGeometry(page)
  const bounds = await viewport(page).boundingBox()
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds!.x + bounds!.width / 2 - 100, bounds!.y + bounds!.height / 2 - 60, { steps: 5 })
  expect((await viewGeometry(page)).y).toBeGreaterThan(before.y + 50)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(page.getByRole('button', { name: 'Pan tool', exact: true })).toHaveAttribute('aria-pressed', 'false')
  const after = await viewGeometry(page)
  expect(after.x).toBeCloseTo(before.x, 1)
  expect(after.y).toBeCloseTo(before.y, 1)
  expect(await recovered(page)).toEqual(original)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
})

test('Space still connects focused holes with the pointer inside the board', async ({ page }) => {
  await ready(page)
  await page.getByRole('button', { name: 'Wire tool', exact: true }).click()
  await terminal(page, 'b1').hover()
  await terminal(page, 'b1').focus()
  await page.keyboard.press('Space')
  await terminal(page, 'b5').focus()
  await page.keyboard.press('Space')
  await expect.poll(async () => (await recovered(page)).wires.length).toBe(4)
  expect((await recovered(page)).wires.at(-1)).toMatchObject({ from: 'b1', to: 'b5' })
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(async () => (await recovered(page)).wires.length).toBe(3)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
})

test('ordinary wheel scrolls a zoomed board and chains to the page when the board fits', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await ready(page)
  await viewport(page).hover()
  const pageBefore = await page.evaluate(() => window.scrollY)
  await page.mouse.wheel(0, 140)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(pageBefore)
  await zoomIn(page, 5)
  await viewport(page).hover()
  const boardBefore = await viewGeometry(page)
  const pageBeforePan = await page.evaluate(() => window.scrollY)
  await page.mouse.wheel(0, 60)
  await expect.poll(async () => (await viewGeometry(page)).y).toBeGreaterThan(boardBefore.y + 40)
  expect(await page.evaluate(() => window.scrollY)).toBe(pageBeforePan)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
})
