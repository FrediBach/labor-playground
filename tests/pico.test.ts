import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Simulation } from 'eecircuit-engine'
import { runPico } from '../src/lib/pico/runtime.ts'
import { picoExamples } from '../src/lib/pico/examples.ts'
import { compileCircuit, validateDocument, createEmptyDocument, resolveTopology } from '../src/lib/circuit.ts'
import { runCircuitCapture } from '../src/lib/simulation-analysis.ts'
import { operatingPointDescriptors } from '../src/lib/simulation-descriptors.ts'
const buffer = (name: string) => { const bytes = readFileSync(new URL(`../public/pico/${name}`, import.meta.url)); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
const assets = { bootrom: buffer('bootrom.bin'), firmware: buffer('micropython.uf2') }
test('Pico project validation and legacy topology', () => {
  const legacy = createEmptyDocument()
  assert.deepEqual(validateDocument(legacy), legacy)
  for (const example of picoExamples) assert.deepEqual(validateDocument(example.document), example.document)
  const doc = structuredClone(picoExamples[0].document)
  assert.equal(resolveTopology(doc).nodeByTerminal['pico:38'], '0')
  assert.throws(() => validateDocument({ ...doc, pico: { ...doc.pico, profile: 'unknown' } }), /incompatible/)
  doc.wires[0].from = 'pico:40'
  assert.throws(() => validateDocument(doc), /Unknown terminal/)
})
test('real firmware deterministic PWM across scheduling chunks and indirect feedback rejection', async () => {
  const source = picoExamples[3].document.pico!.source
  const first = await runPico({ ...assets, source, batchSize: 10000 })
  const second = await runPico({ ...assets, source, batchSize: 100000 })
  assert.deepEqual(first.initial, second.initial)
  assert.deepEqual(first.events, second.events)
  assert.match(first.console, /Pico PWM/)
  assert.equal(first.durationNs, 100_000_000)
  assert.ok(first.events.length > 100)
  for (const source of ['from machine import Pin\np=Pin(0)\nf=getattr(p,"value")\nf()', 'from machine import ADC\nf=ADC(0).read_u16\nf()', 'import machine\nprint(machine.mem8[0xd0000004])', 'import machine\nprint(machine.mem16[0xd0000004])']) await assert.rejects(runPico({ ...assets, source }), /outputs only/)
  await assert.rejects(runPico({ ...assets, source: 'raise ValueError("fixture")' }), /File "main.py", line 1/)
})
test('actual firmware PWM drives real ngspice RC capture', { timeout: 30000 }, async () => {
  const doc = structuredClone(picoExamples[3].document)
  const trace = await runPico({ ...assets, source: doc.pico!.source })
  const transient = compileCircuit(doc, 'transient', trace)
  const dc = compileCircuit(doc, 'operating-point', trace)
  assert.deepEqual(transient.diagnostics.filter(d => d.severity === 'error'), [])
  const engine = new Simulation(); await engine.start()
  const capture = await runCircuitCapture(engine, { type: 'run', revision: 1, netlist: transient.netlist, nodes: { CH1: transient.nodeByTerminal['b4'], CH2: transient.nodeByTerminal['b8'] }, operatingPoint: { netlist: dc.netlist, parts: operatingPointDescriptors(doc, dc.nodeByTerminal) } })
  assert.ok(Math.abs(capture.channels.CH2.at(-1)! - 1.65) < .08)
  assert.ok(Math.abs(capture.operatingPoint!.nodeVoltages[dc.nodeByTerminal['b8']]) < 1e-6)
  assert.ok(Math.max(...capture.channels.CH1) > 3.1)
})

test('real ngspice finite loading, disabled driver, pull changes and contention envelope', { timeout: 30000 }, async () => {
  const { checkPicoEnvelope } = await import('../src/lib/pico/checks.ts')
  const engine = new Simulation(); await engine.start()
  const doc = structuredClone(picoExamples[2].document)
  doc.parts = [{ id: 'R1', kind: 'resistor', value: 1000, pins: ['c4', 'c12'] }]
  doc.probes = { CH1: 'b4', CH2: null }
  const state = (state: number, enabled: boolean, pullUp = false, pullDown = false) => ({ gpio: 0, state, enabled, function: 5, pullUp, pullDown })
  const solve = async (initial: ReturnType<typeof state>, events: Array<ReturnType<typeof state> & { ns: number }> = []) => {
    const trace = { initial: [initial], events, durationNs: 100_000_000, console: '', instructions: 0, elapsedMs: 0 }
    const transient = compileCircuit(doc, 'transient', trace), dc = compileCircuit(doc, 'operating-point', trace)
    return runCircuitCapture(engine, { type: 'run', revision: 1, netlist: transient.netlist, nodes: { CH1: transient.nodeByTerminal['b4'], CH2: null }, operatingPoint: { netlist: dc.netlist, parts: operatingPointDescriptors(doc, dc.nodeByTerminal) }, picoChecks: [{ gpio: 0, node: transient.nodeByTerminal['b4'] }] })
  }
  const high = await solve(state(1, true))
  assert.ok(Math.abs(high.channels.CH1.at(-1)! - 3.3 * 1000 / 1050) < .001)
  const low = await solve(state(0, true))
  assert.ok(Math.abs(low.channels.CH1.at(-1)!) < 1e-6)
  doc.wires[2].from = 'pico:36'
  const released = await solve(state(0, true), [{ ...state(2, false), ns: 20_000_000 }])
  assert.ok(released.channels.CH1[0] < .16)
  assert.ok(released.channels.CH1.at(-1)! > 3.299)
  doc.wires[2].from = 'pico:8'; doc.parts[0].value = 100000
  const pulled = await solve(state(2, false), [{ ...state(3, false, true), ns: 20_000_000 }, { ...state(4, false, false, true), ns: 60_000_000 }])
  const middle = pulled.channels.CH1[pulled.time.findIndex(t => t >= .04)]
  assert.ok(Math.abs(middle - 2.2) < .001)
  assert.ok(Math.abs(pulled.channels.CH1.at(-1)!) < 1e-6)
  doc.parts[0].value = 10
  await assert.rejects(solve(state(1, true)), /20 mA/)
  assert.throws(() => checkPicoEnvelope({ dataType: 'real', numPoints: 1, data: [{ name: 'v(n1)', values: [12] }, { name: 'v(pico_0_high)', values: [0] }, { name: 'v(pico_0_low)', values: [0] }] } as any, [{ gpio: 0, node: 'n1' }]), /outside.*envelope/)
})

test('runtime cancellation, syntax errors, native signatures and unsupported IRQs recover', async () => {
  const controller = new AbortController()
  await assert.rejects(runPico({ ...assets, source: 'while True: pass', signal: controller.signal, onPhase: phase => { if (phase === 'running') controller.abort() } }), /abort/i)
  await assert.rejects(runPico({ ...assets, source: 'def invalid(:\n    pass' }), /main.py/)
  await assert.rejects(runPico({ ...assets, source: 'from machine import Pin\np=Pin(0,Pin.IN)\np.irq(handler=lambda p: print("read"))' }), /interrupts|outputs only/)
  const result = await runPico({ ...assets, source: 'from machine import Pin, PWM\np=Pin(0,Pin.OUT,value=1)\nw=PWM(p)\nw.freq(1000)\nw.duty_u16(12000)\nprint(w.freq(),w.duty_u16())\nw.duty_u16(24000)\nprint(w.duty_u16())' })
  assert.match(result.console, /1000 12000/)
  assert.match(result.console, /24000/)
})


test('5 kHz PWM remains resolved; excessive density and source size fail explicitly', { timeout: 30000 }, async () => {
  const doc = structuredClone(picoExamples[3].document)
  const source = doc.pico!.source.replace('freq(1000)', 'freq(5000)')
  const trace = await runPico({ ...assets, source })
  const compiled = compileCircuit(doc, 'transient', trace)
  assert.deepEqual(compiled.diagnostics.filter(item => item.severity === 'error'), [])
  const engine = new Simulation(); await engine.start()
  const capture = await runCircuitCapture(engine, { type: 'run', revision: 1, netlist: compiled.netlist, nodes: { CH1: compiled.nodeByTerminal['b4'], CH2: compiled.nodeByTerminal['b8'] } })
  assert.ok(Math.abs(capture.channels.CH2.at(-1)! - 1.65) < .03)
  assert.ok(capture.time.length < 50000)
  const excessive = await runPico({ ...assets, source: source.replace('freq(5000)', 'freq(10000)') })
  assert.match(compileCircuit(doc, 'transient', excessive).diagnostics.map(item => item.message).join(' '), /density|5 kHz/)
  assert.throws(() => validateDocument({ ...doc, pico: { ...doc.pico, source: 'é'.repeat(20000) } }), /32 KiB/)
  const missingGround = structuredClone(doc); missingGround.wires = missingGround.wires.filter(wire => wire.id !== 'WG')
  assert.match(compileCircuit(missingGround).diagnostics.map(item => item.message).join(' '), /Connect a Pico GND/)
})


test('narrow peripheral writes cannot enable unsupported input interrupts', async () => {
  for (const width of [8, 16, 32]) await assert.rejects(runPico({ ...assets, source: `import machine\nmachine.mem${width}[0x40014100] = 1` }), /interrupts/)
})
