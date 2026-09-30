import assert from 'node:assert/strict'
import test from 'node:test'
import { Simulation } from 'eecircuit-engine'
import { compileCircuit, terminalById, validateDocument, type CircuitDocument } from '../src/lib/circuit.ts'
import { icExamples } from '../src/lib/ic-examples.ts'
import { fatalSimulationMessages, requireAnalysisCompletion } from '../src/lib/simulation-results.ts'

const engine = new Simulation()
const fixture = () => structuredClone(icExamples.find(example => example.id === 'lm13700-vca')!.document)

async function solve(document: CircuitDocument, analysis: 'transient' | 'operating-point' = 'transient') {
  const compiled = compileCircuit(document, analysis)
  assert.deepEqual(compiled.diagnostics, [])
  await engine.start()
  engine.setNetList(compiled.netlist)
  const result = await engine.runSim()
  requireAnalysisCompletion(result, engine.getInfo(), analysis)
  const time = result.data.find(vector => vector.type === 'time')?.values ?? []
  assert.deepEqual(fatalSimulationMessages(engine.getError(), analysis === 'transient' ? { time } : { analysis, complete: true }), [])
  if (analysis === 'transient') {
    assert.equal(time[0], 0)
    assert.equal(time.at(-1), 0.1)
  }
  const voltage = (terminal: string) => {
    const node = compiled.nodeByTerminal[terminal]
    if (node === '0') return Array(result.numPoints).fill(0) as number[]
    const values = result.data.find(vector => vector.name === `v(${node})`)?.values
    assert.ok(values && values.length === result.numPoints, `Missing voltage at ${terminal}`)
    assert.ok(values.every(Number.isFinite), `Nonfinite voltage at ${terminal}`)
    return values
  }
  return { time, voltage }
}

function amplitude(values: number[]) {
  return (Math.max(...values) - Math.min(...values)) / 2
}

test('LM13700 VCA example validates its DIP-16 wiring and safely defines the unused section', () => {
  const document = fixture()
  assert.deepEqual(validateDocument(document), document)
  const compiled = compileCircuit(document)
  assert.deepEqual(compiled.diagnostics, [])
  const nodes = compiled.nodeByTerminal
  const pins = document.parts.find(part => part.kind === 'lm13700')!.pins
  assert.equal(pins.length, 16)
  assert.equal(nodes[pins[5]], nodes.vminus)
  assert.equal(nodes[pins[10]], nodes.vplus)
  assert.equal(nodes[pins[15]], nodes.vminus, 'Unused IABC is disabled at V−')
  for (const index of [3, 6, 9, 12, 13]) assert.equal(nodes[pins[index]], '0', `Pin ${index + 1} has its external ground connection`)
  for (const part of document.parts.filter(part => part.pins.length === 2)) {
    const [a, b] = part.pins.map(pin => terminalById[pin])
    const span = Math.hypot(a.x - b.x, a.y - b.y)
    assert.ok(span >= 24 && span <= 192, `${part.id} fits the breadboard`)
  }
})

test('real ngspice: LM13700 example gain follows CV bias current while keeping the small audio input linear', { timeout: 15_000 }, async () => {
  const measured: number[] = []
  for (const cv of [-5, 0, 5]) {
    const document = fixture()
    document.instruments.cv = cv
    const point = await solve(document, 'operating-point')
    assert.ok(Math.abs(point.voltage('b15')[0]) < 0.005, 'Balanced OTA has near-zero DC output')
    const { voltage } = await solve(document)
    const rawInput = voltage('c5')
    const input = voltage('e13')
    const output = voltage('b15')
    const bias = voltage('e11')
    assert.ok(Math.abs(amplitude(rawInput) - 2.5) < 0.005)
    assert.ok(amplitude(input) > 0.0045 && amplitude(input) < 0.006, 'Divider keeps differential input in the millivolt range')
    // Small-signal gm is approximately IABC / (2 VT), or 19.2 * IABC at room temperature.
    const current = (cv - bias.at(-1)!) / 100_000
    const expectedAmplitude = 19.2 * current * amplitude(input) * 100_000
    const actualAmplitude = amplitude(output)
    assert.ok(Math.abs(actualAmplitude / expectedAmplitude - 1) < 0.03, `${actualAmplitude} versus gm*Vin*Rload ${expectedAmplitude}`)
    assert.ok(output.every((value, index) => Math.abs(value - input[index] * actualAmplitude / amplitude(input)) < 0.01), 'Output preserves the small-signal waveform and polarity')
    assert.ok(voltage('f15').every(value => Math.abs(value) < 0.005), 'Unused OTA remains off')
    measured.push(actualAmplitude)
  }
  assert.ok(measured[0] > 0.4 && measured[0] < 0.8)
  assert.ok(measured[1] > measured[0] * 1.7)
  assert.ok(measured[2] > measured[1] * 1.4)
  assert.ok(measured[1] > 0.5, 'Zero-volt CV still biases this resistor-controlled circuit, as the lesson states')
})

test('real ngspice: editing the LM13700 output load changes voltage gain', { timeout: 15_000 }, async () => {
  const document = fixture()
  const before = await solve(document)
  document.parts.find(part => part.id === 'R4')!.value = 47_000
  const after = await solve(document)
  const ratio = amplitude(after.voltage('b15')) / amplitude(before.voltage('b15'))
  assert.ok(Math.abs(ratio - 0.47) < 0.01)
  assert.ok(Math.abs(amplitude(after.voltage('c5')) - amplitude(before.voltage('c5'))) < 1e-6)
})
