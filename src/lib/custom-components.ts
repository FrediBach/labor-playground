import { PARTS, formatValue, validateDocument, type CircuitDocument, type ComponentKind, type Part } from './circuit.ts'
import { curveValue, type CurvePoint } from './characteristic-curves.ts'

interface Characteristic { points: CurvePoint[]; interpolation: 'linear'; extrapolation: 'constant' }
interface Definition { id: string; name: string; description?: string; modelVersion: 1 }
export type CustomComponent = Definition & (
  | { baseKind: 'resistor'; characteristic: Characteristic & { type: 'resistance-current'; axis: 'current-magnitude' } }
  | { baseKind: 'capacitor'; characteristic: Characteristic & { type: 'capacitance-voltage'; axis: 'signed-voltage' } }
)
export interface PartPlacement { kind: ComponentKind; customModelId?: string }
export const CUSTOM_LIMITS = { definitions: 32, points: 64, name: 80, description: 500, current: 1, voltage: 100, minCurrentSegment: 1e-6, minVoltageSegment: 1e-3, resistanceSlope: 1e9, capacitanceSlope: 1, netlistBytes: 1_000_000, devices: 1000, internalNodes: 300 } as const

export function validateCustomComponents(input: unknown): CustomComponent[] {
  if (!Array.isArray(input) || input.length > CUSTOM_LIMITS.definitions) throw new Error('Use at most 32 custom component definitions.')
  const ids = new Set<string>()
  return input.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid custom component definition.')
    const d = raw as CustomComponent
    if (typeof d.id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(d.id) || ids.has(d.id.toLowerCase())) throw new Error('Custom component IDs must be unique short alphanumeric IDs.')
    ids.add(d.id.toLowerCase())
    if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > 80) throw new Error('Name must contain 1–80 characters.')
    if (d.description !== undefined && (typeof d.description !== 'string' || d.description.length > 500)) throw new Error('Description must contain at most 500 characters.')
    if (d.modelVersion !== 1 || !['resistor', 'capacitor'].includes(d.baseKind)) throw new Error('Unsupported custom component model version or base kind.')
    const c = d.characteristic
    const resistor = d.baseKind === 'resistor'
    if (!c || c.type !== (resistor ? 'resistance-current' : 'capacitance-voltage') || c.axis !== (resistor ? 'current-magnitude' : 'signed-voltage') || c.interpolation !== 'linear' || c.extrapolation !== 'constant') throw new Error('Unsupported characteristic, axis, interpolation or extrapolation.')
    if (!Array.isArray(c.points) || c.points.length < 2 || c.points.length > 64) throw new Error('Use 2–64 curve points.')
    const range = PARTS[d.baseKind]
    const points = c.points.map((p, i) => {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > (resistor ? CUSTOM_LIMITS.current : CUSTOM_LIMITS.voltage) || p.y < range.min || p.y > range.max) throw new Error(`Row ${i + 1}: coordinates must be finite and within the supported axis and ${resistor ? 'resistance' : 'capacitance'} ranges.`)
      if (i) {
        const a = c.points[i - 1], dx = p.x - a.x
        if (dx < (resistor ? CUSTOM_LIMITS.minCurrentSegment : CUSTOM_LIMITS.minVoltageSegment) * (1 - 1e-10)) throw new Error(`Row ${i + 1}: coordinates must increase by at least ${resistor ? '1 µA' : '1 mV'}.`)
        const slope = (p.y - a.y) / dx
        if (Math.abs(slope) > (resistor ? CUSTOM_LIMITS.resistanceSlope : CUSTOM_LIMITS.capacitanceSlope)) throw new Error(`Row ${i + 1}: slope exceeds the supported limit.`)
        if (resistor && Math.min(a.y + a.x * slope, p.y + p.x * slope) <= 0) throw new Error(`Row ${i + 1}: differential resistance must be positive throughout the segment.`)
      }
      return { x: p.x, y: p.y }
    })
    if (resistor ? points[0].x !== 0 : !(points[0].x < 0 && points.at(-1)!.x > 0 && points.some(p => p.x === 0))) throw new Error(resistor ? 'Current magnitude must begin at zero.' : 'Voltage must include zero and cover negative and positive values.')
    return { id: d.id, name: d.name, ...(d.description === undefined ? {} : { description: d.description }), modelVersion: 1, baseKind: d.baseKind, characteristic: { type: c.type, axis: c.axis, interpolation: 'linear', extrapolation: 'constant', points } } as CustomComponent
  })
}
export function resolvePartModel(document: Pick<CircuitDocument, 'customComponents'>, part: Pick<Part, 'kind' | 'customModelId'>): CustomComponent | undefined {
  if (part.customModelId === undefined) return undefined
  const model = document.customComponents?.find(d => d.id === part.customModelId)
  if (!model || model.baseKind !== part.kind) throw new Error(`Missing or incompatible custom model: ${part.customModelId}.`)
  return model
}
export const nominalValue = (model: CustomComponent) => curveValue(model.characteristic.points, 0)
export const partDisplayName = (doc: CircuitDocument, part: Part) => resolvePartModel(doc, part)?.name ?? PARTS[part.kind].label
export const partValueSummary = (doc: CircuitDocument, part: Part) => `${formatValue(part.value, part.kind)}${resolvePartModel(doc, part) ? ' nominal · custom' : ''}`
export const minimumModelValue = (doc: CircuitDocument, part: Part) => {
  const model = resolvePartModel(doc, part)
  return model ? Math.min(...model.characteristic.points.map(p => p.y)) : part.value
}
export function customTemplate(kind: 'resistor' | 'capacitor', value = PARTS[kind].defaultValue): CustomComponent {
  const base = { id: `model_${crypto.randomUUID().slice(0, 20)}`, name: `Custom ${kind}`, modelVersion: 1 as const }
  return kind === 'resistor'
    ? { ...base, baseKind: kind, characteristic: { type: 'resistance-current', axis: 'current-magnitude', interpolation: 'linear', extrapolation: 'constant', points: [{ x: 0, y: value }, { x: 0.01, y: value }] } }
    : { ...base, baseKind: kind, characteristic: { type: 'capacitance-voltage', axis: 'signed-voltage', interpolation: 'linear', extrapolation: 'constant', points: [-5, 0, 5].map(x => ({ x, y: value })) } }
}
export function saveCustomComponent(document: CircuitDocument, model: CustomComponent): CircuitDocument {
  const definitions = document.customComponents ?? []
  return validateDocument({ ...document, schemaVersion: document.schemaVersion === 4 ? 4 : 3, customComponents: definitions.some(d => d.id === model.id) ? definitions.map(d => d.id === model.id ? model : d) : [...definitions, model] })
}
export function assignCustomComponent(document: CircuitDocument, partId: string, modelId?: string): CircuitDocument {
  return validateDocument({ ...document, parts: document.parts.map(part => {
    if (part.id !== partId) return part
    const { customModelId: _old, ...linear } = part
    return modelId ? { ...linear, customModelId: modelId } : linear
  }) })
}
export function deleteCustomComponent(document: CircuitDocument, id: string): CircuitDocument {
  const instances = document.parts.filter(p => p.customModelId === id)
  if (instances.length) throw new Error(`Reassign or remove ${instances.map(p => p.id).join(', ')} before deleting this model.`)
  return validateDocument({ ...document, customComponents: document.customComponents?.filter(d => d.id !== id) })
}
export function duplicateCustomComponent(document: CircuitDocument, id: string, partId?: string): { document: CircuitDocument; model: CustomComponent } {
  const original = document.customComponents?.find(d => d.id === id)
  if (!original) throw new Error('This model no longer exists.')
  const model = { ...structuredClone(original), id: customTemplate(original.baseKind).id, name: `${original.name.slice(0, 73)} (copy)` }
  const saved = saveCustomComponent(document, model)
  return { document: partId ? assignCustomComponent(saved, partId, model.id) : saved, model }
}
export function parsePlacement(text: string, document: CircuitDocument): PartPlacement | null {
  try {
    const input = text.startsWith('{') ? JSON.parse(text) : { kind: text }
    if (!input || typeof input.kind !== 'string' || !Object.hasOwn(PARTS, input.kind) || (input.customModelId !== undefined && typeof input.customModelId !== 'string')) return null
    resolvePartModel(document, input)
    return { kind: input.kind, ...(input.customModelId === undefined ? {} : { customModelId: input.customModelId }) }
  } catch { return null }
}
