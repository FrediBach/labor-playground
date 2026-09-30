import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Crosshair, Maximize2, Waves } from 'lucide-react'
import type { Capture } from '@/lib/simulation'
import { differentialVoltage, interpolateVoltage, measureTrace } from '@/lib/measurements'
import { findTriggerCrossing, frameCapture, type TriggerEdge } from '@/lib/trigger'
import { ScopeResizer } from './ScopeResizer'
import './Scope.css'

type Channel = 'CH1' | 'CH2'
const COLORS = { CH1: '#aee3d5', CH2: '#f2c46d' }
export function Scope({ capture: suppliedCapture, status, probes, onProbe, onHighlight, stimulus = 'periodic', defaultScale = 1, defaultTimeScale, audioControls }: {
  capture: Capture | null
  status: string
  probes: Record<Channel, string | null>
  onProbe: (channel: Channel) => void
  onHighlight?: (channel: Channel) => void
  stimulus?: 'periodic' | 'step'
  defaultScale?: number
  defaultTimeScale?: number
  audioControls?: ReactNode
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
  const triggerTime = useMemo(() => capture && triggerSource !== 'off' && probes[triggerSource]
    ? findTriggerCrossing(capture.time, capture.channels[triggerSource], { edge: triggerEdge, level: triggerLevel }) : null,
  [capture, triggerSource, triggerEdge, triggerLevel, probes])
  const frame = useMemo(() => capture ? frameCapture(capture.time, requestedWindow, triggerTime) : null, [capture, requestedWindow, triggerTime])
  const windowStart = frame?.start ?? 0
  const windowSeconds = frame?.duration ?? requestedWindow
  const windowEnd = frame?.end ?? windowStart + windowSeconds
  const cursorA = Math.max(captureStart, Math.min(captureEnd, cursorSeconds.A))
  const cursorB = Math.max(captureStart, Math.min(captureEnd, cursorSeconds.B))
  const measurements = useMemo(() => ({
    CH1: capture && probes.CH1 ? measureTrace(capture.time, capture.channels.CH1, stimulus) : null,
    CH2: capture && probes.CH2 ? measureTrace(capture.time, capture.channels.CH2, stimulus) : null,
  }), [capture, probes.CH1, probes.CH2, stimulus])
  const cursorVoltages = useMemo(() => ({
    CH1: {
      A: capture && probes.CH1 ? interpolateVoltage(capture.time, capture.channels.CH1, cursorA) : null,
      B: capture && probes.CH1 ? interpolateVoltage(capture.time, capture.channels.CH1, cursorB) : null,
    },
    CH2: {
      A: capture && probes.CH2 ? interpolateVoltage(capture.time, capture.channels.CH2, cursorA) : null,
      B: capture && probes.CH2 ? interpolateVoltage(capture.time, capture.channels.CH2, cursorB) : null,
    },
  }), [capture, probes.CH1, probes.CH2, cursorA, cursorB])
  const differential = useMemo(() => capture && probes.CH1 && probes.CH2
    ? differentialVoltage(capture.time, capture.channels.CH1, capture.channels.CH2, meterPosition === 'mean' ? undefined : meterPosition === 'A' ? cursorA : cursorB)
    : null, [capture, probes.CH1, probes.CH2, meterPosition, cursorA, cursorB])

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
        if (!visible[channel] || !probes[channel]) continue
        const values = capture.channels[channel]
        if (!values?.length) continue
        context.globalAlpha = status === 'ready' ? 1 : 0.4
        context.strokeStyle = COLORS[channel]
        context.lineWidth = 1.65
        context.beginPath()
        // Preserve each screen column's extrema, including narrow solver pulses.
        let index = 0, started = false
        while (index < capture.time.length && capture.time[index] < windowStart) index++
        const startVoltage = interpolateVoltage(capture.time, values, windowStart)
        if (startVoltage !== null) { context.moveTo(left, middle - startVoltage / scales[channel] * h / 6); started = true }
        for (let pixel = 0; pixel < Math.ceil(w); pixel++) {
          let min = Infinity, max = -Infinity
          const end = Math.min(windowEnd, windowStart + (pixel + 1) / w * windowSeconds)
          while (index < capture.time.length && capture.time[index] <= end) {
            min = Math.min(min, values[index]); max = Math.max(max, values[index]); index++
          }
          if (!Number.isFinite(min)) continue
          const x = left + pixel
          const y1 = middle - min / scales[channel] * h / 6
          const y2 = middle - max / scales[channel] * h / 6
          if (!started) { context.moveTo(x, y1); started = true } else context.lineTo(x, y1)
          context.lineTo(x, y2)
        }
        const endVoltage = interpolateVoltage(capture.time, values, windowEnd)
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
    if (cursor !== null) {
      context.strokeStyle = '#e8e8dc'; context.setLineDash([3, 4])
      context.beginPath(); context.moveTo(left + cursor * w, top); context.lineTo(left + cursor * w, bottom); context.stroke()
      context.setLineDash([])
    }
    if (measurementsOpen && capture) {
      for (const [label, time] of [['A', cursorA], ['B', cursorB]] as const) {
        if (time < windowStart || time > windowEnd) continue
        const x = left + (time - windowStart) / windowSeconds * w
        context.strokeStyle = label === activeCursor ? '#f2f1e4' : '#98a88d'
        context.setLineDash(label === 'A' ? [5, 3] : [2, 3])
        context.beginPath(); context.moveTo(x, top); context.lineTo(x, bottom); context.stroke()
        context.setLineDash([])
        context.fillStyle = context.strokeStyle
        context.fillText(label, Math.min(right - 8, x + 4), top + 10)
      }
    }
  }, [capture, cursor, probes, scales, size, status, visible, windowStart, windowSeconds, windowEnd, triggerTime, measurementsOpen, cursorA, cursorB, activeCursor])

  function measurement(channel: Channel) {
    const values = capture?.channels[channel]
    if (!probes[channel]) return 'No probe attached'
    if (status !== 'ready') return busy ? 'Simulating…' : 'Simulate to update'
    if (!values?.length || !measurements[channel]) return 'No voltage available'
    if (cursor !== null && capture) {
      const target = windowStart + cursor * windowSeconds
      const voltage = interpolateVoltage(capture.time, values, target)
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
  const triggerStatus = !capture ? 'Awaiting current capture.'
    : triggerSource === 'off' ? 'Trigger off · showing capture start.'
      : !probes[triggerSource] ? `Attach ${triggerSource} to find a crossing.`
        : triggerTime === null ? 'No crossing found · showing capture start.'
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
        <label>TIME <select aria-label="Time per division" value={timeScale} onChange={e => setTimeScale(Number(e.target.value))}>{[0.5, 1, 2, 5, 10].map(v => <option key={v} value={v}>{v} ms/div</option>)}</select></label>
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
      <canvas ref={canvas} style={scopeHeight === undefined ? undefined : { height: scopeHeight }} aria-label="Voltage versus time for scope channels 1 and 2" aria-description={`View from ${(windowStart * 1000).toFixed(3)} to ${(windowEnd * 1000).toFixed(3)} absolute milliseconds.`} data-window-start={windowStart} data-window-end={windowEnd} data-trigger-time={triggerTime ?? undefined} onPointerMove={e => { const rect = e.currentTarget.getBoundingClientRect(); setCursor(Math.max(0, Math.min(1, (e.clientX - rect.left - 34) / (rect.width - 46)))) }} onPointerLeave={() => setCursor(null)} onPointerDown={e => { if (!measurementsOpen || !capture) return; const rect = e.currentTarget.getBoundingClientRect(); moveCursor(activeCursor, windowStart + Math.max(0, Math.min(1, (e.clientX - rect.left - 34) / (rect.width - 46))) * windowSeconds) }} />
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
