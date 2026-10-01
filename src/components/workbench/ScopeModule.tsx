import { useId, useMemo } from 'react'
import type { CircuitDocument } from '@/lib/circuit'
import type { Capture, Channel, SimulationStatus } from '@/lib/simulation'
import { createVoltageSampler } from '@/lib/measurements'
import './ScopeModule.css'

const CHANNELS = ['CH1', 'CH2'] as const
const STATUS_LABELS: Record<SimulationStatus, string> = {
  loading: 'STARTING',
  calculating: 'ACQUIRING',
  ready: 'TRACE READY',
  stale: 'CAPTURE NEEDED',
  invalid: 'CHECK CIRCUIT',
  error: 'CAPTURE ERROR',
}
const WIDTH = 144
const HEIGHT = 80

function scopeTrace(capture: Capture, channel: Channel, voltsPerDivision: number, duration: number, endVoltage: number | null) {
  const values = capture.channels[channel]
  const start = capture.time[0]
  const end = start + duration
  if (!duration || !values.length) return ''

  // Keep each pixel column's extrema so short pulses survive the small display.
  const columns: Array<{ first: number; min: number; max: number; last: number } | undefined> = []
  for (let index = 0; index < Math.min(values.length, capture.time.length); index++) {
    if (capture.time[index] > end) break
    if (!Number.isFinite(values[index])) continue
    const column = Math.max(0, Math.min(WIDTH - 1, Math.floor((capture.time[index] - start) / duration * WIDTH)))
    const bucket = columns[column]
    if (!bucket) columns[column] = { first: index, min: index, max: index, last: index }
    else {
      if (values[index] < values[bucket.min]) bucket.min = index
      if (values[index] > values[bucket.max]) bucket.max = index
      bucket.last = index
    }
  }
  const points: string[] = []
  for (const bucket of columns) {
    if (!bucket) continue
    const indices = [...new Set([bucket.first, bucket.min, bucket.max, bucket.last])].sort((a, b) => a - b)
    for (const index of indices) {
      const x = (capture.time[index] - start) / duration * WIDTH
      const y = HEIGHT / 2 - values[index] / voltsPerDivision * HEIGHT / 6
      points.push(`${points.length ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`)
    }
  }
  if (points.length && endVoltage !== null) points.push(`L${WIDTH},${(HEIGHT / 2 - endVoltage / voltsPerDivision * HEIGHT / 6).toFixed(2)}`)
  return points.join(' ')
}

export function ScopeModule({ capture: suppliedCapture, status, probes, onProbe, windowSeconds }: {
  capture: Capture | null
  status: SimulationStatus
  probes: CircuitDocument['probes']
  onProbe: (channel: Channel) => void
  windowSeconds?: number
}) {
  const clipId = useId()
  const capture = status === 'ready' && suppliedCapture?.time.length ? suppliedCapture : null
  const { CH1: probe1, CH2: probe2 } = probes
  const display = useMemo(() => {
    if (!capture) return null
    const attached = { CH1: probe1, CH2: probe2 }
    const captureDuration = capture.time.at(-1)! - capture.time[0]
    const duration = windowSeconds && Number.isFinite(windowSeconds) && windowSeconds > 0 ? Math.min(captureDuration, windowSeconds) : captureDuration
    const end = capture.time[0] + duration
    const endVoltages = Object.fromEntries(CHANNELS.map(channel => [channel, attached[channel] ? createVoltageSampler(capture.time, capture.channels[channel])?.(end) ?? null : null])) as Record<Channel, number | null>
    let peak = 0
    for (const channel of CHANNELS) {
      if (!attached[channel]) continue
      const values = capture.channels[channel]
      for (let index = 0; index < Math.min(capture.time.length, values.length); index++) {
        if (capture.time[index] > end) break
        const value = values[index]
        if (Number.isFinite(value)) peak = Math.max(peak, Math.abs(value))
      }
      const endVoltage = endVoltages[channel]
      if (endVoltage !== null) peak = Math.max(peak, Math.abs(endVoltage))
    }
    const voltsPerDivision = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20].find(value => value * 2.7 >= peak) ?? Math.ceil(peak / 2.7)
    return {
      voltsPerDivision,
      millisecondsPerDivision: duration * 1000 / 8,
      traces: CHANNELS.map(channel => ({ channel, path: attached[channel] ? scopeTrace(capture, channel, voltsPerDivision, duration, endVoltages[channel]) : '' })),
    }
  }, [capture, probe1, probe2, windowSeconds])
  const hasProbe = Boolean(probes.CH1 || probes.CH2)

  return <section className="scope-module" aria-label="Integrated EDU oscilloscope">
    {['top-left', 'top-right', 'bottom-left', 'bottom-right'].map(position => <span key={position} className={`scope-module-screw ${position}`} aria-hidden="true" />)}
    <div className="scope-module-heading"><span>EDU / SCOPE</span><span className={`scope-module-led ${capture ? 'is-ready' : ''}`} aria-hidden="true" /></div>
    <div className="scope-module-pcb">
      <div className="scope-module-screen">
        <div className="scope-module-readout"><span>{display && hasProbe ? `${display.voltsPerDivision} V/div` : '2 CHANNEL'}</span><span>{display && hasProbe ? `${Number(display.millisecondsPerDivision.toFixed(2))} ms/div` : 'DC'}</span></div>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={capture && hasProbe ? 'Current captured voltage traces' : 'Scope awaiting a current capture'}>
          <defs><clipPath id={clipId}><rect width={WIDTH} height={HEIGHT} /></clipPath></defs>
          <g className="scope-module-grid" aria-hidden="true">
            {Array.from({ length: 9 }, (_, index) => <path key={`v${index}`} d={`M${index * WIDTH / 8},0 V${HEIGHT}`} />)}
            {Array.from({ length: 7 }, (_, index) => <path key={`h${index}`} d={`M0,${index * HEIGHT / 6} H${WIDTH}`} />)}
            <path className="scope-module-zero" d={`M0,${HEIGHT / 2} H${WIDTH}`} />
          </g>
          <g clipPath={`url(#${clipId})`}>
            {display?.traces.map(({ channel, path }) => path && <path key={channel} className={`scope-module-trace ${channel.toLowerCase()}`} d={path} />)}
          </g>
          {(!capture || !hasProbe) && <text className="scope-module-empty" x={WIDTH / 2} y={HEIGHT / 2 - 9} textAnchor="middle">{!hasProbe ? 'PATCH AN INPUT' : STATUS_LABELS[status]}</text>}
        </svg>
        <div className="scope-module-status">{!hasProbe ? 'INPUTS OPEN' : STATUS_LABELS[status]}</div>
      </div>
    </div>
    <div className="scope-module-inputs">
      {CHANNELS.map(channel => <button key={channel} type="button" className={`scope-module-input ${channel.toLowerCase()} ${probes[channel] ? 'is-patched' : ''}`} onClick={() => onProbe(channel)} aria-label={`Patch scope ${channel}`} title={`${channel}: ${probes[channel]?.toUpperCase() ?? 'unpatched'} · click to patch`}>
        <span className="scope-module-jack" aria-hidden="true" /><span>{channel}</span>
      </button>)}
      <span className="scope-module-input-label">SIGNAL<br />INPUTS</span>
    </div>
  </section>
}
