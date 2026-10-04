import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import type { Capture } from '@/lib/simulation-types'
import type { AutomationEvent } from '@/lib/automations'
import type { PicoScopeChannel } from '@/lib/pico/scope-log'
import { createPicoScopeTrace } from '@/lib/pico/scope-trace'
import './PicoScopeLogs.css'

const COLORS = ['#bca7ec', '#92d6dd', '#e6b590', '#accb88', '#e19abd', '#a4b7e7', '#e0ce84', '#9ed1b5']
const LEFT = 34, RIGHT = 12, TOP = 12, BOTTOM = 74, HEIGHT = 98

function formatValue(value: number | null | undefined, unit: string) {
  if (value == null) return '—'
  const magnitude = Math.abs(value)
  const number = magnitude !== 0 && (magnitude >= 1e6 || magnitude < 0.001) ? value.toExponential(3) : value.toFixed(3)
  return `${number}${unit ? ` ${unit}` : ''}`
}

function axisLabel(value: number) {
  return Math.abs(value) >= 10000 || Math.abs(value) > 0 && Math.abs(value) < 0.01 ? value.toExponential(0) : String(Number(value.toPrecision(3)))
}

export function PicoScopeLogs({ capture, enabled = false, windowStart, windowEnd, seconds, onSeek, events, hoverTime, onHoverTime }: {
  capture: Capture | null
  enabled?: boolean
  windowStart: number
  windowEnd: number
  seconds: number
  onSeek?: (seconds: number) => void
  events: AutomationEvent[]
  hoverTime?: number | null
  onHoverTime?: (seconds: number | null) => void
}) {
  const [showLogs, setShowLogs] = useState(true)
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const logs = capture?.picoTrace?.scopeLogs ?? []
  if (!enabled && !capture?.picoTrace) return null
  return <section className="pico-scope-logs" aria-label="Pico scope logs">
    <div className="pico-log-controls"><label><input type="checkbox" checked={showLogs} onChange={event => setShowLogs(event.target.checked)} />Show Pico logs</label><span>{logs.length ? `${logs.length} series · shared time axis · separate scales` : 'Code values'}</span></div>
    {showLogs && (logs.length ? <>
      <div className="pico-log-legend">{logs.map((channel, index) => <button key={channel.name} type="button" style={{ '--log-color': COLORS[index % COLORS.length] } as CSSProperties} aria-label={`Toggle Pico log ${channel.name}`} aria-pressed={!hidden.has(channel.name)} onClick={() => setHidden(previous => { const next = new Set(previous); if (next.has(channel.name)) next.delete(channel.name); else next.add(channel.name); return next })}><i />{channel.name}{channel.unit && <small>{channel.unit}</small>}</button>)}</div>
      <p className="pico-log-note">Hover to compare · drag to scrub · values hold until the next log</p>
      <div className="pico-log-lanes">{logs.map((channel, index) => !hidden.has(channel.name) && <PicoLogLane key={channel.name} channel={channel} duration={capture!.picoTrace!.durationNs / 1e9} color={COLORS[index % COLORS.length]} windowStart={windowStart} windowEnd={windowEnd} seconds={seconds} onSeek={onSeek} events={events} hoverTime={hoverTime} onHoverTime={onHoverTime} />)}</div>
      {logs.every(channel => hidden.has(channel.name)) && <p className="pico-log-note">Select a series above to display its trace.</p>}
    </> : <p className="pico-log-empty">{enabled || capture?.picoTrace ? <>Use <code>scope.log("target", value, unit="V")</code> in Pico code, then Simulate to plot it here. No scope probe needed.</> : <>Add a Pico and use <code>scope.log()</code> to plot code values alongside your circuit.</>}</p>)}
  </section>
}

