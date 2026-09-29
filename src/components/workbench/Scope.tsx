import { useEffect, useRef, useState } from 'react'
import { Crosshair, Maximize2, Waves } from 'lucide-react'
import type { Capture } from '@/lib/simulation'

type Channel = 'CH1' | 'CH2'
const COLORS = { CH1: '#aee3d5', CH2: '#f2c46d' }
export function Scope({ capture, status, probes, onProbe }: {
  capture: Capture | null
  status: string
  probes: Record<Channel, string | null>
  onProbe: (channel: Channel) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [timeScale, setTimeScale] = useState(2)
  const [scales, setScales] = useState({ CH1: 1, CH2: 1 })
  const [cursor, setCursor] = useState<number | null>(null)
  const [visible, setVisible] = useState({ CH1: true, CH2: true })
  const [size, setSize] = useState({ width: 600, height: 170 })
  const windowSeconds = timeScale * 10 / 1000

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
    context.font = '9px monospace'
    context.lineWidth = 1
    for (let i = 0; i <= 10; i++) {
      const x = left + w * i / 10
      context.strokeStyle = '#343a38'
      context.beginPath(); context.moveTo(x, top); context.lineTo(x, bottom); context.stroke()
      if (i % 2 === 0) { context.fillStyle = '#828a84'; context.fillText(`${i * timeScale}`, x - 5, height - 5) }
    }
    for (let i = 0; i <= 6; i++) {
      const y = top + h * i / 6
      context.strokeStyle = i === 3 ? '#69706a' : '#343a38'
      context.setLineDash(i === 3 ? [3, 4] : [])
      context.beginPath(); context.moveTo(left, y); context.lineTo(right, y); context.stroke()
    }
    context.setLineDash([])
    context.fillStyle = '#8b948d'; context.fillText('0 V', 5, middle + 3); context.fillText('ms', right - 6, height - 5)
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
        for (let pixel = 0; pixel < Math.ceil(w); pixel++) {
          let min = Infinity, max = -Infinity
          const end = (pixel + 1) / w * windowSeconds
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
        context.stroke()
      }
      context.restore()
    }
    if (cursor !== null) {
      context.strokeStyle = '#e8e8dc'; context.setLineDash([3, 4])
      context.beginPath(); context.moveTo(left + cursor * w, top); context.lineTo(left + cursor * w, bottom); context.stroke()
      context.setLineDash([])
    }
  }, [capture, cursor, probes, scales, size, status, timeScale, visible, windowSeconds])

  function measurement(channel: Channel) {
    const values = capture?.channels[channel]
    if (!values?.length || !probes[channel]) return 'No probe attached'
    if (status !== 'ready') return 'Previous capture · awaiting update'
    let min = Infinity, max = -Infinity, integral = 0
    for (let index = 0; index < values.length; index++) {
      min = Math.min(min, values[index]); max = Math.max(max, values[index])
      if (index > 0 && capture) integral += (values[index - 1] + values[index]) / 2 * (capture.time[index] - capture.time[index - 1])
    }
    const duration = capture ? capture.time.at(-1)! - capture.time[0] : 0
    const mean = duration > 0 ? integral / duration : values[0]
    if (cursor !== null && capture) {
      const target = cursor * windowSeconds
      const index = capture.time.findIndex(time => time >= target)
      if (index < 0) return 'Outside capture'
      const previous = Math.max(0, index - 1)
      const dt = capture.time[index] - capture.time[previous]
      const fraction = dt > 0 ? (target - capture.time[previous]) / dt : 0
      const voltage = values[previous] + fraction * (values[index] - values[previous])
      return `${(target * 1000).toFixed(2)} ms  ·  ${voltage.toFixed(3)} V`
    }
    return `${(max - min).toFixed(2)} Vpp  ·  ${mean.toFixed(2)} V mean`
  }

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
        <button className="subtle-button" onClick={autoscale} title="Autoscale channels"><Maximize2 size={13} />Auto</button>
        <span className={`capture-state ${status}`}>{status === 'ready' ? 'CAPTURED' : status.toUpperCase()}</span>
      </div>
    </div>
    <div className="scope-screen">
      <canvas ref={canvas} aria-label="Voltage versus time for scope channels 1 and 2" onPointerMove={e => { const rect = e.currentTarget.getBoundingClientRect(); setCursor(Math.max(0, Math.min(1, (e.clientX - rect.left - 34) / (rect.width - 46)))) }} onPointerLeave={() => setCursor(null)} />
      {!capture && <div className="scope-empty"><Waves size={25} /><span>{status === 'loading' || status === 'calculating' ? 'Preparing your first capture…' : 'Connect a circuit and capture a waveform.'}</span></div>}
    </div>
    <div className="scope-channels">{(['CH1', 'CH2'] as const).map(channel => <div className="scope-channel" key={channel} style={{ '--channel-color': COLORS[channel] } as React.CSSProperties}>
      <button className="channel-toggle" aria-pressed={visible[channel]} onClick={() => setVisible({ ...visible, [channel]: !visible[channel] })}>{channel}</button>
      <button className="probe-location" onClick={() => onProbe(channel)} title={`Move ${channel} probe`}><Crosshair size={11} />{probes[channel]?.toUpperCase() ?? 'Attach'}</button>
      <select aria-label={`${channel} volts per division`} value={scales[channel]} onChange={e => setScales({ ...scales, [channel]: Number(e.target.value) })}>{[0.1, 0.2, 0.5, 1, 2, 5, 10].map(v => <option key={v} value={v}>{v} V/div</option>)}</select>
      <span className="measurement">{measurement(channel)}</span>
    </div>)}</div>
    <div className="scope-footnote">{capture ? `${capture.time.length.toLocaleString()} samples · ${Math.round(capture.elapsedMs)} ms solve` : 'ngspice · local simulation'}<span>Each capture restarts from its initial conditions.</span></div>
  </section>
}
