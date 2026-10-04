import assert from 'node:assert/strict'
import test from 'node:test'
import { BREADBOARD_EXTENT, boardViewportCenter, boardViewportFit, boardViewportLayout, boardViewportScroll, clampBoardZoom } from '../src/lib/board-viewport.ts'

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`)

test('workbench fit centers the complete source ports and board at 100% on different screens', () => {
  for (const size of [{ width: 760, height: 430 }, { width: 310, height: 300 }, { width: 1400, height: 270 }]) {
    const fit = boardViewportFit(size, 'workbench')
    assert.equal(fit.zoom, 1)
    const layout = boardViewportLayout(size, fit.zoom)
    assert.ok(layout.stageWidth <= size.width + 1e-8)
    assert.ok(layout.stageHeight <= size.height + 1e-8)
    assert.deepEqual(boardViewportScroll(layout, fit.center), { x: 0, y: 0 })
    close(boardViewportCenter(layout, { x: 0, y: 0 }).x, 460)
    close(boardViewportCenter(layout, { x: 0, y: 0 }).y, 275)
  }
})

test('breadboard fit computes its own scale and frames the breadboard bounds consistently', () => {
  for (const size of [{ width: 760, height: 430 }, { width: 310, height: 300 }, { width: 1400, height: 270 }]) {
    const fit = boardViewportFit(size, 'breadboard')
    const layout = boardViewportLayout(size, fit.zoom)
    const scroll = boardViewportScroll(layout, fit.center)
    assert.ok(fit.zoom > 1)
    assert.ok(BREADBOARD_EXTENT.width * layout.scale <= size.width + 1e-8)
    assert.ok(BREADBOARD_EXTENT.height * layout.scale <= size.height + 1e-8)
    const left = BREADBOARD_EXTENT.x * layout.scale + layout.left - scroll.x
    const top = BREADBOARD_EXTENT.y * layout.scale + layout.top - scroll.y
    assert.ok(left >= -1e-8 && top >= -1e-8)
    assert.ok(left + BREADBOARD_EXTENT.width * layout.scale <= size.width + 1e-8)
    assert.ok(top + BREADBOARD_EXTENT.height * layout.scale <= size.height + 1e-8)
  }
})

test('zoom preserves the visible center away from boundaries and clamps edge scrolling', () => {
  const before = boardViewportLayout({ width: 760, height: 430 }, 1.5)
  const center = boardViewportCenter(before, { x: 110, y: 120 })
  const after = boardViewportLayout({ width: 760, height: 430 }, 1.8)
  const restored = boardViewportCenter(after, boardViewportScroll(after, center))
  close(restored.x, center.x)
  close(restored.y, center.y)
  assert.deepEqual(boardViewportScroll(after, { x: -1000, y: -1000 }), { x: 0, y: 0 })
  assert.deepEqual(boardViewportScroll(after, { x: 10000, y: 10000 }), { x: after.contentWidth - after.width, y: after.contentHeight - after.height })
  assert.equal(clampBoardZoom(0), 0.6)
  assert.equal(clampBoardZoom(10), 6)
  assert.equal(clampBoardZoom(NaN), 1)
})


test('fit frames a wide, three-row board and its Pico dock', () => {
  const size = { width: 760, height: 300 }
  const board = { x: 46, y: 79, width: 1548, height: 1410 }
  for (const mode of ['breadboard', 'workbench'] as const) {
    const fit = boardViewportFit(size, mode, 1830, 1510, board)
    const layout = boardViewportLayout(size, fit.zoom, 1830, 1510)
    const scroll = boardViewportScroll(layout, fit.center)
    const bounds = mode === 'breadboard' ? board : { x: 0, y: 0, width: 1830, height: 1510 }
    const left = bounds.x * layout.scale + layout.left - scroll.x
    const top = bounds.y * layout.scale + layout.top - scroll.y
    assert.ok(left >= -1e-8 && top >= -1e-8)
    assert.ok(left + bounds.width * layout.scale <= size.width + 1e-8)
    assert.ok(top + bounds.height * layout.scale <= size.height + 1e-8)
  }
})
