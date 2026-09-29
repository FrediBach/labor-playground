import assert from 'node:assert/strict'
import test from 'node:test'
import { Simulation } from 'eecircuit-engine'
import { compileCircuit, createEmptyDocument, DEFAULT_ENVELOPE, envelopeSettings, examples, terminalById, validateDocument, type CircuitDocument, type EnvelopeSettings } from '../src/lib/circuit.ts'

const engine = new Simulation()
function documentFor(settings?: EnvelopeSettings): CircuitDocument {
  const document = createEmptyDocument()
  document.probes.CH1 = 'eg'
  if (settings) document.instruments.envelope = { ...settings }
  return document
}
async function solve(document: CircuitDocument, analysis: 'transient' | 'operating-point' = 'transient') {
  const compiled = compileCircuit(document, analysis)
  assert.deepEqual(compiled.diagnostics.filter((item) => item.severity === 'error'), [])
  await engine.start()
  engine.setNetList(compiled.netlist)
  const result = await engine.runSim()
  assert.deepEqual(engine.getError(), [])
  const voltage = (terminal: string) => result.data.find((vector) => vector.name === `v(${compiled.nodeByTerminal[terminal]})`)!.values
  return { result, voltage, time: result.data.find((vector) => vector.type === 'time')?.values ?? [] }
}
function interpolate(time: number[], voltage: number[], target: number): number {
  const index = time.findIndex((value) => value >= target)
  assert.ok(index >= 0)
  if (index === 0 || time[index] === target) return voltage[index]
  const fraction = (target - time[index - 1]) / (time[index] - time[index - 1])
  return voltage[index - 1] + fraction * (voltage[index] - voltage[index - 1])
}

test('envelope defaults are immutable and do not expand legacy schema-1 documents', () => {
  assert.equal(Object.isFrozen(DEFAULT_ENVELOPE), true)
  assert.deepEqual(DEFAULT_ENVELOPE, { mode: 'envelope', gateHigh: false, decayMs: 20 })
  for (const example of examples.slice(0, 5)) {
    assert.equal('envelope' in example.document.instruments, false)
    assert.deepEqual(validateDocument(example.document), example.document)
    assert.equal(envelopeSettings(example.document), DEFAULT_ENVELOPE)
  }
  const document = documentFor({ mode: 'gate', gateHigh: true, decayMs: 8.5 })
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(document))), document)
  assert.deepEqual(envelopeSettings(document), document.instruments.envelope)
})

test('envelope import validates every setting and rejects unbounded or unknown values', () => {
  const invalid = [
    null, [], {},
    { mode: 'adsr', gateHigh: false, decayMs: 20 },
    { mode: 'envelope', gateHigh: 'false', decayMs: 20 },
    { mode: 'envelope', decayMs: 20 },
    { mode: 'envelope', gateHigh: false, decayMs: 0.99 },
    { mode: 'envelope', gateHigh: false, decayMs: 40.01 },
    { mode: 'envelope', gateHigh: false, decayMs: NaN },
    { mode: 'envelope', gateHigh: false, decayMs: Infinity },
    { mode: 'envelope', gateHigh: false, decayMs: '20' },
    { mode: 'envelope', gateHigh: false, decayMs: 20, netlist: '.control' },
  ]
  for (const envelope of invalid) {
    const document = createEmptyDocument()
    const untrusted = { ...document, instruments: { ...document.instruments, envelope } }
    assert.throws(() => validateDocument(untrusted), /envelope/i)
    assert.equal(compileCircuit(untrusted as CircuitDocument).netlist, '')
  }
})

test('EG adds an isolated terminal without moving old terminals or implicitly powering rails', () => {
  assert.deepEqual(terminalById.eg, { id: 'eg', x: 855, y: 52, group: 'eg' })
  for (const [index, id] of ['osc', 'cv', 'gnd', 'vplus', 'vminus'].entries()) {
    assert.equal(terminalById[id].x, 135 + index * 160)
    assert.equal(terminalById[id].y, 52)
  }
  const document = documentFor()
  const { nodeByTerminal, diagnostics } = compileCircuit(document)
  assert.deepEqual(diagnostics, [])
  for (const id of ['osc', 'cv', 'gnd', 'vplus', 'vminus', 'tp1', 'tn1', 'bp1', 'bn1']) assert.notEqual(nodeByTerminal.eg, nodeByTerminal[id])
  document.wires = [{ id: 'W1', from: 'eg', to: 'gnd', color: '#ffffff' }]
  const shorted = compileCircuit(document)
  assert.equal(shorted.diagnostics.filter((item) => item.severity === 'error').length, 0)
  assert.ok(shorted.diagnostics.some((item) => item.message.includes('EG is shorted')))
  assert.match(shorted.netlist, /REG eg_internal 0 100/)
})

