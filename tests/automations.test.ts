import assert from 'node:assert/strict'
import test from 'node:test'
import { Simulation } from 'eecircuit-engine'
import { automationControlValues, automationCrossing, automationIssue, automationTimelines, automationValueAt, scheduledAutomationEvents, type Automation } from '../src/lib/automations.ts'
import { compileCircuit, createEmptyDocument, examples, validateDocument, type CircuitDocument } from '../src/lib/circuit.ts'
import { runCircuitCapture } from '../src/lib/simulation-analysis.ts'
import { operatingPointDescriptors } from '../src/lib/simulation-descriptors.ts'
import type { Capture } from '../src/lib/simulation-types.ts'
import { sampleRecording } from '../src/lib/recording.ts'

function timed(id: string, target: Automation['action']['target'], value: number, atMs = 10, durationMs = 0, partId?: string): Automation {
  return { id, name: id, enabled: true, trigger: { kind: 'time', atMs }, action: { target, value, durationMs, ...(partId ? { partId } : {}) } }
}
function crossing(id: string, threshold: number, target: Automation['action']['target'], value: number): Automation {
  return { ...timed(id, target, value), trigger: { kind: 'voltage', channel: 'CH1', direction: 'rising', threshold, afterMs: 0 } }
}
function base(): CircuitDocument {
  return { ...createEmptyDocument(), probes: { CH1: 'cv', CH2: 'osc' } }
}
const engine = new Simulation()
async function solve(document: CircuitDocument, durationSeconds = 0.1): Promise<Capture> {
  await engine.start()
  const transient = compileCircuit(document, 'transient', undefined, durationSeconds)
  const operating = compileCircuit(document, 'operating-point', undefined, durationSeconds)
  assert.deepEqual(transient.diagnostics.filter(row => row.severity === 'error'), [])
  const resolve = (pin: string | null) => pin ? transient.nodeByTerminal[pin] : null
  return runCircuitCapture(engine, {
    type: 'run', revision: 1, netlist: transient.netlist, nodes: { CH1: resolve(document.probes.CH1), CH2: resolve(document.probes.CH2) }, durationSeconds,
    operatingPoint: { netlist: operating.netlist, parts: operatingPointDescriptors(document, operating.nodeByTerminal) }, automation: { document },
  })
}
function voltage(capture: Capture, channel: 'CH1' | 'CH2', time: number): number {
  const right = capture.time.findIndex(value => value >= time)
  if (right <= 0) return capture.channels[channel][Math.max(0, right)]
  const fraction = (time - capture.time[right - 1]) / (capture.time[right] - capture.time[right - 1])
  return capture.channels[channel][right - 1] + fraction * (capture.channels[channel][right] - capture.channels[channel][right - 1])
}

test('automation imports are bounded, strict and optional on legacy projects', () => {
  const original = createEmptyDocument()
  assert.deepEqual(validateDocument(original), original)
  const good = { ...base(), automations: [timed('A1', 'cv', 2)] }
  assert.deepEqual(validateDocument(good), good)
  for (const automations of [null, {}, Array(25).fill(good.automations[0]), [good.automations[0], good.automations[0]], [{ ...good.automations[0], enabled: 1 }], [{ ...good.automations[0], netlist: '.end' }], [{ ...good.automations[0], action: { target: 'cv', value: NaN, durationMs: 0 } }], [{ ...good.automations[0], action: { target: 'frequency', value: 3000, durationMs: 0 } }], [{ ...good.automations[0], trigger: { kind: 'voltage', channel: 'CH3', direction: 'rising', threshold: 1, afterMs: 0 } }]]) {
    assert.throws(() => validateDocument({ ...good, automations }), /automation/i)
  }
})

test('deleted targets and disconnected probes remain editable, with a skipped-row diagnostic', () => {
  const document = base()
  document.automations = [timed('A1', 'switch', 1, 10, 0, 'S_deleted')]
  assert.deepEqual(validateDocument(document), document)
  assert.match(automationIssue(document.automations[0], document)!, /unavailable/)
  assert.equal(compileCircuit(document).diagnostics[0].severity, 'warning')
  assert.deepEqual(scheduledAutomationEvents(document, 0.1), [])
  document.probes.CH1 = null
  assert.match(automationIssue(crossing('A2', 3, 'cv', 0), document)!, /Connect CH1/)
  assert.match(automationIssue(timed('A3', 'gate', 1), document)!, /Gate mode/)
  assert.match(automationIssue(timed('A4', 'cv', 1, 100), document, 0.1)!, /at or after/)
})

