import assert from 'node:assert/strict'
import test from 'node:test'
import { Simulation } from 'eecircuit-engine'
import { compileCircuit, getPlacement, isValidFootprint, validateDocument, type CircuitDocument } from '../src/lib/circuit.ts'
import { synthUtilityExamples } from '../src/lib/synth-utility-examples.ts'
import { synthUtilityLines, SCHMITT_SECTIONS, MULTIPLEXER_SECTIONS } from '../src/lib/synth-utilities.ts'
import { runCircuitCapture } from '../src/lib/simulation-analysis.ts'
import { operatingPointDescriptors } from '../src/lib/simulation-descriptors.ts'
import { extractCapture } from '../src/lib/simulation-results.ts'
import { interpolateVoltage } from '../src/lib/measurements.ts'
import type { Capture } from '../src/lib/simulation-types.ts'

const engine = new Simulation()
const example = (id: string) => structuredClone(synthUtilityExamples.find(e => e.id === id)!.document)
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
  engine.setNetList(`Synth utility fixture\n${lines.join('\n')}\n.tran ${step} ${duration} 0 ${step}\n.save all\n.end`)
  return extractCapture(await engine.runSim(), { CH1: 'input', CH2: 'out' }, 1, 0)
}

test('new utility examples round-trip, have no overlapping holes, and compile cleanly', () => {
  for (const { document } of synthUtilityExamples) {
    assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(document))), document)
    assert.deepEqual(compileCircuit(document).diagnostics, [])
    const occupied = [...document.parts.flatMap(p => p.pins), ...document.wires.flatMap(w => [w.from, w.to])]
    assert.equal(new Set(occupied).size, occupied.length)
  }
  for (const kind of ['cd40106', 'cd4053', 'vactrol', 'pmos'] as const) {
    const dip = kind !== 'pmos'
    for (const [hole, rotation] of [[dip ? 'e10' : 'a10', 0], [dip ? 'f20' : 'c20', 180]] as const) assert.ok(isValidFootprint(kind, getPlacement(kind, hole, rotation)!))
    assert.equal(getPlacement(kind, 'd29', 90), null)
    const document = example(kind === 'pmos' ? 'pmos-high-side' : kind === 'vactrol' ? 'optical-gain' : kind === 'cd4053' ? 'signal-selector' : 'schmitt-oscillator')
    document.parts[0].value = 2
    assert.throws(() => validateDocument(document), /value/)
  }
})

test('logic inputs and VEE require returns; optical isolation does not conceal floating LDR wiring', () => {
  const sch = example('schmitt-oscillator')
  sch.wires = sch.wires.filter(w => w.from !== 'b13')
  assert.ok(compileCircuit(sch).diagnostics.some(d => d.severity === 'error' && /IN B/.test(d.message)))
  const mux = example('signal-selector')
  mux.wires = mux.wires.filter(w => w.from !== 'vminus')
  assert.ok(compileCircuit(mux).diagnostics.some(d => d.severity === 'error' && /VEE/.test(d.message)))
  const overvoltage = example('signal-selector')
  overvoltage.wires.find(w => w.from === 'cv')!.from = 'vplus'
  assert.ok(compileCircuit(overvoltage).diagnostics.some(d => d.severity === 'error' && /20 V/.test(d.message)))
  const optical = example('optical-gain')
  optical.wires = optical.wires.filter(w => w.from !== 'osc' && w.from !== 'i18')
  assert.ok(compileCircuit(optical).diagnostics.some(d => d.severity === 'error' && /LDR/.test(d.message)))
})

test('all six Schmitt sections retain state inside the hysteresis band', async () => {
  for (const [input, output] of SCHMITT_SECTIONS) {
    const n = Array.from({ length: 14 }, (_, i) => `unused${i}`)
    for (const [pin] of SCHMITT_SECTIONS) n[pin] = '0'
    n[6] = '0'; n[13] = 'vcc'; n[input] = 'input'; n[output] = 'out'
    const result = await fixture(['VCC vcc 0 5', 'VI input 0 PWL(0 0 1m 0 1.1m 2.4 2m 2.4 2.1m 3.4 3m 3.4 3.1m 2.4 4m 2.4 4.1m 1.4 5m 1.4)', 'RL out 0 100k', ...synthUtilityLines('cd40106', 'U1', n)])
    assert.ok(at(result, 'CH2', 0.0015) > 4.9, 'rising middle keeps high output')
    assert.ok(at(result, 'CH2', 0.0025) < 0.01, 'upper threshold switches low')
    assert.ok(at(result, 'CH2', 0.0035) < 0.01, 'falling middle keeps low output')
    assert.ok(at(result, 'CH2', 0.0045) > 4.9, 'lower threshold switches high')
  }
})

