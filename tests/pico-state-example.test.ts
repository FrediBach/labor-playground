import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Simulation } from 'eecircuit-engine'
import { compileCircuit, validateDocument } from '../src/lib/circuit.ts'
import { runCircuitCapture } from '../src/lib/simulation-analysis.ts'
import { runPico } from '../src/lib/pico/runtime.ts'
import { picoStateExample } from '../src/lib/pico/state-example.ts'
import { samplePicoState, type PicoStateValue } from '../src/lib/pico/state.ts'
import { createPicoScopeTrace } from '../src/lib/pico/scope-trace.ts'

const buffer = (name: string) => { const bytes = readFileSync(new URL(`../public/pico/${name}`, import.meta.url)); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
const assets = { bootrom: buffer('bootrom.bin'), firmware: buffer('micropython.uf2') }
const field = (value: PicoStateValue | undefined, name: string) => value?.children?.find(child => child.name === JSON.stringify(name))?.value

test('state and logs example contrasts automatic nested snapshots, explicit local logs and measured filter voltage', { timeout: 30_000 }, async () => {
  const document = structuredClone(picoStateExample.document)
  assert.deepEqual(validateDocument(document), document)
  assert.equal(document.pico!.captureMs, 500)
  const durationSeconds = document.pico!.captureMs / 1000
  const trace = await runPico({ ...assets, source: document.pico!.source, durationSeconds })
  assert.equal(trace.state?.unavailable, undefined)
  assert.equal(trace.state?.truncated, undefined)
  assert.equal(trace.state?.sampledThroughNs, durationSeconds * 1e9)
  assert.match(trace.console, /Complete:/)

  assert.deepEqual(trace.scopeLogs?.map(channel => [channel.name, channel.unit]), [['duty', '%'], ['target', 'V']])
  const [duty, target] = trace.scopeLogs!
  assert.deepEqual(duty.values, [25, 75, 50, 0])
  assert.equal(target.values.length, 4)
  target.values.forEach((value, index) => assert.ok(Math.abs(value - duty.values[index] * 3.3 / 100) < 1e-5))
  const dutyLog = createPicoScopeTrace(duty, durationSeconds)!
  const targetLog = createPicoScopeTrace(target, durationSeconds)!
  const stateAt = (seconds: number) => samplePicoState(trace.state, seconds)?.variables.find(variable => variable.name === 'state')?.value

  const early = stateAt(.05), later = stateAt(.09)
  assert.equal(field(early, 'phase')?.value, '"driving"')
  assert.equal(field(early, 'duty')?.value, '25')
  assert.deepEqual(field(early, 'history')?.children?.map(child => child.value.value), ['25'])
  assert.ok(Number(field(later, 'ticks')?.value) > Number(field(early, 'ticks')?.value), 'automatic snapshots capture intermediate state updates')
  assert.equal(dutyLog.sampleAt(.05), 25)
  assert.equal(dutyLog.sampleAt(.09), 25)
  assert.equal(targetLog.sampleAt(.05), targetLog.sampleAt(.09), 'explicit logs hold their last sample between calls')
  assert.equal(field(stateAt(.15), 'duty')?.value, '75')
  assert.deepEqual(field(stateAt(.15), 'history')?.children?.map(child => child.value.value), ['25', '75'])
  assert.equal(field(stateAt(.25), 'duty')?.value, '50')
  assert.equal(field(stateAt(.35), 'phase')?.value, '"off"')
  const final = stateAt(durationSeconds)
  assert.equal(field(final, 'phase')?.value, '"complete"')
  assert.equal(field(final, 'ticks')?.value, '20')
  assert.deepEqual(field(final, 'history')?.children?.map(child => child.value.value), ['25', '75', '50', '0'])
  assert.ok(trace.state!.snapshots.every(snapshot => snapshot.variables.every(variable => variable.name !== 'target_voltage')), 'the explicitly logged function local is absent from automatic globals')

  const compiled = compileCircuit(document, 'transient', trace, durationSeconds)
  assert.deepEqual(compiled.diagnostics.filter(diagnostic => diagnostic.severity === 'error'), [])
  const engine = new Simulation()
  await engine.start()
  const capture = await runCircuitCapture(engine, {
    type: 'run', revision: 1, durationSeconds, netlist: compiled.netlist,
    nodes: { CH1: compiled.nodeByTerminal[document.probes.CH1!], CH2: compiled.nodeByTerminal[document.probes.CH2!] },
    picoChecks: [{ gpio: 0, node: compiled.nodeByTerminal['pico:1'] }],
  })
  for (const seconds of [.08, .18, .28, .45]) {
    const measured = capture.channels.CH2[capture.time.findIndex(time => time >= seconds)]
    assert.ok(Math.abs(measured - targetLog.sampleAt(seconds)!) < .1, `CH2 settles near its logged target at ${seconds * 1000} ms`)
  }
  const rising = capture.channels.CH2[capture.time.findIndex(time => time >= .12)]
  assert.ok(rising > 1 && rising < targetLog.sampleAt(.12)!, 'measured filter voltage rises gradually after the target changes')
  assert.ok(Math.max(...capture.channels.CH1) > 3, 'the raw GPIO trace remains a pulse waveform')
})
