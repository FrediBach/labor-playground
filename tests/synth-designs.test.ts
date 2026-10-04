import assert from 'node:assert/strict'
import test from 'node:test'
import { Simulation } from 'eecircuit-engine'
import { boardGeometry, compileCircuit, examples, validateDocument, type CircuitDocument } from '../src/lib/circuit.ts'
import { synthDesignExamples } from '../src/lib/synth-design-examples.ts'
import { runCircuitCapture } from '../src/lib/simulation-analysis.ts'
import { operatingPointDescriptors } from '../src/lib/simulation-descriptors.ts'
import { interpolateVoltage } from '../src/lib/measurements.ts'
import type { Capture } from '../src/lib/simulation-types.ts'

const engine = new Simulation()
const example = (id: string) => structuredClone(synthDesignExamples.find(e => e.id === id)!.document)
const part = (doc: CircuitDocument, id: string) => doc.parts.find(p => p.id === id)!
async function solve(doc: CircuitDocument) {
  const tran = compileCircuit(doc), dc = compileCircuit(doc, 'operating-point')
  assert.deepEqual(tran.diagnostics, [])
  assert.deepEqual(dc.diagnostics, [])
  await engine.start()
  return runCircuitCapture(engine, {
    type: 'run', revision: 1, netlist: tran.netlist,
    nodes: { CH1: tran.nodeByTerminal[doc.probes.CH1!], CH2: tran.nodeByTerminal[doc.probes.CH2!] },
    operatingPoint: { netlist: dc.netlist, parts: operatingPointDescriptors(doc, dc.nodeByTerminal) },
  })
}
const at = (c: Capture, ch: 'CH1' | 'CH2', time: number) => interpolateVoltage(c.time, c.channels[ch], time)!
function amplitude(c: Capture, ch: 'CH1' | 'CH2', start = 0.05, end = 0.1) {
  let low = Infinity, high = -Infinity
  c.time.forEach((t, i) => { if (t >= start && t <= end) { low = Math.min(low, c.channels[ch][i]); high = Math.max(high, c.channels[ch][i]) } })
  return (high - low) / 2
}
function frequency(c: Capture, ch: 'CH1' | 'CH2', level = 0) {
  const edges: number[] = []
  for (let i = 1; i < c.time.length; i++) if (c.time[i] > 0.02 && c.channels[ch][i - 1] < level && c.channels[ch][i] >= level) {
    const fraction = (level - c.channels[ch][i - 1]) / (c.channels[ch][i] - c.channels[ch][i - 1])
    edges.push(c.time[i - 1] + fraction * (c.time[i] - c.time[i - 1]))
  }
  assert.ok(edges.length >= 5, `Expected sustained oscillation, got ${edges.length} crossings`)
  return (edges.length - 1) / (edges.at(-1)! - edges[0])
}

test('new synth designs are unique ordinary documents with non-overlapping physical wiring and lessons', () => {
  assert.equal(new Set(examples.map(e => e.id)).size, examples.length)
  for (const e of synthDesignExamples) {
    const doc = e.document
    const serialized = JSON.stringify(doc)
    assert.deepEqual(validateDocument(JSON.parse(serialized)), doc, e.id)
    assert.deepEqual(compileCircuit(doc).diagnostics, [], e.id)
    const occupied = [...doc.parts.flatMap(p => p.pins), ...doc.wires.flatMap(w => [w.from, w.to])]
    assert.equal(new Set(occupied).size, occupied.length, `${e.id}: no shared holes`)
    const geometry = boardGeometry(doc)
    for (const p of doc.parts.filter(p => p.pins.length === 2)) {
      const [a, b] = p.pins.map(pin => geometry.terminalById[pin])
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) <= 192, `${e.id}: ${p.id} lead span`)
    }
    assert.ok(doc.documentation?.sections.length)
    assert.ok(doc.parts.every(p => p.schemaGroup))
  }
})

test('real ngspice: SEM band/low-pass responses follow the two-integrator law and CV moves cutoff', { timeout: 30_000 }, async () => {
  const doc = example('sem-filter')
  for (const cv of [-5, 0, 5]) {
    doc.instruments.cv = cv
    for (const f of [80, 300, 1200]) {
      doc.instruments.frequency = f
      const c = await solve(doc)
      // IABC ~ (CV + 10.7 V)/100k, gm=IABC/52mV; the loaded 100k/1k
      // divider is close to 1/101. Bias junction voltage and finite input
      // resistance account for a few percent versus this nominal equation.
      const pole = ((cv + 10.7) / 100_000 / 0.052) / 101 / (2 * Math.PI * 10e-9)
      const x = f / pole
      const lp = 0.5 / Math.hypot(1 - x * x, x)
      assert.ok(Math.abs(amplitude(c, 'CH2') / lp - 1) < 0.08, `${cv} V / ${f} Hz`)
      assert.ok(Math.abs(amplitude(c, 'CH1') / amplitude(c, 'CH2') / x - 1) < 0.04)
    }
  }
  doc.instruments.cv = 0
  doc.instruments.frequency = 320
  const before = await solve(doc)
  part(doc, 'R4').value = 47_000
  const after = await solve(doc)
  assert.ok(amplitude(after, 'CH1') > 1.7 * amplitude(before, 'CH1'))
})

