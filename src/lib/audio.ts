import type { Capture, Channel } from './simulation-types.ts'
import { renderAudioPcm, resampleAudioLoop } from './audio-loop.ts'

export { analyzeAudioLoop } from './audio-loop.ts'
export type { AudioLoopAnalysis, AudioLoopRegion } from './audio-loop.ts'

export interface AudioPlaybackOptions {
  mode?: 'once' | 'loop'
  volume?: number
  /** Fired once for natural completion, cancellation, explicit stop, or failure. */
  onEnded?: () => void
}

interface Playback {
  context: AudioContext
  source: AudioBufferSourceNode | null
  gain: GainNode | null
  volume: number
  stopped: boolean
  ended: boolean
  onEnded?: () => void
  cleanupTimer?: ReturnType<typeof setTimeout>
}

const FADE_SECONDS = 0.005
const MAX_VOLUME = 0.35
let audioContext: AudioContext | null = null
let activePlayback: Playback | null = null
let playbackGeneration = 0

function boundedVolume(volume = 0.25) {
  return Math.max(0, Math.min(MAX_VOLUME, Number.isFinite(volume) ? volume : 0.25))
}

function finishPlayback(playback: Playback) {
  if (playback.ended) return
  playback.ended = true
  if (playback.cleanupTimer !== undefined) clearTimeout(playback.cleanupTimer)
  playback.source?.disconnect()
  playback.gain?.disconnect()
  if (activePlayback === playback) activePlayback = null
  playback.onEnded?.()
}

function holdGain(gain: AudioParam, now: number) {
  if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(now)
  else {
    const value = gain.value
    gain.cancelScheduledValues(now)
    gain.setValueAtTime(value, now)
  }
}

function stopPlayback(playback: Playback) {
  if (playback.stopped || playback.ended) return
  playback.stopped = true
  if (activePlayback === playback) activePlayback = null
  // A pending/suspended context has no audible tail to fade. Finishing now also
  // prevents a later user-agent resume from resurrecting a cancelled request.
  if (!playback.source || playback.context.state !== 'running') {
    try { playback.source?.stop() } catch { /* Already ended. */ }
    finishPlayback(playback)
    return
  }
  const now = playback.context.currentTime
  if (playback.gain) {
    holdGain(playback.gain.gain, now)
    playback.gain.gain.linearRampToValueAtTime(0, now + FADE_SECONDS)
  }
  try { playback.source.stop(now + FADE_SECONDS) } catch { finishPlayback(playback); return }
  // Disconnect even if the context becomes suspended before its onended event.
  playback.cleanupTimer = setTimeout(() => finishPlayback(playback), 50)
}

export function stopAllAudio() {
  playbackGeneration += 1
  if (activePlayback) stopPlayback(activePlayback)
}

/** Change the active monitor level without rebuilding or restarting its loop. */
export function setMonitorVolume(volume: number) {
  const playback = activePlayback
  if (!playback || playback.ended || playback.stopped) return
  playback.volume = boundedVolume(volume)
  if (playback.gain) {
    const now = playback.context.currentTime
    holdGain(playback.gain.gain, now)
    playback.gain.gain.linearRampToValueAtTime(playback.volume / MAX_VOLUME, now + FADE_SECONDS)
  }
}

/** Backwards-compatible one-shot PCM: adaptive resampling and endpoint fades. */
export function resampleCapture(capture: Capture, channel: Channel, sampleRate: number, volume = 0.25): Float32Array<ArrayBuffer> {
  return renderAudioPcm(capture, channel, sampleRate, volume)
}

/** Explicit playback; sustained mode accepts only a verified periodic region. */
export async function playCapture(capture: Capture, channel: Channel, volumeOrOptions: number | AudioPlaybackOptions = 0.25): Promise<() => void> {
  stopAllAudio()
  const generation = playbackGeneration
  const options = typeof volumeOrOptions === 'number' ? { volume: volumeOrOptions } : volumeOrOptions
  if (typeof AudioContext === 'undefined') {
    options.onEnded?.()
    throw new Error('Audio previews are unavailable in this browser.')
  }
  try {
    if (!audioContext || audioContext.state === 'closed') audioContext = new AudioContext()
  } catch (error) {
    options.onEnded?.()
    throw error
  }
  const context = audioContext
  const playback: Playback = {
    context, source: null, gain: null, volume: boundedVolume(options.volume),
    stopped: false, ended: false, onEnded: options.onEnded,
  }
  activePlayback = playback
  try {
    await context.resume()
    if (generation !== playbackGeneration || playback.ended) return () => {}
    const loop = options.mode === 'loop' ? resampleAudioLoop(capture, channel, context.sampleRate, MAX_VOLUME) : null
    const pcm = loop?.pcm ?? resampleCapture(capture, channel, context.sampleRate, MAX_VOLUME)
    const buffer = context.createBuffer(1, pcm.length, context.sampleRate)
    buffer.copyToChannel(pcm, 0)
    const source = context.createBufferSource()
    const gain = context.createGain()
    playback.source = source
    playback.gain = gain
    source.buffer = buffer
    source.loop = loop !== null
    if (loop) {
      source.loopStart = 0
      source.loopEnd = buffer.duration
      source.playbackRate.setValueAtTime(loop.playbackRate, context.currentTime)
    }
    source.connect(gain)
    gain.connect(context.destination)
    gain.gain.setValueAtTime(0, context.currentTime)
    gain.gain.linearRampToValueAtTime(playback.volume / MAX_VOLUME, context.currentTime + FADE_SECONDS)
    source.onended = () => finishPlayback(playback)
    source.start()
    return () => {
      if (playback.ended || playback.stopped) return
      if (activePlayback === playback) playbackGeneration += 1
      stopPlayback(playback)
    }
  } catch (error) {
    // No half-created source may survive a failed start or rejected resume.
    try { playback.source?.stop() } catch { /* It may not have started. */ }
    finishPlayback(playback)
    throw error
  }
}
