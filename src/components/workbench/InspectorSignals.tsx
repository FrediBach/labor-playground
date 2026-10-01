import { useMemo, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react'
import { Pause, Play, Waves } from 'lucide-react'
import { useRecording } from '@/lib/recording-context'
import { createInspectorTrace } from '@/lib/inspector-traces'
import { followCaptureFrame } from '@/lib/scopeTrace'
import { formatElectrical } from '@/lib/format-electrical'
import './InspectorSignals.css'

export interface InspectorSignal {
  id: string
  label: string
  detail: string
  node?: string
  referenceNode?: string
  color: string
  ariaLabel: string
  toggleLabel: string
  differential?: boolean
}

const PLOT = { left: 56, right: 268, top: 16, bottom: 138, width: 280, height: 164 }

function timeLabel(seconds: number) {
  return Math.abs(seconds) >= 1 ? `${Number(seconds.toFixed(3))} s` : `${Number((seconds * 1000).toFixed(2))} ms`
}

function axisVoltage(value: number) {
  if (Math.abs(value) < 1e-9) return '0 V'
  const small = Math.abs(value) < 0.1
  return `${Number((value * (small ? 1000 : 1)).toPrecision(2))} ${small ? 'mV' : 'V'}`
}

/** A node scope shares the recording clock, without allocating paths on every playback tick. */
export function InspectorSignals({ signals, children, wire = false }: { signals: InspectorSignal[]; children?: ReactNode; wire?: boolean }) {
  const { playback, seconds, playing, point } = useRecording()
  const capture = playback.capture
  const [hidden, setHidden] = useState(() => new Set(signals.filter(signal => signal.differential).map(signal => signal.id)))
  const [timeWindow, setTimeWindow] = useState('full')
  const traces = useMemo(() => signals.map(signal => ({
    ...signal,
    trace: signal.differential && signal.referenceNode === undefined ? null : createInspectorTrace(capture, signal.node, signal.referenceNode),
  })), [capture, signals])
  const available = traces.some(signal => signal.trace !== null)
  const duration = playback.end - playback.start
  const windowDuration = timeWindow === 'full' ? duration : Math.min(duration, Number(timeWindow))
  const initialFrame = useMemo(() => ({ start: playback.start, end: playback.start + windowDuration, duration: windowDuration }), [playback, windowDuration])
  const [view, setView] = useState({ initialFrame, frame: initialFrame })
  const baseFrame = view.initialFrame === initialFrame ? view.frame : initialFrame
  // Keep the right endpoint in the current view, including while dragging there.
  const frame = windowDuration > 0 ? followCaptureFrame(baseFrame, playback.start, playback.end, seconds) : initialFrame
  if (view.initialFrame !== initialFrame || view.frame !== frame) setView({ initialFrame, frame })
  const windowStart = frame.start, windowEnd = frame.end
  const chart = useMemo(() => {
    const visible = traces.filter(signal => !hidden.has(signal.id)).flatMap(signal => {
      const window = signal.trace?.window(windowStart, windowEnd)
      return window ? [{ ...signal, window }] : []
    })
    const min = Math.min(0, ...visible.map(signal => signal.window.min))
    const max = Math.max(0, ...visible.map(signal => signal.window.max))
    const padding = Math.max((max - min) * 0.1, 0.05)
    const lower = min - padding, upper = max + padding
    const y = (value: number) => PLOT.bottom - (value - lower) / (upper - lower) * (PLOT.bottom - PLOT.top)
    const x = (time: number) => PLOT.left + (time - windowStart) / (windowDuration || 1) * (PLOT.right - PLOT.left)
    return { lower, upper, y, x, visible: visible.map(signal => ({ ...signal, path: signal.window.points.map((p, index) => `${index ? 'L' : 'M'}${x(p.seconds).toFixed(2)},${y(p.voltage).toFixed(2)}`).join(' ') })) }
  }, [traces, hidden, windowStart, windowEnd, windowDuration])

  function seekFromPointer(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width * PLOT.width
    const fraction = Math.max(0, Math.min(1, (x - PLOT.left) / (PLOT.right - PLOT.left)))
    playback.seek(windowStart + fraction * windowDuration)
  }

  function seekFromKey(event: KeyboardEvent<HTMLDivElement>) {
    const step = windowDuration / (event.shiftKey ? 10 : 100)
    const target = event.key === 'Home' ? playback.start : event.key === 'End' ? playback.end
      : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? seconds + step
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? seconds - step : null
    if (target !== null) { event.preventDefault(); playback.seek(target) }
  }

  return <section className="inspector-section inspector-signals" aria-label={wire ? 'Wire recorded measurements' : 'Component recorded measurements'}>
    <div className="inspector-signals-heading"><h3><Waves size={15} />Signal history</h3><span className={`signal-status ${available ? 'ready' : ''}`}>{available ? 'RECORDED' : 'NO CAPTURE'}</span></div>
    {available ? <>
      <div className="signal-scope-toolbar"><span>Voltage <span className="signal-reference">/ GND</span></span><label>View<select aria-label="Inspector time window" value={Number(timeWindow) >= duration ? 'full' : timeWindow} onChange={event => setTimeWindow(event.target.value)}><option value="full">Full capture</option>{[0.001, 0.01, 0.05, 0.1, 0.5, 1].filter(value => value < duration).map(value => <option key={value} value={value}>{timeLabel(value)}</option>)}</select></label></div>
      <div className="signal-plot" role="slider" tabIndex={0} aria-label="Inspector recording cursor" aria-valuemin={playback.start} aria-valuemax={playback.end} aria-valuenow={seconds} aria-valuetext={`${(seconds * 1000).toFixed(3)} milliseconds`} onKeyDown={seekFromKey}
        onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); seekFromPointer(event) }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seekFromPointer(event) }}
        onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}>
        <svg viewBox={`0 0 ${PLOT.width} ${PLOT.height}`} role="img" aria-label="Voltage waveforms" data-window-start={windowStart} data-window-end={windowEnd}>
          <title>Recorded voltage over time. Select pin rows to show or hide traces.</title>
          <g className="signal-grid">{[0, 1, 2, 3, 4].map(index => <g key={index}><line x1={PLOT.left + index / 4 * (PLOT.right - PLOT.left)} x2={PLOT.left + index / 4 * (PLOT.right - PLOT.left)} y1={PLOT.top} y2={PLOT.bottom} /><line x1={PLOT.left} x2={PLOT.right} y1={PLOT.top + index / 4 * (PLOT.bottom - PLOT.top)} y2={PLOT.top + index / 4 * (PLOT.bottom - PLOT.top)} /></g>)}</g>
          <line className="signal-zero" x1={PLOT.left} x2={PLOT.right} y1={chart.y(0)} y2={chart.y(0)} />
          <g className="signal-axis"><text x={PLOT.left - 7} y={PLOT.top + 3} textAnchor="end">{axisVoltage(chart.upper)}</text><text x={PLOT.left - 7} y={PLOT.bottom + 3} textAnchor="end">{axisVoltage(chart.lower)}</text>{chart.y(0) > PLOT.top + 16 && chart.y(0) < PLOT.bottom - 16 && <text x={PLOT.left - 7} y={chart.y(0) + 3} textAnchor="end">0 V</text>}<text x={PLOT.left} y={155}>{timeLabel(windowStart)}</text><text x={PLOT.right} y={155} textAnchor="end">{timeLabel(windowEnd)}</text></g>
          {chart.visible.map(signal => <path key={signal.id} data-trace={signal.id} className="signal-trace" d={signal.path} stroke={signal.color} strokeDasharray={signal.differential ? '4 3' : undefined} />)}
          <line className="signal-cursor" data-testid="inspector-playhead" x1={chart.x(seconds)} x2={chart.x(seconds)} y1={PLOT.top} y2={PLOT.bottom} />
          <path className="signal-cursor-cap" d={`M${chart.x(seconds) - 3},8 h6 l-3,5 Z`} />
          {chart.visible.map(signal => { const value = signal.trace?.sampleAt(seconds); return value == null ? null : <circle key={signal.id} cx={chart.x(seconds)} cy={chart.y(value)} r={2.8} fill={signal.color} stroke="#18231f" strokeWidth={1.2} /> })}
          {!chart.visible.length && <text className="signal-chart-hint" x={155} y={80} textAnchor="middle">Choose a trace below</text>}
        </svg>
      </div>
      <div className="signal-position"><button type="button" aria-label={playing ? 'Pause inspector recording' : 'Play inspector recording'} title={playing ? 'Pause recording' : 'Play recording'} onClick={playing ? playback.pause : playback.play}>{playing ? <Pause size={13} /> : <Play size={13} />}</button><span>At cursor</span><output aria-label="Inspector recording time">{(seconds * 1000).toFixed(3)} <span>ms</span></output></div>
      <p className="signal-interaction-hint">Drag to inspect · select a row to toggle its trace</p>
    </> : <div className="signal-empty"><Waves size={26} /><strong>See how voltage changes</strong><p>Simulate the circuit to record pin and wire waveforms.</p></div>}
    {point && <div className="signal-readings">{traces.map(signal => {
      const visible = !hidden.has(signal.id)
      const value = signal.trace?.sampleAt(seconds)
      return <div key={signal.id} className={`signal-reading ${visible ? 'visible' : ''} ${signal.differential ? 'differential' : ''}`} style={{ '--signal-color': signal.color } as CSSProperties}>
        <button type="button" aria-label={signal.toggleLabel} aria-pressed={visible && !!signal.trace} disabled={!signal.trace} onClick={() => setHidden(previous => { const next = new Set(previous); if (next.has(signal.id)) next.delete(signal.id); else next.add(signal.id); return next })}>
          <span className="signal-swatch" /><span className="signal-name">{signal.label}<small>{signal.detail}</small></span>
        </button><output aria-label={signal.ariaLabel}>{formatElectrical(value, 'V')}</output>
      </div>
    })}</div>}
    {children}
  </section>
}