test('real ngspice: MS-20 feedback raises resonance and its low-pass rolls off at high frequency', { timeout: 30_000 }, async () => {
  const doc = example('ms20-filter')
  const gains: number[] = []
  for (const f of [80, 500, 1000, 2000]) {
    doc.instruments.frequency = f
    const c = await solve(doc)
    gains.push(amplitude(c, 'CH2') / amplitude(c, 'CH1'))
  }
  assert.ok(gains[3] < gains[1] * 0.15)
  assert.ok(gains[3] / gains[2] > 0.20 && gains[3] / gains[2] < 0.27, `High-frequency octave ratio ${gains[3] / gains[2]}`)
  doc.instruments.frequency = 310
  const low = await solve(doc)
  part(doc, 'P1').position = 0.25
  const high = await solve(doc)
  assert.ok(amplitude(high, 'CH2') > amplitude(low, 'CH2') * 1.3)
  doc.instruments.cv = -5
  const lowerCutoff = await solve(doc)
  assert.ok(amplitude(lowerCutoff, 'CH2') < amplitude(high, 'CH2'))
  doc.instruments.cv = 0
  part(doc, 'P1').position = 0.4
  const inputWire = doc.wires.find(w => w.from === 'osc')!
  inputWire.from = 'eg'
  doc.instruments.envelope = { mode: 'trigger', gateHigh: false, decayMs: 20 }
  const resonating = await solve(doc)
  assert.ok(amplitude(resonating, 'CH2') > 1, 'Positive capacitive feedback sustains a limited oscillation')
  inputWire.from = 'osc'
  doc.instruments.amplitude = 2
  const driven = await solve(doc)
  assert.ok(amplitude(driven, 'CH2') < 3, 'LED feedback limiter bounds the strong-input response')
})

test('real ngspice: WASP CMOS loop filters around midrail and both bias resistors tune it', { timeout: 30_000 }, async () => {
  const doc = example('wasp-filter')
  const amplitudes: number[] = []
  for (const f of [80, 300, 1200]) {
    doc.instruments.frequency = f
    const c = await solve(doc)
    amplitudes.push(amplitude(c, 'CH2'))
    assert.ok(c.channels.CH1.every(v => v > 2 && v < 3))
    assert.ok(c.channels.CH2.every(v => v > 2 && v < 3))
  }
  assert.ok(amplitudes[2] < amplitudes[0] * 0.06)
  doc.instruments.frequency = 300
  const before = await solve(doc)
  for (const id of ['R10', 'R14']) part(doc, id).value = 680_000
  const after = await solve(doc)
  assert.ok(amplitude(after, 'CH2') < amplitude(before, 'CH2') * 0.5)
  doc.instruments.amplitude = 2
  const driven = await solve(doc)
  assert.ok(driven.channels.CH2.every(v => v >= 0 && v <= 5))
})

test('real ngspice: triangle and current-ramp oscillators start, sustain and scale with timing capacitance', { timeout: 30_000 }, async () => {
  for (const [id, level, nominal] of [['triangle-core', 0, 500], ['current-saw-core', 6, 170]] as const) {
    const doc = example(id)
    const first = await solve(doc)
    const hz = frequency(first, 'CH1', level)
    assert.ok(Math.abs(hz / nominal - 1) < 0.15, `${id}: ${hz} Hz`)
    part(doc, 'C1').value *= 2.2
    const slower = frequency(await solve(doc), 'CH1', level)
    assert.ok(Math.abs(hz / slower - 2.2) < 0.03, `${id}: ${hz} / ${slower} Hz`)
    if (id === 'triangle-core') {
      assert.ok(amplitude(first, 'CH1') > 5 && amplitude(first, 'CH1') < 6.5)
      assert.ok(Math.abs(frequency(first, 'CH2') / hz - 1) < 0.001)
    } else {
      // The central part of a charging ramp is linear to within 3%; avoid
      // the fast discharge edge and the startup cycle.
      const t = first.time.find((t, i) => t > 0.03 && first.channels.CH1[i] > 4.5 && first.channels.CH1[i] < 4.6)!
      const delta = 0.0005
      const a = at(first, 'CH1', t), b = at(first, 'CH1', t + delta), c = at(first, 'CH1', t + 2 * delta)
      assert.ok(b > a && c > b)
      assert.ok(Math.abs((c - b) / (b - a) - 1) < 0.03)
    }
  }
})

test('real ngspice: low-pass gate decays and its capacitor controls brightness', { timeout: 15_000 }, async () => {
  const doc = example('vactrol-lpg')
  const c = await solve(doc)
  const peak = amplitude(c, 'CH2', 0.005, 0.015)
  assert.ok(peak > 0.5)
  assert.ok(amplitude(c, 'CH2', 0.08, 0.1) < peak * 0.1)
  part(doc, 'C1').value = 10e-9
  assert.ok(amplitude(await solve(doc), 'CH2', 0.005, 0.015) > peak * 1.3)
})

test('real ngspice: asymmetric portamento has a fast initial rise and a predictable exponential fall', { timeout: 15_000 }, async () => {
  const doc = example('asymmetric-slew')
  const c = await solve(doc)
  assert.ok(at(c, 'CH2', 0.004) > 3.8)
  assert.ok(at(c, 'CH2', 0.05) > 4.9)
  // After the 51ms falling edge only R2+100Ω source resistance discharges C1.
  const expected = 5 * Math.exp(-0.01 / (100_100 * 100e-9))
  assert.ok(Math.abs(at(c, 'CH2', 0.061) - expected) < 0.02)
  part(doc, 'R2').value = 220_000
  assert.ok(at(await solve(doc), 'CH2', 0.061) > 3)
})
