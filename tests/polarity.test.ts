import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResultType } from 'eecircuit-engine'
import { extractCapture, fatalSimulationMessages, requireCompleteCapture } from '../src/lib/simulation-results.ts'

function result(positive: number[], negative: number[]): ResultType {
  return {
    dataType: 'real',
    data: [
      { name: 'time', type: 'time', values: [0, 0.001, 0.004, 0.1] },
      { name: 'v(n1)', type: 'voltage', values: positive },
      { name: 'v(n2)', type: 'voltage', values: negative },
    ],
  } as ResultType
}

test('polarized capacitor checks compare simultaneous lead voltages, not separate extrema', () => {
  const capture = extractCapture(result([0, 2, 1, 3], [-1, 1, 0, 2]), { CH1: 'n1', CH2: 'n2' }, 1, 1,
    [{ partId: 'C1', positiveNode: 'n1', negativeNode: 'n2' }])
  assert.deepEqual(capture.diagnostics, [])
})

test('reverse-bias diagnostics identify the part and largest negative voltage', () => {
  const capture = extractCapture(result([0, -1, -4, -2], [0, 0, 0, 0]), { CH1: 'n1', CH2: 'n2' }, 1, 1,
    [{ partId: 'C2', positiveNode: 'n1', negativeNode: '0' }])
  assert.equal(capture.diagnostics?.[0].partId, 'C2')
  assert.equal(capture.diagnostics?.[0].severity, 'warning')
  assert.match(capture.diagnostics?.[0].message ?? '', /4\.00 V/)
  assert.deepEqual(capture.channels.CH1, [0, -1, -4, -2])
})

test('missing or malformed checked capacitor vectors fail explicitly', () => {
  assert.throws(() => extractCapture(result([0, 1, 2, 3], [0, 0, 0, 0]), { CH1: 'n1', CH2: null }, 1, 1,
    [{ partId: 'C3', positiveNode: 'unused', negativeNode: '0' }]), /C3 returned no voltage/)
  assert.throws(() => extractCapture(result([-5], [0, 0, 0, 0]), { CH1: '0', CH2: null }, 1, 1,
    [{ partId: 'C3', positiveNode: 'n1', negativeNode: '0' }]), /C3 returned incomplete voltages/)
})


test('source stepping may recover gmin warnings only with a complete capture and explicit later success', () => {
  const logs = ['Warning: Dynamic gmin stepping failed', 'Warning: True gmin stepping failed', 'Note: Source stepping completed']
  assert.deepEqual(fatalSimulationMessages(logs, { time: [0, 0.1] }), [])
  assert.equal(fatalSimulationMessages(logs, { time: [0, 0.05] }).length, 2)
  assert.equal(fatalSimulationMessages(logs.slice(0, 2), { time: [0, 0.1] }).length, 2)
  assert.equal(fatalSimulationMessages([...logs, 'Error: timestep too small'], { time: [0, 0.1] }).length, 1)
  assert.equal(fatalSimulationMessages(['Note: Source stepping completed', 'Warning: Dynamic gmin stepping failed'], { time: [0, 0.1] }).length, 1)
})

test('production captures reject silent truncation and wrong start times', () => {
  assert.doesNotThrow(() => requireCompleteCapture({ time: [0, 0.05, 0.1] }))
  assert.throws(() => requireCompleteCapture({ time: [0, 0.02] }), /incomplete capture/)
  assert.throws(() => requireCompleteCapture({ time: [0.01, 0.1] }), /incomplete capture/)
  assert.throws(() => requireCompleteCapture({ time: [] }), /incomplete capture/)
})
