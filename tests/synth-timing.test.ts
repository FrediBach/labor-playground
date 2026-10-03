import assert from 'node:assert/strict'
import test from 'node:test'
import { Simulation } from 'eecircuit-engine'
import { compileCircuit, getPlacement, isValidFootprint, validateDocument, type CircuitDocument } from '../src/lib/circuit.ts'
import { synthTimingExamples } from '../src/lib/synth-timing-examples.ts'
import { synthTimingLines, COUNTER_OUTPUTS, COUNTER_NC } from '../src/lib/synth-timing.ts'
import { synthLogicLines, QUAD_GATE_SECTIONS } from '../src/lib/synth-logic.ts'
import { runCircuitCapture } from '../src/lib/simulation-analysis.ts'
import { operatingPointDescriptors } from '../src/lib/simulation-descriptors.ts'
import { extractCapture } from '../src/lib/simulation-results.ts'
import { interpolateVoltage } from '../src/lib/measurements.ts'
import type { Capture } from '../src/lib/simulation-types.ts'

const engine = new Simulation()
const example = (id: string) => structuredClone(synthTimingExamples.find(e => e.id === id)!.document)
const at = (capture: Capture, channel: 'CH1' | 'CH2', time: number) => interpolateVoltage(capture.time, capture.channels[channel], time)!
async function solve(doc: CircuitDocument) {
  const compiled = compileCircuit(doc), dc = compileCircuit(doc, 'operating-point')
  assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), [])
  await engine.start()
  return runCircuitCapture(engine, { type: 'run', revision: 1, netlist: compiled.netlist,
    nodes: { CH1: compiled.nodeByTerminal[doc.probes.CH1!], CH2: compiled.nodeByTerminal[doc.probes.CH2!] },
    operatingPoint: { netlist: dc.netlist, parts: operatingPointDescriptors(doc, dc.nodeByTerminal) },
  })
}
async function fixture(lines: string[], outputs = ['out'], duration = '10m', step = '5u') {
  await engine.start()
  engine.setNetList(`Timing fixture\n${lines.join('\n')}\n.tran ${step} ${duration} 0 ${step}\n.options reltol=0.001 abstol=1e-12 vntol=1e-6 trtol=0.01\n.save all\n.end`)
  const result = await engine.runSim()
  return outputs.map(output => extractCapture(result, { CH1: 'input', CH2: output }, 1, 0))
}
const nodes = () => { const n = Array.from({ length: 14 }, (_, i) => `pin${i + 1}`); n[6] = '0'; n[13] = 'vcc'; return n }

test('timing examples import with valid packages, clear diagnostics, and no occupied-hole conflicts', () => {
  for (const { document } of synthTimingExamples) {
    assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(document))), document)
    assert.deepEqual(compileCircuit(document).diagnostics, [])
    const occupied = [...document.parts.flatMap(p => p.pins), ...document.wires.flatMap(w => [w.from, w.to])]
    assert.equal(new Set(occupied).size, occupied.length)
  }
  for (const kind of ['cd4024', 'cd4093', 'cd4001', 'lm4040'] as const) {
    assert.ok(isValidFootprint(kind, getPlacement(kind, 'e11')!))
    assert.ok(isValidFootprint(kind, getPlacement(kind, 'f20', 180)!))
  }
})

test('counter NC pins remain isolated and reference pin 1 can only float or join its anode', () => {
  const doc = example('ripple-divider')
  const compiled = compileCircuit(doc)
  for (const index of COUNTER_NC) assert.ok(!compiled.netlist.includes(`v(${compiled.nodeByTerminal[doc.parts[0].pins[index]]})`))
  // Adding a Schmitt RC timer must not relax the counter integration setting.
  const combined = structuredClone(doc)
  combined.parts.push({ id: 'U2', kind: 'cd4093', value: 1, pins: getPlacement('cd4093', 'e22')! })
  combined.wires.push({ id: 'W20', from: 'j22', to: 'tp4', color: '#d98870' })
  for (const [i, pin] of ['b22', 'b23', 'b26', 'b27', 'b28', 'j28', 'j27', 'j24', 'j23'].entries()) combined.wires.push({ id: `W${21 + i}`, from: pin, to: `tn${3 + i}`, color: '#6a839b' })
  assert.deepEqual(compileCircuit(combined).diagnostics, [])
  assert.match(compileCircuit(combined).netlist, /trtol=0\.01/)
  doc.wires = doc.wires.filter(w => w.from !== 'eg')
  assert.ok(compileCircuit(doc).diagnostics.some(d => /RESET/.test(d.message)))
  const ref = example('precision-cv-reference')
  ref.wires.push({ id: 'W10', from: 'b13', to: 'c15', color: '#6a839b' })
  assert.deepEqual(compileCircuit(ref).diagnostics, [])
  ref.wires.at(-1)!.to = 'cv'
  assert.ok(compileCircuit(ref).diagnostics.some(d => /pin 1 must float/.test(d.message)))
})

