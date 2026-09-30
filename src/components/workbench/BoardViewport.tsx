import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'
import { boardViewportCenter, boardViewportFit, boardViewportLayout, boardViewportScroll, clampBoardZoom } from '@/lib/board-viewport'
import type { BoardFit, BoardViewportLayout, ViewportPoint, ViewportSize } from '@/lib/board-viewport'
import './BoardViewport.css'

export interface BoardViewportHandle {
  zoomTo: (zoom: number) => void
  fit: (mode: BoardFit) => void
}

interface BoardViewportProps {
  zoom: number
  workbenchWidth?: number
  onZoomChange: (zoom: number) => void
  panEnabled: boolean
  onPanEnabledChange?: (enabled: boolean) => void
  children: ReactNode
}

interface PanGesture {
  pointerId: number
  clientX: number
  clientY: number
  scroll: ViewportPoint
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable="true"]')
}

/** View changes stay outside the circuit document and its undo history. */
export const BoardViewport = forwardRef<BoardViewportHandle, BoardViewportProps>(function BoardViewport({ workbenchWidth = 920, zoom, onZoomChange, panEnabled, onPanEnabledChange, children }, ref) {
  const viewport = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<ViewportSize>({ width: 920, height: 550 })
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [positionVersion, setPositionVersion] = useState(0)
  const gesture = useRef<PanGesture | null>(null)
  const heldSpace = useRef(false)
  const spaceActivation = useRef<Element | null>(null)
  const spaceGestureUsed = useRef(false)
  const replayingSpace = useRef(false)
  const hovered = useRef(false)
  const suppressClick = useRef(false)
  const blockedPointer = useRef<number | null>(null)
  const pendingCenter = useRef<ViewportPoint | null>(null)
  const previousLayout = useRef<BoardViewportLayout | null>(null)
  const scroll = useRef<ViewportPoint>({ x: 0, y: 0 })
  const layout = useMemo(() => boardViewportLayout(size, zoom, workbenchWidth), [size, zoom, workbenchWidth])

  const position = useCallback((next: ViewportPoint) => {
    const element = viewport.current
    if (!element) return
    element.scrollLeft = next.x
    element.scrollTop = next.y
    scroll.current = { x: element.scrollLeft, y: element.scrollTop }
  }, [])

  useLayoutEffect(() => {
    const element = viewport.current!
    const measure = () => {
      const next = { width: element.clientWidth, height: element.clientHeight }
      if (!next.width || !next.height) return
      setSize(previous => previous.width === next.width && previous.height === next.height ? previous : next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const previous = previousLayout.current
    const center = pendingCenter.current ?? (previous ? boardViewportCenter(previous, scroll.current) : { x: 460, y: 275 })
    position(boardViewportScroll(layout, center))
    previousLayout.current = layout
    pendingCenter.current = null
  }, [layout, position, positionVersion])

  useImperativeHandle(ref, () => ({
    zoomTo(next) {
      const element = viewport.current
      pendingCenter.current = boardViewportCenter(layout, element ? { x: element.scrollLeft, y: element.scrollTop } : scroll.current)
      onZoomChange(clampBoardZoom(next))
      setPositionVersion(version => version + 1)
    },
    fit(mode) {
      const fit = boardViewportFit(size, mode, workbenchWidth)
      pendingCenter.current = fit.center
      onZoomChange(fit.zoom)
      setPositionVersion(version => version + 1)
    },
  }), [layout, onZoomChange, size, workbenchWidth])

  const finishPan = useCallback((cancelled: boolean) => {
    const active = gesture.current
    if (!active) return
    gesture.current = null
    if (cancelled) position(active.scroll)
    setDragging(false)
    const element = viewport.current
    if (element?.hasPointerCapture(active.pointerId)) element.releasePointerCapture(active.pointerId)
    suppressClick.current = true
    if (!cancelled) window.setTimeout(() => { suppressClick.current = false }, 0)
  }, [position])

  useEffect(() => {
    const keyDown = (event: globalThis.KeyboardEvent) => {
      if (heldSpace.current && event.code !== 'Space') spaceActivation.current = null
      const target = event.target instanceof Element ? event.target : null
      const inside = !!target && !!viewport.current?.contains(target)
      const interactive = target?.closest('button, a[href], summary, [role="button"]')
      if (event.code === 'Space' && !replayingSpace.current && !event.altKey && !event.ctrlKey && !event.metaKey && !isEditable(target)
        && !(interactive && !inside) && (hovered.current || inside)) {
        event.preventDefault()
        event.stopPropagation()
        if (!heldSpace.current) {
          // Space still activates a focused board terminal when released without a drag.
          spaceActivation.current = !panEnabled && inside ? interactive ?? null : null
          spaceGestureUsed.current = false
        }
        heldSpace.current = true
        setSpaceHeld(true)
      }
      if (event.key === 'Escape') {
        finishPan(true)
        heldSpace.current = false
        spaceActivation.current = null
        setSpaceHeld(false)
        if (panEnabled) onPanEnabledChange?.(false)
      }
    }
    const keyUp = (event: globalThis.KeyboardEvent) => {
      if (event.code !== 'Space' || !heldSpace.current) return
      event.preventDefault()
      event.stopPropagation()
      heldSpace.current = false
      setSpaceHeld(false)
      const activation = spaceActivation.current
      spaceActivation.current = null
      if (spaceGestureUsed.current || !activation?.isConnected || document.activeElement !== activation) return
      if (activation instanceof HTMLElement) activation.click()
      else {
        replayingSpace.current = true
        activation.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }))
        replayingSpace.current = false
      }
    }
    const blur = () => { finishPan(true); heldSpace.current = false; spaceActivation.current = null; setSpaceHeld(false) }
    window.addEventListener('keydown', keyDown, true)
    window.addEventListener('keyup', keyUp, true)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', keyDown, true)
      window.removeEventListener('keyup', keyUp, true)
      window.removeEventListener('blur', blur)
    }
  }, [finishPan, onPanEnabledChange, panEnabled])

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!gesture.current) { blockedPointer.current = null; suppressClick.current = false }
    if (event.button !== 1 && !(event.button === 0 && (panEnabled || heldSpace.current))) return
    event.preventDefault()
    event.stopPropagation()
    if (heldSpace.current) spaceGestureUsed.current = true
    const element = event.currentTarget
    element.focus({ preventScroll: true })
    element.setPointerCapture(event.pointerId)
    blockedPointer.current = event.pointerId
    gesture.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, scroll: { x: element.scrollLeft, y: element.scrollTop } }
    setDragging(true)
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    position({ x: active.scroll.x - (event.clientX - active.clientX), y: active.scroll.y - (event.clientY - active.clientY) })
  }

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!(panEnabled || heldSpace.current) || isEditable(event.target)) return
    const amount = event.shiftKey ? 160 : 48
    const delta: Record<string, ViewportPoint> = {
      ArrowLeft: { x: -amount, y: 0 }, ArrowRight: { x: amount, y: 0 },
      ArrowUp: { x: 0, y: -amount }, ArrowDown: { x: 0, y: amount },
    }
    if (!delta[event.key]) return
    event.preventDefault()
    event.stopPropagation()
    position({ x: scroll.current.x + delta[event.key].x, y: scroll.current.y + delta[event.key].y })
  }

  return <div
    ref={viewport} className="breadboard-viewport board-viewport" role="region" aria-label="Breadboard view" tabIndex={0}
    aria-description="Scroll to pan a zoomed board. Hold Space and drag, use the middle mouse button, or turn on Pan. In Pan mode, arrow keys move the view. Escape cancels a pan."
    data-testid="board-viewport" data-pan={panEnabled || spaceHeld} data-dragging={dragging} data-zoom={zoom}
    onPointerEnter={() => { hovered.current = true }} onPointerLeave={() => { hovered.current = false }}
    onPointerDownCapture={pointerDown} onPointerMoveCapture={pointerMove}
    onPointerUpCapture={event => {
      if (blockedPointer.current !== event.pointerId) return
      blockedPointer.current = null
      event.preventDefault(); event.stopPropagation(); finishPan(false)
      suppressClick.current = true
      window.setTimeout(() => { suppressClick.current = false }, 0)
    }}
    onPointerCancelCapture={event => { if (gesture.current) { event.stopPropagation(); finishPan(true) } }}
    onLostPointerCapture={() => { if (gesture.current) finishPan(true) }}
    onClickCapture={event => {
      if (!suppressClick.current && !panEnabled && !heldSpace.current) return
      event.preventDefault(); event.stopPropagation(); suppressClick.current = false
    }}
    onAuxClickCapture={event => { if (event.button === 1) { event.preventDefault(); event.stopPropagation() } }}
    onKeyDownCapture={keyboard}
    onScroll={event => { scroll.current = { x: event.currentTarget.scrollLeft, y: event.currentTarget.scrollTop } }}
  >
    <div className="board-viewport-space" style={{ width: layout.contentWidth, height: layout.contentHeight }}>
      <div className="board-viewport-stage" data-testid="board-stage" style={{ width: layout.stageWidth, height: layout.stageHeight, left: layout.left, top: layout.top }}>
        {children}
      </div>
    </div>
  </div>
})
