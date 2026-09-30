import assert from 'node:assert/strict'
import test from 'node:test'
import { Simulation } from 'eecircuit-engine'
import { compileCircuit, createEmptyDocument, formatValue, getPlacement, isValidFootprint, PARTS, validateDocument, type CircuitDocument, type ComponentKind } from '../src/lib/circuit.ts'
import { interpolateVoltage } from '../src/lib/measurements.ts'
import { runCircuitCapture } from '../src/lib/simulation-analysis.ts'
import { operatingPointDescriptors } from '../src/lib/simulation-descriptors.ts'

const engine = new Simulation()
const close = (actual: number, expected: number, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`)
const wire = (id: string, from: string, to: string) => ({ id, from, to, color: '#ffffff' })

async function solve(document: CircuitDocument) {
  const transient = compileCircuit(document)
  const dc = compileCircuit(document, 'operating-point')
  assert.deepEqual(transient.diagnostics.filter((item) => item.severity === 'error'), [])
  assert.deepEqual(dc.diagnostics.filter((item) => item.severity === 'error'), [])
  await engine.start()
  return runCircuitCapture(engine, {
    type: 'run', revision: 1, netlist: transient.netlist,
    nodes: { CH1: document.probes.CH1 ? transient.nodeByTerminal[document.probes.CH1] : null, CH2: document.probes.CH2 ? transient.nodeByTerminal[document.probes.CH2] : null },
    operatingPoint: { netlist: dc.netlist, parts: operatingPointDescriptors(document, dc.nodeByTerminal) },
  })
}

function diode(kind: 'diode' | 'schottky' | 'zener', reverse = false): CircuitDocument {
  return {
    ...createEmptyDocument(),
    parts: [
      { id: 'R1', kind: 'resistor', value: 1_000, pins: ['a6', 'a16'] },
      { id: 'D-a_b', kind, value: PARTS[kind].defaultValue, pins: reverse ? ['c26', 'c16'] : ['c16', 'c26'] },
    ],
    wires: [wire('W1', kind === 'zener' && reverse ? 'vplus' : 'cv', 'b6'), wire('W2', 'gnd', 'b26')],
    probes: { CH1: 'd6', CH2: 'd16' },
  }
}

function transistor(kind: 'npn' | 'pnp', baseResistance = 100_000): CircuitDocument {
  return {
    ...createEmptyDocument(),
    instruments: { ...createEmptyDocument().instruments, cv: kind === 'npn' ? 5 : -5 },
    parts: [
      { id: 'Q-a_b', kind, value: 1, pins: ['a10', 'a11', 'a12'] },
      { id: 'RC', kind: 'resistor', value: 1_000, pins: ['c5', 'c10'] },
      { id: 'RB', kind: 'resistor', value: baseResistance, pins: ['c20', 'c11'] },
    ],
    wires: [wire('W1', kind === 'npn' ? 'vplus' : 'vminus', 'b5'), wire('W2', 'cv', 'b20'), wire('W3', 'gnd', 'b12')],
    probes: { CH1: 'd11', CH2: 'd10' },
  }
}

test('new part values round-trip and reject invalid ranges and fixed model changes', () => {
  for (const kind of ['inductor', 'schottky', 'zener', 'npn', 'pnp'] as const) {
    const definition = PARTS[kind]
    const document = createEmptyDocument()
    document.parts = [{ id: 'X1', kind, value: definition.defaultValue, pins: getPlacement(kind, 'a10')! }]
    assert.deepEqual(validateDocument(document), document)
    for (const value of [NaN, Infinity, -1, definition.min / 2, definition.max * 2]) {
      document.parts[0].value = value
      assert.throws(() => validateDocument(document), /value/)
    }
    for (const value of [definition.min, definition.max]) {
      document.parts[0].value = value
      assert.equal(validateDocument(document).parts[0].value, value)
    }
  }
  assert.equal(formatValue(10e-3, 'inductor'), '10 mH')
  assert.equal(formatValue(5.1, 'zener'), '5.1 V')
  assert.equal(formatValue(1, 'schottky'), 'Low Vf')
})

test('transistor C–B–E packages rotate rigidly and cannot cross the trench or board edge', () => {
  for (const kind of ['npn', 'pnp'] as const) {
    assert.deepEqual(PARTS[kind].pinNames, ['Collector', 'Base', 'Emitter'])
    assert.deepEqual(getPlacement(kind, 'a10'), ['a10', 'a11', 'a12'])
    assert.deepEqual(getPlacement(kind, 'c12', 180), ['c12', 'c11', 'c10'])
    assert.deepEqual(getPlacement(kind, 'a10', 90), ['a10', 'b10', 'c10'])
    assert.deepEqual(getPlacement(kind, 'c10', 270), ['c10', 'b10', 'a10'])
    assert.equal(getPlacement(kind, 'd10', 90), null)
    assert.equal(getPlacement(kind, 'a29'), null)
    assert.equal(isValidFootprint(kind, ['a10', 'a11', 'a13']), false)
    assert.equal(isValidFootprint(kind, ['a10', 'a12', 'a11']), false)
    assert.equal(isValidFootprint(kind, ['tp10', 'tp11', 'tp12']), false)
    const document = transistor(kind)
    document.parts[0].pins = ['a10', 'a12', 'a11']
    assert.throws(() => validateDocument(document), /footprint/)
  }
})

test('inductors provide DC connectivity while capacitors do not; transistor emitters are checked', () => {
  const document: CircuitDocument = {
    ...createEmptyDocument(),
    parts: [{ id: 'L1', kind: 'inductor', value: 0.01, pins: ['a10', 'a13'] }],
    wires: [wire('W1', 'gnd', 'b10')],
  }
  assert.deepEqual(compileCircuit(document).diagnostics, [])
  document.parts[0].kind = 'capacitor'
  assert.ok(compileCircuit(document).diagnostics.some((item) => item.severity === 'error' && /no DC path/.test(item.message)))
  const floating = transistor('npn')
  floating.wires = []
  assert.ok(compileCircuit(floating).diagnostics.some((item) => item.severity === 'error' && /a12/.test(item.message)))
})

test('new netlists preserve encoded IDs and independent zener voltages', () => {
  const document = diode('zener', true)
  document.parts.push({ id: 'D_a-b', kind: 'zener', value: 8.2, pins: ['e26', 'e16'] })
  const compiled = compileCircuit(document, 'operating-point')
  assert.deepEqual(compiled.diagnostics, [])
  assert.match(compiled.netlist, /\.model DZ_D_2da_5fb .*Bv=5\.100000000e\+0/)
  assert.match(compiled.netlist, /\.model DZ_D_5fa_2db .*Bv=8\.200000000e\+0/)
  assert.match(compiled.netlist, /\.save all @D_D_5fa_2db\[id\] @D_D_2da_5fb\[id\]/)
  const reordered = structuredClone(document)
  reordered.parts.reverse()
  reordered.wires.reverse()
  assert.equal(compileCircuit(reordered, 'operating-point').netlist, compiled.netlist)
})

test('real inductor DC current and winding power include the fixed 1 Ω resistance', { timeout: 15_000 }, async () => {
  const document: CircuitDocument = {
    ...createEmptyDocument(),
    parts: [
      { id: 'L-a_b', kind: 'inductor', value: 0.1, pins: ['a6', 'a16'] },
      { id: 'R1', kind: 'resistor', value: 100, pins: ['c16', 'c26'] },
    ],
    wires: [wire('W1', 'cv', 'b6'), wire('W2', 'gnd', 'b26')],
    probes: { CH1: 'd6', CH2: 'd16' },
  }
  const capture = await solve(document)
  const current = 5 / 101
  const reading = capture.operatingPoint!.parts['L-a_b']
  close(reading.currents[0].value, current)
  close(reading.power!, current ** 2)
  close(capture.channels.CH2.at(-1)!, current * 100)

  document.stimulus = 'step'
  document.instruments.amplitude = 5
  document.wires[0].from = 'osc'
  const step = await solve(document)
  const tau = 0.1 / 201 // winding + load + oscillator output resistance
  const expected = (5 * 100 / 201) * (1 - Math.exp(-1))
  close(interpolateVoltage(step.time, step.channels.CH2, 0.0010005 + tau)!, expected, 0.002)
  close(step.operatingPoint!.parts['L-a_b'].currents[0].value, 0)
  document.parts[0].value = 0.2
  const slower = await solve(document)
  assert.ok(interpolateVoltage(slower.time, slower.channels.CH2, 0.0010005 + tau)! < expected * 0.7)
})

test('real Schottky diode has lower forward voltage and preserves signed reverse leakage', { timeout: 15_000 }, async () => {
  const silicon = await solve(diode('diode'))
  const schottky = await solve(diode('schottky'))
  const voltage = schottky.channels.CH2.at(-1)!
  assert.ok(voltage > 0.15 && voltage < 0.4, `Schottky Vf ${voltage}`)
  assert.ok(silicon.channels.CH2.at(-1)! > voltage + 0.25)
  close(schottky.operatingPoint!.parts['D-a_b'].currents[0].value, (5 - voltage) / 1_000, 1e-7)
  const reverse = await solve(diode('schottky', true))
  const leakage = reverse.operatingPoint!.parts['D-a_b']
  assert.ok(leakage.currents[0].value < -1e-7 && leakage.currents[0].value > -3e-7)
  assert.ok(reverse.channels.CH2.at(-1)! > 4.99)
  assert.ok(leakage.power! > 0)
})

test('real zener reverse breakdown follows its editable voltage and also conducts forward', { timeout: 15_000 }, async () => {
  for (const nominal of [5.1, 8.2]) {
    const document = diode('zener', true)
    document.parts[1].value = nominal
    const capture = await solve(document)
    const voltage = capture.operatingPoint!.nodeVoltages[compileCircuit(document).nodeByTerminal.d16]
    assert.ok(voltage > nominal && voltage < nominal + 0.2, `Zener ${nominal}: ${voltage}`)
    const reading = capture.operatingPoint!.parts['D-a_b']
    // Saved nonlinear currents follow the compiler's reltol=0.001.
    close(reading.currents[0].value, -(12 - voltage) / 1_000, (12 - voltage) / 1_000 * 0.001)
    close(reading.power!, -voltage * reading.currents[0].value, 1e-7)
  }
  const forward = await solve(diode('zener'))
  assert.ok(forward.channels.CH2.at(-1)! > 0.5 && forward.channels.CH2.at(-1)! < 0.8)
  assert.ok(forward.operatingPoint!.parts['D-a_b'].currents[0].value > 0)
})

test('real complementary BJTs cover cutoff, active gain, saturation, terminal currents and power', { timeout: 15_000 }, async () => {
  for (const kind of ['npn', 'pnp'] as const) {
    const polarity = kind === 'npn' ? 1 : -1
    const document = transistor(kind)
    const capture = await solve(document)
    const nodes = compileCircuit(document).nodeByTerminal
    const op = capture.operatingPoint!
    const collector = op.nodeVoltages[nodes.a10]
    const base = op.nodeVoltages[nodes.a11]
    const reading = op.parts['Q-a_b']
    assert.ok(polarity * collector > 6 && polarity * collector < 9)
    assert.ok(polarity * base > 0.6 && polarity * base < 0.8)
    assert.deepEqual(reading.currents.map((item) => item.label), ['Collector → Emitter', 'Base → Emitter'])
    const [ic, ib] = reading.currents.map((item) => item.value)
    close(ic, (polarity * 12 - collector) / 1_000, 1e-7)
    close(ib, (polarity * 5 - base) / 100_000, 1e-8)
    assert.ok(ic / ib > 100 && ic / ib < 115, `Forward gain ${ic / ib}`)
    close(reading.power!, collector * ic + base * ib)
    assert.ok(reading.power! > 0)

    document.instruments.cv = 0
    const cutoff = await solve(document)
    close(cutoff.channels.CH2.at(-1)!, polarity * 12, 1e-5)
    assert.ok(Math.abs(cutoff.operatingPoint!.parts['Q-a_b'].currents[0].value) < 1e-8)

    const saturated = await solve(transistor(kind, 10_000))
    const vce = polarity * saturated.channels.CH2.at(-1)!
    assert.ok(vce > 0 && vce < 0.25, `Saturation Vce ${vce}`)
  }
})

test('all added kinds have strict compiler validation before netlist emission', () => {
  for (const kind of ['inductor', 'schottky', 'zener', 'npn', 'pnp'] satisfies ComponentKind[]) {
    const document = createEmptyDocument()
    document.parts = [{ id: 'X1', kind, value: Infinity, pins: getPlacement(kind, 'a10')! }]
    const compiled = compileCircuit(document)
    assert.equal(compiled.netlist, '')
    assert.equal(compiled.diagnostics[0].severity, 'error')
  }
})
