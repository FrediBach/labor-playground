import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPicoStateTimeline } from '../src/lib/pico/state-timeline.ts'
import type { PicoStateTrace } from '../src/lib/pico/state.ts'

const variable = (name: string, value: string) => ({ name, value: { type: 'int', value } })

test('state annotations preserve sampled time and describe nested changes and removals', () => {
  const trace: PicoStateTrace = { intervalNs: 1e6, sampledThroughNs: 4e6, snapshots: [
    { ns: 1e6, variables: [variable('count', '1'), { name: 'state', value: { type: 'dict', value: '1 entries', children: [variable('duty', '25')] } }] },
    { ns: 2e6, variables: [variable('count', '2'), { name: 'state', value: { type: 'dict', value: '1 entries', children: [variable('duty', '75')] } }] },
    { ns: 3e6, variables: [variable('finished', '1')] },
  ] }
  const timeline = createPicoStateTimeline(trace)
  assert.equal(timeline.at(0), null)
  assert.equal(timeline.at(NaN), null)
  assert.equal(timeline.at(.0019), timeline.annotations[0])
  assert.deepEqual(timeline.at(.002)?.changes, [{ name: 'count', before: '1', after: '2' }, { name: 'state.duty', before: '25', after: '75' }])
  assert.deepEqual(timeline.at(.003)?.changes, [{ name: 'finished', before: undefined, after: '1' }, { name: 'count', before: '2', after: undefined }, { name: 'state', before: '1 entries', after: undefined }])
  assert.equal(timeline.before(.002)?.seconds, .001)
  assert.equal(timeline.before(.0021)?.seconds, .002)
  assert.equal(timeline.after(.002)?.seconds, .003)
  assert.equal(timeline.after(.003), null)
  assert.equal(timeline.at(.004), timeline.annotations[2])
  assert.deepEqual(timeline.window(.001, .002).map(marker => marker.annotation.seconds), [.001, .002])
})

test('dense timelines group visible snapshots with bounded markers without losing their count', () => {
  const timeline = createPicoStateTimeline({ intervalNs: 1e6, sampledThroughNs: 1000e6, snapshots: Array.from({ length: 1001 }, (_, index) => ({ ns: index * 1e6, variables: [variable('count', String(index))] })) })
  const markers = timeline.window(.1, .9)
  assert.ok(markers.length <= 48)
  assert.equal(markers.reduce((sum, marker) => sum + marker.count, 0), 801)
  assert.ok(markers.every(marker => marker.annotation.seconds >= .1 && marker.annotation.seconds <= .9))
  assert.equal(timeline.window(.1, .9, 5).length, 5)
  assert.deepEqual(timeline.window(1, 0), [])
  assert.deepEqual(timeline.window(0, 1, Infinity), [])
  assert.deepEqual(createPicoStateTimeline(undefined).window(0, 1), [])
})

test('nearby changes share a marker even in a sparse capture, while exact navigation retains them', () => {
  const timeline = createPicoStateTimeline({ intervalNs: 1e6, sampledThroughNs: 100e6, snapshots: [
    { ns: 0, variables: [] },
    { ns: 1e6, variables: [variable('count', '1')] },
    { ns: 90e6, variables: [variable('count', '2')] },
  ] })
  assert.deepEqual(timeline.window(0, .1, 12).map(marker => [marker.annotation.seconds, marker.count]), [[0, 2], [.09, 1]])
  assert.equal(timeline.after(0)?.seconds, .001)
  assert.equal(timeline.after(.001)?.seconds, .09)
})
