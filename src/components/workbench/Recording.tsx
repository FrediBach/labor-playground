import { sampleOled } from '@/lib/ssd1306'
import { useEffect, useMemo } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { Pause, Play, Repeat2, SkipBack, SkipForward } from 'lucide-react'
import type { Capture, ProbeNodes } from '@/lib/simulation-types'
import { RecordingPlayback } from '@/lib/recording-playback'
import { RecordingContext, useRecording } from '@/lib/recording-context'
import { formatElectrical } from '@/lib/format-electrical'
import { samplePicoPin } from '@/lib/pico/electrical'
import { PartGlyph } from './PartGlyph'
import { Scope } from './Scope'
import type { CircuitDocument } from '@/lib/circuit'
import { AutomationTimeline } from './AutomationPlayback'
import './Recording.css'

export function RecordingProvider({ capture, children }: { capture: Capture | null; children: ReactNode }) {
  const playback = useMemo(() => new RecordingPlayback(capture), [capture])
  useEffect(() => {
    const hide = () => { if (document.hidden) playback.pause() }
    document.addEventListener('visibilitychange', hide)
    return () => { document.removeEventListener('visibilitychange', hide); playback.dispose() }
  }, [playback])
  return <RecordingContext.Provider value={playback}>{children}</RecordingContext.Provider>
}