test('every NOR and Schmitt NAND section implements its truth table with finite output drive', async () => {
  for (const kind of ['cd4001', 'cd4093'] as const) for (const [a, b, out] of QUAD_GATE_SECTIONS) {
    const n = nodes()
    for (const [x, y] of QUAD_GATE_SECTIONS) { n[x] = '0'; n[y] = '0' }
    n[a] = 'input'; n[b] = 'second'; n[out] = 'out'
    const model = kind === 'cd4001' ? synthLogicLines(kind, 'U1', n) : synthTimingLines(kind, 'U1', n)
    const [capture] = await fixture(['VCC vcc 0 5', 'VA input 0 PWL(0 0 4m 0 4.001m 5)', 'VB second 0 PWL(0 0 2m 0 2.001m 5 4m 5 4.001m 0 6m 0 6.001m 5)', 'RL out 0 10k', ...model])
    for (const [i, [x, y]] of [[0, 0], [0, 1], [1, 0], [1, 1]].entries()) {
      const expected = kind === 'cd4001' ? !(x || y) : !(x && y)
      const value = at(capture, 'CH2', 0.001 + i * 0.002)
      assert.ok(expected ? value > 4.7 && value < 4.8 : Math.abs(value) < 0.001, `${kind} ${out}: ${x}/${y} => ${value}`)
    }
  }
})

test('both NAND inputs retain state inside the Schmitt hysteresis band', async () => {
  for (const input of [0, 1]) {
    const n = nodes()
    for (const [x, y] of QUAD_GATE_SECTIONS) { n[x] = '0'; n[y] = '0' }
    n[0] = 'vcc'; n[1] = 'vcc'; n[input] = 'input'; n[2] = 'out'
    const [capture] = await fixture(['VCC vcc 0 5', 'VIN input 0 PWL(0 0 1m 0 2m 2.5 3m 2.5 4m 5 5m 5 6m 2.5 7m 2.5 8m 0)', ...synthTimingLines('cd4093', 'U1', n)])
    assert.ok(at(capture, 'CH2', 0.0025) > 4.99, 'rising input remains low below positive threshold')
    assert.ok(at(capture, 'CH2', 0.0045) < 0.01)
    assert.ok(at(capture, 'CH2', 0.0065) < 0.01, 'falling input remains high above negative threshold')
    assert.ok(at(capture, 'CH2', 0.0085) > 4.99)
  }
})

test('seven ripple stages count falling edges, divide through 128, and clear asynchronously', async () => {
  const n = nodes(); n[0] = 'input'; n[1] = 'reset'
  const captures = await fixture(['VCC vcc 0 5', 'VIN input 0 PULSE(5 0 1m 1u 1u 0.5m 1m)', 'VR reset 0 PWL(0 0 135m 0 135.001m 5 138m 5 138.001m 0)', ...synthTimingLines('cd4024', 'U1', n)], COUNTER_OUTPUTS.map(p => n[p]), '144m', '10u')
  for (const [bit, capture] of captures.entries()) {
    for (const [time, count] of [[0.0005, 0], [0.00125, 1], [0.00175, 1], [0.02025, 20], [0.06425, 64], [0.12925, 129], [0.136, 0], [0.14025, 3]]) {
      const expected = (count >> bit) & 1, voltage = at(capture, 'CH2', time)
      assert.ok(expected ? voltage > 4.99 : voltage < 0.01, `Q${bit + 1} at ${time}: ${voltage}, count ${count}`)
    }
  }
})

