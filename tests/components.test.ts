import assert from 'node:assert/strict'
import test from 'node:test'
import { Simulation } from 'eecircuit-engine'
import { canPlace, compileCircuit, createEmptyDocument, examples, getPlacement, isValidFootprint, PARTS, validateDocument, type CircuitDocument } from '../src/lib/circuit.ts'
import { extractCapture } from '../src/lib/simulation-results.ts'

const engine = new Simulation()
const example = (id: string) => structuredClone(examples.find((item) => item.id === id)!.document)
async function capture(document: CircuitDocument) {
  const compiled = compileCircuit(document)
  assert.deepEqual(compiled.diagnostics.filter((item) => item.severity === 'error'), [])
  await engine.start()
  engine.setNetList(compiled.netlist)
  return extractCapture(await engine.runSim(), {
    CH1: document.probes.CH1 ? compiled.nodeByTerminal[document.probes.CH1] : null,
    CH2: document.probes.CH2 ? compiled.nodeByTerminal[document.probes.CH2] : null,
  }, 1, 0)
}

function potentiometer(position?: number): CircuitDocument {
  return {
    ...createEmptyDocument(),
    parts: [{ id: 'P1', kind: 'potentiometer', value: 10_000, pins: ['a10', 'a11', 'a12'], ...(position === undefined ? {} : { position }) }],
    wires: [{ id: 'W1', from: 'cv', to: 'b10', color: '#ffffff' }, { id: 'W2', from: 'gnd', to: 'b12', color: '#ffffff' }],
    probes: { CH1: 'c10', CH2: 'c11' },
  }
}

test('schema 1 preserves old documents and optional new parameters without extra properties', () => {
  const legacy = example('rc-filter')
  assert.deepEqual(validateDocument(legacy), legacy)
  assert.equal('stimulus' in validateDocument(legacy), false)
  const pot = potentiometer()
  assert.equal('position' in validateDocument(pot).parts[0], false)
  pot.parts[0].position = 0.25
  pot.stimulus = 'step'
  assert.deepEqual(validateDocument(pot), pot)
  assert.throws(() => validateDocument({ ...pot, stimulus: 'script' }), /stimulus/)
  for (const value of [-0.1, 1.1, NaN, Infinity]) {
    pot.parts[0].position = value
    assert.throws(() => validateDocument(pot), /wiper position/)
  }
})

test('DIP-8 occupies the trench in two orientations with verified pin numbering', () => {
  const standard = ['e13', 'e14', 'e15', 'e16', 'f16', 'f15', 'f14', 'f13']
  const rotated = ['f16', 'f15', 'f14', 'f13', 'e13', 'e14', 'e15', 'e16']
  assert.deepEqual(getPlacement('opamp', 'e13'), standard)
  assert.deepEqual(getPlacement('opamp', 'f16', 180), rotated)
  assert.deepEqual(PARTS.opamp.pinNames, ['OUT A', 'IN− A', 'IN+ A', 'V−', 'IN+ B', 'IN− B', 'OUT B', 'V+'])
  assert.equal(isValidFootprint('opamp', standard), true)
  assert.equal(isValidFootprint('opamp', rotated), true)
  assert.equal(getPlacement('opamp', 'e13', 90), null)
  assert.equal(getPlacement('opamp', 'e13', 180), null)
  assert.equal(getPlacement('opamp', 'e28'), null)
  assert.equal(getPlacement('opamp', 'f3', 180), null)
  assert.equal(getPlacement('opamp', 'd13'), null)
  const doc = example('opamp-amplifier')
  assert.equal(canPlace(doc, getPlacement('opamp', 'e12')!), false)
  const rotatedDoc = createEmptyDocument()
  rotatedDoc.parts = [{ id: 'U1', kind: 'opamp', value: 1, pins: rotated }]
  assert.deepEqual(validateDocument(rotatedDoc).parts[0].pins, rotated)
  for (const pins of [standard.slice(0, -1), standard.map((pin) => pin.replace('e', 'd')), [standard[1], standard[0], ...standard.slice(2)]]) {
    rotatedDoc.parts[0].pins = pins
    assert.throws(() => validateDocument(rotatedDoc), /pins|footprint/)
  }
})

