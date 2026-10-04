import { PARTS, formatValue, resolveTopology, terminalById, type CircuitDocument, type ComponentKind, type Part } from './circuit.ts'
import { PICO_PINS } from './pico/profile.ts'

export interface SchematicPoint { x: number; y: number }
export interface SchematicPin extends SchematicPoint {
  number: number
  name: string
  terminal: string
  node: string
  side: 'left' | 'right' | 'top' | 'bottom'
  connected: boolean
}
export interface SchematicSymbol extends SchematicPoint {
  id: string
  kind: ComponentKind | 'pico'
  label: string
  value: string
  width: number
  height: number
  rotation: number
  pins: SchematicPin[]
  part?: Part
}
export interface SchematicNet {
  id: string
  label: string
  terminals: string[]
  sources: string[]
  probes: string[]
  pins: { symbolId: string; number: number }[]
}
export interface SchematicWire { node: string; points: SchematicPoint[] }
export interface SchematicLabel extends SchematicPoint {
  node: string
  anchor: 'start' | 'middle' | 'end'
  ground?: boolean
}
export interface SchematicGroup extends SchematicPoint { name: string; width: number; height: number }
export interface SchematicLayout {
  width: number
  height: number
  mode: 'wired' | 'labeled'
  symbols: SchematicSymbol[]
  nets: SchematicNet[]
  wires: SchematicWire[]
  labels: SchematicLabel[]
  junctions: (SchematicPoint & { node: string })[]
  groups: SchematicGroup[]
  warnings: string[]
}

const sources = [
  ['gnd', 'GND'], ['osc', 'SIGNAL'], ['eg', 'EG'], ['cv', 'CV'],
  ['vplus', '+12V'], ['vminus', '−12V'], ['pico:36', '+3V3'], ['pico:3', 'PICO GND'],
] as const
const naturalOrder = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })
const isTransistor = (kind: SchematicSymbol['kind']) => ['npn', 'pnp', 'nmos', 'pmos', 'njfet'].includes(kind)

function partLabel(part: Part, document: CircuitDocument): string {
  const custom = document.customComponents?.find(model => model.id === part.customModelId)
  if (custom) return custom.name
  return ({ opamp: 'TL072', quadopamp: 'TL074', timer555: 'NE555', lm13700: 'LM13700', ssd1306: 'SSD1306' } as Partial<Record<ComponentKind, string>>)[part.kind]
    ?? (PARTS[part.kind].package ? part.kind.toUpperCase() : PARTS[part.kind].label)
}

function createSymbol(part: Part, document: CircuitDocument, nodes: Record<string, string>): SchematicSymbol {
  const names = PARTS[part.kind].pinNames
  const simple = names.length === 2 || isTransistor(part.kind) || part.kind === 'potentiometer'
  const height = simple ? 80 : Math.ceil(names.length / 2) * 40 + 30
  return {
    id: part.id, kind: part.kind, label: partLabel(part, document), value: formatValue(part.value, part.kind),
    x: 0, y: 0, width: simple ? 120 : 200, height, rotation: 0, part,
    pins: names.map((name, index) => ({
      number: index + 1, name, terminal: part.pins[index] ?? '',
      node: nodes[part.pins[index]] ?? `unconnected:${part.id}:${index + 1}`,
      x: 0, y: 0, side: 'left', connected: false,
    })),
  }
}

/** Place symbols by their logical pins; breadboard coordinates never enter this layout. */
function placeSymbol(symbol: SchematicSymbol, x: number, y: number) {
  symbol.x = x
  symbol.y = y
  if (symbol.pins.length === 2 && symbol.kind !== 'pico') {
    for (const [index, pin] of symbol.pins.entries()) Object.assign(pin, { x: x + (index === 0 ? -60 : 60), y, side: index === 0 ? 'left' : 'right' })
    return
  }
  if (isTransistor(symbol.kind)) {
    const positions = [{ x: x + 80, y: y - 35, side: 'right' }, { x: x - 80, y, side: 'left' }, { x: x + 80, y: y + 35, side: 'right' }]
    symbol.pins.forEach((pin, index) => Object.assign(pin, positions[index]))
    return
  }
  if (symbol.kind === 'potentiometer') {
    const positions = [{ x: x - 60, y, side: 'left' }, { x, y: y + 60, side: 'bottom' }, { x: x + 60, y, side: 'right' }]
    symbol.pins.forEach((pin, index) => Object.assign(pin, positions[index]))
    return
  }
  const split = Math.ceil(symbol.pins.length / 2)
  const left = symbol.pins.filter((pin, index) => symbol.kind === 'pico' ? pin.number <= 20 : index < split)
  const right = symbol.pins.filter(pin => !left.includes(pin)).reverse()
  for (const [pins, side] of [[left, 'left'], [right, 'right']] as const) {
    pins.forEach((pin, index) => Object.assign(pin, { x: x + (side === 'left' ? -130 : 130), y: y - symbol.height / 2 + 35 + index * 40, side }))
  }
}

