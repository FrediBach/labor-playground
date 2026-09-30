import assert from 'node:assert/strict'
import test from 'node:test'
import { Simulation } from 'eecircuit-engine'
import { icExamples } from '../src/lib/ic-examples.ts'
import { canPlace, compileCircuit, createEmptyDocument, getPlacement, isValidFootprint, PARTS, terminalById, validateDocument, type CircuitDocument } from '../src/lib/circuit.ts'

const engine = new Simulation()
const example = (id: string) => structuredClone(icExamples.find((item) => item.id === id)!.document)
const close = (actual: number, expected: number, tolerance: number) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`)

async function solve(document: CircuitDocument, analysis: 'transient' | 'operating-point' = 'transient') {
  const compiled = compileCircuit(document, analysis)
  assert.deepEqual(compiled.diagnostics, [])
  await engine.start()
  engine.setNetList(compiled.netlist)
  const result = await engine.runSim()
  assert.deepEqual(engine.getError(), [])
  const time = result.data.find((vector) => vector.type === 'time')?.values ?? []
  const voltage = (terminal: string) => {
    const values = result.data.find((vector) => vector.name === `v(${compiled.nodeByTerminal[terminal]})`)?.values
    assert.ok(values?.length, `Missing voltage at ${terminal}`)
    assert.ok(values.every(Number.isFinite), `Nonfinite voltage at ${terminal}`)
    return values
  }
  return { time, voltage }
}

function crossings(time: number[], values: number[], level: number, rising: boolean) {
  const result: number[] = []
  for (let index = 1; index < time.length; index++) {
    if (rising ? values[index - 1] <= level && values[index] > level : values[index - 1] >= level && values[index] < level) {
      const fraction = (level - values[index - 1]) / (values[index] - values[index - 1])
      result.push(time[index - 1] + fraction * (time[index] - time[index - 1]))
    }
  }
  return result
}

test('555 and quad op-amp footprints preserve physical pin numbering across supported rotations and imports', () => {
  assert.deepEqual(PARTS.timer555.pinNames, ['GND', 'TRIG', 'OUT', 'RESET', 'CTRL', 'THRESH', 'DISCH', 'VCC'])
  assert.deepEqual(PARTS.quadopamp.pinNames, ['OUT A', 'IN− A', 'IN+ A', 'V+', 'IN+ B', 'IN− B', 'OUT B', 'OUT C', 'IN− C', 'IN+ C', 'V−', 'IN+ D', 'IN− D', 'OUT D'])
  for (const [kind, half] of [['timer555', 4], ['quadopamp', 7]] as const) {
    const standard = Array.from({ length: half }, (_, index) => `e${11 + index}`).concat(Array.from({ length: half }, (_, index) => `f${10 + half - index}`))
    const rotated = standard.slice(half).concat(standard.slice(0, half))
    assert.deepEqual(getPlacement(kind, 'e11'), standard)
    assert.deepEqual(getPlacement(kind, `f${10 + half}`, 180), rotated)
    assert.equal(isValidFootprint(kind, standard), true)
    assert.equal(isValidFootprint(kind, rotated), true)
    assert.equal(getPlacement(kind, 'e11', 90), null)
    assert.equal(getPlacement(kind, 'e11', 180), null)
    assert.equal(getPlacement(kind, 'f3', 180), null)
    assert.equal(getPlacement(kind, `e${32 - half}`), null)
    assert.equal(getPlacement(kind, 'd11'), null)
    const document = createEmptyDocument()
    document.parts = [{ id: 'U1', kind, value: 1, pins: rotated }]
    assert.deepEqual(validateDocument(document), document)
    assert.equal(canPlace(document, standard), false)
    for (const pins of [standard.slice(0, -1), standard.map((pin) => pin.replace('e', 'd')), [standard[1], standard[0], ...standard.slice(2)]]) {
      document.parts[0].pins = pins
      assert.throws(() => validateDocument(document), /pins|footprint/)
    }
    document.parts[0].pins = standard
    document.parts[0].value = 2
    assert.throws(() => validateDocument(document), /value/)
  }
})

test('IC examples fit the editable board with explicit supplies and physical component spans', () => {
  for (const { id, document } of icExamples) {
    assert.deepEqual(validateDocument(document), document, id)
    const compiled = compileCircuit(document)
    assert.deepEqual(compiled.diagnostics, [], id)
    const nodes = compiled.nodeByTerminal
    const ic = document.parts.find((part) => part.id === 'U1')!
    if (ic.kind === 'quadopamp') {
      assert.equal(nodes[ic.pins[3]], nodes.vplus, 'TL074 pin 4 is positive supply')
      assert.equal(nodes[ic.pins[10]], nodes.vminus, 'TL074 pin 11 is negative supply')
    } else {
      assert.equal(nodes[ic.pins[0]], '0', '555 pin 1 is GND')
      assert.equal(nodes[ic.pins[7]], nodes[id === '555-astable' ? 'vplus' : 'cv'], '555 pin 8 is VCC')
      assert.equal(nodes[ic.pins[3]], nodes[ic.pins[7]], '555 RESET is held high')
    }
    for (const part of document.parts.filter((part) => part.pins.length === 2)) {
      const [a, b] = part.pins.map((pin) => terminalById[pin])
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      assert.ok(distance >= 24 && distance <= 192, `${id}: ${part.id} lead span`)
    }
  }
})

test('quad op-amp supplies and all eight input returns are checked before capture', () => {
  for (const wireId of ['W5', 'W6']) {
    const document = example('quad-buffer')
    document.wires = document.wires.filter((wire) => wire.id !== wireId)
    assert.ok(compileCircuit(document).diagnostics.some((item) => item.severity === 'error' && /no connected supply/.test(item.message)))
  }
  const reversed = example('quad-buffer')
  reversed.wires.find((wire) => wire.id === 'W2')!.from = 'vminus'
  reversed.wires.find((wire) => wire.id === 'W3')!.from = 'vplus'
  assert.ok(compileCircuit(reversed).diagnostics.some((item) => /polarity is reversed/.test(item.message)))
  for (const [wireId, name] of [['W1', 'IN+ A'], ['W7', 'IN+ B'], ['W11', 'IN+ C'], ['W12', 'IN+ D'], ['W10', 'IN− A'], ['W13', 'IN− C'], ['W14', 'IN− D']]) {
    const document = example('quad-buffer')
    document.wires = document.wires.filter((wire) => wire.id !== wireId)
    assert.ok(compileCircuit(document).diagnostics.some((item) => item.message.includes(name) && /floating/.test(item.message)), name)
  }
  const floatingB = example('quad-buffer')
  floatingB.parts = floatingB.parts.filter((part) => !['R1', 'R2'].includes(part.id))
  assert.ok(compileCircuit(floatingB).diagnostics.some((item) => item.message.includes('IN− B') && /floating/.test(item.message)))
})

test('555 supplies and reset are explicit while the internal CTRL divider may provide its DC reference', () => {
  for (const wireId of ['W3', 'W5']) {
    const document = example('555-astable')
    document.wires = document.wires.filter((wire) => wire.id !== wireId)
    assert.ok(compileCircuit(document).diagnostics.some((item) => item.severity === 'error' && /no connected supply/.test(item.message)))
  }
  const resetFloating = example('555-astable')
  resetFloating.wires = resetFloating.wires.filter((wire) => wire.id !== 'W4')
  assert.ok(compileCircuit(resetFloating).diagnostics.some((item) => /e16.*no DC path/.test(item.message)))
  const lowSupply = example('555-monostable')
  lowSupply.instruments.cv = 3.3
  assert.ok(compileCircuit(lowSupply).diagnostics.some((item) => /4\.5–16 V/.test(item.message) && item.severity === 'error'))
  const openControl = example('555-astable')
  openControl.parts = openControl.parts.filter((part) => part.id !== 'C2')
  assert.deepEqual(compileCircuit(openControl).diagnostics, [])
})

test('real ngspice: editable 555 astable frequency and duty cycle follow both external timing resistors and capacitor', { timeout: 15_000 }, async () => {
  for (const [ra, capacitance] of [[10_000, 100e-9], [10_000, 220e-9], [22_000, 220e-9]]) {
    const document = example('555-astable')
    document.parts.find((part) => part.id === 'R1')!.value = ra
    document.parts.find((part) => part.id === 'C1')!.value = capacitance
    const { time, voltage } = await solve(document)
    const timing = voltage(document.probes.CH1!)
    const output = voltage(document.probes.CH2!)
    const rising = crossings(time, output, 6, true).filter((value) => value > 0.02)
    const falling = crossings(time, output, 6, false)
    assert.ok(rising.length > 5, 'Free-running oscillator continues after startup')
    const expectedHigh = Math.LN2 * (ra + 10_000) * capacitance
    const expectedLow = Math.LN2 * 10_000 * capacitance
    for (let index = 0; index < rising.length - 1; index++) {
      const fall = falling.find((value) => value > rising[index])!
      close(fall - rising[index], expectedHigh, expectedHigh * 0.025)
      close(rising[index + 1] - fall, expectedLow, expectedLow * 0.025)
    }
    const settledTiming = timing.filter((_, index) => time[index] > 0.02)
    close(Math.min(...settledTiming), 4, 0.06)
    close(Math.max(...settledTiming), 8, 0.06)
    close(Math.min(...output), 0.1, 0.001)
    close(Math.max(...output), 10.8, 0.001)
  }
})

test('real ngspice: editable 555 monostable edge trigger produces an RC-controlled pulse and returns low', { timeout: 15_000 }, async () => {
  for (const resistance of [100_000, 220_000]) {
    const document = example('555-monostable')
    document.parts.find((part) => part.id === 'R1')!.value = resistance
    const { time, voltage } = await solve(document)
    const trigger = voltage(document.probes.CH1!)
    const output = voltage(document.probes.CH2!)
    const rising = crossings(time, output, 2, true)
    const falling = crossings(time, output, 2, false)
    assert.equal(rising.length, 1)
    assert.equal(falling.length, 1)
    close(rising[0], 0.051, 5e-6)
    const expectedWidth = Math.log(3) * resistance * 100e-9
    close(falling[0] - rising[0], expectedWidth, expectedWidth * 0.02)
    const recoveryIndex = time.findIndex((value) => value > rising[0] + 0.001)
    assert.ok(trigger[recoveryIndex] > 4.9 && output[recoveryIndex] > 3.7, 'Trigger recovers while timer retains its state')
    close(output.at(-1)!, 0.1, 0.001)
    close(Math.max(...output), 3.8, 0.001)
    const point = await solve(document, 'operating-point')
    close(point.voltage(document.probes.CH2!)[0], 0.1, 0.001)
  }
})

test('real ngspice: all four TL074-style sections buffer and invert audio and CV, with clipping from explicit rails', { timeout: 15_000 }, async () => {
  for (const gain of [1, 2]) {
    const document = example('quad-buffer')
    document.parts.find((part) => part.id === 'R2')!.value = gain * 100_000
    const { voltage } = await solve(document)
    const input = voltage('e13')
    for (const [pin, expectedGain] of [['e11', 1], ['e17', -gain], ['f17', 1], ['f11', -gain]] as const) {
      assert.ok(voltage(pin).every((value, index) => Math.abs(value - input[index] * expectedGain) < 0.003), `Section at ${pin} gain ${expectedGain}`)
    }
    document.wires.find((wire) => wire.id === 'W1')!.from = 'cv'
    document.instruments.cv = 2
    const dc = await solve(document, 'operating-point')
    close(dc.voltage('e11')[0], 2, 0.003)
    close(dc.voltage('e17')[0], -2 * gain, 0.003)
    close(dc.voltage('f17')[0], 2, 0.003)
    close(dc.voltage('f11')[0], -2 * gain, 0.003)
  }
  const clipped = example('quad-buffer')
  clipped.parts.find((part) => part.id === 'R2')!.value = 1_000_000
  for (const frequency of [20, 220, 2_000]) {
    clipped.instruments.frequency = frequency
    const { voltage } = await solve(clipped)
    for (const pin of ['e17', 'f11']) {
      close(Math.max(...voltage(pin)), 11, 0.002)
      close(Math.min(...voltage(pin)), -11, 0.002)
    }
  }
  clipped.wires.find((wire) => wire.id === 'W2')!.from = 'cv'
  const lowerSupply = await solve(clipped)
  for (const pin of ['e17', 'f11']) {
    close(Math.max(...lowerSupply.voltage(pin)), 4, 0.002)
    close(Math.min(...lowerSupply.voltage(pin)), -11, 0.002)
  }
})