function PicoLogLane({ channel, duration, color, windowStart, windowEnd, seconds, onSeek, events, hoverTime, onHoverTime }: {
  channel: PicoScopeChannel; duration: number; color: string; windowStart: number; windowEnd: number; seconds: number; onSeek?: (seconds: number) => void; events: AutomationEvent[]; hoverTime?: number | null; onHoverTime?: (seconds: number | null) => void
}) {
  const canvas = useRef<HTMLDivElement>(null)
  const dragging = useRef<number | null>(null)
  const [width, setWidth] = useState(600)
  const [localHover, setLocalHover] = useState<number | null>(null)
  const inspectedTime = hoverTime === undefined ? localHover : hoverTime
  const changeHover = onHoverTime ?? setLocalHover
  useEffect(() => {
    if (!canvas.current) return
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width > LEFT + RIGHT) setWidth(entry.contentRect.width) })
    observer.observe(canvas.current)
    return () => observer.disconnect()
  }, [])
  const trace = useMemo(() => createPicoScopeTrace(channel, duration), [channel, duration])
  const chart = useMemo(() => {
    if (!trace) return null
    const x = (time: number) => LEFT + (time - windowStart) / (windowEnd - windowStart || 1) * (width - LEFT - RIGHT)
    const y = (value: number) => BOTTOM - trace.normalize(value) * (BOTTOM - TOP)
    const points = trace.window(windowStart, windowEnd, width - LEFT - RIGHT)
    return { x, y, min: trace.min, max: trace.max, path: points.map((point, index) => `${index ? 'L' : 'M'}${x(point.seconds).toFixed(2)},${y(point.value).toFixed(2)}`).join(' ') }
  }, [trace, width, windowStart, windowEnd])
  const value = trace?.sampleAt(seconds)
  const inspectedValue = inspectedTime == null ? null : trace?.sampleAt(inspectedTime)
  const hoverVisible = inspectedTime != null && inspectedTime >= windowStart && inspectedTime <= windowEnd
  const pointerTime = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const position = Math.max(0, Math.min(1, (event.clientX - rect.left - LEFT) / Math.max(1, rect.width - LEFT - RIGHT)))
    return windowStart + position * (windowEnd - windowStart)
  }
  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (event.pointerType !== 'mouse') changeHover(null)
  }
  const seekKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = (windowEnd - windowStart) / (event.shiftKey ? 10 : 100)
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? duration : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? seconds + step : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? seconds - step : null
    if (target !== null) { event.preventDefault(); event.stopPropagation(); onSeek?.(Math.max(0, Math.min(duration, target))) }
  }
  return <div className="pico-log-lane" style={{ '--log-color': color } as CSSProperties}>
    <div className="pico-log-lane-heading"><strong>{channel.name}<small>{channel.unit || 'unitless'}</small></strong><div>{hoverVisible && <span className="pico-log-hover-value">Hover <b>{formatValue(inspectedValue, channel.unit)}</b></span>}<output aria-label={`Pico log ${channel.name} value`} title={`At recording cursor · ${(seconds * 1000).toFixed(3)} ms`}>{formatValue(value, channel.unit)}</output></div></div>
    <div className="pico-log-plot" ref={canvas} role="slider" tabIndex={onSeek ? 0 : undefined} aria-label={`Pico log ${channel.name} recording cursor`} aria-disabled={!onSeek} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={seconds} aria-valuetext={`${(seconds * 1000).toFixed(3)} milliseconds; ${formatValue(value, channel.unit)}`} onKeyDown={seekKey} onPointerDown={event => {
      if (event.button !== 0 || !onSeek) return
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
      dragging.current = event.pointerId
      const time = pointerTime(event); changeHover(time); onSeek(time)
    }} onPointerMove={event => {
      const time = pointerTime(event); changeHover(time)
      if (dragging.current === event.pointerId) onSeek?.(time)
    }} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={() => { dragging.current = null }} onPointerLeave={() => { if (dragging.current === null) changeHover(null) }}>
      <svg viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={`Pico log ${channel.name} waveform`} data-window-start={windowStart} data-window-end={windowEnd}>
        <g className="pico-log-grid">{Array.from({ length: 11 }, (_, i) => <line key={i} x1={LEFT + i / 10 * (width - LEFT - RIGHT)} x2={LEFT + i / 10 * (width - LEFT - RIGHT)} y1={TOP} y2={BOTTOM} />)}{[TOP, (TOP + BOTTOM) / 2, BOTTOM].map(y => <line key={y} x1={LEFT} x2={width - RIGHT} y1={y} y2={y} />)}</g>
        {chart && <>
          <g className="pico-log-axis"><text x={LEFT - 5} y={chart.y(chart.max) + 3} textAnchor="end">{axisLabel(chart.max)}</text>{chart.min !== chart.max && <text x={LEFT - 5} y={chart.y(chart.min) + 3} textAnchor="end">{axisLabel(chart.min)}</text>}</g>
          <path className="pico-log-path" d={chart.path} data-log-trace={channel.name} />
          {events.map(event => <line key={`${event.automationId}-${event.time}`} className="pico-log-event" data-log-event={event.automationId} x1={chart.x(event.time)} x2={chart.x(event.time)} y1={TOP} y2={BOTTOM} />)}
          {seconds >= windowStart && seconds <= windowEnd && <><line className="pico-log-playhead" x1={chart.x(seconds)} x2={chart.x(seconds)} y1={TOP} y2={BOTTOM} />{value != null && <circle cx={chart.x(seconds)} cy={chart.y(value)} r={3} fill={color} />}</>}
          {hoverVisible && <><line className="pico-log-hover-line" x1={chart.x(inspectedTime)} x2={chart.x(inspectedTime)} y1={TOP} y2={BOTTOM} />{inspectedValue != null && <circle cx={chart.x(inspectedTime)} cy={chart.y(inspectedValue)} r={4} className="pico-log-hover-point" />}</>}
          {!chart.path && <text className="pico-log-hint" x={width / 2} y={45} textAnchor="middle">No samples yet in this time window</text>}
        </>}
        <g className="pico-log-axis"><text x={LEFT} y={92}>{Number((windowStart * 1000).toFixed(2))} ms</text><text x={width - RIGHT} y={92} textAnchor="end">{Number((windowEnd * 1000).toFixed(2))} ms</text></g>
      </svg>
      {hoverVisible && chart && <div className="pico-log-tooltip" data-testid="pico-log-tooltip" style={{ left: `clamp(6px, ${chart.x(inspectedTime) + 10}px, calc(100% - 210px))` }}><time>{(inspectedTime * 1000).toFixed(3)} ms</time><strong>{channel.name}: {formatValue(inspectedValue, channel.unit)}</strong><small>{inspectedValue == null ? 'No sample recorded yet' : 'Held from the last logged sample'}</small></div>}
    </div>
  </div>
}