test('later actions interrupt ramps and cancel pending pulse releases predictably', () => {
  const document = base()
  document.instruments.cv = 0
  document.instruments.envelope = { mode: 'gate', gateHigh: false, decayMs: 20 }
  document.automations = [timed('A1', 'cv', 4, 10, 40), timed('A2', 'cv', -2, 30, 10), timed('A3', 'gate', 1, 10, 20), timed('A4', 'gate', 1, 20)]
  const events = scheduledAutomationEvents(document, 0.1)
  const cv = automationTimelines(document, events).get('cv')!
  assert.equal(automationValueAt(cv, 0.02), 1)
  assert.ok(Math.abs(automationValueAt(cv, 0.035)) < 1e-12)
  const controls = automationControlValues(document, events, 0.06)
  assert.equal(controls.cv, -2)
  assert.equal(controls.gate, 1)
})

test('voltage triggers require a directed crossing after arming, and interpolate adaptive samples', () => {
  const automation = crossing('A1', 2, 'cv', 0)
  const capture = { time: [0, 0.01, 0.02, 0.03, 0.04], channels: { CH1: [0, 4, 4, 0, 4], CH2: [] } }
  assert.equal(automationCrossing(automation, capture), 0.005)
  automation.trigger = { kind: 'voltage', channel: 'CH1', direction: 'rising', threshold: 2, afterMs: 12 }
  assert.equal(automationCrossing(automation, capture), 0.035)
  automation.trigger.direction = 'falling'
  assert.equal(automationCrossing(automation, capture), 0.025)
  assert.equal(automationCrossing(automation, capture, 0.026), null)
})

test('real ngspice: CV ramp, disabled rows, initial DC and final playback values agree', { timeout: 15_000 }, async () => {
  const document = base()
  document.instruments.cv = 0
  document.automations = [timed('Ramp', 'cv', 4, 10, 40), { ...timed('Disabled', 'cv', -5, 20), enabled: false }]
  const capture = await solve(document)
  assert.deepEqual(capture.automationEvents, [{ automationId: 'Ramp', time: 0.01 }])
  assert.ok(Math.abs(voltage(capture, 'CH1', 0.03) - 2) < 1e-8)
  assert.ok(Math.abs(voltage(capture, 'CH1', 0.08) - 4) < 1e-8)
  assert.equal(capture.operatingPoint!.nodeVoltages[compileCircuit(document).nodeByTerminal.cv], 0)
})

test('real ngspice: causal events remove future crossings invalidated by an earlier action', { timeout: 15_000 }, async () => {
  const document = base()
  document.instruments.cv = 0
  document.automations = [timed('Raise', 'cv', 5, 10, 20), crossing('StopAt3', 3, 'cv', 0), crossing('NeverReaches4', 4, 'amplitude', 0)]
  const capture = await solve(document)
  assert.deepEqual(capture.automationEvents!.map(event => event.automationId), ['Raise', 'StopAt3'])
  assert.ok(Math.abs(capture.automationEvents![1].time - 0.022) < 1e-8)
  assert.ok(Math.abs(voltage(capture, 'CH1', 0.03)) < 1e-9)
  assert.ok(Math.max(...capture.channels.CH1) < 3.00001)
})

test('real ngspice: automated switch recording measures changed current and preserves the initial operating point', { timeout: 15_000 }, async () => {
  const document = structuredClone(examples.find(example => example.id === 'voltage-divider')!.document)
  const part = document.parts[1]
  part.kind = 'switch'; part.value = 0
  document.automations = [timed('Close', 'switch', 1, 20, 0, part.id)]
  const capture = await solve(document)
  const before = sampleRecording(capture, 0.01)!.parts[part.id].currents[0].value
  const after = sampleRecording(capture, 0.08)!.parts[part.id].currents[0].value
  assert.ok(before > 4.9e-9 && before < 5.1e-9)
  assert.ok(Math.abs(after - 5 / 10001) < 1e-9)
  assert.ok(capture.operatingPoint!.parts[part.id].currents[0].value < 1e-8)
})

