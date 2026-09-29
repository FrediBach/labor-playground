import type { Capture, Channel } from './simulation-types.ts'

let audioContext: AudioContext | null = null
let activeSource: AudioBufferSourceNode | null = null
let playbackGeneration = 0

export function stopAllAudio() {
  playbackGeneration += 1
  if (activeSource) {
    try { activeSource.stop() } catch { /* The one-shot may already have ended. */ }
    activeSource.disconnect()
    activeSource = null
  }
}

/** Resample adaptive timestamps at 4× rate, FIR low-pass, then decimate to PCM. */
export function resampleCapture(capture: Capture, channel: Channel, sampleRate: number, volume = 0.25): Float32Array<ArrayBuffer> {
  const values = capture.channels[channel]
  const times = capture.time
  if (values.length !== times.length || times.length < 2) throw new Error(`${channel} is not measuring a simulated node. Attach its probe to the circuit.`)
  const duration = times.at(-1)! - times[0]
  if (!Number.isFinite(duration) || duration <= 0 || duration > 1) throw new Error('This capture is not suitable for audio preview.')
  if (!Number.isFinite(sampleRate) || sampleRate < 8_000 || sampleRate > 192_000) throw new Error('The audio sample rate is unsupported.')
  const count = Math.max(1, Math.floor(duration * sampleRate))
  const factor = 4
  const highRate = sampleRate * factor
  const interpolated = new Float64Array(count * factor)
  let cursor = 0
  let mean = 0
  for (let index = 0; index < interpolated.length; index++) {
    const time = times[0] + index / highRate
    while (cursor < times.length - 2 && times[cursor + 1] < time) cursor++
    const interval = times[cursor + 1] - times[cursor]
    const fraction = interval > 0 ? (time - times[cursor]) / interval : 0
    const value = values[cursor] + Math.max(0, Math.min(1, fraction)) * (values[cursor + 1] - values[cursor])
    if (!Number.isFinite(value)) throw new Error('The capture contains a non-finite voltage.')
    interpolated[index] = value
    mean += value
  }
  mean /= interpolated.length

  // Listening bandwidth is deliberately limited to 10 kHz. A 97-tap Hann-windowed
  // sinc filter reduces aliases when the high-rate interpolation is decimated.
  const half = 48
  const cutoff = Math.min(10_000, sampleRate * 0.22) / highRate
  const kernel = new Float64Array(half * 2 + 1)
  let kernelSum = 0
  for (let index = -half; index <= half; index++) {
    const sinc = index === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * index) / (Math.PI * index)
    const window = 0.5 + 0.5 * Math.cos(Math.PI * index / half)
    kernel[index + half] = sinc * window
    kernelSum += sinc * window
  }
  const output = new Float32Array(count)
  let peak = 0
  for (let index = 0; index < count; index++) {
    let value = 0
    for (let tap = -half; tap <= half; tap++) {
      const source = Math.max(0, Math.min(interpolated.length - 1, index * factor + tap))
      value += (interpolated[source] - mean) * kernel[tap + half] / kernelSum
    }
    output[index] = value
    peak = Math.max(peak, Math.abs(value))
  }
  const gain = Math.max(0, Math.min(0.35, Number.isFinite(volume) ? volume : 0.25)) / Math.max(1, peak)
  const fadeSamples = Math.min(Math.floor(sampleRate * 0.005), Math.floor(count / 4))
  for (let index = 0; index < count; index++) {
    const fade = Math.min(1, index / Math.max(1, fadeSamples), (count - 1 - index) / Math.max(1, fadeSamples))
    output[index] = Math.max(-0.35, Math.min(0.35, output[index] * gain)) * fade
  }
  return output
}

/** Deliberate, bounded one-shot playback; never loop an arbitrary capture. */
export async function playCapture(capture: Capture, channel: Channel, volume = 0.25): Promise<() => void> {
  stopAllAudio()
  const generation = playbackGeneration
  if (typeof AudioContext === 'undefined') throw new Error('Audio previews are unavailable in this browser.')
  audioContext ??= new AudioContext()
  await audioContext.resume()
  if (generation !== playbackGeneration) return () => {}
  const pcm = resampleCapture(capture, channel, audioContext.sampleRate, volume)
  const buffer = audioContext.createBuffer(1, pcm.length, audioContext.sampleRate)
  buffer.copyToChannel(pcm, 0)
  const source = audioContext.createBufferSource()
  source.buffer = buffer
  source.loop = false
  source.connect(audioContext.destination)
  source.onended = () => {
    source.disconnect()
    if (activeSource === source) activeSource = null
  }
  activeSource = source
  source.start()
  return () => { if (activeSource === source) stopAllAudio() }
}
