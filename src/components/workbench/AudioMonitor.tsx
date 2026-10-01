import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Headphones, VolumeX } from 'lucide-react'
import { analyzeAudioLoop, playCapture, setMonitorVolume, stopAllAudio } from '@/lib/audio'
import type { Capture, Channel } from '@/lib/simulation-types'
import { RotaryControl } from './ParameterControls'
import './AudioMonitor.css'

export function AudioMonitor({ capture: recording, onMessage }: { capture: Capture | null; onMessage: (message: string) => void }) {
  // Audio DSP has its own bounded preview; the electrical recording stays intact.
  const capture = useMemo(() => {
    if (!recording) return null
    let end = Math.min(recording.time.length, 100_000)
    if (recording.time[end - 1] - recording.time[0] > 1) {
      let low = 0, high = end
      while (low < high) {
        const middle = (low + high) >>> 1
        if (recording.time[middle] - recording.time[0] <= 1) low = middle + 1
        else high = middle
      }
      end = low
    }
    if (end === recording.time.length) return recording
    const time = recording.time.slice(0, end)
    return { ...recording, time, duration: time.at(-1)! - time[0], channels: { CH1: recording.channels.CH1.slice(0, end), CH2: recording.channels.CH2.slice(0, end) } }
  }, [recording])
  const [channel, setChannel] = useState<Channel>('CH2')
  const [mode, setMode] = useState<'once' | 'loop'>('once')
  const [volume, setVolume] = useState(70)
  const [playing, setPlaying] = useState(false)
  const generation = useRef(0)
  const loop = useMemo(() => capture ? analyzeAudioLoop(capture, channel) : null, [capture, channel])
  if (capture && mode === 'loop' && !loop?.available) setMode('once')
  const hasSignal = !!capture && capture.channels[channel].length === capture.time.length && capture.time.length > 1
  const invalidatePlayback = useCallback(() => {
    generation.current++
    stopAllAudio()
  }, [])
  const mute = useCallback(() => {
    invalidatePlayback()
    setPlaying(false)
  }, [invalidatePlayback])
  // Playback belongs to a particular capture; edits and new captures stop it.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { mute(); return invalidatePlayback }, [capture, mute, invalidatePlayback])

  async function listen() {
    if (playing) { mute(); return }
    if (!capture || !hasSignal) return
    const ticket = ++generation.current
    setPlaying(true)
    try {
      const stop = await playCapture(capture, channel, {
        mode, volume: volume / 100 * 0.35,
        onEnded: () => { if (ticket === generation.current) setPlaying(false) },
      })
      if (ticket !== generation.current) stop()
    } catch (error) {
      if (ticket !== generation.current) return
      mute()
      onMessage(error instanceof Error ? error.message : 'Audio preview could not start.')
    }
  }

  function changeVolume(next: number) {
    setVolume(next)
    setMonitorVolume(next / 100 * 0.35)
  }

  return <div className="audio-monitor" role="group" aria-label="Audio monitor">
    <div className="audio-monitor-controls">
      <div className="monitor-phones">
        <span className="instrument-label">PHONES</span>
        <button className={`monitor-listen ${playing ? 'listening' : ''}`} aria-label={playing ? 'Stop listening' : 'Listen'} disabled={!hasSignal} title={playing ? 'Stop audio preview' : 'Listen to the selected scope channel'} onClick={() => void listen()}>
          <span className="monitor-jack" aria-hidden="true"><Headphones size={13} /></span>
          <span>{playing ? 'STOP' : 'LISTEN'}</span>
        </button>
      </div>
      <div className="monitor-volume" title="Listening level only; measured voltages stay unchanged.">
        <span className="instrument-label">VOLUME</span>
        <RotaryControl label="Monitor level" sliderLabel="Monitor volume" value={volume} min={0} max={100} step={1} unit="%" onPreview={changeVolume} onCommit={changeVolume} />
      </div>
      <div className="monitor-routing">
        <div><label htmlFor="monitor-channel">SOURCE</label><select id="monitor-channel" aria-label="Audio preview channel" value={channel} onChange={event => { mute(); setChannel(event.target.value as Channel) }}><option>CH1</option><option>CH2</option></select></div>
        <div><label htmlFor="monitor-mode">PLAYBACK</label><select id="monitor-mode" aria-label="Audio preview mode" value={mode} onChange={event => { mute(); setMode(event.target.value as 'once' | 'loop') }}>
          <option value="once">One shot</option><option value="loop" disabled={!loop?.available}>Steady loop</option>
        </select></div>
      </div>
      <button className="monitor-mute icon-button" aria-label="Mute audio" title="Mute audio" onClick={mute}><VolumeX size={12} /><span>MUTE</span></button>
    </div>
    <p className="monitor-note" aria-label="Loop availability">{capture && capture !== recording && `Audio preview: first ${(capture.duration * 1000).toFixed(0)} ms. `}{!capture ? 'Capture a signal to listen.' : loop?.available ? `${mode === 'loop' ? 'Loops' : 'Loop available:'} ${loop.region.cycles} settled cycles · ${loop.region.frequency.toFixed(1)} Hz. Edits stop playback.` : loop && !loop.available ? loop.reason : 'No settled loop available.'}</p>
  </div>
}
