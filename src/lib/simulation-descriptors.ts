import { compileCustomModel } from './component-models.ts'
import { spiceDeviceId, type CircuitDocument } from './circuit.ts'
import type { OperatingPointBranch, OperatingPointPartDescriptor } from './simulation-types.ts'
import { COUNTER_NC } from './synth-timing.ts'
import { automationIssue } from './automations.ts'

/** These match the compiler's fixed device models; this is measurement, not a solver. */
export function operatingPointDescriptors(document: CircuitDocument, nodeByTerminal: Record<string, string>, automatedTransient = false, durationSeconds = 10): OperatingPointPartDescriptor[] {
  return document.parts.map((part) => {
    const nodes = part.pins.map((pin) => nodeByTerminal[pin])
    const custom = compileCustomModel(document, part, nodes)
    if (custom) return custom.descriptor
    const [a, b, c] = nodes
    const branches: OperatingPointBranch[] = []
    const automated = automatedTransient && document.automations?.some(row => row.enabled && row.action.partId === part.id && !automationIssue(row, document, durationSeconds))
    if (automated && part.kind === 'switch') {
      branches.push({ kind: 'saved-current', label: '1 → 2', fromNode: a, toNode: b, vector: `i(@ba_${spiceDeviceId(part).toLowerCase()}[i])` })
    } else if (automated && part.kind === 'potentiometer') {
      const safeId = spiceDeviceId(part).toLowerCase()
      branches.push({ kind: 'saved-current', label: 'CCW → Wiper', fromNode: a, toNode: b, vector: `i(@ba_${safeId}_ccw[i])` })
      branches.push({ kind: 'saved-current', label: 'Wiper → CW', fromNode: b, toNode: c, vector: `i(@ba_${safeId}_cw[i])` })
    } else if (part.kind === 'resistor' || part.kind === 'switch') {
      branches.push({ kind: 'resistance', label: '1 → 2', fromNode: a, toNode: b, resistance: part.kind === 'resistor' ? part.value : part.value === 1 ? 1 : 1e9 })
    } else if (part.kind === 'potentiometer') {
      const position = part.position ?? 0.5
      branches.push({ kind: 'resistance', label: 'CCW → Wiper', fromNode: a, toNode: b, resistance: Math.max(1, position * part.value) })
      branches.push({ kind: 'resistance', label: 'Wiper → CW', fromNode: b, toNode: c, resistance: Math.max(1, (1 - position) * part.value) })
    } else if (part.kind === 'capacitor' || part.kind === 'electrolytic') {
      branches.push({ kind: 'ideal-capacitor', label: part.kind === 'electrolytic' ? '+ → − (ideal DC)' : '1 → 2 (ideal DC)', fromNode: a, toNode: b, vector: `i(@c_${spiceDeviceId(part).toLowerCase()}[i])` })
    } else if (part.kind === 'diode' || part.kind === 'led' || part.kind === 'schottky' || part.kind === 'zener') {
      const safeId = spiceDeviceId(part)
      branches.push({ kind: 'saved-current', label: 'Anode → Cathode', fromNode: a, toNode: b, vector: `i(@d_${safeId.toLowerCase()}[id])` })
    } else if (part.kind === 'inductor') {
      branches.push({ kind: 'saved-current', label: '1 → 2', fromNode: a, toNode: b, vector: `i(@l_${spiceDeviceId(part).toLowerCase()}[i])` })
    } else if (part.kind === 'njfet' || part.kind === 'nmos' || part.kind === 'pmos') {
      const id = spiceDeviceId(part).toLowerCase()
      branches.push({ kind: 'saved-current', label: 'Drain → Source', fromNode: a, toNode: c, vector: `i(vfd_${id})` })
      branches.push({ kind: 'saved-current', label: 'Gate → Source', fromNode: b, toNode: c, vector: `i(vfg_${id})` })
    } else if (part.kind === 'lm4040') {
      branches.push({ kind: 'saved-current', label: 'Cathode → Anode', fromNode: b, toNode: c, vector: `i(vref_${spiceDeviceId(part).toLowerCase()})` })
    } else if (part.kind === 'pc817') {
      const id = spiceDeviceId(part).toLowerCase()
      branches.push({ kind: 'saved-current', label: 'LED A → K', fromNode: a, toNode: b, vector: `i(vled_${id})` })
      branches.push({ kind: 'saved-current', label: 'Collector → Emitter', fromNode: nodes[3], toNode: nodes[2], vector: `i(vcol_${id})` })
    } else if (part.kind === 'vactrol') {
      const id = spiceDeviceId(part).toLowerCase()
      branches.push({ kind: 'saved-current', label: 'LED A → K', fromNode: a, toNode: b, vector: `i(vled_${id})` })
      branches.push({ kind: 'saved-current', label: 'LDR 1 → 2', fromNode: nodes[3], toNode: nodes[2], vector: `i(@bldr_${id}[i])` })
    } else if (part.kind === 'npn' || part.kind === 'pnp') {
      const safeId = spiceDeviceId(part).toLowerCase()
      // Referencing both terminal currents to E gives Vce*Ic + Vbe*Ib.
      // Signed PNP currents and voltages therefore yield positive dissipation.
      branches.push({ kind: 'saved-current', label: 'Collector → Emitter', fromNode: a, toNode: c, vector: `i(@q_${safeId}[ic])` })
      branches.push({ kind: 'saved-current', label: 'Base → Emitter', fromNode: b, toNode: c, vector: `i(@q_${safeId}[ib])` })
    }
    // Behavioral IC terminal currents are not exposed as measured chip power.
    // Op-amps omit supply consumption; 555 supply loading is only approximate.
    // Unconnected package pins have no electrical voltage to measure.
    const measuredNodes = nodes.filter((_, index) => !(part.kind === 'cd4024' && (COUNTER_NC as readonly number[]).includes(index) || part.kind === 'lm4040' && index === 0))
    return { partId: part.id, nodes: measuredNodes, branches }
  })
}