/** A chain of signal nets with parallel branches and grounded shunts can be wired without crossings. */
function layoutSmallCircuit(layout: SchematicLayout): boolean {
  if (!layout.symbols.length || layout.symbols.length > 8 || layout.symbols.some(symbol => symbol.kind === 'pico' || symbol.pins.length !== 2)) return false
  const groupNames = new Set(layout.symbols.map(symbol => symbol.part?.schemaGroup ?? ''))
  if (groupNames.size > 1) return false
  if (layout.symbols.some(symbol => symbol.pins[0].node === symbol.pins[1].node || symbol.pins.some(pin => pin.node.startsWith('unconnected:')))) return false
  const signalNodes = [...new Set(layout.symbols.flatMap(symbol => symbol.pins.map(pin => pin.node)).filter(node => node !== '0'))]
  const neighbors = new Map(signalNodes.map(node => [node, new Set<string>()]))
  for (const symbol of layout.symbols) {
    const [a, b] = symbol.pins.map(pin => pin.node)
    if (a !== '0' && b !== '0') { neighbors.get(a)!.add(b); neighbors.get(b)!.add(a) }
  }
  if ([...neighbors.values()].some(adjacent => adjacent.size > 2)) return false
  const endpoints = signalNodes.filter(node => neighbors.get(node)!.size < 2)
  if (!endpoints.length) return false
  endpoints.sort((a, b) => {
    const sourceRank = (node: string) => layout.nets.find(net => net.id === node)?.sources.length ? 0 : 1
    return sourceRank(a) - sourceRank(b) || naturalOrder(a, b)
  })
  const ordered = [endpoints[0]]
  while (ordered.length < signalNodes.length) {
    const next = [...neighbors.get(ordered.at(-1)!)!].find(node => !ordered.includes(node))
    if (!next) return false
    ordered.push(next)
  }
  const shunts = new Map(ordered.map(node => [node, layout.symbols.filter(symbol => symbol.pins.some(pin => pin.node === '0') && symbol.pins.some(pin => pin.node === node))]))
  if ([...shunts.values()].some(parts => parts.length > 3)) return false
  const branches = ordered.slice(0, -1).map((node, index) => layout.symbols.filter(symbol => symbol.pins.every(pin => pin.node === node || pin.node === ordered[index + 1])))
  const maxParallel = Math.max(1, ...branches.map(parts => parts.length))
  const top = 190, lastRow = top + (maxParallel - 1) * 140, shuntTop = lastRow + 50
  const left = 180, pitch = 330
  layout.width = Math.max(900, left * 2 + (ordered.length - 1) * pitch)
  layout.height = Math.max(580, lastRow + ([...shunts.values()].some(parts => parts.length) ? 370 : 230))
  const nodeX = new Map(ordered.map((node, index) => [node, (layout.width - (ordered.length - 1) * pitch) / 2 + index * pitch]))
  const taps = new Map(ordered.map(node => [node, [] as SchematicPoint[]]))
  const wire = (node: string, points: SchematicPoint[]) => layout.wires.push({ node, points })
  branches.forEach((parts, index) => {
    const leftNode = ordered[index], rightNode = ordered[index + 1]
    parts.forEach((symbol, row) => {
      placeSymbol(symbol, (nodeX.get(leftNode)! + nodeX.get(rightNode)!) / 2, top + row * 140)
      const reverse = symbol.pins[0].node !== leftNode
      if (reverse) {
        symbol.rotation = 180
        symbol.pins.forEach(pin => { pin.x = 2 * symbol.x - pin.x; pin.side = pin.side === 'left' ? 'right' : 'left' })
      }
      symbol.pins.forEach(pin => {
        const tap = { x: nodeX.get(pin.node)!, y: pin.y }
        wire(pin.node, [tap, { x: pin.x, y: pin.y }])
        taps.get(pin.node)!.push(tap)
      })
    })
  })
  for (const [node, parts] of shunts) {
    parts.forEach((symbol, index) => {
      const x = nodeX.get(node)! + (index - (parts.length - 1) / 2) * 130
      const y = shuntTop + 100
      symbol.x = x; symbol.y = y
      symbol.rotation = symbol.pins[0].node === node ? 90 : -90
      for (const pin of symbol.pins) Object.assign(pin, { x, y: y + (pin.node === node ? -60 : 60), side: pin.node === node ? 'top' : 'bottom' })
      const tap = { x: nodeX.get(node)!, y: shuntTop }
      wire(node, [tap, { x, y: shuntTop }, { x, y: y - 60 }])
      taps.get(node)!.push(tap)
      wire('0', [{ x, y: y + 60 }, { x, y: y + 80 }])
      layout.labels.push({ node: '0', x, y: y + 96, anchor: 'middle', ground: true })
    })
  }
  for (const node of ordered) {
    const points = taps.get(node)!
    const x = nodeX.get(node)!, minY = top, maxY = Math.max(top, ...points.map(point => point.y))
    wire(node, [{ x, y: minY - 29 }, { x, y: maxY }])
    layout.labels.push({ node, x, y: top - 35, anchor: 'middle' })
    if (points.length > 1) {
      const distinct = new Set<number>()
      points.forEach(point => { if (!distinct.has(point.y)) { layout.junctions.push({ ...point, node }); distinct.add(point.y) } })
    }
  }
  const groupName = [...groupNames][0]
  if (groupName) {
    layout.height = Math.max(layout.height, ...layout.labels.map(label => label.y + (label.ground ? 48 : 24) + 96))
    layout.groups.push({ name: groupName, x: 48, y: 125, width: layout.width - 96, height: layout.height - 221 })
  }
  layout.mode = 'wired'
  return true
}

