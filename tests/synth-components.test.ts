import assert from 'node:assert/strict'
import test from 'node:test'
import { Simulation } from 'eecircuit-engine'
import { compileCircuit, getPlacement, isValidFootprint, validateDocument, type CircuitDocument } from '../src/lib/circuit.ts'
import { synthExamples } from '../src/lib/synth-examples.ts'
import { synthIcLines } from '../src/lib/synth-models.ts'
import { runCircuitCapture } from '../src/lib/simulation-analysis.ts'
import { operatingPointDescriptors } from '../src/lib/simulation-descriptors.ts'
import { extractCapture } from '../src/lib/simulation-results.ts'
import { interpolateVoltage } from '../src/lib/measurements.ts'

const engine = new Simulation()
const example = (id: string) => structuredClone(synthExamples.find(e => e.id === id)!.document)
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

test('synth examples round-trip without diagnostics and footprints remain rigid in both orientations', () => {
  for (const { document } of synthExamples) {
    assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(document))), document)
    assert.deepEqual(compileCircuit(document).diagnostics, [])
    const occupied = [...document.parts.flatMap(p => p.pins), ...document.wires.flatMap(w => [w.from, w.to])]
    assert.equal(new Set(occupied).size, occupied.length)
  }
  for (const kind of ['njfet', 'nmos', 'lm393', 'cd4066'] as const) {
    const dip = kind === 'lm393' || kind === 'cd4066'
    for (const [hole, rotation] of [[dip ? 'e10' : 'a10', 0], [dip ? 'f20' : 'c20', 180]] as const) assert.ok(isValidFootprint(kind, getPlacement(kind, hole, rotation)!))
    assert.equal(getPlacement(kind, 'a29'), null)
    assert.equal(getPlacement(kind, 'd10', 90), null)
  }
})

test('FET gates require an external DC return and IC supplies enforce their voltage range', () => {
  const fet = example('jfet-buffer')
  fet.wires = fet.wires.filter(w => w.from !== 'osc')
  fet.parts = fet.parts.filter(p => p.id !== 'R2')
  assert.ok(compileCircuit(fet).diagnostics.some(d => d.severity === 'error' && /c11/.test(d.message)))
  const sw = example('analog-track-hold')
  sw.wires.find(w => w.from === 'cv')!.from = 'vplus'
  sw.wires.find(w => w.from === 'gnd')!.from = 'vminus'
  assert.ok(compileCircuit(sw).diagnostics.some(d => d.severity === 'error' && /3–18 V/.test(d.message)))
  const cmp = example('comparator-gate')
  cmp.parts = cmp.parts.filter(p => p.id !== 'R1')
  assert.ok(compileCircuit(cmp).diagnostics.some(d => /OUT A.*pull-up/.test(d.message)))
  cmp.wires = cmp.wires.filter(w => w.from !== 'vplus')
  assert.ok(compileCircuit(cmp).diagnostics.some(d => d.severity === 'error' && /supply/.test(d.message)))
})

test('real JFET follower self-biases, buffers and pinches off with negative gate voltage', async () => {
  const doc = example('jfet-buffer')
  const capture = await solve(doc)
  const output = capture.channels.CH2
  assert.ok(Math.min(...output) > 0.5 && Math.max(...output) < 2)
  const gain = (Math.max(...output) - Math.min(...output)) / (Math.max(...capture.channels.CH1) - Math.min(...capture.channels.CH1))
  assert.ok(gain > 0.65 && gain < 1, `gain ${gain}`)
  const currents = capture.operatingPoint!.parts.J1.currents
  assert.ok(currents[0].value > 0.0002 && currents[0].value < 0.001)
  assert.ok(Math.abs(currents[1].value) < 1e-8)
  doc.wires.find(w => w.from === 'osc')!.from = 'cv'
  doc.instruments.cv = -5
  const off = await solve(doc)
  assert.ok(Math.abs(off.channels.CH2.at(-1)!) < 1e-4)
})

