import assert from 'node:assert/strict'
import test from 'node:test'
import { Simulation } from 'eecircuit-engine'
import { compileCircuit, getPlacement, isValidFootprint, validateDocument, type CircuitDocument } from '../src/lib/circuit.ts'
import { synthLogicExamples } from '../src/lib/synth-logic-examples.ts'
import { synthLogicLines, FLIP_FLOP_SECTIONS, QUAD_GATE_SECTIONS } from '../src/lib/synth-logic.ts'
import { runCircuitCapture } from '../src/lib/simulation-analysis.ts'
import { operatingPointDescriptors } from '../src/lib/simulation-descriptors.ts'
import { extractCapture } from '../src/lib/simulation-results.ts'
import { interpolateVoltage } from '../src/lib/measurements.ts'
import type { Capture } from '../src/lib/simulation-types.ts'

const engine = new Simulation()
const example = (id: string) => structuredClone(synthLogicExamples.find(e => e.id === id)!.document)
const at = (capture: Capture, channel: 'CH1' | 'CH2', time: number) => interpolateVoltage(capture.time, capture.channels[channel], time)!
async function solve(doc: CircuitDocument) {
  const compiled = compileCircuit(doc), dc = compileCircuit(doc, 'operating-point')
  assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), [])
  await engine.start()
  return runCircuitCapture(engine, {
    type: 'run', revision: 1, netlist: compiled.netlist,
    nodes: { CH1: compiled.nodeByTerminal[doc.probes.CH1!], CH2: compiled.nodeByTerminal[doc.probes.CH2!] },
    operatingPoint: { netlist: dc.netlist, parts: operatingPointDescriptors(doc, dc.nodeByTerminal) },
  })
}
async function fixture(lines: string[], duration = '10m', step = '5u') {
  await engine.start()
  engine.setNetList(`Synth logic fixture\n${lines.join('\n')}\n.tran ${step} ${duration} 0 ${step}\n.save all\n.end`)
  return extractCapture(await engine.runSim(), { CH1: 'input', CH2: 'out' }, 1, 0)
}
function gateNodes() {
  const n = Array.from({ length: 14 }, (_, i) => `unused${i}`)
  n[6] = '0'; n[13] = 'vcc'
  return n
}

test('logic examples import cleanly, retain pin order, and have no occupied-hole conflicts', () => {
  for (const { document } of synthLogicExamples) {
    assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(document))), document)
    assert.deepEqual(compileCircuit(document).diagnostics, [])
    const occupied = [...document.parts.flatMap(p => p.pins), ...document.wires.flatMap(w => [w.from, w.to])]
    assert.equal(new Set(occupied).size, occupied.length)
  }
  for (const kind of ['cd4013', 'cd4070', 'cd4081', 'pc817'] as const) {
    assert.ok(isValidFootprint(kind, getPlacement(kind, 'e10')!))
    assert.ok(isValidFootprint(kind, getPlacement(kind, 'f20', 180)!))
    assert.equal(getPlacement(kind, 'a10'), null)
  }
  const doc = example('opto-gate-input')
  for (const value of [50, 100, 600]) { doc.parts[0].value = value; assert.equal(validateDocument(doc).parts[0].value, value) }
  for (const value of [0, 49, 601, NaN]) { doc.parts[0].value = value; assert.throws(() => validateDocument(doc), /value/) }
})

test('logic requires supplies and all input returns; optocoupler does not bridge its isolated sides', () => {
  const doc = example('clock-divider')
  doc.wires = doc.wires.filter(w => w.from !== 'b14')
  assert.ok(compileCircuit(doc).diagnostics.some(d => d.severity === 'error' && /RST A/.test(d.message)))
  const unpowered = example('and-clock-gate')
  unpowered.wires = unpowered.wires.filter(w => w.from !== 'j11')
  assert.ok(compileCircuit(unpowered).diagnostics.some(d => d.severity === 'error' && /supply/.test(d.message)))
  const optical = example('opto-gate-input')
  optical.wires = optical.wires.filter(w => w.from !== 'j12' && w.from !== 'cv')
  assert.ok(compileCircuit(optical).diagnostics.some(d => d.severity === 'error' && /Collector|Emitter/.test(d.message)))
})

test('all XOR and AND sections implement all four truth-table rows with finite loaded outputs', async () => {
  for (const kind of ['cd4070', 'cd4081'] as const) {
    for (const [a, b, out] of QUAD_GATE_SECTIONS) {
      const n = gateNodes()
      for (const [x, y] of QUAD_GATE_SECTIONS) { n[x] = '0'; n[y] = '0' }
      n[a] = 'input'; n[b] = 'second'; n[out] = 'out'
      const capture = await fixture(['VCC vcc 0 5', 'VA input 0 PWL(0 0 4m 0 4.001m 5)', 'VB second 0 PWL(0 0 2m 0 2.001m 5 4m 5 4.001m 0 6m 0 6.001m 5)', 'RL out 0 10k', ...synthLogicLines(kind, 'U1', n)])
      for (const [i, [x, y]] of [[0, 0], [0, 1], [1, 0], [1, 1]].entries()) {
        const expected = kind === 'cd4070' ? x !== y : !!(x && y)
        const value = at(capture, 'CH2', 0.001 + i * 0.002)
        assert.ok(expected ? value > 4.7 && value < 4.8 : Math.abs(value) < 0.001, `${kind} output ${out}, ${x}/${y}: ${value}`)
      }
    }
  }
})

