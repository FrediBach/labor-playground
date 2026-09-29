import assert from 'node:assert/strict'
import test from 'node:test'
import { Simulation, type ResultType } from 'eecircuit-engine'
import { compileCircuit, createEmptyDocument, examples, type CircuitDocument } from '../src/lib/circuit.ts'
import { runCircuitCapture } from '../src/lib/simulation-analysis.ts'
import { operatingPointDescriptors } from '../src/lib/simulation-descriptors.ts'
import { extractOperatingPoint, fatalSimulationMessages, requireAnalysisCompletion } from '../src/lib/simulation-results.ts'
import type { OperatingPointPartDescriptor, SimulationRequest } from '../src/lib/simulation-types.ts'

const engine = new Simulation()
const example = (id: string) => structuredClone(examples.find((item) => item.id === id)!.document)
const close = (actual: number, expected: number, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`)

function requestFor(document: CircuitDocument): SimulationRequest {
  const transient = compileCircuit(document)
  const dc = compileCircuit(document, 'operating-point')
  assert.deepEqual(transient.diagnostics.filter((item) => item.severity === 'error'), [])
  assert.deepEqual(dc.diagnostics.filter((item) => item.severity === 'error'), [])
  return {
    type: 'run', revision: 42, netlist: transient.netlist,
    nodes: { CH1: document.probes.CH1 ? transient.nodeByTerminal[document.probes.CH1] : null, CH2: document.probes.CH2 ? transient.nodeByTerminal[document.probes.CH2] : null },
    operatingPoint: { netlist: dc.netlist, parts: operatingPointDescriptors(document, dc.nodeByTerminal) },
  }
}

async function solve(document: CircuitDocument) {
  await engine.start()
  return runCircuitCapture(engine, requestFor(document))
}

test('real .op divider is 2.5 V with 0.25 mA and 0.625 mW in each resistor', { timeout: 15_000 }, async () => {
  const document = example('voltage-divider')
  const capture = await solve(document)
  const op = capture.operatingPoint!
  const nodes = compileCircuit(document).nodeByTerminal
  assert.equal(capture.revision, 42)
  close(op.nodeVoltages[nodes[document.probes.CH2!]], 2.5)
  for (const id of ['R1', 'R2']) {
    assert.equal(op.parts[id].currents[0].label, '1 → 2')
    close(op.parts[id].currents[0].value, 0.00025)
    close(op.parts[id].power!, 0.000625)
  }
  close(capture.time.at(-1)!, 0.1)
  assert.ok(op.elapsedMs >= 0 && capture.elapsedMs >= op.elapsedMs)
})

test('square-driven RC operating point uses the source initial DC value, not its transient mean', { timeout: 15_000 }, async () => {
  const document = example('rc-filter')
  document.instruments.waveform = 'square'
  const capture = await solve(document)
  const nodes = compileCircuit(document).nodeByTerminal
  const dc = capture.operatingPoint!.nodeVoltages[nodes[document.probes.CH2!]]
  close(dc, -document.instruments.amplitude)
  let integral = 0
  for (let index = 1; index < capture.time.length; index++) integral += (capture.channels.CH2[index - 1] + capture.channels.CH2[index]) / 2 * (capture.time[index] - capture.time[index - 1])
  assert.ok(Math.abs(dc - integral / capture.duration) > 2)
  close(capture.operatingPoint!.parts.C1.currents[0].value, 0)
  close(capture.operatingPoint!.parts.C1.power!, 0)
  assert.match(capture.operatingPoint!.parts.C1.currents[0].label, /ideal DC/)
})

test('real .op potentiometer segment currents and total power use the exact endpoint floors', { timeout: 15_000 }, async () => {
  for (const position of [0, 0.25, 1]) {
    const document: CircuitDocument = {
      ...createEmptyDocument(),
      parts: [{ id: 'P1', kind: 'potentiometer', value: 10_000, position, pins: ['a10', 'a11', 'a12'] }],
      wires: [{ id: 'W1', from: 'cv', to: 'b10', color: '#ffffff' }, { id: 'W2', from: 'gnd', to: 'b12', color: '#ffffff' }],
      probes: { CH1: 'c10', CH2: 'c11' },
    }
    const capture = await solve(document)
    const resistance = Math.max(1, position * 10_000) + Math.max(1, (1 - position) * 10_000)
    const reading = capture.operatingPoint!.parts.P1
    assert.deepEqual(reading.currents.map((current) => current.label), ['CCW → Wiper', 'Wiper → CW'])
    for (const current of reading.currents) { assert.ok(current.value > 0); close(current.value, 5 / resistance) }
    close(reading.power!, 25 / resistance)
  }
})

test('real saved diode and LED currents agree with the series resistor, including encoded device IDs', { timeout: 15_000 }, async () => {
  for (const kind of ['diode', 'led'] as const) {
    const document = example('voltage-divider')
    document.parts[0].value = 1_000
    document.parts[1] = { ...document.parts[1], id: 'D-a_b', kind, value: 1 }
    const capture = await solve(document)
    const nodes = compileCircuit(document).nodeByTerminal
    const voltage = capture.operatingPoint!.nodeVoltages[nodes[document.probes.CH2!]]
    const reading = capture.operatingPoint!.parts['D-a_b']
    const resistorCurrent = (5 - voltage) / 1_000
    // Nonlinear-device current convergence follows the compiler's reltol=0.001.
    close(reading.currents[0].value, resistorCurrent, Math.max(1e-9, Math.abs(resistorCurrent) * 0.001))
    close(reading.power!, voltage * reading.currents[0].value)
    assert.equal(reading.currents[0].label, 'Anode → Cathode')
  }
})

test('real DC op-amp clipping follows both supply rails; unsupported currents remain unavailable', { timeout: 15_000 }, async () => {
  for (const input of [-5, 5]) {
    const document = example('opamp-amplifier')
    document.wires.find((wire) => wire.id === 'W1')!.from = 'cv'
    document.instruments.cv = input
    document.parts.find((part) => part.id === 'R1')!.value = 100_000
    const capture = await solve(document)
    const nodes = compileCircuit(document).nodeByTerminal
    const output = capture.operatingPoint!.nodeVoltages[nodes[document.probes.CH2!]]
    assert.ok(output >= -11.001 && output <= 11.001)
    assert.ok(Math.abs(output) > 10.9)
    assert.equal(Math.sign(output), Math.sign(input))
    assert.deepEqual(capture.operatingPoint!.parts.U1, { currents: [], power: null })
  }
})

function fixture(): ResultType {
  return { header: 'Plotname: Operating Point\n', dataType: 'real', numPoints: 1, numVariables: 2, variableNames: ['v(in)', 'v(out)'], data: [
    { name: 'v(in)', type: 'voltage', values: [5] }, { name: 'v(out)', type: 'voltage', values: [2.5] },
  ] }
}
const resistor: OperatingPointPartDescriptor = { partId: 'R1', nodes: ['in', 'out'], branches: [{ kind: 'resistance', label: '1 → 2', fromNode: 'in', toNode: 'out', resistance: 10_000 }] }

test('OP extraction rejects wrong analyses, malformed rows, missing pins and unsaved currents', () => {
  assert.throws(() => extractOperatingPoint({ ...fixture(), header: 'Plotname: Transient Analysis\n' }, [resistor], 0), /single real operating-point row/)
  assert.throws(() => extractOperatingPoint({ ...fixture(), numPoints: 2 }, [resistor], 0), /single real operating-point row/)
  const invalid = fixture()
  invalid.data[0].values[0] = Infinity
  assert.throws(() => extractOperatingPoint(invalid, [resistor], 0), /invalid or incomplete/)
  assert.throws(() => extractOperatingPoint(fixture(), [{ ...resistor, nodes: ['in', 'missing'] }], 0), /no DC voltage/)
  const diode: OperatingPointPartDescriptor = { partId: 'D1', nodes: ['in', 'out'], branches: [{ kind: 'saved-current', label: 'A → K', fromNode: 'in', toNode: 'out', vector: 'i(@d_d1[id])' }] }
  assert.throws(() => extractOperatingPoint(fixture(), [diode], 0), /no saved DC current/)
  const op = extractOperatingPoint(fixture(), [resistor], 0)
  assert.equal(op.nodeVoltages['0'], 0)
  assert.equal(op.nodeVoltages.unused, undefined)
})

test('fresh OP completion and an explicit later source-stepping success are required for recovery', () => {
  const info = 'No. of Data Rows : 1\nngspice 4 -> binary raw file "out.raw"\n'
  assert.doesNotThrow(() => requireAnalysisCompletion(fixture(), info, 'operating-point'))
  assert.throws(() => requireAnalysisCompletion(fixture(), 'binary raw file "out.raw"', 'operating-point'), /fresh DC/)
  assert.throws(() => requireAnalysisCompletion(fixture(), 'No. of Data Rows : 7\nbinary raw file "out.raw"', 'operating-point'), /fresh DC/)
  assert.throws(() => requireAnalysisCompletion(fixture(), info, 'transient'), /fresh transient/)
  const logs = ['Warning: Dynamic gmin stepping failed', 'Warning: True gmin stepping failed', 'Note: Source stepping completed']
  assert.deepEqual(fatalSimulationMessages(logs, { analysis: 'operating-point', complete: true }), [])
  assert.equal(fatalSimulationMessages(logs, { analysis: 'operating-point', complete: false }).length, 2)
  assert.equal(fatalSimulationMessages(logs.slice(0, 2), { analysis: 'operating-point', complete: true }).length, 2)
  assert.equal(fatalSimulationMessages([...logs, 'Error: singular matrix'], { analysis: 'operating-point', complete: true }).length, 1)
})

test('a stale raw operating point from a failed run cannot be attached to a capture', async () => {
  let runs = 0
  const fake = {
    setNetList: () => {},
    runSim: async () => { runs++; return fixture() },
    getError: () => ['Error: no circuit loaded'],
    getInfo: () => 'binary raw file "out.raw"',
  }
  const request = requestFor(example('voltage-divider'))
  request.operatingPoint!.parts = [resistor]
  await assert.rejects(runCircuitCapture(fake, request), /fresh DC/)
  assert.equal(runs, 1, 'A failed OP must not start the transient or publish a combined result.')
})

test('an upstream promise left pending after an irreversible abort rejects without waiting for the watchdog', { timeout: 2_000 }, async () => {
  let runs = 0
  const fake = {
    setNetList: () => {},
    runSim: () => { runs++; return new Promise<ResultType>(() => {}) },
    getError: () => ['Error: The operating point could not be simulated successfully.', 'run simulation(s) aborted'],
    getInfo: () => '',
  }
  await assert.rejects(runCircuitCapture(fake, requestFor(example('voltage-divider'))), /operating point could not/)
  assert.equal(runs, 1)
})