test('real MOSFET inverter turns off and on with measured drain current and power', async () => {
  const doc = example('mosfet-gate-inverter')
  const off = await solve(doc)
  assert.ok(off.channels.CH2.at(-1)! > 11.99)
  doc.instruments.cv = 5
  const on = await solve(doc)
  assert.ok(on.channels.CH2.at(-1)! > 0 && on.channels.CH2.at(-1)! < 0.1)
  const measured = on.operatingPoint!.parts.M1
  assert.ok(measured.currents[0].value > 0.0011 && measured.currents[0].value < 0.0013)
  assert.ok(Math.abs(measured.currents[1].value) < 1e-8)
  assert.ok(measured.power > 0)
})

test('real comparator produces pull-up-defined gates and responds on both sections', async () => {
  const capture = await solve(example('comparator-gate'))
  assert.ok(Math.max(...capture.channels.CH2) > 4.99)
  assert.ok(Math.min(...capture.channels.CH2) >= 0 && Math.min(...capture.channels.CH2) < 0.05)
  assert.ok(interpolateVoltage(capture.time, capture.channels.CH2, 0.001)! > 4.9)
  assert.ok(interpolateVoltage(capture.time, capture.channels.CH2, 0.003)! < 0.1)
  // Separate fixture checks B polarity and the lack of any internal high driver.
  await engine.start()
  const nodes = ['out', 'minus', 'plus', '0', 'minus', 'plus', 'other', 'vcc']
  engine.setNetList(`Comparator fixture\nVCC vcc 0 12\nVP plus 0 3\nVM minus 0 2\nRP vcc out 10k\nRQ vcc other 10k\n${synthIcLines('lm393', 'U1', nodes).join('\n')}\n.tran 1u 1m\n.save all\n.end`)
  const result = extractCapture(await engine.runSim(), { CH1: 'out', CH2: 'other' }, 1, 0)
  assert.ok(result.channels.CH1.at(-1)! > 11.99)
  assert.ok(result.channels.CH2.at(-1)! < 0.1)
})

test('real CD4066 acquires and holds a sample with finite leakage droop', async () => {
  const capture = await solve(example('analog-track-hold'))
  const value = (t: number) => interpolateVoltage(capture.time, capture.channels.CH2, t)!
  assert.ok(Math.abs(value(0.0018) - interpolateVoltage(capture.time, capture.channels.CH1, 0.0018)!) < 0.12)
  assert.ok(value(0.01) > 2 && value(0.01) < 4)
  assert.ok(value(0.08) < value(0.01) * 0.6)
  const doc = example('analog-track-hold')
  doc.instruments.envelope = { mode: 'gate', gateHigh: true, decayMs: 20 }
  const tracking = await solve(doc)
  assert.ok(Math.max(...tracking.channels.CH2) - Math.min(...tracking.channels.CH2) > 1.8)
})

test('all four analog switches conduct bilaterally with finite on resistance and turn off', async () => {
  for (const [a, b, enable] of [[0, 1, 12], [2, 3, 4], [7, 8, 5], [9, 10, 11]]) {
    for (const reverse of [false, true]) {
      const n = Array<string>(14).fill('0')
      n[13] = 'vcc'; n[enable] = 'control'; n[reverse ? b : a] = 'input'; n[reverse ? a : b] = 'out'
      await engine.start()
      engine.setNetList(`Analog switch fixture\nVCC vcc 0 5\nVI input 0 3\nVC control 0 PULSE(0 5 1m 1u 1u 2m 10m)\nRL out 0 10k\n${synthIcLines('cd4066', 'U1', n).join('\n')}\n.tran 2u 5m\n.save all\n.end`)
      const capture = extractCapture(await engine.runSim(), { CH1: 'input', CH2: 'out' }, 1, 0)
      const on = interpolateVoltage(capture.time, capture.channels.CH2, 0.002)!
      assert.ok(on > 2.8 && on < 2.9, `on level ${on}`)
      assert.ok(capture.channels.CH2.at(-1)! < 0.001)
    }
  }
})

test('MOSFET body diode conducts with negative drain bias while its gate stays off', async () => {
  const doc = example('mosfet-gate-inverter')
  doc.wires.find(w => w.from === 'vplus')!.from = 'vminus'
  const capture = await solve(doc)
  const drain = capture.channels.CH2.at(-1)!
  assert.ok(drain < -0.3 && drain > -0.9, `body diode clamp ${drain}`)
  assert.ok(capture.operatingPoint!.parts.M1.currents[0].value < -0.001)
  assert.ok(capture.operatingPoint!.parts.M1.power > 0)
})
