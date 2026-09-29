import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmptyDocument, validateDocument, type Part } from '../src/lib/circuit.ts'
import { hasEditableLeads, leadPlacementError, previewLeadPins } from '../src/lib/part-editing.ts'

const resistor: Part = { id: 'R1', kind: 'resistor', value: 10_000, pins: ['c5', 'c8'] }
function fixture(part = resistor) { return { ...createEmptyDocument(), parts: [structuredClone(part)] } }

test('moving either lead preserves pin identity, the other lead, and the source part', () => {
  const diode: Part = { id: 'D1', kind: 'diode', value: 1, pins: ['c5', 'c8'] }
  assert.deepEqual(previewLeadPins(diode, 0, 'd6'), ['d6', 'c8'])
  assert.deepEqual(previewLeadPins(diode, 1, 'f8'), ['c5', 'f8'])
  assert.deepEqual(diode.pins, ['c5', 'c8'])
  assert.equal(leadPlacementError(fixture(diode), diode, 1, 'f8'), null)
})

test('new spacing includes exact 1- and 8-pitch boundaries and measures diagonals geometrically', () => {
  assert.equal(leadPlacementError(fixture(), resistor, 1, 'c6'), null)
  assert.equal(leadPlacementError(fixture(), resistor, 1, 'c13'), null)
  assert.match(leadPlacementError(fixture(), resistor, 1, 'c14')!, /1 and 8/)
  assert.equal(leadPlacementError(fixture(), resistor, 1, 'd12'), null)
  assert.match(leadPlacementError(fixture(), resistor, 1, 'd13')!, /1 and 8/)
})

test('instrument ports and duplicate holes are rejected while rail holes remain usable', () => {
  assert.match(leadPlacementError(fixture(), resistor, 1, 'osc')!, /instrument ports/)
  assert.match(leadPlacementError(fixture(), resistor, 1, 'c5')!, /separate holes/)
  const railPart: Part = { ...resistor, pins: ['bn5', 'bn8'] }
  assert.equal(leadPlacementError(fixture(railPart), railPart, 1, 'bp5'), null)
  assert.equal(previewLeadPins(resistor, 1, 'missing'), null)
})

test('own holes are available, other leads and jumper endpoints occupy holes, probes do not', () => {
  const document = fixture()
  assert.equal(leadPlacementError(document, resistor, 1, 'c8'), null)
  document.probes.CH1 = 'c9'
  assert.equal(leadPlacementError(document, resistor, 1, 'c9'), null)
  document.wires.push({ id: 'W1', from: 'c9', to: 'a9', color: '#ffffff' })
  assert.match(leadPlacementError(document, resistor, 1, 'c9')!, /occupied/)
  document.parts.push({ id: 'C1', kind: 'capacitor', value: 1e-6, pins: ['d9', 'd10'] })
  assert.match(leadPlacementError(document, resistor, 1, 'd9')!, /occupied/)
})

test('rigid packages and invalid pin indices never become editable two-lead parts', () => {
  for (const part of [
    { id: 'P1', kind: 'potentiometer', value: 10_000, pins: ['a1', 'a2', 'a3'] },
    { id: 'U1', kind: 'opamp', value: 1, pins: ['e1', 'e2', 'e3', 'e4', 'f4', 'f3', 'f2', 'f1'] },
  ] as Part[]) {
    assert.equal(hasEditableLeads(part), false)
    assert.equal(previewLeadPins(part, 0, 'a10'), null)
  }
  for (const index of [-1, 2, 0.5, NaN]) assert.equal(previewLeadPins(resistor, index, 'c9'), null)
})

test('legacy long lead placements still import while a new edit can shorten them', () => {
  const long: Part = { ...resistor, pins: ['a1', 'a25'] }
  const document = fixture(long)
  assert.deepEqual(validateDocument(document).parts[0].pins, long.pins)
  assert.equal(leadPlacementError(document, long, 1, 'a8'), null)
  assert.match(leadPlacementError(document, long, 1, 'a24')!, /1 and 8/)
})