test('potentiometers have three evenly spaced pins and every lead participates in occupancy', () => {
  assert.deepEqual(getPlacement('potentiometer', 'a10'), ['a10', 'a11', 'a12'])
  assert.deepEqual(getPlacement('potentiometer', 'c10', 270), ['c10', 'b10', 'a10'])
  assert.deepEqual(getPlacement('potentiometer', 'c12', 180), ['c12', 'c11', 'c10'])
  assert.equal(getPlacement('potentiometer', 'a29'), null)
  assert.equal(getPlacement('potentiometer', 'd10', 90), null)
  assert.equal(isValidFootprint('potentiometer', ['a10', 'a11', 'a13']), false)
  assert.equal(canPlace(potentiometer(), ['a9', 'a12']), false)
  const doc = potentiometer()
  doc.parts[0].pins = ['a10', 'b10', 'c10']
  doc.wires = []
  assert.ok(compileCircuit(doc).diagnostics.some((item) => item.message.includes('three separate strips')))
})

test('op-amp supply and input diagnostics prevent an unpowered or floating amplifier capture', () => {
  for (const wireId of ['W2', 'W3']) {
    const doc = example('opamp-amplifier')
    doc.wires = doc.wires.filter((wire) => wire.id !== wireId)
    assert.ok(compileCircuit(doc).diagnostics.some((item) => item.severity === 'error' && item.message.includes('no connected supply')))
  }
  const reversed = example('opamp-amplifier')
  reversed.wires.find((wire) => wire.id === 'W2')!.from = 'vminus'
  reversed.wires.find((wire) => wire.id === 'W3')!.from = 'vplus'
  assert.ok(compileCircuit(reversed).diagnostics.some((item) => item.message.includes('polarity is reversed')))
  const insufficient = example('opamp-amplifier')
  insufficient.instruments.cv = 1
  insufficient.wires.find((wire) => wire.id === 'W2')!.from = 'cv'
  insufficient.wires.find((wire) => wire.id === 'W3')!.from = 'bn7'
  assert.ok(compileCircuit(insufficient).diagnostics.some((item) => item.message.includes('insufficient')))
  const floating = example('opamp-amplifier')
  floating.wires = floating.wires.filter((wire) => wire.id !== 'W1' && wire.id !== 'W6')
  const messages = compileCircuit(floating).diagnostics.map((item) => item.message)
  assert.ok(messages.some((message) => message.includes('IN+ A') && message.includes('floating')))
  assert.ok(messages.some((message) => message.includes('IN+ B') && message.includes('floating')))
  const nodes = compileCircuit(example('opamp-amplifier')).nodeByTerminal
  assert.notEqual(nodes.e13, nodes.e14)
  assert.notEqual(nodes.e14, nodes.e15)
  assert.notEqual(nodes.e16, nodes.f13)
})

test('electrolytic polarity is retained and definite reversed DC bias warns without inventing a return', () => {
  const doc = createEmptyDocument()
  doc.parts = [{ id: 'C1', kind: 'electrolytic', value: 1e-6, pins: ['e1', 'f1'] }]
  doc.wires = [{ id: 'W1', from: 'gnd', to: 'a1', color: '#ffffff' }, { id: 'W2', from: 'cv', to: 'j1', color: '#ffffff' }]
  assert.deepEqual(validateDocument(doc).parts[0].pins, ['e1', 'f1'])
  assert.ok(compileCircuit(doc).diagnostics.some((item) => item.severity === 'warning' && item.message.includes('reversed DC polarity')))
  doc.wires.pop()
  assert.ok(compileCircuit(doc).diagnostics.some((item) => item.severity === 'error' && item.message.includes('DC path')))
})

test('real ngspice: potentiometer midpoint and endpoints obey the modeled 1Ω minimum', { timeout: 15_000 }, async () => {
  for (const position of [undefined, 0, 0.25, 1]) {
    const result = await capture(potentiometer(position))
    const fraction = position ?? 0.5
    const expected = 5 * Math.max(1, (1 - fraction) * 10_000) / (Math.max(1, fraction * 10_000) + Math.max(1, (1 - fraction) * 10_000))
    assert.ok(Math.abs(result.channels.CH2.at(-1)! - expected) < 1e-8, `position ${position}`)
  }
})

