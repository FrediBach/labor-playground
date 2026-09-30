import assert from 'node:assert/strict'
import test from 'node:test'
import { Simulation } from 'eecircuit-engine'
import { activeExamples } from '../src/lib/active-examples.ts'
import { compileCircuit, terminalById, validateDocument, type CircuitDocument } from '../src/lib/circuit.ts'

const engine = new Simulation()
const example = (id: string) => structuredClone(activeExamples.find((item) => item.id === id)!.document)

async function solve(document: CircuitDocument, analysis: 'transient' | 'operating-point' = 'transient') {
  const compiled = compileCircuit(document, analysis)
  assert.deepEqual(compiled.diagnostics, [])
  await engine.start()
  engine.setNetList(compiled.netlist)
  const result = await engine.runSim()
  assert.deepEqual(engine.getError(), [])
  const voltage = (terminal: string) => {
    const values = result.data.find((vector) => vector.name === `v(${compiled.nodeByTerminal[terminal]})`)?.values
    assert.ok(values?.length, `Missing voltage at ${terminal}`)
    assert.ok(values.every(Number.isFinite), `Nonfinite voltage at ${terminal}`)
    return values
  }
  const time = result.data.find((vector) => vector.type === 'time')?.values ?? []
  const input = voltage(document.probes.CH1!)
  const output = voltage(document.probes.CH2!)
  const amplitude = (values: number[]) => {
    const steady = values.filter((_, index) => time[index] > 0.05)
    return (Math.max(...steady) - Math.min(...steady)) / 2
  }
  return { input, output, voltage, amplitude }
}

test('active synth examples fit the editable board and explicitly power and bypass each TL072', () => {
  for (const { id, document } of activeExamples) {
    assert.deepEqual(validateDocument(document), document, id)
    const compiled = compileCircuit(document)
    assert.deepEqual(compiled.diagnostics, [], id)
    const nodes = compiled.nodeByTerminal
    const opamp = document.parts.find((part) => part.kind === 'opamp')!
    assert.equal(nodes[opamp.pins[3]], nodes.vminus, `${id}: pin 4`)
    assert.equal(nodes[opamp.pins[7]], nodes.vplus, `${id}: pin 8`)
    for (const [capacitorId, supply] of [['C3', 'vplus'], ['C4', 'vminus']]) {
      const capacitor = document.parts.find((part) => part.id === capacitorId)!
      assert.equal(capacitor.kind, 'capacitor')
      assert.equal(capacitor.value, 100e-9)
      assert.deepEqual(new Set(capacitor.pins.map((pin) => nodes[pin])), new Set([nodes[supply], '0']))
    }
    for (const part of document.parts.filter((part) => part.pins.length === 2)) {
      const [a, b] = part.pins.map((pin) => terminalById[pin])
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      assert.ok(distance >= 24 && distance <= 192, `${id}: ${part.id} lead span`)
    }
  }
})

test('real ngspice: mixer preserves audio polarity and documented CV weighting in transient and DC', { timeout: 15_000 }, async () => {
  const document = example('cv-mixer')
  for (const [cv, resistance] of [[2, 100_000], [-2, 100_000], [2, 47_000]]) {
    document.instruments.cv = cv
    document.parts.find((part) => part.id === 'R2')!.value = resistance
    const expectedOffset = cv * 100_000 / resistance
    const capture = await solve(document)
    assert.ok(Math.abs(capture.amplitude(capture.input) - 2.5) < 0.005)
    assert.ok(Math.abs(capture.amplitude(capture.output) - capture.amplitude(capture.input)) < 0.005)
    assert.ok(capture.output.every((value, index) => Math.abs(value - capture.input[index] - expectedOffset) < 0.005))
    assert.ok(capture.output.every((value) => Math.abs(value) < 7))
    const point = await solve(document, 'operating-point')
    assert.ok(Math.abs(point.output[0] - expectedOffset) < 0.005)
  }
})

test('real ngspice: buffered attenuverter scales, nulls and inverts audio and DC with its pot', { timeout: 15_000 }, async () => {
  const document = example('attenuverter')
  for (const position of [0.75, 0.5, 0, 1]) {
    document.parts.find((part) => part.id === 'P1')!.position = position
    const gain = 2 * position - 1
    const capture = await solve(document)
    assert.ok(Math.abs(capture.amplitude(capture.input) - 2.5) < 0.005)
    assert.ok(capture.output.every((value, index) => Math.abs(value - gain * capture.input[index]) < 0.002))
    const dcDocument = structuredClone(document)
    dcDocument.wires.find((wire) => wire.from === 'osc')!.from = 'cv'
    const point = await solve(dcDocument, 'operating-point')
    assert.ok(Math.abs(point.output[0] - gain * dcDocument.instruments.cv) < 0.002)
  }
})

test('real ngspice: Sallen–Key feedback raises Q and high frequencies fall by 12 dB per octave', { timeout: 15_000 }, async () => {
  const document = example('sallen-key-filter')
  const poleFrequency = 1 / (2 * Math.PI * 10_000 * 100e-9)
  for (const feedback of [4_700, 10_000]) {
    document.parts.find((part) => part.id === 'R3')!.value = feedback
    const gain = 1 + feedback / 10_000
    const q = 1 / (3 - gain)
    const ratios: number[] = []
    for (const frequency of [20, 160, 640, 1_280]) {
      document.instruments.frequency = frequency
      const capture = await solve(document)
      const ratio = capture.amplitude(capture.output) / capture.amplitude(capture.input)
      const normalized = frequency / poleFrequency
      const expected = gain / Math.sqrt((1 - normalized ** 2) ** 2 + (normalized / q) ** 2)
      assert.ok(Math.abs(ratio - expected) < 0.005, `${feedback} Ω at ${frequency} Hz: ${ratio} vs ${expected}`)
      assert.ok(capture.output.every((value) => Math.abs(value) < 7), 'Filter stays below clipping')
      if (frequency === 160) {
        const targetPeak = feedback === 4_700 ? 2.4 : 5
        assert.ok(Math.abs(capture.amplitude(capture.output) - targetPeak) < 0.1)
      }
      ratios.push(ratio)
    }
    const octaveRatio = ratios[3] / ratios[2]
    assert.ok(octaveRatio > 0.24 && octaveRatio < 0.27, `${octaveRatio}: expected one quarter per octave`)
    const dcDocument = structuredClone(document)
    dcDocument.wires.find((wire) => wire.from === 'osc')!.from = 'cv'
    dcDocument.instruments.cv = 2
    const point = await solve(dcDocument, 'operating-point')
    assert.ok(Math.abs(point.output[0] - 2 * gain) < 0.002)
    assert.ok(Math.abs(point.voltage('j14')[0]) < 1e-8, 'Unused amplifier is a grounded follower')
  }
})