test('logic outputs shut down on an invalid supply and follow a shifted ground', async () => {
  for (const kind of ['cd4024', 'cd4093', 'cd4001'] as const) {
    const n = nodes(); n[6] = 'ground'; n[13] = 'vcc'
    if (kind === 'cd4024') { n[0] = 'ground'; n[1] = 'ground'; n[11] = 'out' }
    else { for (const [a, b] of QUAD_GATE_SECTIONS) { n[a] = 'ground'; n[b] = 'ground' }; n[2] = 'out' }
    const model = kind === 'cd4001' ? synthLogicLines(kind, 'U1', n) : synthTimingLines(kind, 'U1', n)
    const [capture] = await fixture(['VG ground 0 2', 'VCC vcc ground PWL(0 5 2m 5 2.001m 0 4m 0 4.001m 20 6m 20 6.001m -5)', 'VIN input 0 0', ...model])
    assert.ok(Math.abs(at(capture, 'CH2', 0.001) - (kind === 'cd4024' ? 2 : 7)) < 0.01)
    for (const time of [0.003, 0.005, 0.007]) assert.ok(Math.abs(at(capture, 'CH2', time) - 2) < 0.01)
  }
})

test('NAND oscillator responds to capacitance and enable; NOR inhibit and counter reset stop their clocks', async () => {
  const doc = example('nand-oscillator')
  const crossingCount = (c: Capture) => c.time.filter((t, i) => t > 0.01 && c.channels.CH2[i - 1] < 2.5 && c.channels.CH2[i] >= 2.5).length
  const first = await solve(doc)
  assert.ok(crossingCount(first) >= 8)
  doc.parts.find(p => p.id === 'C1')!.value = 220e-9
  const slower = await solve(doc)
  assert.ok(crossingCount(slower) < crossingCount(first) * 0.6)
  doc.instruments.envelope!.gateHigh = false
  assert.ok(Math.min(...(await solve(doc)).channels.CH2) > 4.99)
  for (const id of ['ripple-divider', 'nor-clock-inhibit']) {
    const circuit = example(id), running = await solve(circuit)
    assert.ok(Math.max(...running.channels.CH2) > 4.99 && Math.min(...running.channels.CH2) < 0.01)
    if (id === 'ripple-divider') {
      for (const [channel, expected] of [['CH1', 64], ['CH2', 32]] as const) {
        const edges = running.time.filter((_, i) => i > 0 && running.channels[channel][i - 1] < 2.5 && running.channels[channel][i] >= 2.5)
        assert.ok(edges.length >= 3)
        const frequency = (edges.length - 1) / (edges.at(-1)! - edges[0])
        assert.ok(Math.abs(frequency - expected) < 0.1, `${channel}: ${frequency} Hz`)
      }
    }
    circuit.instruments.envelope!.gateHigh = true
    assert.ok(Math.max(...(await solve(circuit)).channels.CH2) < 0.01)
  }
})

test('shunt reference regulates with finite slope, loses regulation at low current, and conducts forward', async () => {
  const volts: number[] = []
  for (const current of [10e-6, 100e-6, 1e-3, 5e-3, -1e-3]) {
    const [capture] = await fixture([`IREF 0 out ${current}`, 'VIN input 0 0', ...synthTimingLines('lm4040', 'U1', ['nc', 'out', '0'])], ['out'], '1m')
    volts.push(capture.channels.CH2.at(-1)!)
  }
  assert.ok(volts[0] < 2.1 && volts[0] > 1.8)
  for (const v of volts.slice(1, 4)) assert.ok(v >= 2.5 && v < 2.503)
  assert.ok(Math.abs((volts[3] - volts[2]) / 0.004 - 0.5) < 0.01)
  assert.ok(volts[4] < -0.4 && volts[4] > -0.8)
})

test('reference example exposes shunt current and power and droops when the load exceeds available current', async () => {
  const doc = example('precision-cv-reference'), result = await solve(doc)
  assert.ok(result.channels.CH2.at(-1)! > 2.5 && result.channels.CH2.at(-1)! < 2.502)
  const measured = result.operatingPoint!.parts.U1
  assert.equal(measured.currents[0].label, 'Cathode → Anode')
  assert.ok(measured.currents[0].value > 0.0017 && measured.currents[0].value < 0.0018)
  assert.ok(measured.power > 0.004)
  doc.parts.find(p => p.id === 'R2')!.value = 1000
  assert.ok((await solve(doc)).channels.CH2.at(-1)! < 2.2)
})
