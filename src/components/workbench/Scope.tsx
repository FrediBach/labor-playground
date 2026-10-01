import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Crosshair, Maximize2, Waves } from 'lucide-react'
import type { Capture } from '@/lib/simulation'
import { measureTrace } from '@/lib/measurements'
import { createScopeTrace, followCaptureFrame } from '@/lib/scopeTrace'
import { findTriggerCrossing, frameCapture, type TriggerEdge } from '@/lib/trigger'
import { ScopeResizer } from './ScopeResizer'
import './Scope.css'

type Channel = 'CH1' | 'CH2'
const COLORS = { CH1: '#aee3d5', CH2: '#f2c46d' }
export function Scope({ capture: suppliedCapture, status, probes, onProbe, onHighlight, stimulus = 'periodic', defaultScale = 1, defaultTimeScale, audioControls, playbackTime, onSeek }: {
  capture: Capture | null
  status: string
  probes: Record<Channel, string | null>
  onProbe: (channel: Channel) => void
  onHighlight?: (channel: Channel) => void
  stimulus?: 'periodic' | 'step'
  defaultScale?: number
  defaultTimeScale?: number
  audioControls?: ReactNode
  playbackTime?: number
  onSeek?: (seconds: number) => void
}) {
  // Measurements and physical probe labels must refer to the same circuit.
  const capture = status === 'ready' ? suppliedCapture : null
  const hasProbe = Boolean(probes.CH1 || probes.CH2)
  const busy = status === 'loading' || status === 'calculating'
  const emptyTitle = busy ? 'Simulating your circuit…'
    : status === 'invalid' ? 'Check your circuit connections'
      : status === 'error' ? 'Simulation needs attention'
        : !hasProbe ? 'Attach a scope probe'
          : 'Ready to simulate'
  const emptyHint = busy ? 'The waveform will appear here when the simulation finishes.'
    : status === 'invalid' || status === 'error' ? 'See Circuit status in the inspector for details.'
      : !hasProbe ? 'Choose Attach for CH1 or CH2 below, select a terminal, then Simulate.'
        : 'Select Simulate in the top bar to capture a waveform.'
  const canvas = useRef<HTMLCanvasElement>(null)
  const [timeScale, setTimeScale] = useState(defaultTimeScale ?? (stimulus === 'step' ? 10 : 2))
  const [scales, setScales] = useState({ CH1: defaultScale, CH2: defaultScale })
  const [cursor, setCursor] = useState<number | null>(null)
  const [measurementsOpen, setMeasurementsOpen] = useState(false)
  const [cursorSeconds, setCursorSeconds] = useState({ A: 0.002, B: 0.007 })
  const [activeCursor, setActiveCursor] = useState<'A' | 'B'>('A')
  const [meterPosition, setMeterPosition] = useState<'mean' | 'A' | 'B'>('mean')
  const [visible, setVisible] = useState({ CH1: true, CH2: true })
  const [triggerSource, setTriggerSource] = useState<'off' | Channel>('off')
  const [triggerEdge, setTriggerEdge] = useState<TriggerEdge>('rising')
  const [triggerLevel, setTriggerLevel] = useState(0)
  const [triggerLevelDraft, setTriggerLevelDraft] = useState('0')
  const [size, setSize] = useState({ width: 600, height: 170 })
  const [scopeHeight, setScopeHeight] = useState<number | undefined>()
  const requestedWindow = timeScale * 10 / 1000
  const captureStart = capture?.time[0] ?? 0
  const captureEnd = capture?.time.at(-1) ?? 0.1
  const triggerProbe = triggerSource !== 'off' ? probes[triggerSource] : null
  const triggerTime = useMemo(() => capture && triggerSource !== 'off' && triggerProbe
    ? findTriggerCrossing(capture.time, capture.channels[triggerSource], { edge: triggerEdge, level: triggerLevel }) : null,
  [capture, triggerSource, triggerEdge, triggerLevel, triggerProbe])
  const initialFrame = useMemo(() => capture ? frameCapture(capture.time, requestedWindow, triggerTime) : null, [capture, requestedWindow, triggerTime])
  const [view, setView] = useState({ initialFrame, playbackTime, triggerTime, frame: initialFrame })
  // A trigger/timebase change deliberately reframes the trace. Subsequent
  // transport movement follows it only when the playhead leaves the view.
  let frame = view.frame
  if (view.initialFrame !== initialFrame) {
    frame = initialFrame && playbackTime !== undefined && view.triggerTime === triggerTime
      ? followCaptureFrame(initialFrame, captureStart, captureEnd, playbackTime) : initialFrame
    setView({ initialFrame, playbackTime, triggerTime, frame })
  } else if (view.playbackTime !== playbackTime) {
    frame = frame && playbackTime !== undefined ? followCaptureFrame(frame, captureStart, captureEnd, playbackTime) : frame
    setView({ initialFrame, playbackTime, triggerTime, frame })
  }
  const windowStart = frame?.start ?? 0
  const windowSeconds = frame?.duration ?? requestedWindow
  const windowEnd = frame?.end ?? windowStart + windowSeconds
  const cursorA = Math.max(captureStart, Math.min(captureEnd, cursorSeconds.A))
  const cursorB = Math.max(captureStart, Math.min(captureEnd, cursorSeconds.B))
  const traces = useMemo(() => ({
    CH1: capture && probes.CH1 ? createScopeTrace(capture.time, capture.channels.CH1) : null,
    CH2: capture && probes.CH2 ? createScopeTrace(capture.time, capture.channels.CH2) : null,
  }), [capture, probes.CH1, probes.CH2])
  const measurements = useMemo(() => ({
    CH1: capture && probes.CH1 ? measureTrace(capture.time, capture.channels.CH1, stimulus) : null,
    CH2: capture && probes.CH2 ? measureTrace(capture.time, capture.channels.CH2, stimulus) : null,
  }), [capture, probes.CH1, probes.CH2, stimulus])
  const cursorVoltages = useMemo(() => ({
    CH1: {
      A: traces.CH1?.sampleAt(cursorA) ?? null,
      B: traces.CH1?.sampleAt(cursorB) ?? null,
    },
    CH2: {
      A: traces.CH2?.sampleAt(cursorA) ?? null,
      B: traces.CH2?.sampleAt(cursorB) ?? null,
    },
  }), [traces, cursorA, cursorB])
  const firstVoltage = meterPosition === 'mean' ? measurements.CH1?.mean : cursorVoltages.CH1[meterPosition]
  const secondVoltage = meterPosition === 'mean' ? measurements.CH2?.mean : cursorVoltages.CH2[meterPosition]
  const differential = firstVoltage == null || secondVoltage == null ? null : firstVoltage - secondVoltage

  useEffect(() => {
    if (!canvas.current) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(canvas.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const context = element.getContext('2d')
    if (!context) return
    const { width, height } = size
    const dpr = window.devicePixelRatio || 1
    element.width = width * dpr
    element.height = height * dpr
    context.scale(dpr, dpr)
    context.clearRect(0, 0, width, height)
    const left = 34, right = width - 12, top = 12, bottom = height - 20
    const w = right - left, h = bottom - top, middle = top + h / 2
    context.font = '11px monospace'
    context.lineWidth = 1
    for (let i = 0; i <= 10; i++) {
      const x = left + w * i / 10
      context.strokeStyle = '#343a38'
      context.beginPath(); context.moveTo(x, top); context.lineTo(x, bottom); context.stroke()
      if (i % 2 === 0) {
        context.fillStyle = '#a7b0a9'
        context.textAlign = i === 10 ? 'right' : i === 0 ? 'left' : 'center'
        const milliseconds = (windowStart + i / 10 * windowSeconds) * 1000
        context.fillText(`${Number(milliseconds.toFixed(2))}`, x, height - 5)
      }
    }
    for (let i = 0; i <= 6; i++) {
      const y = top + h * i / 6
      context.strokeStyle = i === 3 ? '#69706a' : '#343a38'
      context.setLineDash(i === 3 ? [3, 4] : [])
      context.beginPath(); context.moveTo(left, y); context.lineTo(right, y); context.stroke()
    }
    context.setLineDash([])
    context.textAlign = 'left'
    context.fillStyle = '#a7b0a9'; context.fillText('0 V', 5, middle + 3); context.fillText('ms', 5, height - 5)
    if (capture?.time.length) {
      context.save()
      context.beginPath(); context.rect(left, top, w, h); context.clip()
      for (const channel of ['CH1', 'CH2'] as const) {
        const trace = traces[channel]
        if (!visible[channel] || !trace) continue
        context.strokeStyle = COLORS[channel]
        context.lineWidth = 1.65
        context.beginPath()
        // Preserve each screen column's extrema, including narrow solver pulses.
        let started = false
        const startVoltage = trace.sampleAt(windowStart)
        if (startVoltage !== null) { context.moveTo(left, middle - startVoltage / scales[channel] * h / 6); started = true }
        const envelope = trace.envelope(windowStart, windowEnd, w)
        for (let pixel = 0; pixel < envelope.length; pixel++) {
          const extrema = envelope[pixel]
          if (!extrema) continue
          const x = left + pixel
          const y1 = middle - extrema.min / scales[channel] * h / 6
          const y2 = middle - extrema.max / scales[channel] * h / 6
          if (!started) { context.moveTo(x, y1); started = true } else context.lineTo(x, y1)
          context.lineTo(x, y2)
        }
        const endVoltage = trace.sampleAt(windowEnd)
        if (endVoltage !== null) context.lineTo(right, middle - endVoltage / scales[channel] * h / 6)
        context.stroke()
      }
      context.restore()
    }
    if (triggerTime !== null && triggerTime >= windowStart && triggerTime <= windowEnd) {
      const x = left + (triggerTime - windowStart) / windowSeconds * w
      context.strokeStyle = '#9db7d5'; context.setLineDash([2, 4])
      context.beginPath(); context.moveTo(x, top); context.lineTo(x, bottom); context.stroke()
      context.setLineDash([]); context.fillStyle = '#b9cee6'; context.fillText('T', Math.min(right - 8, x + 4), top + 10)
    }
  }, [capture, traces, scales, size, visible, windowStart, windowSeconds, windowEnd, triggerTime])

  function measurement(channel: Channel) {
    const values = capture?.channels[channel]
    if (!probes[channel]) return 'No probe attached'
    if (status !== 'ready') return busy ? 'Simulating…' : 'Simulate to update'
    if (!values?.length || !measurements[channel]) return 'No voltage available'
    if ((cursor !== null || playbackTime !== undefined) && capture) {
      const target = cursor !== null ? windowStart + cursor * windowSeconds : playbackTime!
      const voltage = traces[channel]?.sampleAt(target) ?? null
      if (voltage === null) return 'Outside capture'
      return `${(target * 1000).toFixed(2)} ms  ·  ${voltage.toFixed(3)} V`
    }
    return `${measurements[channel].peakToPeak.toFixed(2)} Vpp  ·  ${measurements[channel].mean.toFixed(2)} V mean`
  }

  function moveCursor(which: 'A' | 'B', seconds: number) {
    if (!Number.isFinite(seconds)) return
    setCursorSeconds((previous) => ({ ...previous, [which]: Math.max(captureStart, Math.min(captureEnd, seconds)) }))
  }

  const voltageText = (value: number | null | undefined) => value === null || value === undefined ? '—' : `${(Math.abs(value) < 0.0005 ? 0 : value).toFixed(3)} V`
  const frameStatus = windowStart > captureStart ? 'following recording position.' : 'showing capture start.'
  const triggerStatus = !capture ? 'Awaiting current capture.'
    : triggerSource === 'off' ? `Trigger off · ${frameStatus}`
      : !probes[triggerSource] ? `Attach ${triggerSource} to find a crossing.`
        : triggerTime === null ? `No crossing found · ${frameStatus}`
          : `${triggerEdge === 'rising' ? 'Rising' : 'Falling'} ${triggerSource} crossing at ${(triggerTime * 1000).toFixed(3)} ms.`

  function autoscale() {
    if (!capture) return
    const next = { CH1: 1, CH2: 1 }
    for (const ch of ['CH1', 'CH2'] as const) {
      const peak = capture.channels[ch].reduce((p, v) => Math.max(p, Math.abs(v)), 0)
      next[ch] = [0.1, 0.2, 0.5, 1, 2, 5, 10].find(v => v * 2.8 >= peak) ?? 10
    }
    setScales(next)
  }

  return <section className="scope" aria-label="Oscilloscope">
    <div className="scope-heading">
      <div className="section-label"><Waves size={15} /><h2>OSCILLOSCOPE</h2><span className="tiny-tag">2 CHANNEL</span></div>
      <div className="scope-controls">
        <label>TIME <select aria-label="Time per division" value={timeScale} onChange={e => setTimeScale(Number(e.target.value))}>{[0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].map(v => <option key={v} value={v}>{v >= 1000 ? `${v / 1000} s` : `${v} ms`}/div</option>)}</select></label>
        <button className="subtle-button" onClick={autoscale} title="Autoscale channels" disabled={!capture || !hasProbe}><Maximize2 size={14} />Auto</button>
        <span className={`capture-state ${status}`}>{status === 'ready' ? 'CAPTURED' : status === 'stale' ? 'NEEDS SIMULATION' : status.toUpperCase()}</span>
      </div>
    </div>
    <details className="scope-trigger">
      <summary>Trigger <span>{triggerSource === 'off' ? 'Off' : `${triggerSource} · ${triggerEdge} · ${triggerLevel} V`}</span></summary>
      <div className="scope-trigger-content">
        <div className="scope-trigger-controls">
          <label>Source <select aria-label="Trigger source" value={triggerSource} onChange={event => setTriggerSource(event.target.value as 'off' | Channel)}><option value="off">Off</option><option value="CH1">CH1</option><option value="CH2">CH2</option></select></label>
          <label>Edge <select aria-label="Trigger edge" value={triggerEdge} disabled={triggerSource === 'off'} onChange={event => setTriggerEdge(event.target.value as TriggerEdge)}><option value="rising">Rising</option><option value="falling">Falling</option></select></label>
          <label>Level <input type="number" aria-label="Trigger level" step="0.1" value={triggerLevelDraft} disabled={triggerSource === 'off'} onChange={event => { setTriggerLevelDraft(event.target.value); if (Number.isFinite(event.target.valueAsNumber)) setTriggerLevel(event.target.valueAsNumber) }} onBlur={() => setTriggerLevelDraft(String(triggerLevel))} /><span>V</span></label>
        </div>
        <p className="scope-trigger-status" data-testid="trigger-status" aria-live="polite">{triggerStatus}</p>
        <p className="scope-measurement-note">Frames this capture without rerunning it. Time labels and cursors stay in absolute milliseconds. Crossings use 1% signal-span hysteresis, with a 1 mV minimum.</p>
      </div>
    </details>
    <div className="scope-screen">
      <canvas ref={canvas} style={scopeHeight === undefined ? undefined : { height: scopeHeight }} aria-label="Voltage versus time for scope channels 1 and 2" aria-description={`View from ${(windowStart * 1000).toFixed(3)} to ${(windowEnd * 1000).toFixed(3)} absolute milliseconds.${onSeek ? ' Click to inspect the recording at that time.' : ''}`} data-window-start={windowStart} data-window-end={windowEnd} data-trigger-time={triggerTime ?? undefined} onPointerMove={e => { const rect = e.currentTarget.getBoundingClientRect(); setCursor(Math.max(0, Math.min(1, (e.clientX - rect.left - 34) / (rect.width - 46)))) }} onPointerLeave={() => setCursor(null)} onPointerDown={e => {
        if (!capture) return
        const rect = e.currentTarget.getBoundingClientRect()
        const seconds = windowStart + Math.max(0, Math.min(1, (e.clientX - rect.left - 34) / (rect.width - 46))) * windowSeconds
        if (measurementsOpen) moveCursor(activeCursor, seconds)
        onSeek?.(seconds)
      }} />
      <div className="scope-trace-overlay" aria-hidden="true">
        {cursor !== null && <span className="scope-trace-cursor hover" style={{ left: `${cursor * 100}%` }} />}
        {measurementsOpen && capture && ([['A', cursorA], ['B', cursorB]] as const).map(([label, seconds]) => seconds >= windowStart && seconds <= windowEnd && <span key={label} className={`scope-trace-cursor measurement-cursor ${label === activeCursor ? 'active' : ''} cursor-${label.toLowerCase()}`} style={{ left: `${(seconds - windowStart) / windowSeconds * 100}%` }}><b>{label}</b></span>)}
        {capture && playbackTime !== undefined && playbackTime >= windowStart && playbackTime <= windowEnd && <span className="scope-trace-cursor playhead" data-testid="scope-playhead" data-time={playbackTime} style={{ left: `${(playbackTime - windowStart) / windowSeconds * 100}%` }} />}
      </div>
      {capture && playbackTime !== undefined && <output className="scope-playhead-time" aria-label="Scope playback time">{(playbackTime * 1000).toFixed(2)} ms</output>}
      {(!capture || !hasProbe) && <div className="scope-empty" role="status"><Waves size={26} /><div><strong>{emptyTitle}</strong><span>{emptyHint}</span></div></div>}
    </div>
    <ScopeResizer height={size.height} value={scopeHeight} onChange={setScopeHeight} />
    <div className="scope-channels">{(['CH1', 'CH2'] as const).map(channel => <div className="scope-channel" key={channel} style={{ '--channel-color': COLORS[channel] } as React.CSSProperties}>
      <button className="channel-toggle" aria-pressed={visible[channel]} onClick={() => setVisible({ ...visible, [channel]: !visible[channel] })}>{channel}</button>
      <button className="probe-location" onClick={() => probes[channel] && onHighlight ? onHighlight(channel) : onProbe(channel)} title={probes[channel] ? `Highlight ${channel} connection` : `Attach ${channel} probe`}>{probes[channel]?.toUpperCase() ?? 'Attach'}</button>
      <button className="scope-probe-move" onClick={() => onProbe(channel)} aria-label={`Move ${channel} probe`} title={`Move ${channel} probe`}><Crosshair size={15} /></button>
      <select aria-label={`${channel} volts per division`} value={scales[channel]} onChange={e => setScales({ ...scales, [channel]: Number(e.target.value) })}>{[0.1, 0.2, 0.5, 1, 2, 5, 10].map(v => <option key={v} value={v}>{v} V/div</option>)}</select>
      <span className="measurement">{measurement(channel)}</span>
    </div>)}</div>
    {audioControls}
    <details className="scope-measurements" open={measurementsOpen} onToggle={event => setMeasurementsOpen(event.currentTarget.open)}>
      <summary>Measurements <span>Voltages, frequency & cursors</span></summary>
      <div className="scope-measurements-content">
        <p className="scope-measurement-note">Voltages are relative to GND. Mean values cover the full capture; frequency uses a stable repeating region.</p>
        <div className="scope-measurement-table-wrap"><table aria-label="Channel measurements">
          <thead><tr><th scope="col">Measurement</th>{(['CH1', 'CH2'] as const).map(channel => <th scope="col" key={channel} style={{ color: COLORS[channel] }}>{channel} · {probes[channel]?.toUpperCase() ?? 'no probe'}</th>)}</tr></thead>
          <tbody>
            {([{ label: 'Minimum', key: 'min' }, { label: 'Maximum', key: 'max' }, { label: 'Peak to peak', key: 'peakToPeak' }, { label: 'Capture mean', key: 'mean' }] as const).map(row => <tr key={row.key}><th scope="row">{row.label}</th>{(['CH1', 'CH2'] as const).map(channel => <td key={channel}>{voltageText(measurements[channel]?.[row.key])}</td>)}</tr>)}
            <tr><th scope="row">Frequency</th>{(['CH1', 'CH2'] as const).map(channel => <td key={channel}>{measurements[channel]?.frequency ? `${measurements[channel].frequency.toFixed(1)} Hz` : 'Unavailable'}</td>)}</tr>
            <tr><th scope="row">At cursor A</th>{(['CH1', 'CH2'] as const).map(channel => <td key={channel}>{voltageText(cursorVoltages[channel].A)}</td>)}</tr>
            <tr><th scope="row">At cursor B</th>{(['CH1', 'CH2'] as const).map(channel => <td key={channel}>{voltageText(cursorVoltages[channel].B)}</td>)}</tr>
            <tr><th scope="row">ΔV · B − A</th>{(['CH1', 'CH2'] as const).map(channel => <td key={channel}>{voltageText(cursorVoltages[channel].A !== null && cursorVoltages[channel].B !== null ? cursorVoltages[channel].B - cursorVoltages[channel].A : null)}</td>)}</tr>
          </tbody>
        </table></div>
        <p className="scope-measurement-note">Frequency is unavailable for DC, steps, irregular signals, or fewer than three stable periods.</p>
        <fieldset className="scope-cursor-controls" disabled={!capture}>
          <legend>Time cursors <span>Click the trace to move the selected cursor.</span></legend>
          {(['A', 'B'] as const).map(which => {
            const seconds = which === 'A' ? cursorA : cursorB
            return <div className="scope-cursor-row" key={which}>
              <label className="scope-cursor-select"><input type="radio" name="scope-active-cursor" checked={activeCursor === which} onChange={() => setActiveCursor(which)} aria-label={`Select cursor ${which}`} />{which}</label>
              <input type="range" min={captureStart * 1000} max={captureEnd * 1000} step={0.01} value={seconds * 1000} aria-label={`Cursor ${which} time`} aria-valuetext={`${(seconds * 1000).toFixed(2)} milliseconds`} onFocus={() => setActiveCursor(which)} onChange={event => moveCursor(which, Number(event.target.value) / 1000)} />
              <label className="scope-cursor-number"><input type="number" min={captureStart * 1000} max={captureEnd * 1000} step={0.01} value={Number((seconds * 1000).toFixed(3))} aria-label={`Cursor ${which} milliseconds`} onFocus={() => setActiveCursor(which)} onChange={event => moveCursor(which, event.target.valueAsNumber / 1000)} /><span>ms</span></label>
            </div>
          })}
          <div className="scope-cursor-delta">Δt · B − A <output aria-label="Cursor time difference">{capture ? `${((cursorB - cursorA) * 1000).toFixed(3)} ms` : '—'}</output><span>{capture && (cursorA < windowStart || cursorB < windowStart || cursorA > windowEnd || cursorB > windowEnd) ? 'A cursor is outside the displayed time window.' : 'Cursor positions persist across captures.'}</span></div>
        </fieldset>
        <div className="scope-differential-meter">
          <div><strong>DIFFERENTIAL VOLTAGE</strong><span>CH1 − CH2</span></div>
          <label>Measure at <select aria-label="Differential meter position" value={meterPosition} onChange={event => setMeterPosition(event.target.value as 'mean' | 'A' | 'B')}><option value="mean">Capture mean</option><option value="A">Cursor A</option><option value="B">Cursor B</option></select></label>
          <output aria-label="Differential voltage">{voltageText(differential)}</output>
        </div>
      </div>
    </details>
    <div className="scope-footnote">{capture ? `${capture.time.length.toLocaleString()} samples · ${Math.round(capture.elapsedMs)} ms solve` : 'ngspice · local simulation'}<span>Each capture restarts from its initial conditions.</span></div>
  </section>
}
