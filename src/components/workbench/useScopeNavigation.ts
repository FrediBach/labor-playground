import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, PointerEvent, RefObject } from 'react'
import type { Capture } from '@/lib/simulation'
import { followCaptureFrame } from '@/lib/scopeTrace'
import { frameCapture } from '@/lib/trigger'

type VerticalView = { top: number; height: number }
type Viewport = { start: number; duration: number; vertical: VerticalView }
type Gesture = {
  pointerId: number; mode: 'seek' | 'zoom' | 'pan'; capture: Capture
  x: number; y: number; width: number; height: number; point: { x: number; y: number }
  view: Viewport; moved: boolean
}
const FULL_HEIGHT: VerticalView = { top: 0, height: 1 }
const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value))

/** Ephemeral inspection state; never changes the saved circuit or recorded samples. */
export function useScopeNavigation({ capture, initialTimeScale, playbackTime, triggerTime, canvas, onSeek, onInspect, onPause }: {
  capture: Capture | null
  initialTimeScale: number
  playbackTime?: number
  triggerTime: number | null
  canvas: RefObject<HTMLCanvasElement | null>
  onSeek?: (seconds: number) => void
  onInspect?: (seconds: number) => (() => void) | void
  onPause?: () => void
}) {
  const [timeScale, setTimeScale] = useState(initialTimeScale)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [manualWindow, setManualWindow] = useState<{ start: number } | null>(null)
  const [verticalView, setVerticalView] = useState(FULL_HEIGHT)
  const pointerDrag = useRef<Gesture | null>(null)
  const [zoomSelection, setZoomSelection] = useState<{ start: number; end: number; top: number; bottom: number } | null>(null)
  const history = useRef<{ capture: Capture; views: Viewport[] } | null>(null)
  const clicked = useRef<{ seconds?: number; restoreCursor?: (() => void) | void; capture: Capture } | null>(null)
  const pendingClick = useRef<number | null>(null)
  const heldSpace = useRef(false)
  const spaceControl = useRef(false)
  const spaceGestureUsed = useRef(false)
  const hovered = useRef(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [panning, setPanning] = useState(false)
  const requestedWindow = timeScale * 10 / 1000
  const captureStart = capture?.time[0] ?? 0
  const captureEnd = capture?.time.at(-1) ?? 0.1
  const captureDuration = captureEnd - captureStart
  const minimumWindow = Math.min(captureDuration, 0.00001)
  const initialFrame = useMemo(() => {
    if (!capture) return null
    const next = frameCapture(capture.time, requestedWindow, triggerTime)
    if (!next || !manualWindow) return next
    const start = clamp(manualWindow.start, captureStart, captureEnd - next.duration)
    return { start, end: start + next.duration, duration: next.duration }
  }, [capture, requestedWindow, triggerTime, manualWindow, captureStart, captureEnd])
  const [view, setView] = useState({ initialFrame, playbackTime, triggerTime, frame: initialFrame })
  // Timebase/trigger changes deliberately reframe; transport follows only when
  // its playhead leaves the view. A manual pan never seeks the recording.
  let frame = view.frame
  if (view.initialFrame !== initialFrame) {
    frame = initialFrame && !manualWindow && playbackTime !== undefined && view.triggerTime === triggerTime
      ? followCaptureFrame(initialFrame, captureStart, captureEnd, playbackTime) : initialFrame
    setView({ initialFrame, playbackTime, triggerTime, frame })
  } else if (view.playbackTime !== playbackTime) {
    frame = frame && playbackTime !== undefined ? followCaptureFrame(frame, captureStart, captureEnd, playbackTime) : frame
    setView({ initialFrame, playbackTime, triggerTime, frame })
  }
  const windowStart = frame?.start ?? 0
  const windowSeconds = frame?.duration ?? requestedWindow
  const windowEnd = frame?.end ?? windowStart + windowSeconds
  const cursor = capture && hoverTime !== null && hoverTime >= windowStart && hoverTime <= windowEnd ? (hoverTime - windowStart) / windowSeconds : null

  function inspectTime(seconds: number) {
    const target = clamp(seconds, captureStart, captureEnd)
    const restore = onInspect?.(target)
    onSeek?.(target)
    return restore
  }

  function showWindow(start: number, duration = windowSeconds) {
    if (!capture) return
    const boundedDuration = clamp(duration, minimumWindow, captureDuration)
    setTimeScale(boundedDuration * 100)
    setManualWindow({ start: clamp(start, captureStart, captureEnd - boundedDuration) })
    setHoverTime(null)
  }

  function zoom(factor: number) {
    const anchor = hoverTime !== null && hoverTime >= windowStart && hoverTime <= windowEnd ? hoverTime
      : playbackTime !== undefined && playbackTime >= windowStart && playbackTime <= windowEnd ? playbackTime
        : windowStart + windowSeconds / 2
    const duration = clamp(windowSeconds * factor, minimumWindow, captureDuration)
    showWindow(anchor - (anchor - windowStart) / windowSeconds * duration, duration)
  }

  function restoreView(previous: Viewport) {
    showWindow(previous.start, previous.duration)
    setVerticalView(previous.vertical)
  }

  function cancelGesture(restore = true) {
    const drag = pointerDrag.current
    pointerDrag.current = null
    pendingClick.current = null
    setZoomSelection(null)
    setPanning(false)
    setHoverTime(null)
    if (restore && drag?.capture === capture && drag.mode === 'pan') restoreView(drag.view)
    if (drag && canvas.current?.hasPointerCapture(drag.pointerId)) canvas.current.releasePointerCapture(drag.pointerId)
  }

  const spaceDown = useEffectEvent((event: globalThis.KeyboardEvent) => {
    const element = canvas.current
    if (!capture || !element?.clientWidth || !element.clientHeight) return
    if (event.code === 'Space' && !event.altKey && !event.ctrlKey && !event.metaKey
      && !(event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))
      && (hovered.current || event.target === element)) {
      if (!heldSpace.current) {
        spaceControl.current = event.target instanceof Element && !!event.target.closest('button, a[href], summary, [role="button"], [role="checkbox"], [role="tab"]')
        spaceGestureUsed.current = false
      }
      // Focused controls retain Space activation when no pan follows. A drag
      // consumes the key release instead, even when the canvas was unfocused.
      if (!spaceControl.current) event.preventDefault()
      heldSpace.current = true
      setSpaceHeld(true)
    }
    if (event.key === 'Escape' && pointerDrag.current) { event.preventDefault(); cancelGesture() }
  })
  const clearSpace = useEffectEvent(() => { heldSpace.current = false; setSpaceHeld(false) })
  const loseFocus = useEffectEvent(() => { clearSpace(); cancelGesture() })
  useEffect(() => {
    const spaceUp = (event: globalThis.KeyboardEvent) => {
      if (event.code !== 'Space' || !heldSpace.current) return
      if (!spaceControl.current || spaceGestureUsed.current) event.preventDefault()
      clearSpace()
    }
    window.addEventListener('keydown', spaceDown, true)
    window.addEventListener('keyup', spaceUp, true)
    window.addEventListener('blur', loseFocus)
    return () => {
      window.removeEventListener('keydown', spaceDown, true)
      window.removeEventListener('keyup', spaceUp, true)
      window.removeEventListener('blur', loseFocus)
    }
  }, [])

  function pointerPoint(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: clamp((event.clientX - rect.left - 34) / Math.max(1, rect.width - 46)), y: clamp((event.clientY - rect.top - 12) / Math.max(1, rect.height - 32)) }
  }

  function startPointer(event: PointerEvent<HTMLCanvasElement>) {
    if (!capture || event.button !== 0 || pointerDrag.current) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    onPause?.()
    const point = pointerPoint(event), rect = event.currentTarget.getBoundingClientRect()
    const mode = heldSpace.current ? 'pan' : event.shiftKey ? 'seek' : 'zoom'
    if (mode === 'pan') spaceGestureUsed.current = true
    pendingClick.current = null
    pointerDrag.current = { pointerId: event.pointerId, mode, capture, x: event.clientX, y: event.clientY, width: Math.max(1, rect.width - 46), height: Math.max(1, rect.height - 32), point, view: { start: windowStart, duration: windowSeconds, vertical: verticalView }, moved: false }
    setPanning(mode === 'pan')
    setHoverTime(mode === 'pan' ? null : windowStart + point.x * windowSeconds)
    if (mode === 'seek') inspectTime(windowStart + point.x * windowSeconds)
  }

  function movePointer(event: PointerEvent<HTMLCanvasElement>) {
    if (!capture) return
    const point = pointerPoint(event), drag = pointerDrag.current
    if (!drag) { setHoverTime(windowStart + point.x * windowSeconds); return }
    if (drag.capture !== capture) { cancelGesture(false); return }
    if (drag.pointerId !== event.pointerId) return
    drag.moved ||= Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= 5
    if (drag.mode === 'pan') {
      showWindow(drag.view.start - (event.clientX - drag.x) / drag.width * drag.view.duration, drag.view.duration)
      setVerticalView({ ...drag.view.vertical, top: clamp(drag.view.vertical.top - (event.clientY - drag.y) / drag.height * drag.view.vertical.height, 0, 1 - drag.view.vertical.height) })
      return
    }
    const seconds = drag.view.start + point.x * drag.view.duration
    setHoverTime(seconds)
    if (drag.mode === 'zoom' && drag.moved) setZoomSelection({ start: drag.view.start + drag.point.x * drag.view.duration, end: seconds, top: Math.min(drag.point.y, point.y), bottom: Math.max(drag.point.y, point.y) })
    else if (drag.mode === 'seek') inspectTime(seconds)
  }

  function finishPointer(event: PointerEvent<HTMLCanvasElement>) {
    const drag = pointerDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.type !== 'pointerup' || drag.capture !== capture) { cancelGesture(); return }
    pointerDrag.current = null
    setZoomSelection(null)
    setPanning(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (event.pointerType !== 'mouse') setHoverTime(null)
    if (drag.mode !== 'zoom') return
    const point = pointerPoint(event)
    if (!drag.moved) { pendingClick.current = drag.view.start + point.x * drag.view.duration; return }
    if (Math.abs(point.x - drag.point.x) * drag.width < 5) return
    if (history.current?.capture !== capture) history.current = { capture: capture!, views: [] }
    history.current.views.push(drag.view)
    if (history.current.views.length > 32) history.current.views.shift()
    showWindow(drag.view.start + Math.min(point.x, drag.point.x) * drag.view.duration, Math.abs(point.x - drag.point.x) * drag.view.duration)
    if (Math.abs(point.y - drag.point.y) * drag.height >= 5) {
      const height = Math.max(0.001, drag.view.vertical.height * Math.abs(point.y - drag.point.y))
      setVerticalView({ top: clamp(drag.view.vertical.top + Math.min(point.y, drag.point.y) * drag.view.vertical.height, 0, 1 - height), height })
    }
  }

  function clickPointer(event: MouseEvent<HTMLCanvasElement>) {
    const seconds = pendingClick.current
    pendingClick.current = null
    if (!capture || seconds === null || event.detail > 1) return
    clicked.current = { capture, seconds: playbackTime, restoreCursor: inspectTime(seconds) }
  }

  function doubleClick(event: MouseEvent<HTMLCanvasElement>) {
    if (!capture || event.button !== 0 || heldSpace.current || event.shiftKey) return
    event.preventDefault()
    // A native double-click includes a first single click. Restore that click's
    // inspection state so zooming does not silently move the recording/cursors.
    if (clicked.current?.capture === capture) {
      clicked.current.restoreCursor?.()
      if (clicked.current.seconds !== undefined) onSeek?.(clicked.current.seconds)
    }
    clicked.current = null
    const previous = history.current?.capture === capture ? history.current.views.pop() : undefined
    if (previous) restoreView(previous)
    else zoom(2)
  }

  function navigateKey(event: KeyboardEvent<HTMLCanvasElement>) {
    if (!capture || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === '+' || event.key === '=' || event.key === '-') { event.preventDefault(); zoom(event.key === '-' ? 2 : 0.5); return }
    if (event.key === 'Escape') { cancelGesture(); return }
    const step = windowSeconds / (event.shiftKey ? 10 : 100)
    const current = playbackTime ?? hoverTime ?? windowStart
    const target = event.key === 'Home' ? captureStart : event.key === 'End' ? captureEnd
      : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? current + step
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? current - step : null
    if (target !== null) { event.preventDefault(); setHoverTime(null); inspectTime(target) }
  }

  function selectTimeScale(value: number) { history.current = null; setManualWindow(null); setHoverTime(null); setTimeScale(value) }
  function resetWindow() { history.current = null; setManualWindow(null) }
  function resetVertical() { history.current = null; setVerticalView(FULL_HEIGHT) }
  function fitCapture() { resetVertical(); showWindow(captureStart, captureDuration) }
  function leavePointer() { hovered.current = false; if (!pointerDrag.current) setHoverTime(null) }
  function enterPointer() { hovered.current = true }

  return {
    timeScale, selectTimeScale, resetWindow, windowStart, windowEnd, windowSeconds,
    hoverTime, setHoverTime, cursor, zoomSelection, zoom, showWindow, fitCapture, verticalView, resetVertical, spaceHeld, panning,
    startPointer, movePointer, finishPointer, leavePointer, enterPointer, clickPointer, doubleClick, navigateKey,
  }
}