test('real ngspice: gate pulses release, falling edges fire once, and later holds cancel a pending release', { timeout: 15_000 }, async () => {
  const document = base()
  document.probes = { CH1: 'eg', CH2: 'cv' }
  document.instruments.envelope = { mode: 'gate', gateHigh: false, decayMs: 20 }
  const onRelease = crossing('OnRelease', 2.5, 'cv', -2)
  onRelease.trigger = { kind: 'voltage', channel: 'CH1', direction: 'falling', threshold: 2.5, afterMs: 0 }
  document.automations = [timed('FirstPulse', 'gate', 1, 0, 5), timed('SecondPulse', 'gate', 1, 10, 10), timed('Hold', 'gate', 1, 15), onRelease]
  const capture = await solve(document, 0.04)
  assert.ok(Math.abs(voltage(capture, 'CH1', 0.002) - 5) < 1e-9)
  assert.ok(Math.abs(voltage(capture, 'CH1', 0.006)) < 1e-9)
  assert.ok(Math.abs(voltage(capture, 'CH1', 0.03) - 5) < 1e-9)
  assert.ok(Math.abs(voltage(capture, 'CH2', 0.03) + 2) < 1e-9)
  assert.equal(capture.automationEvents!.filter(event => event.automationId === 'OnRelease').length, 1)
  assert.ok(Math.abs(capture.automationEvents!.find(event => event.automationId === 'OnRelease')!.time - 0.0050005) < 1e-10)
})

test('real ngspice: oscillator frequency ramps retain phase for every waveform while amplitude changes independently', { timeout: 20_000 }, async () => {
  for (const waveform of ['sine', 'triangle', 'square'] as const) {
    const document = base()
    document.instruments.frequency = 100
    document.instruments.waveform = waveform
    document.automations = [timed('Frequency', 'frequency', 200, 10, 20), timed('Amplitude', 'amplitude', 1, 5, 10)]
    const capture = await solve(document, 0.04)
    const expected = waveform === 'sine' ? Math.sin(2 * Math.PI * 4.4) : waveform === 'triangle' ? 0.6 : 1
    assert.ok(Math.abs(voltage(capture, 'CH2', 0.032) - expected) < 0.002, `${waveform}: ${voltage(capture, 'CH2', 0.032)} versus ${expected}`)
    assert.equal(capture.automationEvents!.length, 2)
  }
})

test('real ngspice: automated square edges retain solver breakpoints at the voltage event arm boundary', { timeout: 20_000 }, async () => {
  for (const frequency of [20, 100, 2000]) {
    const document = base()
    document.probes = { CH1: 'osc', CH2: 'cv' }
    document.instruments = { frequency, amplitude: 2, waveform: 'square', cv: 0 }
    const onEdge = crossing('OnEdge', 0, 'cv', 2)
    onEdge.trigger = { kind: 'voltage', channel: 'CH1', direction: 'rising', threshold: 0, afterMs: 1000 / frequency }
    document.automations = [timed('Amplitude', 'amplitude', 2, 90, 1), onEdge]
    const capture = await solve(document)
    const event = capture.automationEvents!.find(row => row.automationId === 'OnEdge')
    assert.ok(event, `${frequency} Hz edge must fire`)
    assert.ok(Math.abs(event.time - (1 / frequency + 0.5e-6)) < 1e-10, `${frequency} Hz: ${event.time}`)
  }
})

test('real ngspice: square edge timing integrates accelerating and decelerating frequency ramps', { timeout: 20_000 }, async () => {
  for (const [initial, final] of [[100, 200], [200, 100]]) {
    const document = base()
    document.probes = { CH1: 'osc', CH2: 'cv' }
    document.instruments = { frequency: initial, amplitude: 2, waveform: 'square', cv: 0 }
    const onEdge = crossing('OnEdge', 0, 'cv', 2)
    onEdge.trigger = { kind: 'voltage', channel: 'CH1', direction: 'rising', threshold: 0, afterMs: 11 }
    document.automations = [timed('Frequency', 'frequency', final, 10, 20), onEdge]
    const capture = await solve(document)
    const event = capture.automationEvents!.find(row => row.automationId === 'OnEdge')!
    const slope = (final - initial) / 0.02
    const elapsed = 2 / (initial + Math.sqrt(initial ** 2 + 2 * slope))
    const expected = 0.01 + elapsed + 0.5e-6
    assert.ok(Math.abs(event.time - expected) < 1e-10, `${initial}→${final} Hz: ${event.time} versus ${expected}`)
  }
})

test('real ngspice: automated triangle vertices remain captured so near-peak voltage events fire', { timeout: 20_000 }, async () => {
  const document = base()
  document.probes = { CH1: 'osc', CH2: 'cv' }
  document.instruments = { frequency: 20, amplitude: 2, waveform: 'triangle', cv: 0 }
  document.automations = [timed('Amplitude', 'amplitude', 2, 90, 1), crossing('NearPeak', 1.99999, 'cv', 2)]
  const capture = await solve(document)
  assert.ok(Math.abs(Math.max(...capture.channels.CH1) - 2) < 1e-9)
  const event = capture.automationEvents!.find(row => row.automationId === 'NearPeak')!
  assert.ok(event)
  assert.ok(Math.abs(event.time - 0.0249999375) < 1e-10)
})