test('Schmitt RC oscillator starts reliably and scales its period with capacitance', async () => {
  const doc = example('schmitt-oscillator')
  const period = (capture: Capture) => {
    const crossings: number[] = []
    for (let i = 1; i < capture.time.length; i++) if (capture.time[i] > 0.02 && capture.channels.CH2[i - 1] < 2.5 && capture.channels.CH2[i] >= 2.5) crossings.push(capture.time[i])
    assert.ok(crossings.length >= 5)
    return (crossings.at(-1)! - crossings[0]) / (crossings.length - 1)
  }
  const capture = await solve(doc)
  const first = period(capture)
  assert.ok(first > 0.00075 && first < 0.0009, `period ${first}`)
  doc.parts.find(p => p.id === 'C1')!.value *= 10
  const slower = period(await solve(doc))
  assert.ok(slower / first > 9.8 && slower / first < 10.2)
})

test('every CD4053 section selects X/Y bidirectionally and inhibit opens both paths', async () => {
  for (const [common, x, y, select] of MULTIPLEXER_SECTIONS) {
    for (const reverse of [false, true]) {
      const n = Array<string>(16).fill('0')
      n[15] = 'vcc'; n[6] = 'vee'; n[select] = 'select'; n[5] = 'inhibit'
      n[common] = reverse ? 'input' : 'out'; n[x] = reverse ? 'out' : 'input'; n[y] = 'other'
      const result = await fixture(['VCC vcc 0 5', 'VEE vee 0 -5', 'VI input 0 -2', 'VY other 0 3', 'VS select 0 PWL(0 0 2m 0 2.001m 5)', 'VH inhibit 0 PWL(0 0 4m 0 4.001m 5)', 'RL out 0 10k', ...synthUtilityLines('cd4053', 'U1', n)])
      assert.ok(at(result, 'CH2', 0.001) < -1.9)
      if (!reverse) assert.ok(at(result, 'CH2', 0.003) > 2.9)
      else assert.ok(Math.abs(at(result, 'CH2', 0.003)) < 0.001)
      assert.ok(Math.abs(at(result, 'CH2', 0.006)) < 0.001)
    }
  }
})

test('CD4053 example follows bipolar audio or selects the control voltage', async () => {
  const doc = example('signal-selector')
  const audio = await solve(doc)
  assert.ok(Math.max(...audio.channels.CH2) > 2.4 && Math.min(...audio.channels.CH2) < -2.4)
  doc.instruments.envelope!.gateHigh = true
  const dc = await solve(doc)
  assert.ok(dc.channels.CH2.at(-1)! > 4.9)
})

test('optical resistance is bilateral with slow attack and a longer release', async () => {
  for (const reverse of [false, true]) {
    const result = await fixture(['VI input 0 5', 'ILED 0 anode PULSE(0 5m 10m 1u 1u 30m 200m)', 'RL out 0 10k', ...synthUtilityLines('vactrol', 'O1', ['anode', '0', reverse ? 'input' : 'out', reverse ? 'out' : 'input'])], '100m', '20u')
    assert.ok(at(result, 'CH2', 0.005) < 0.01)
    assert.ok(at(result, 'CH2', 0.01) < 0.02)
    assert.ok(at(result, 'CH2', 0.011) > 2 && at(result, 'CH2', 0.011) < 4)
    const plateau = at(result, 'CH2', 0.035)
    assert.ok(plateau > 4.3 && plateau < 4.4)
    assert.ok(at(result, 'CH2', 0.045) > 3.5, 'release persists after LED turns off')
    assert.ok(at(result, 'CH2', 0.095) < 0.5)
  }
  const capture = await solve(example('optical-gain'))
  assert.equal(capture.operatingPoint!.parts.O1.currents.length, 2)
})

test('P-channel high-side switch has negative drain current, positive dissipation, and correct off polarity', async () => {
  const doc = example('pmos-high-side')
  const on = await solve(doc)
  assert.ok(on.channels.CH2.at(-1)! > 4.97)
  assert.ok(on.operatingPoint!.parts.M1.currents[0].value < -0.00049)
  assert.ok(on.operatingPoint!.parts.M1.power > 0)
  doc.instruments.envelope!.gateHigh = true
  const off = await solve(doc)
  assert.ok(Math.abs(off.channels.CH2.at(-1)!) < 0.001)
})
