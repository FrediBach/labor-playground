import { spiceDeviceId, type CircuitDocument } from './circuit.ts'
import type { OperatingPointBranch, OperatingPointPartDescriptor } from './simulation-types.ts'

/** These match the compiler's fixed device models; this is measurement, not a solver. */
export function operatingPointDescriptors(document: CircuitDocument, nodeByTerminal: Record<string, string>): OperatingPointPartDescriptor[] {
  return document.parts.map((part) => {
    const nodes = part.pins.map((pin) => nodeByTerminal[pin])
    const [a, b, c] = nodes
    const branches: OperatingPointBranch[] = []
    if (part.kind === 'resistor' || part.kind === 'switch') {
      branches.push({ kind: 'resistance', label: '1 → 2', fromNode: a, toNode: b, resistance: part.kind === 'resistor' ? part.value : part.value === 1 ? 1 : 1e9 })
    } else if (part.kind === 'potentiometer') {
      const position = part.position ?? 0.5
      branches.push({ kind: 'resistance', label: 'CCW → Wiper', fromNode: a, toNode: b, resistance: Math.max(1, position * part.value) })
      branches.push({ kind: 'resistance', label: 'Wiper → CW', fromNode: b, toNode: c, resistance: Math.max(1, (1 - position) * part.value) })
    } else if (part.kind === 'capacitor' || part.kind === 'electrolytic') {
      branches.push({ kind: 'ideal-capacitor', label: part.kind === 'electrolytic' ? '+ → − (ideal DC)' : '1 → 2 (ideal DC)', fromNode: a, toNode: b })
    } else if (part.kind === 'diode' || part.kind === 'led' || part.kind === 'schottky' || part.kind === 'zener') {
      const safeId = spiceDeviceId(part)
      branches.push({ kind: 'saved-current', label: 'Anode → Cathode', fromNode: a, toNode: b, vector: `i(@d_${safeId.toLowerCase()}[id])` })
    } else if (part.kind === 'inductor') {
      branches.push({ kind: 'saved-current', label: '1 → 2', fromNode: a, toNode: b, vector: `i(@l_${spiceDeviceId(part).toLowerCase()}[i])` })
    } else if (part.kind === 'npn' || part.kind === 'pnp') {
      const safeId = spiceDeviceId(part).toLowerCase()
      // Referencing both terminal currents to E gives Vce*Ic + Vbe*Ib.
      // Signed PNP currents and voltages therefore yield positive dissipation.
      branches.push({ kind: 'saved-current', label: 'Collector → Emitter', fromNode: a, toNode: c, vector: `i(@q_${safeId}[ic])` })
      branches.push({ kind: 'saved-current', label: 'Base → Emitter', fromNode: b, toNode: c, vector: `i(@q_${safeId}[ib])` })
    }
    // Generic op-amp supply/output currents are intentionally unavailable: its
    // behavioral voltage model does not model real supply-current consumption.
    return { partId: part.id, nodes, branches }
  })
}