function layoutLabeledCircuit(layout: SchematicLayout) {
  const sections = new Map<string, SchematicSymbol[]>()
  for (const symbol of layout.symbols) {
    const group = symbol.part?.schemaGroup ?? ''
    if (!sections.has(group)) sections.set(group, [])
    sections.get(group)!.push(symbol)
  }
  const sortedSections = [...sections.entries()].sort(([a], [b]) => a === '' ? 1 : b === '' ? -1 : naturalOrder(a, b))
  const maxColumns = Math.min(3, Math.max(1, ...[...sections.values()].map(symbols => symbols.length)))
  layout.width = Math.max(900, maxColumns * 430 + 136)
  let y = 120
  for (const [name, symbols] of sortedSections) {
    const top = y
    if (name) y += 28
    for (let row = 0; row < symbols.length; row += maxColumns) {
      const rowSymbols = symbols.slice(row, row + maxColumns)
      const height = Math.max(220, ...rowSymbols.map(symbol => symbol.height + 145))
      rowSymbols.forEach((symbol, column) => {
        placeSymbol(symbol, 68 + column * 430 + 215, y + 66 + symbol.height / 2)
        for (const pin of symbol.pins) {
          if (!pin.connected && !pin.node.startsWith('unconnected:')) continue
          layout.labels.push({ node: pin.node, x: pin.x + (pin.side === 'left' ? -8 : pin.side === 'right' ? 8 : 0), y: pin.y - (pin.side === 'bottom' ? -20 : 5), anchor: pin.side === 'left' ? 'end' : pin.side === 'right' ? 'start' : 'middle' })
        }
      })
      y += height
    }
    if (name) layout.groups.push({ name, x: 48, y: top, width: Math.min(maxColumns, symbols.length) * 430 + 40, height: y - top + 10 })
    y += 35
  }
  layout.height = Math.max(560, y + 125)
}

