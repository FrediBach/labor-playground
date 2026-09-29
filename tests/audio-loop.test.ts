import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeAudioLoop, resampleAudioLoop } from '../src/lib/audio-loop.ts'
import { playCapture, resampleCapture, setMonitorVolume, stopAllAudio } from '../src/lib/audio.ts'
import type { Capture } from '../src/lib/simulation-types.ts'

function capture(fn: (t: number) => number, duration = 0.1, steps = [2e-6, 8e-6, 3e-6, 7e-6]): Capture {
  const time = [0]
  let index = 0
  while (time.at(-1)! < duration) time.push(Math.min(duration, time.at(-1)! + steps[index++ % steps.length]))
  return { revision: 1, time, channels: { CH1: time.map(fn), CH2: [] }, duration, elapsedMs: 0 }
}

function close(actual: number, expected: number, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${actual} to be within ${tolerance} of ${expected}`)
}

const sine = (frequency: number, offset = 0) => (t: number) => offset + Math.sin(2 * Math.PI * frequency * t)
const rms = (pcm: Float32Array) => Math.sqrt(pcm.reduce((sum, value) => sum + value * value, 0) / pcm.length)

test('loop selection uses adaptive timestamps and measured cycles, independent of the other channel', () => {
  const measured = capture(sine(220, 7))
  measured.channels.CH2 = measured.channels.CH1
  measured.channels.CH1 = measured.time.map(() => 5)
  assert.equal(analyzeAudioLoop(measured, 'CH1').available, false)
  const result = analyzeAudioLoop(measured, 'CH2')
  assert.ok(result.available)
  close(result.region.frequency, 220, 0.01)
  assert.ok(result.region.cycles >= 3 && result.region.cycles <= 8)
  assert.ok(result.region.start > 0.05 && result.region.end <= 0.1)
  close(result.region.end - result.region.start, result.region.cycles * result.region.period)
})

test('a physically settled RC startup is trimmed, while an unsettled amplitude envelope is rejected', () => {
  const tau = 0.005
  const omega = 2 * Math.PI * 220
  const phase = Math.atan(omega * tau)
  const amplitude = 1 / Math.sqrt(1 + (omega * tau) ** 2)
  // Analytical zero-state response of a first-order low-pass to a sine.
  const settled = capture((t) => amplitude * (Math.sin(omega * t - phase) + Math.sin(phase) * Math.exp(-t / tau)))
  const result = analyzeAudioLoop(settled, 'CH1')
  assert.ok(result.available)
  assert.ok(result.region.start > 8 * tau)
  close(result.region.frequency, 220, 0.05)
  const changing = capture((t) => (1 - Math.exp(-t / 0.05)) * Math.sin(omega * t))
  assert.equal(analyzeAudioLoop(changing, 'CH1').available, false)
})

test('stable square and diode-like clipping waveforms qualify without per-cycle fades', () => {
  for (const fn of [
    (t: number) => (t * 200) % 1 < 0.5 ? -2 : 3,
    (t: number) => Math.max(-0.6, Math.min(0.6, 3 * Math.sin(2 * Math.PI * 220 * t))),
  ]) {
    const measured = capture(fn)
    const result = analyzeAudioLoop(measured, 'CH1')
    assert.ok(result.available, result.available ? '' : result.reason)
    const { pcm } = resampleAudioLoop(measured, 'CH1', 48_000)
    assert.ok(rms(pcm) > 0.1)
    assert.ok(Math.max(...pcm.map(Math.abs)) <= 0.350001)
  }
})

test('DC, isolated steps, decays, irregular traces, sparse samples, and too few cycles cannot loop', () => {
  const waveforms = [
    () => 2.5,
    (t: number) => t < 0.001 || t >= 0.051 ? 0 : 5,
    (t: number) => 5 * (1 - Math.exp(-t / 0.01)),
    (t: number) => Math.exp(-t / 0.02) * Math.sin(2 * Math.PI * 220 * t),
    (t: number) => Math.sin(2 * Math.PI * (100 * t + 1500 * t * t)),
    (t: number) => Math.sin(2 * Math.PI * 220 * t) + 0.2 * Math.sin(2 * Math.PI * 433 * t),
    // Regular crossings alone must not accept irregular intra-cycle shapes.
    (t: number) => {
      const phase = 2 * Math.PI * 200 * t
      return Math.sin(phase) + 0.3 * Math.sin(phase) ** 2 * Math.sin(phase * 7 + Math.floor(t * 200) * 1.731)
    },
    // A late change after the last crossing must not reuse an earlier stable tail.
    (t: number) => t > 0.098 ? 0 : Math.sin(2 * Math.PI * 220 * t),
  ]
  for (const fn of waveforms) assert.equal(analyzeAudioLoop(capture(fn), 'CH1').available, false)
  assert.equal(analyzeAudioLoop(capture(sine(100), 0.029), 'CH1').available, false)
  assert.equal(analyzeAudioLoop(capture(sine(1000), 0.1, [0.000125]), 'CH1').available, false)
})

test('malformed captures and unsupported sample rates fail before producing audio', () => {
  const valid = capture(sine(220))
  for (const invalid of [
    { ...valid, time: [], channels: { CH1: [], CH2: [] } },
    { ...valid, channels: { CH1: [], CH2: [] } },
    { ...valid, time: [0, 0.1, 0.05], channels: { CH1: [0, 1, 2], CH2: [] } },
    { ...valid, time: [0, NaN], channels: { CH1: [0, 1], CH2: [] } },
    { ...valid, time: [0, 0.1], channels: { CH1: [0, Infinity], CH2: [] } },
    { ...valid, time: [0, 0.1], channels: { CH1: [1e308, -1e308], CH2: [] } },
    { ...valid, time: [0, 1.01], channels: { CH1: [0, 1], CH2: [] } },
  ]) {
    assert.equal(analyzeAudioLoop(invalid, 'CH1').available, false)
    assert.throws(() => resampleAudioLoop(invalid, 'CH1', 48_000))
    assert.throws(() => resampleCapture(invalid, 'CH1', 48_000))
  }
  for (const rate of [0, NaN, 7_999, 192_001]) assert.throws(() => resampleAudioLoop(valid, 'CH1', rate))
})

test('narrow nonrepeating defects between phase samples cannot qualify as a stable loop', () => {
  const notches = capture((t) => {
    const cycles = t * 200
    const phase = cycles % 1
    const cycle = Math.floor(cycles)
    return Math.sin(2 * Math.PI * cycles) - (Math.abs(phase - 0.2517) < 0.0008 ? 0.4 + 0.3 * Math.sin(cycle * 0.731) : 0)
  }, 0.1, [2e-6])
  assert.equal(analyzeAudioLoop(notches, 'CH1').available, false)
  const lateNotch = capture((t) => Math.sin(2 * Math.PI * 200 * t) - (t > 0.095 && Math.abs((t * 200) % 1 - 0.2517) < 0.0008 ? 0.7 : 0), 0.1, [2e-6])
  assert.equal(analyzeAudioLoop(lateNotch, 'CH1').available, false)
})

test('periodic resampling removes DC, keeps a continuous seam, and preserves measured pitch exactly', () => {
  const measured = capture((t) => 5 + 0.8 * Math.sin(2 * Math.PI * 237 * t))
  const { pcm, region, playbackRate } = resampleAudioLoop(measured, 'CH1', 44_100)
  close(pcm.length / 44_100 / playbackRate, region.end - region.start, 1e-12)
  close(pcm.reduce((sum, value) => sum + value, 0) / pcm.length, 0, 1e-8)
  const step = Math.max(...pcm.slice(1).map((value, index) => Math.abs(value - pcm[index])))
  assert.ok(Math.abs(pcm[0] - pcm.at(-1)!) <= step * 1.05)
  const seamSlope = pcm[0] - pcm.at(-1)!
  close(seamSlope, pcm[1] - pcm[0], 0.0001)
  // No endpoint fade: the slope is present on both sides of the loop boundary.
  assert.ok(Math.abs(seamSlope) > 0.005)
  assert.ok(Math.max(...pcm) > 0.19 && Math.max(...pcm) < 0.21)
})

test('periodic FIR resampling attenuates an above-band harmonic instead of aliasing it', () => {
  const measured = capture((t) => Math.sin(2 * Math.PI * 1000 * t) + 0.08 * Math.sin(2 * Math.PI * 30_000 * t), 0.1, [2.5e-6])
  const { pcm, region } = resampleAudioLoop(measured, 'CH1', 48_000)
  function amplitude(frequency: number) {
    let real = 0
    let imaginary = 0
    for (let index = 0; index < pcm.length; index++) {
      const time = region.start + index * (region.end - region.start) / pcm.length
      real += pcm[index] * Math.cos(2 * Math.PI * frequency * time)
      imaginary += pcm[index] * Math.sin(2 * Math.PI * frequency * time)
    }
    return 2 * Math.hypot(real, imaginary) / pcm.length
  }
  assert.ok(amplitude(1000) > 0.23)
  assert.ok(amplitude(18_000) < 0.0005, `18 kHz alias: ${amplitude(18_000)}`)
})

test('volume is bounded without boosting small signals or changing their shape', () => {
  const small = capture((t) => 0.1 * Math.sin(2 * Math.PI * 220 * t))
  const quiet = resampleAudioLoop(small, 'CH1', 48_000, 0.2).pcm
  assert.ok(Math.max(...quiet) < 0.021 && Math.max(...quiet) > 0.019)
  const large = capture((t) => 100 * Math.sin(2 * Math.PI * 220 * t))
  const limited = resampleAudioLoop(large, 'CH1', 48_000, 5).pcm
  close(Math.max(...limited.map(Math.abs)), 0.35, 1e-7)
  assert.ok(resampleAudioLoop(large, 'CH1', 48_000, -1).pcm.every((value) => value === 0))
})

class FakeParam {
  value = 1
  events: { type: string; value?: number; time: number }[] = []
  setValueAtTime(value: number, time: number) { this.value = value; this.events.push({ type: 'set', value, time }); return this }
  linearRampToValueAtTime(value: number, time: number) { this.value = value; this.events.push({ type: 'ramp', value, time }); return this }
  cancelAndHoldAtTime(time: number) { this.events.push({ type: 'hold', time }); return this }
}

class FakeGain {
  gain = new FakeParam()
  disconnected = false
  connect() { return this }
  disconnect() { this.disconnected = true }
}

class FakeSource {
  buffer: { duration: number; data: Float32Array } | null = null
  loop = false
  loopStart = 0
  loopEnd = 0
  playbackRate = new FakeParam()
  onended: (() => void) | null = null
  started = false
  stopTime: number | null = null
  disconnected = false
  start() { this.started = true }
  stop(time = 0) { this.stopTime = time }
  connect() { return this }
  disconnect() { this.disconnected = true }
  end() { this.onended?.() }
}

class FakeContext {
  static instances: FakeContext[] = []
  sampleRate = 48_000
  currentTime = 1
  state = 'running'
  destination = {}
  sources: FakeSource[] = []
  gains: FakeGain[] = []
  resumePromise: Promise<void> = Promise.resolve()
  constructor() { FakeContext.instances.push(this) }
  resume() { return this.resumePromise }
  createBuffer(_channels: number, count: number, rate: number) {
    return { duration: count / rate, data: new Float32Array(count), copyToChannel(data: Float32Array) { this.data.set(data) } }
  }
  createBufferSource() { const source = new FakeSource(); this.sources.push(source); return source }
  createGain() { const gain = new FakeGain(); this.gains.push(gain); return gain }
}

test('playback lifecycle: live volume, fades, cancellation, replacement, and natural completion', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext')
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, writable: true, value: FakeContext })
  t.after(() => {
    stopAllAudio()
    for (const context of FakeContext.instances) {
      context.state = 'closed'
      for (const source of context.sources) source.end()
    }
    if (original) Object.defineProperty(globalThis, 'AudioContext', original)
    else Reflect.deleteProperty(globalThis, 'AudioContext')
  })
  const measured = capture(sine(220))
  let ended = 0
  const stop = await playCapture(measured, 'CH1', { mode: 'loop', volume: 0.245, onEnded: () => ended++ })
  const context = FakeContext.instances.at(-1)!
  const source = context.sources.at(-1)!
  const gain = context.gains.at(-1)!
  assert.equal(source.loop, true)
  assert.equal(source.started, true)
  assert.equal(source.loopEnd, source.buffer!.duration)
  close(gain.gain.events.at(-1)!.value!, 0.7)
  close(gain.gain.events.at(-1)!.time, 1.005)
  setMonitorVolume(0.1)
  assert.equal(context.sources.length, 1)
  close(gain.gain.events.at(-1)!.value!, 0.1 / 0.35)
  setMonitorVolume(9)
  close(gain.gain.events.at(-1)!.value!, 1)
  stop()
  close(source.stopTime!, 1.005)
  close(gain.gain.events.at(-1)!.value!, 0)
  assert.equal(ended, 0)
  source.end()
  source.end()
  stop()
  assert.equal(ended, 1)
  assert.equal(source.disconnected, true)
  assert.equal(gain.disconnected, true)

  // Stopping while resume is unresolved must prevent a later source from starting.
  let resolveResume: (() => void) | undefined
  context.state = 'suspended'
  context.resumePromise = new Promise<void>((resolve) => { resolveResume = resolve })
  let cancelled = 0
  const pending = playCapture(measured, 'CH1', { mode: 'loop', onEnded: () => cancelled++ })
  stopAllAudio()
  assert.equal(cancelled, 1)
  resolveResume!()
  await pending
  assert.equal(context.sources.length, 1)
  assert.equal(cancelled, 1)
  context.state = 'running'
  context.resumePromise = Promise.resolve()

  let firstEnded = 0
  const stopFirst = await playCapture(measured, 'CH1', { mode: 'loop', onEnded: () => firstEnded++ })
  const first = context.sources.at(-1)!
  let secondEnded = 0
  await playCapture(measured, 'CH1', { onEnded: () => secondEnded++ })
  const second = context.sources.at(-1)!
  assert.equal(second.loop, false)
  assert.notEqual(first.stopTime, null)
  stopFirst()
  first.end()
  assert.equal(firstEnded, 1)
  assert.equal(second.stopTime, null)
  second.end()
  second.end()
  assert.equal(secondEnded, 1)

  let failed = 0
  await assert.rejects(playCapture(capture(() => 5), 'CH1', { mode: 'loop', onEnded: () => failed++ }), /DC/)
  assert.equal(failed, 1)
  assert.equal(context.sources.length, 3)

  // Pending volume changes are applied when resume eventually succeeds.
  context.state = 'suspended'
  context.resumePromise = new Promise<void>((resolve) => { resolveResume = resolve })
  const delayed = playCapture(measured, 'CH1', { mode: 'loop', volume: 0.25 })
  setMonitorVolume(0.035)
  context.state = 'running'
  resolveResume!()
  const stopDelayed = await delayed
  close(context.gains.at(-1)!.gain.events.at(-1)!.value!, 0.1)
  stopDelayed()
  context.sources.at(-1)!.end()

  let resumeFailure = 0
  context.resumePromise = Promise.reject(new Error('resume refused'))
  await assert.rejects(playCapture(measured, 'CH1', { onEnded: () => resumeFailure++ }), /resume refused/)
  assert.equal(resumeFailure, 1)
  assert.equal(context.sources.length, 4)
  context.resumePromise = Promise.resolve()

  // A missing onended event cannot leave a disconnected/suspended tail active.
  let fallbackEnded = 0
  const stopFallback = await playCapture(measured, 'CH1', { mode: 'loop', onEnded: () => fallbackEnded++ })
  const fallback = context.sources.at(-1)!
  stopFallback()
  context.state = 'suspended'
  await new Promise((resolve) => setTimeout(resolve, 75))
  assert.equal(fallback.disconnected, true)
  assert.equal(fallbackEnded, 1)
  fallback.end()
  assert.equal(fallbackEnded, 1)
})
