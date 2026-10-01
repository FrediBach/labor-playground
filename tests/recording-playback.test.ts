import assert from 'node:assert/strict'
import test from 'node:test'
import { RecordingPlayback } from '../src/lib/recording-playback.ts'
import type { Capture } from '../src/lib/simulation-types.ts'

function fixture() {
  let now = 0, id = 0
  const frames = new Map<number, (time: number) => void>()
  const capture: Capture = { revision: 1, time: [0, 0.5, 1], duration: 1, elapsedMs: 1, channels: { CH1: [0, 5, 0], CH2: [] }, recording: { nodeVoltages: { signal: [0, 5, 0] }, currents: {}, parts: [] } }
  const playback = new RecordingPlayback(capture, { now: () => now, request: callback => { frames.set(++id, callback); return id }, cancel: ticket => { frames.delete(ticket) } })
  const advance = (milliseconds: number) => { now += milliseconds; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(now)) }
  return { playback, frames, advance }
}

test('playback samples absolute time, wraps multiple loops, and preserves end in one-shot mode', () => {
  const { playback, advance } = fixture()
  playback.play()
  advance(250)
  assert.equal(playback.getSnapshot().seconds, 0.25)
  assert.equal(playback.getSnapshot().point?.nodeVoltages.signal, 2.5)
  advance(3100)
  assert.ok(Math.abs(playback.getSnapshot().seconds - 0.35) < 1e-12)
  playback.setLoop(false)
  advance(1000)
  assert.equal(playback.getSnapshot().seconds, 1)
  assert.equal(playback.getSnapshot().playing, false)
  playback.play()
  assert.equal(playback.getSnapshot().seconds, 0)
})

test('scrubbing pauses, speed changes stay continuous, and dispose cancels queued frames', () => {
  const { playback, advance, frames } = fixture()
  playback.setSpeed(0.1)
  playback.play()
  advance(1000)
  assert.equal(playback.getSnapshot().seconds, 0.1)
  playback.setSpeed(0.5)
  advance(1000)
  assert.equal(playback.getSnapshot().seconds, 0.6)
  playback.seek(0.25)
  assert.equal(playback.getSnapshot().playing, false)
  assert.equal(frames.size, 0)
  advance(5000)
  assert.equal(playback.getSnapshot().seconds, 0.25)
  playback.seek(-2)
  assert.equal(playback.getSnapshot().seconds, 0)
  playback.seek(Infinity)
  assert.equal(playback.getSnapshot().seconds, 0)
  playback.play()
  playback.dispose()
  assert.equal(frames.size, 0)
})

test('unavailable recordings never start an animation', () => {
  const playback = new RecordingPlayback(null)
  playback.play()
  assert.equal(playback.getSnapshot().playing, false)
  assert.equal(playback.getSnapshot().point, undefined)
})
