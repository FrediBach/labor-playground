import { spiceDeviceId, type CircuitDocument, type Part } from './circuit.ts'
import { resolvePartModel } from './custom-components.ts'
import { curveExpression } from './characteristic-curves.ts'
import type { OperatingPointPartDescriptor } from './simulation-types.ts'

/** One adapter result owns the solver law, saved current and frozen measurement model. */
export function compileCustomModel(document: CircuitDocument, part: Part, nodes: string[]) {
  const model = resolvePartModel(document, part)
  if (!model) return undefined
  const id = spiceDeviceId(part), sensor = `VSENSE_${id}`, internal = `custom_${id}`
  const [a, b] = nodes
  const vector = `i(${sensor.toLowerCase()})`
  const lines = [`${sensor} ${a} ${internal} 0`]
  if (model.baseKind === 'resistor') lines.push(`BCUSTOM_${id} ${internal} ${b} V = i(${sensor})*${curveExpression(model.characteristic.points, `abs(i(${sensor}))`)}`)
  else lines.push(`CCUSTOM_${id} ${internal} ${b} Q = ${curveExpression(model.characteristic.points, `v(${internal},${b})`, true)}`)
  const descriptor: OperatingPointPartDescriptor = { partId: part.id, nodes, branches: [{ kind: 'saved-current', label: '1 → 2', fromNode: a, toNode: b, vector }], customModel: structuredClone(model) }
  return { lines, savedVectors: [vector], descriptor, devices: 2, internalNodes: 1 }
}