test('operating-point compilation preserves graph and devices while changing only analysis and current saves', () => {
  const document = structuredClone(examples.find((example) => example.id === 'diode-clipper')!.document)
  const transient = compileCircuit(document)
  const operatingPoint = compileCircuit(document, 'operating-point')
  assert.deepEqual(operatingPoint.nodeByTerminal, transient.nodeByTerminal)
  assert.match(operatingPoint.netlist, /\n\.op\n/)
  assert.doesNotMatch(operatingPoint.netlist, /\.tran/)
  assert.match(operatingPoint.netlist, /\.save all @D_D1\[id\] @D_D2\[id\]/)
  const devices = (netlist: string) => netlist.split('\n').filter((line) => line && !line.startsWith('.'))
  assert.deepEqual(devices(operatingPoint.netlist), devices(transient.netlist))
})

test('real ngspice: gate levels are held through capture and operating point, including 100Ω loading', { timeout: 15_000 }, async () => {
  for (const gateHigh of [false, true]) {
    const document = documentFor({ ...DEFAULT_ENVELOPE, mode: 'gate', gateHigh })
    const free = await solve(document)
    assert.ok(free.voltage('eg').every((voltage) => Math.abs(voltage - (gateHigh ? 5 : 0)) < 1e-9))
    const point = await solve(document, 'operating-point')
    assert.equal(point.result.numPoints, 1)
    assert.equal(point.voltage('eg')[0], gateHigh ? 5 : 0)
    document.parts = [{ id: 'R1', kind: 'resistor', value: 1000, pins: ['a1', 'a4'] }]
    document.wires = [{ id: 'W1', from: 'eg', to: 'b1', color: '#ffffff' }, { id: 'W2', from: 'gnd', to: 'b4', color: '#ffffff' }]
    const loaded = await solve(document, 'operating-point')
    assert.ok(Math.abs(loaded.voltage('eg')[0] - (gateHigh ? 5 * 1000 / 1100 : 0)) < 1e-9)
  }
})

test('real ngspice: trigger is one 5V pulse at 1ms with a 1ms width and a zero DC start', { timeout: 15_000 }, async () => {
  const document = documentFor({ ...DEFAULT_ENVELOPE, mode: 'trigger' })
  const { time, voltage } = await solve(document)
  const eg = voltage('eg')
  assert.ok(time.filter((t) => t < 0.001).every((t) => interpolate(time, eg, t) === 0))
  assert.ok(Math.abs(interpolate(time, eg, 0.0010005) - 2.5) < 1e-7)
  assert.ok(Math.abs(interpolate(time, eg, 0.0015) - 5) < 1e-9)
  assert.ok(Math.abs(interpolate(time, eg, 0.0020005) - 2.5) < 1e-7)
  assert.ok(eg.filter((_, index) => time[index] > 0.002001).every((value) => Math.abs(value) < 1e-9))
  assert.equal((await solve(document, 'operating-point')).voltage('eg')[0], 0)
})

test('real ngspice: envelope reaches its peak rapidly and follows the selected exponential time constant', { timeout: 15_000 }, async () => {
  for (const decayMs of [1, 20, 40]) {
    const document = documentFor({ ...DEFAULT_ENVELOPE, decayMs })
    const { time, voltage } = await solve(document)
    const eg = voltage('eg')
    assert.equal(eg[0], 0)
    assert.equal(interpolate(time, eg, 0.0009), 0)
    assert.ok(Math.max(...eg) > 4.99 && Math.max(...eg) <= 5)
    const atTau = interpolate(time, eg, 0.001001 + decayMs / 1000)
    assert.ok(Math.abs(atTau - 5 / Math.E) < 0.00005, `${decayMs} ms: ${atTau}`)
    assert.ok(Math.abs(eg.at(-1)! - 5 * Math.exp(-(0.1 - 0.001001) / (decayMs / 1000))) < 1e-8)
    assert.equal((await solve(document, 'operating-point')).voltage('eg')[0], 0)
  }
})

