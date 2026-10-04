export interface ViewportSize { width: number; height: number }
export interface ViewportPoint { x: number; y: number }
export type BoardFit = 'breadboard' | 'workbench'

export const BOARD_ZOOM_MIN = 0.6
export const BOARD_ZOOM_MAX = 6
export const WORKBENCH_EXTENT = { x: 0, y: 0, width: 920, height: 550 } as const
export const BREADBOARD_EXTENT = { x: 46, y: 79, width: 828, height: 450 } as const

export function clampBoardZoom(value: number): number {
  return Number.isFinite(value) ? Math.max(BOARD_ZOOM_MIN, Math.min(BOARD_ZOOM_MAX, value)) : 1
}

export function boardViewportLayout(viewport: ViewportSize, zoom: number, workbenchWidth = WORKBENCH_EXTENT.width as number, workbenchHeight = WORKBENCH_EXTENT.height as number) {
  const width = Math.max(1, viewport.width)
  const height = Math.max(1, viewport.height)
  const baseScale = Math.min(width / workbenchWidth, height / workbenchHeight)
  const scale = baseScale * clampBoardZoom(zoom)
  const stageWidth = workbenchWidth * scale
  const stageHeight = workbenchHeight * scale
  return {
    width, height, baseScale, scale, stageWidth, stageHeight,
    contentWidth: Math.max(width, stageWidth),
    contentHeight: Math.max(height, stageHeight),
    left: Math.max(0, (width - stageWidth) / 2),
    top: Math.max(0, (height - stageHeight) / 2),
  }
}

export type BoardViewportLayout = ReturnType<typeof boardViewportLayout>

export function boardViewportCenter(layout: BoardViewportLayout, scroll: ViewportPoint): ViewportPoint {
  return {
    x: (scroll.x + layout.width / 2 - layout.left) / layout.scale,
    y: (scroll.y + layout.height / 2 - layout.top) / layout.scale,
  }
}

export function boardViewportScroll(layout: BoardViewportLayout, center: ViewportPoint): ViewportPoint {
  return {
    x: Math.max(0, Math.min(layout.contentWidth - layout.width, center.x * layout.scale + layout.left - layout.width / 2)),
    y: Math.max(0, Math.min(layout.contentHeight - layout.height, center.y * layout.scale + layout.top - layout.height / 2)),
  }
}

export function boardViewportFit(viewport: ViewportSize, mode: BoardFit, workbenchWidth = WORKBENCH_EXTENT.width as number, workbenchHeight = WORKBENCH_EXTENT.height as number, breadboardExtent: { x: number; y: number; width: number; height: number } = BREADBOARD_EXTENT) {
  const bounds = mode === 'breadboard' ? breadboardExtent : { ...WORKBENCH_EXTENT, width: workbenchWidth, height: workbenchHeight }
  const { baseScale } = boardViewportLayout(viewport, 1, workbenchWidth, workbenchHeight)
  return {
    zoom: clampBoardZoom(Math.min(viewport.width / bounds.width, viewport.height / bounds.height) / baseScale),
    center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
  }
}
