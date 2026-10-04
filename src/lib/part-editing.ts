import { canPlace, boardGeometry, type CircuitDocument, type Part } from './circuit.ts'

export interface LeadEdit { partId: string; pinIndex: number }
export const MIN_LEAD_SPACING = 24
export const MAX_LEAD_SPACING = 192
const flexibleKinds = new Set(['resistor', 'capacitor', 'electrolytic', 'inductor', 'diode', 'schottky', 'zener', 'led', 'switch'])

export function hasEditableLeads(part: Part): boolean {
  return part.pins.length === 2 && flexibleKinds.has(part.kind)
}

/** Keep pin order and the fixed lead intact, including when previewing an invalid hole. */
export function previewLeadPins(part: Part, pinIndex: number, terminal: string, document: Pick<CircuitDocument, 'board'> = {}): string[] | null {
  const { terminalById } = boardGeometry(document)
  if (!hasEditableLeads(part) || !Number.isInteger(pinIndex) || pinIndex < 0 || pinIndex > 1 || !Object.hasOwn(terminalById, terminal)) return null
  return part.pins.map((pin, index) => index === pinIndex ? terminal : pin)
}

/** This is an edit constraint, deliberately separate from legacy import validation. */
export function leadPlacementError(document: CircuitDocument, part: Part, pinIndex: number, terminal: string): string | null {
  const { holes: boardHoles, terminalById } = boardGeometry(document)
  const holes = new Set(boardHoles.map(hole => hole.id))
  const pins = previewLeadPins(part, pinIndex, terminal, document)
  if (!pins) return 'This component does not support individual lead movement.'
  if (!pins.every(pin => holes.has(pin))) return 'Choose a breadboard hole; component leads cannot attach directly to instrument ports.'
  if (pins[0] === pins[1]) return 'The two leads need separate holes.'
  const first = terminalById[pins[0]], second = terminalById[pins[1]]
  const spacing = Math.hypot(first.x - second.x, first.y - second.y)
  if (spacing < MIN_LEAD_SPACING || spacing > MAX_LEAD_SPACING) return 'Keep the leads between 1 and 8 hole spacings apart.'
  if (!canPlace(document, pins, part.id)) return 'That hole is occupied. Choose a free hole on the connected strip.'
  return null
}
