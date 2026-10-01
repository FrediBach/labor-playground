import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Simulation } from 'eecircuit-engine'
import { runPico } from '../src/lib/pico/runtime.ts'
import { picoExamples } from '../src/lib/pico/examples.ts'
import { compileCircuit, validateDocument, createEmptyDocument, resolveTopology } from '../src/lib/circuit.ts'
import { runCircuitCapture } from '../src/lib/simulation-analysis.ts'
import { operatingPointDescriptors } from '../src/lib/simulation-descriptors.ts'
import { PICO_CAPTURE_DURATIONS_MS, validatePico } from '../src/lib/pico/profile.ts'
import { picoDriverLines, samplePicoPin } from '../src/lib/pico/electrical.ts'
import { sampleRecording } from '../src/lib/recording.ts'
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
  for (const captureMs of PICO_CAPTURE_DURATIONS_MS) assert.equal(validatePico({ ...doc.pico, captureMs }).captureMs, captureMs)
  for (const captureMs of [0, 50, 20000, NaN]) assert.throws(() => validatePico({ ...doc.pico, captureMs }), /duration/)
})

test('longer firmware capture keeps delayed output events and electrical endpoints', async () => {
  const trace = await runPico({ ...assets, durationSeconds: 0.5, source: 'from machine import Pin\nimport time\np = Pin(0, Pin.OUT, value=0)\ntime.sleep_ms(250)\np.on()\nprint("late output")' })
  assert.equal(trace.durationNs, 500_000_000)
  assert.match(trace.console, /late output/)
  assert.ok(trace.events.some(event => event.gpio === 0 && event.state === 1 && event.ns > 250_000_000))
  assert.ok(trace.events.every(event => event.ns < trace.durationNs))
  const doc = picoExamples[1].document
  const nodes = resolveTopology(doc).nodeByTerminal
  const lines = picoDriverLines(nodes, new Set([nodes['pico:1']]), trace)
  assert.ok(lines.filter(line => line.includes('PWL(')).every(line => / 0\.5 [\d.e-]+\)$/.test(line)), 'every driver holds its final state through the requested duration')
  const tenSecondTrace = { ...trace, durationNs: 10_000_000_000 }
  assert.ok(picoDriverLines(nodes, new Set([nodes['pico:1']]), tenSecondTrace).filter(line => line.includes('PWL(')).every(line => / 10 [\d.e-]+\)$/.test(line)))
  const transient = compileCircuit(doc, 'transient', trace, 0.5), dc = compileCircuit(doc, 'operating-point', trace, 0.5)
  assert.deepEqual([...transient.diagnostics, ...dc.diagnostics].filter(item => item.severity === 'error'), [])
  const engine = new Simulation(); await engine.start()
  const capture = await runCircuitCapture(engine, { type: 'run', revision: 1, durationSeconds: 0.5, netlist: transient.netlist, nodes: { CH1: nodes['b4'], CH2: nodes['b8'] }, operatingPoint: { netlist: dc.netlist, parts: operatingPointDescriptors(doc, nodes) }, picoChecks: [{ gpio: 0, node: nodes['b4'] }] })
  assert.ok(Math.abs(capture.time.at(-1)! - 0.5) < 1e-12, 'the solver reaches the requested endpoint within floating-point precision')
  assert.ok(sampleRecording(capture, 0.1)!.parts.D1.currents[0].value < 1e-6, 'LED is off before the delayed output')
  assert.ok(sampleRecording(capture, 0.3)!.parts.D1.currents[0].value > 1e-3, 'LED is lit after the delayed output')
  for (const durationSeconds of [0, 0.2, 11, Infinity, NaN]) await assert.rejects(runPico({ ...assets, source: '', durationSeconds }), /duration/)
})

test('recorded GPIO state seeks through discrete changes and release without stale state', () => {
  const initial = { gpio: 25, state: 0, function: 5, enabled: true, pullUp: false, pullDown: false }
  const high = { ...initial, state: 1, ns: 10_000_000 }
  const released = { ...high, state: 2, enabled: false, ns: 20_000_000 }
  const final = { ...initial, ns: 30_000_000 }
  const trace = { initial: [initial], events: [{ ...high, gpio: 0, ns: 5_000_000 }, high, { ...high, pullUp: true, ns: 20_000_000 }, released, final], durationNs: 100_000_000, console: '', instructions: 0, elapsedMs: 0 }
  assert.equal(samplePicoPin(trace, 25, 0), initial)
  assert.equal(samplePicoPin(trace, 25, 0.009), initial)
  assert.equal(samplePicoPin(trace, 25, 0.01), high)
  assert.equal(samplePicoPin(trace, 25, 0.02), released, 'the final register event at the same time wins')
  assert.equal(samplePicoPin(trace, 25, 0.029)?.enabled, false, 'a released pin must not retain its previous high output')
  assert.equal(samplePicoPin(trace, 25, 1), final, 'seeking past the capture clamps to its final state')
  assert.equal(samplePicoPin(trace, 25, -1), initial)
  assert.equal(samplePicoPin(undefined, 25, 0.01), undefined, 'stale or unavailable captures expose no GPIO state')
  assert.equal(samplePicoPin(trace, 24, 0.01), undefined)
  assert.equal(samplePicoPin(trace, 25, NaN), undefined)
  assert.equal(samplePicoPin({ ...trace, initial: [{ ...initial, state: 1 }], events: [] }, 25, 0)?.state, 1, 'a new recording owns a fresh state index')
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

test('stock LED and pulse examples tolerate independent output and pull initialization', { timeout: 30000 }, async () => {
  const engine = new Simulation(); await engine.start()
  for (const example of picoExamples.slice(1, 3)) {
    const doc = example.document
    const trace = await runPico({ ...assets, source: doc.pico!.source })
    const events = trace.events.filter(event => event.gpio === 0)
    assert.ok(events[1].ns - events[0].ns < 1000, 'firmware initializes output and pull less than 1 µs apart')
    const transient = compileCircuit(doc, 'transient', trace)
    const dc = compileCircuit(doc, 'operating-point', trace)
    assert.deepEqual(transient.diagnostics.filter(item => item.severity === 'error'), [])
    assert.deepEqual(dc.diagnostics.filter(item => item.severity === 'error'), [])
    const node = transient.nodeByTerminal['b4']
    const capture = await runCircuitCapture(engine, { type: 'run', revision: 1, netlist: transient.netlist, nodes: { CH1: node, CH2: transient.nodeByTerminal['b8'] }, operatingPoint: { netlist: dc.netlist, parts: operatingPointDescriptors(doc, dc.nodeByTerminal) }, picoChecks: [{ gpio: 0, node }] })
    assert.ok(Math.max(...capture.channels.CH1) > 3)
    if (example.id === 'pico-led') {
      assert.match(trace.console, /External LED on/)
      assert.ok(capture.channels.CH1.at(-1)! > 3)
      assert.ok(capture.channels.CH2.at(-1)! > 1 && capture.channels.CH2.at(-1)! < 2.5)
    } else {
      assert.ok(capture.channels.CH1[capture.time.findIndex(time => time >= .003)] > 3)
      assert.ok(capture.channels.CH1[capture.time.findIndex(time => time >= .008)] < .01)
    }
    // Genuine rapid changes to the same driver must still fail.
    const high = events.find(event => event.enabled && event.state === 1)!
    const rapid = { ...trace, events: [{ ...high, ns: 10000 }, { ...high, state: 0, ns: 10500 }] }
    assert.match(compileCircuit(doc, 'transient', rapid).diagnostics.map(item => item.message).join(' '), /edges are less than 1 µs apart/)
  }
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