export function RecordingTransport({ probes, document }: { probes: ProbeNodes; document?: CircuitDocument }) {
  const { playback, seconds, playing, speed, loop, point } = useRecording()
  const available = !!playback.capture?.recording
  const picoTrace = playback.capture?.picoTrace
  const activePins = useMemo(() => picoTrace ? [...new Set([...picoTrace.initial.filter(pin => pin.enabled).map(pin => pin.gpio), ...picoTrace.events.map(pin => pin.gpio)])].sort((a, b) => a - b) : [], [picoTrace])
  return <section className="recording-panel" aria-label="Simulation recording">
    <div className="recording-heading"><div><strong>SIMULATION RECORDING</strong><span>{available ? 'Scrub to inspect · play to watch your circuit' : 'Simulate to record voltages, currents and component states'}</span></div><span className="recording-mode">{playing ? 'PLAYING' : available ? 'PAUSED' : 'AWAITING CAPTURE'}</span></div>
    <fieldset disabled={!available} className="recording-controls">
      <button className="icon-button" aria-label="Recording start" title="Go to start" onClick={() => playback.seek(playback.start)}><SkipBack size={16} /></button>
      <button className="recording-play" aria-label={playing ? 'Pause recording' : 'Play recording'} onClick={playing ? playback.pause : playback.play}>{playing ? <Pause size={16} /> : <Play size={16} />}<span>{playing ? 'Pause' : 'Play'}</span></button>
      <button className="icon-button" aria-label="Recording end" title="Go to end" onClick={() => playback.seek(playback.end)}><SkipForward size={16} /></button>
      <button className={`icon-button recording-loop ${loop ? 'active' : ''}`} aria-label="Loop recording" title="Loop recording" aria-pressed={loop} onClick={() => playback.setLoop(!loop)}><Repeat2 size={17} /></button>
      <label className="recording-speed">Speed<select aria-label="Recording speed" value={speed} onChange={event => playback.setSpeed(Number(event.target.value))}>{[0.001, 0.01, 0.1, 0.25, 0.5, 1, 2].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
      <label className="recording-position"><input type="number" aria-label="Recording time milliseconds" min={playback.start * 1000} max={playback.end * 1000} step="any" value={Number((seconds * 1000).toFixed(4))} onChange={event => playback.seek(event.target.valueAsNumber / 1000)} /><span>/ {(playback.end * 1000).toLocaleString()} ms</span></label>
      <input className="recording-timeline" type="range" aria-label="Recording timeline" aria-valuetext={`${(seconds * 1000).toFixed(3)} milliseconds`} min={playback.start} max={playback.end || 0.1} step="any" value={seconds} onChange={event => playback.seek(Number(event.target.value))} />
    </fieldset>
    {document && <AutomationTimeline document={document} />}
    <div className="recording-readings">{(['CH1', 'CH2'] as const).map(channel => <div key={channel}><span className={channel === 'CH1' ? 'ch1-text' : 'ch2-text'}>{channel}</span><output aria-label={`${channel} recorded voltage`}>{formatElectrical(probes[channel] ? point?.nodeVoltages[probes[channel]] : undefined, 'V')}</output></div>)}<p>Select a component for pin voltages, current and power at this time. LED brightness follows forward current.</p></div>
    {picoTrace && <details className="recording-gpio"><summary>Pico GPIO states</summary><div>{activePins.map(gpio => {
      const pin = samplePicoPin(picoTrace, gpio, seconds)
      const state = pin?.function === 3 ? 'I²C · transaction model' : pin?.enabled ? pin.state === 1 ? 'High' : pin.state === 0 ? 'Low' : 'High impedance' : pin?.pullUp ? 'Input · pull up' : pin?.pullDown ? 'Input · pull down' : 'High impedance'
      return <span key={gpio}>GP{gpio}{gpio === 25 ? ' · LED' : ''}<output aria-label={`Recorded GP${gpio} state`}>{state}</output></span>
    })}</div><p>Firmware output and pull states. Connected pin voltages are measured by the circuit solver.</p></details>}
  </section>
}

export function RecordingScope(props: ComponentProps<typeof Scope>) {
  const { seconds, playback } = useRecording()
  return <Scope {...props} playbackTime={playback.capture?.recording ? seconds : undefined} onSeek={playback.seek} />
}

export function RecordedLed({ partId, ...props }: ComponentProps<typeof PartGlyph> & { partId: string }) {
  const { point } = useRecording()
  const current = point?.parts[partId]?.currents[0]?.value
  const level = current === undefined ? undefined : Math.min(1, Math.sqrt(Math.max(0, current) / 0.01))
  return <g data-led={partId} data-led-state={current === undefined ? 'unavailable' : current > 1e-6 ? 'on' : 'off'}><title>{current === undefined ? 'Simulate to inspect LED' : `LED ${current > 1e-6 ? 'on' : 'off'} · ${formatElectrical(current, 'A')}`}</title><PartGlyph {...props} ledLevel={level} /></g>
}

export function RecordedTerminalVoltage({ node, x, y }: { node?: string; x: number; y: number }) {
  const { point } = useRecording()
  return <text x={x} y={y} textAnchor="middle" fill="#ddedb9" fontSize={10} aria-label="Terminal recorded voltage">{formatElectrical(node ? point?.nodeVoltages[node] : undefined, 'V')}</text>
}

export function RecordedPicoLed({ x, y }: { x: number; y: number }) {
  const { playback, seconds } = useRecording()
  const pin = samplePicoPin(playback.capture?.picoTrace, 25, seconds)
  const on = pin?.enabled && pin.state === 1
  return <g data-pico-led-state={pin === undefined ? 'unavailable' : on ? 'on' : 'off'} aria-label={`Pico onboard LED ${pin === undefined ? 'awaiting capture' : on ? 'on' : 'off'}`}>
    {on && <circle cx={x} cy={y} r={12} fill="#9aff75" opacity={0.3} />}
    <rect x={x - 4} y={y - 3} width={8} height={6} rx={1} fill={on ? '#c6ff91' : '#53734a'} stroke="#adbea1" />
    <text x={x + 9} y={y + 3} fill="#d9e9cf" fontSize={8}>LED</text>
  </g>
}

export function RecordedOled({ partId, ...props }: ComponentProps<typeof PartGlyph> & { partId: string }) {
  const { playback, seconds } = useRecording()
  const frames = playback.capture?.picoTrace?.displays?.find(display => display.partId === partId)?.frames
  const frame = sampleOled(frames, seconds)
  return <g data-oled={partId} data-oled-state={frame?.pixels.some(Boolean) ? 'on' : 'off'}>
    <title>SSD1306 OLED · {frames ? 'Recorded display' : 'Simulate to update display'}</title>
    <PartGlyph {...props} oledFrame={frame} />
  </g>
}
