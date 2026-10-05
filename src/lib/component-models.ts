import { spiceDeviceId, type CircuitDocument, type Part } from './circuit.ts'
import { isSpiceComponent, resolvePartModel } from './custom-components.ts'
import { curveExpression } from './characteristic-curves.ts'
import type { OperatingPointPartDescriptor } from './simulation-types.ts'
import { spiceModelText } from './spice-models.ts'
import { expandSubcircuit, subcircuitTerminals } from './spice-subcircuits.ts'

/** One adapter result owns the solver law, saved current and frozen measurement model. */
export function compileCustomModel(document: CircuitDocument, part: Part, nodes: string[]) {
  const model = resolvePartModel(document, part)
  if (!model) return undefined
  if (model.baseKind === 'subcircuit') {
    const id = spiceDeviceId(part), terminals = subcircuitTerminals(model.spice)
    const activeNodes = model.pinMap.map(pin => nodes[pin])
    const sensors = activeNodes.map((_, index) => `VSUBPIN_${id}_${index}`)
    const internal = sensors.map((_, index) => `subpin_${id}_${index}`)
    const savedVectors = sensors.map(sensor => `i(${sensor.toLowerCase()})`)
    const expanded = expandSubcircuit(model.spice, internal, id)
    const lines = [...sensors.map((sensor, index) => `${sensor} ${activeNodes[index]} ${internal[index]} 0`), ...expanded.lines]
    const descriptor: OperatingPointPartDescriptor = { partId: part.id, nodes: activeNodes, branches: savedVectors.map((vector, index) => ({ kind: 'saved-current', label: `Into pin ${model.pinMap[index] + 1} (${terminals[index]})`, fromNode: activeNodes[index], toNode: '0', vector })) }
    return { lines, savedVectors, descriptor, devices: sensors.length + expanded.elements.length, internalNodes: internal.length + expanded.internalNodes }
  }
  if (isSpiceComponent(model)) {
    const id = spiceDeviceId(part), modelName = `IMPORTED_${id}`
    const [a, b, c] = nodes
    const diode = model.baseKind === 'diode'
    const terminalCount = diode ? 1 : 2
    const sensors = Array.from({ length: terminalCount }, (_, index) => `VIMPORTED_${id}_${index}`)
    const internal = sensors.map((_, index) => `imported_${id}_${index}`)
    const savedVectors = sensors.map(sensor => `i(${sensor.toLowerCase()})`)
    // A three-terminal BJT ties its optional substrate to emitter explicitly.
    // Leaving it implicit would connect substrate capacitance to global ground.
    const lines = [spiceModelText(model.spice, modelName), ...sensors.map((sensor, index) => `${sensor} ${nodes[index]} ${internal[index]} 0`), `${diode ? 'D' : 'Q'}_${id} ${diode ? `${internal[0]} ${b}` : `${internal[0]} ${internal[1]} ${c} ${c}`} ${modelName}`]
    const descriptor: OperatingPointPartDescriptor = { partId: part.id, nodes, branches: savedVectors.map((vector, index) => ({ kind: 'saved-current', label: diode ? 'Anode → Cathode' : index === 0 ? 'Collector → Emitter' : 'Base → Emitter', fromNode: index === 0 ? a : b, toNode: diode ? b : c, vector })) }
    return { lines, savedVectors, descriptor, devices: terminalCount + 1, internalNodes: terminalCount }
  }
  const id = spiceDeviceId(part), sensor = `VSENSE_${id}`, internal = `custom_${id}`
  const [a, b] = nodes
  const vector = `i(${sensor.toLowerCase()})`
  const lines = [`${sensor} ${a} ${internal} 0`]
  if (model.baseKind === 'resistor') lines.push(`BCUSTOM_${id} ${internal} ${b} V = i(${sensor})*${curveExpression(model.characteristic.points, `abs(i(${sensor}))`)}`)
  else lines.push(`CCUSTOM_${id} ${internal} ${b} Q = ${curveExpression(model.characteristic.points, `v(${internal},${b})`, true)}`)
  const descriptor: OperatingPointPartDescriptor = { partId: part.id, nodes, branches: [{ kind: 'saved-current', label: '1 → 2', fromNode: a, toNode: b, vector }], customModel: structuredClone(model) }
  return { lines, savedVectors: [vector], descriptor, devices: 2, internalNodes: 1 }
}