test('real ngspice: editable charge example follows analytical charging and decay with source impedance', { timeout: 15_000 }, async () => {
  const result = await capture(example('capacitor-charge'))
  const sample = (time: number) => result.channels.CH2[result.time.findIndex((value) => value >= time)]
  assert.equal(sample(0), 0)
  assert.ok(Math.abs(sample(0.0111) - 5 * (1 - Math.exp(-1))) < 0.006)
  const expectedAtFall = 5 * (1 - Math.exp(-0.05 / 0.0101))
  assert.ok(Math.abs(sample(0.0611) - expectedAtFall / Math.E) < 0.006)
  assert.ok(sample(0.099) < 0.05)
})

test('real ngspice: dual op-amp gain stage, unity follower, and clipping follow explicit supplies', { timeout: 15_000 }, async () => {
  const gain = example('opamp-amplifier')
  const doubled = await capture(gain)
  const peak = Math.max(...doubled.channels.CH2)
  assert.ok(Math.abs(peak - 5) < 0.003, `gain 2 peak ${peak}`)
  assert.ok(Math.min(...doubled.channels.CH2) < -4.99)
  const rotated = example('opamp-amplifier')
  const rotateHole = (id: string) => id.replace(/^([a-j])(\d+)$/, (_, row: string, column: string) => `${'jihgfedcba'['abcdefghij'.indexOf(row)]}${29 - Number(column)}`)
  rotated.parts.forEach((part) => { part.pins = part.pins.map(rotateHole) })
  rotated.wires.forEach((wire) => { wire.from = rotateHole(wire.from); wire.to = rotateHole(wire.to) })
  rotated.probes = { CH1: rotateHole(rotated.probes.CH1!), CH2: rotateHole(rotated.probes.CH2!) }
  const rotatedCapture = await capture(rotated)
  assert.ok(Math.abs(Math.max(...rotatedCapture.channels.CH2) - peak) < 0.0001)
  const gainThree = example('opamp-amplifier')
  gainThree.parts.find((part) => part.id === 'R1')!.value = 20_000
  const tripled = await capture(gainThree)
  assert.ok(Math.abs(Math.max(...tripled.channels.CH2) - 7.5) < 0.005)
  const follower = example('opamp-amplifier')
  follower.parts = follower.parts.filter((part) => part.kind === 'opamp')
  follower.wires.push({ id: 'W8', from: 'c13', to: 'c14', color: '#ffffff' })
  const followed = await capture(follower)
  const error = Math.max(...followed.channels.CH2.map((value, index) => Math.abs(value - followed.channels.CH1[index])))
  assert.ok(error < 0.0001, `follower error ${error}`)
  gain.parts.find((part) => part.id === 'R1')!.value = 100_000
  const clipped = await capture(gain)
  assert.ok(Math.max(...clipped.channels.CH2) <= 11)
  assert.ok(Math.max(...clipped.channels.CH2) > 10.9)
  assert.ok(Math.min(...clipped.channels.CH2) >= -11)
  assert.ok(Math.min(...clipped.channels.CH2) < -10.9)
  gain.wires.find((wire) => wire.id === 'W2')!.from = 'cv'
  const lowerSupply = await capture(gain)
  assert.ok(Math.max(...lowerSupply.channels.CH2) <= 4)
  assert.ok(Math.max(...lowerSupply.channels.CH2) > 3.9)
  assert.ok(Math.min(...lowerSupply.channels.CH2) >= -11)
})

test('step stimulus overrides the capture source while preserving the selected oscillator waveform', () => {
  const doc = example('capacitor-charge')
  const compiled = compileCircuit(doc)
  assert.match(compiled.netlist, /VOSC osc_internal 0 PULSE\(0 .* 0\.001 1e-6 1e-6 0\.049999 1\)/)
  assert.equal(doc.instruments.waveform, 'sine')
  doc.stimulus = 'periodic'
  assert.match(compileCircuit(doc).netlist, /VOSC osc_internal 0 SIN\(/)
})