/** The diagram and simulation share this topology, including implicit breadboard strips. */
export function buildSchematic(document: CircuitDocument): SchematicLayout {
  const warnings: string[] = []
  const validTerminal = (terminal: string) => !!terminalById[terminal] && (!!document.pico || !terminal.startsWith('pico:'))
  const validWires = document.wires.filter(wire => {
    const valid = validTerminal(wire.from) && validTerminal(wire.to)
    if (!valid) warnings.push(`${wire.id}: a wire endpoint is unavailable.`)
    return valid
  })
  const { nodeByTerminal, nets: terminalNets } = resolveTopology({ ...document, wires: validWires })
  const symbols = document.parts.filter(part => {
    if (Object.hasOwn(PARTS, part.kind)) return true
    warnings.push(`${part.id}: unsupported component.`)
    return false
  }).toSorted((a, b) => naturalOrder(a.id, b.id)).map(part => createSymbol(part, document, nodeByTerminal))
  for (const symbol of symbols) for (const pin of symbol.pins) if (pin.node.startsWith('unconnected:')) warnings.push(`${symbol.id} pin ${pin.number}: terminal unavailable.`)
  const explicitTerminals = new Set(validWires.flatMap(wire => [wire.from, wire.to]).concat(Object.values(document.probes).filter((terminal): terminal is string => terminal !== null)))
  if (document.pico) {
    const pins = PICO_PINS.filter(pin => explicitTerminals.has(pin.id) && pin.supported).map(pin => ({ number: pin.number, name: pin.label, terminal: pin.id, node: nodeByTerminal[pin.id], x: 0, y: 0, side: 'left' as const, connected: true }))
    const rows = Math.max(pins.filter(pin => pin.number <= 20).length, pins.filter(pin => pin.number > 20).length)
    symbols.push({ id: 'Pico', kind: 'pico', label: 'Raspberry Pi Pico', value: 'Connected pins · RP2040', width: 200, height: Math.max(110, rows * 40 + 30), x: 0, y: 0, rotation: 0, pins })
  }
  const activeNodes = new Set(symbols.flatMap(symbol => symbol.pins.map(pin => pin.node)))
  for (const terminal of explicitTerminals) if (nodeByTerminal[terminal]) activeNodes.add(nodeByTerminal[terminal])
  const nets: SchematicNet[] = [...activeNodes].sort(naturalOrder).map(id => {
    const aliases = sources.filter(([terminal]) => (!terminal.startsWith('pico:') || document.pico) && nodeByTerminal[terminal] === id).map(([, label]) => label)
    const filteredAliases = aliases.includes('GND') ? aliases.filter(label => label !== 'PICO GND') : aliases
    return { id, label: filteredAliases.length ? filteredAliases.join(' / ') : id.startsWith('unconnected:') ? 'UNCONNECTED' : id.toUpperCase(), terminals: terminalNets[id] ?? [], sources: filteredAliases, probes: Object.entries(document.probes).filter(([, terminal]) => terminal && nodeByTerminal[terminal] === id).map(([channel]) => channel), pins: symbols.flatMap(symbol => symbol.pins.filter(pin => pin.node === id).map(pin => ({ symbolId: symbol.id, number: pin.number }))) }
  })
  for (const symbol of symbols) for (const pin of symbol.pins) {
    const net = nets.find(net => net.id === pin.node)!
    pin.connected = net.pins.length > 1 || net.sources.length > 0 || net.probes.length > 0 || net.terminals.some(terminal => explicitTerminals.has(terminal))
  }
  const layout: SchematicLayout = { width: 900, height: 560, mode: 'labeled', symbols, nets, wires: [], labels: [], junctions: [], groups: [], warnings }
  if (!layoutSmallCircuit(layout)) layoutLabeledCircuit(layout)
  const unrepresented = nets.filter(net => !layout.labels.some(label => label.node === net.id) && !net.pins.length)
  if (unrepresented.length) {
    const y = symbols.length ? layout.height - 75 : 205
    layout.labels.push(...unrepresented.map((net, index) => ({ node: net.id, x: 95, y: y + index * 55, anchor: 'start' as const })))
    layout.height = Math.max(layout.height, y + unrepresented.length * 55 + 100)
  }
  return layout
}