test('real ngspice: envelope attack reaches 99.99% within 1µs at a sufficiently fine inspection step', { timeout: 15_000 }, async () => {
  const document = documentFor()
  const compiled = compileCircuit(document)
  await engine.start()
  // Inspect the sub-microsecond source edge independently of the ordinary
  // 10 µs display-capture resolution; keep only a short interval around it.
  engine.setNetList(compiled.netlist.replace(/^\.tran .*$/m, '.tran 1e-7 0.001003 0.000999 1e-7'))
  const result = await engine.runSim()
  assert.deepEqual(engine.getError(), [])
  const time = result.data.find((vector) => vector.type === 'time')!.values
  const voltage = result.data.find((vector) => vector.name === `v(${compiled.nodeByTerminal.eg})`)!.values
  assert.ok(interpolate(time, voltage, 0.001001) > 4.9995)
  const attack = time.map((t, index) => ({ t, voltage: voltage[index] })).filter((sample) => sample.t > 0.0010002 && sample.t < 0.0010008)
  assert.ok(attack.length > 3)
  for (const sample of attack) assert.ok(Math.abs(sample.voltage - 5 * (1 - Math.exp(-(sample.t - 0.001) / 1e-7))) < 1e-8)
})

test('real ngspice: OSC capture steps and amplitude settings leave EG independently controlled', { timeout: 15_000 }, async () => {
  const document = documentFor()
  const periodic = await solve(document)
  document.stimulus = 'step'
  document.instruments.amplitude = 0.7
  document.instruments.waveform = 'square'
  const stepped = await solve(document)
  for (const time of [0, 0.00102, 0.005, 0.02, 0.08]) {
    const a = interpolate(periodic.time, periodic.voltage('eg'), time)
    const b = interpolate(stepped.time, stepped.voltage('eg'), time)
    assert.ok(Math.abs(a - b) < 0.000001)
  }
})

test('real ngspice: editable envelope example rounds the attack and follows the RC response', { timeout: 15_000 }, async () => {
  const document = structuredClone(examples.find((example) => example.id === 'envelope-shaping')!.document)
  assert.deepEqual(validateDocument(document), document)
  const solved = await solve(document)
  const input = solved.voltage(document.probes.CH1!)
  const output = solved.voltage(document.probes.CH2!)
  const inputPeak = input.indexOf(Math.max(...input))
  const outputPeak = output.indexOf(Math.max(...output))
  assert.ok(solved.time[outputPeak] > solved.time[inputPeak] + 0.001)
  assert.ok(Math.max(...output) < Math.max(...input) * 0.9)
  const elapsed = 0.005
  const rc = 10_100 * 100e-9
  const tau = 0.02
  const expected = 5 * tau / (tau - rc) * (Math.exp(-elapsed / tau) - Math.exp(-elapsed / rc))
  assert.ok(Math.abs(interpolate(solved.time, output, 0.001001 + elapsed) - expected) < 0.003)
  document.parts.find((part) => part.id === 'C1')!.value = 470e-9
  const changed = await solve(document)
  assert.ok(Math.max(...changed.voltage(document.probes.CH2!)) < Math.max(...output) * 0.85)
})


test('real ngspice: every oscillator waveform and EG mode can coexist through both analyses', { timeout: 15_000 }, async () => {
  for (const waveform of ['sine', 'triangle', 'square'] as const) {
    for (const mode of ['gate', 'trigger', 'envelope'] as const) {
      const document = structuredClone(examples.find((example) => example.id === 'rc-filter')!.document)
      document.instruments.waveform = waveform
      document.instruments.envelope = { ...DEFAULT_ENVELOPE, mode, gateHigh: true }
      const point = await solve(document, 'operating-point')
      assert.equal(point.result.numPoints, 1)
      const capture = await solve(document)
      assert.ok(Math.abs(capture.time.at(-1)! - 0.1) < 1e-9)
      assert.ok(capture.voltage(document.probes.CH2!).every(Number.isFinite))
    }
  }
})
