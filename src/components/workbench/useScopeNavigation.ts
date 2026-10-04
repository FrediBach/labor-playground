import { useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import type { Capture } from '@/lib/simulation'
import { followCaptureFrame } from '@/lib/scopeTrace'
import { frameCapture } from '@/lib/trigger'

/** Ephemeral inspection state; never changes the saved circuit or recorded samples. */
export function useScopeNavigation({ capture, initialTimeScale, playbackTime, triggerTime, width, onSeek, onInspect }: {
  capture: Capture | null
  initialTimeScale: number
  playbackTime?: number
  triggerTime: number | null
  width: number
  onSeek?: (seconds: number) => void
  onInspect?: (seconds: number) => void
}) {
  const [timeScale, setTimeScale] = useState(initialTimeScale)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [manualWindow, setManualWindow] = useState<{ start: number } | null>(null)
  const pointerDrag = useRef<{ pointerId: number; mode: 'seek' | 'zoom'; start: number } | null>(null)
  const [zoomSelection, setZoomSelection] = useState<{ start: number; end: number } | null>(null)
  const requestedWindow = timeScale * 10 / 1000
  const captureStart = capture?.time[0] ?? 0
  const captureEnd = capture?.time.at(-1) ?? 0.1
  const captureDuration = captureEnd - captureStart
  const minimumWindow = Math.min(captureDuration, 0.00001)
  const initialFrame = useMemo(() => {
    if (!capture) return null
    const next = frameCapture(capture.time, requestedWindow, triggerTime)
    if (!next || !manualWindow) return next
    const start = Math.max(captureStart, Math.min(captureEnd - next.duration, manualWindow.start))
    return { start, end: start + next.duration, duration: next.duration }
  }, [capture, requestedWindow, triggerTime, manualWindow, captureStart, captureEnd])
  const [view, setView] = useState({ initialFrame, playbackTime, triggerTime, frame: initialFrame })
  // A trigger/timebase change deliberately reframes the trace. Subsequent
  // transport movement follows it only when the playhead leaves the view.
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
    const target = Math.max(captureStart, Math.min(captureEnd, seconds))
    onInspect?.(target)
    onSeek?.(target)
  }

  function showWindow(start: number, duration = windowSeconds) {
    if (!capture) return
    const boundedDuration = Math.max(minimumWindow, Math.min(captureDuration, duration))
    setTimeScale(boundedDuration * 100)
    setManualWindow({ start: Math.max(captureStart, Math.min(captureEnd - boundedDuration, start)) })
    setHoverTime(null)
  }

  function zoom(factor: number) {
    const anchor = hoverTime !== null && hoverTime >= windowStart && hoverTime <= windowEnd ? hoverTime
      : playbackTime !== undefined && playbackTime >= windowStart && playbackTime <= windowEnd ? playbackTime
        : windowStart + windowSeconds / 2
    const duration = Math.max(minimumWindow, Math.min(captureDuration, windowSeconds * factor))
    showWindow(anchor - (anchor - windowStart) / windowSeconds * duration, duration)
  }

  function pointerTime(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return windowStart + Math.max(0, Math.min(1, (event.clientX - rect.left - 34) / Math.max(1, rect.width - 46))) * windowSeconds
  }

  function startPointer(event: PointerEvent<HTMLCanvasElement>) {
    if (!capture || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    const seconds = pointerTime(event)
    pointerDrag.current = { pointerId: event.pointerId, mode: event.shiftKey ? 'zoom' : 'seek', start: seconds }
    setHoverTime(seconds)
    if (event.shiftKey) setZoomSelection({ start: seconds, end: seconds })
    else inspectTime(seconds)
  }

  function movePointer(event: PointerEvent<HTMLCanvasElement>) {
    if (!capture) return
    const seconds = pointerTime(event)
    setHoverTime(seconds)
    const drag = pointerDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.mode === 'zoom') setZoomSelection({ start: drag.start, end: seconds })
    else inspectTime(seconds)
  }

  function finishPointer(event: PointerEvent<HTMLCanvasElement>) {
    const drag = pointerDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    pointerDrag.current = null
    setZoomSelection(null)
    if (event.pointerType !== 'mouse') setHoverTime(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (event.type === 'pointerup' && drag.mode === 'zoom') {
      const end = pointerTime(event)
      if (Math.abs(end - drag.start) >= windowSeconds * 5 / Math.max(1, width - 46)) showWindow(Math.min(drag.start, end), Math.abs(end - drag.start))
    }
  }

  function navigateKey(event: KeyboardEvent<HTMLCanvasElement>) {
    if (!capture || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === '+' || event.key === '=' || event.key === '-') {
      event.preventDefault()
      zoom(event.key === '-' ? 2 : 0.5)
      return
    }
    if (event.key === 'Escape') { pointerDrag.current = null; setZoomSelection(null); setHoverTime(null); return }
    const step = windowSeconds / (event.shiftKey ? 10 : 100)
    const current = playbackTime ?? hoverTime ?? windowStart
    const target = event.key === 'Home' ? captureStart : event.key === 'End' ? captureEnd
      : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? current + step
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? current - step : null
    if (target !== null) {
      event.preventDefault()
      setHoverTime(null)
      inspectTime(target)
    }
  }

  function selectTimeScale(value: number) {
    setManualWindow(null)
    setHoverTime(null)
    setTimeScale(value)
  }

  function resetWindow() { setManualWindow(null) }
  function leavePointer() { if (!pointerDrag.current) setHoverTime(null) }

  return {
    timeScale, selectTimeScale, resetWindow, windowStart, windowEnd, windowSeconds,
    hoverTime, setHoverTime, cursor, zoomSelection, zoom, showWindow,
    startPointer, movePointer, finishPointer, leavePointer, navigateKey,
  }
}