test('both flip-flops capture only rising edges and honor asynchronous set/reset', async () => {
  for (const [q, nq, clock, reset, data, set] of FLIP_FLOP_SECTIONS) {
    const n = gateNodes()
    for (const [, , clk, rst, d, s] of FLIP_FLOP_SECTIONS) for (const pin of [clk, rst, d, s]) n[pin] = '0'
    n[q] = 'out'; n[nq] = 'inverse'; n[clock] = 'clock'; n[data] = 'input'; n[reset] = 'reset'; n[set] = 'set'
    const capture = await fixture(['VCC vcc 0 5', 'VD input 0 PWL(0 5 2m 5 2.001m 0)', 'VC clock 0 PWL(0 0 1m 0 1.001m 5 3m 5 3.001m 0 4m 0 4.001m 5)', 'VR reset 0 PWL(0 0 7m 0 7.001m 5)', 'VS set 0 PWL(0 0 6m 0 6.001m 5 8m 5 8.001m 0)', ...synthLogicLines('cd4013', 'U1', n)])
    assert.ok(at(capture, 'CH2', 0.0005) < 0.01)
    assert.ok(at(capture, 'CH2', 0.0015) > 4.99)
    assert.ok(at(capture, 'CH2', 0.0025) > 4.99, 'data changing during high clock must not pass through')
    assert.ok(at(capture, 'CH2', 0.0035) > 4.99, 'falling clock must not sample')
    assert.ok(at(capture, 'CH2', 0.0045) < 0.01)
    assert.ok(at(capture, 'CH2', 0.0065) > 4.99)
    assert.ok(at(capture, 'CH2', 0.0075) > 4.99, 'both async inputs force Q high')
    assert.ok(at(capture, 'CH2', 0.0085) < 0.01)
  }
})

test('cascaded flip-flops divide by two and four, with the expected output periods', async () => {
  const capture = await solve(example('clock-divider'))
  const period = (channel: 'CH1' | 'CH2') => {
    const crossings: number[] = []
    for (let i = 1; i < capture.time.length; i++) if (capture.time[i] > 0.01 && capture.channels[channel][i - 1] < 2.5 && capture.channels[channel][i] >= 2.5) crossings.push(capture.time[i])
    assert.ok(crossings.length > 3)
    return (crossings.at(-1)! - crossings[0]) / (crossings.length - 1)
  }
  assert.ok(Math.abs(period('CH1') - 2 / 220) < 2e-5)
  assert.ok(Math.abs(period('CH2') - 4 / 220) < 2e-5)
})

test('AND clock enable blocks the pulse train; XOR combines two independent clocks', async () => {
  const doc = example('and-clock-gate')
  const enabled = await solve(doc)
  assert.ok(Math.max(...enabled.channels.CH2) > 4.9 && Math.min(...enabled.channels.CH2) < 0.1)
  doc.instruments.envelope!.gateHigh = false
  assert.ok(Math.max(...(await solve(doc)).channels.CH2) < 0.001)
  const xor = await solve(example('xor-ring-modulator'))
  assert.ok(Math.max(...xor.channels.CH2) > 4.9 && Math.min(...xor.channels.CH2) < 0.1)
  const differences = xor.time.filter((t, i) => t > 0.02 && Math.abs(xor.channels.CH1[i] - xor.channels.CH2[i]) > 4).length
  assert.ok(differences > 100)
})

test('optocoupler CTR scales unsaturated collector current and its output saturates under stronger drive', async () => {
  const currents: number[] = []
  for (const ctr of [50, 100, 200, 600]) {
    const capture = await fixture(['VCC vcc 0 5', 'VI input 0 0', 'ILED 0 anode 1m', 'RL vcc out 1k', ...synthLogicLines('pc817', 'O1', ['anode', '0', '0', 'out'], ctr)], '1m')
    currents.push((5 - capture.channels.CH2.at(-1)!) / 1000)
  }
  assert.ok(currents[0] > 0.00045 && currents[0] < 0.0006)
  assert.ok(currents[1] / currents[0] > 1.9 && currents[1] / currents[0] < 2.1)
  assert.ok(currents[2] / currents[1] > 1.9 && currents[2] / currents[1] < 2.1)
  assert.ok(currents[3] > 0.0048 && currents[3] < 0.005)
})

test('opto gate receiver responds to its pulse and exposes measured currents on both sides', async () => {
  const capture = await solve(example('opto-gate-input'))
  assert.ok(at(capture, 'CH2', 0.0005) > 4.99)
  assert.ok(at(capture, 'CH2', 0.0015) < 0.2)
  assert.ok(at(capture, 'CH2', 0.003) > 4.99)
  const doc = example('opto-gate-input')
  doc.instruments.envelope = { mode: 'gate', gateHigh: true, decayMs: 20 }
  const steady = await solve(doc)
  const measured = steady.operatingPoint!.parts.O1
  assert.equal(measured.currents.length, 2)
  assert.ok(measured.currents[0].value > 0.003)
  assert.ok(measured.currents[1].value > 0.00048)
  assert.ok(measured.power > 0)
})
