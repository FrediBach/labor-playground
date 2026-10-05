import type { SchematicLayout, SchematicPin, SchematicPoint, SchematicSymbol, SchematicWire } from './schematic.ts'

interface Bounds { left: number; right: number; top: number; bottom: number }
interface Segment extends Bounds { node: string; a: SchematicPoint; b: SchematicPoint }
interface Endpoint { pin: SchematicPin; symbol: SchematicSymbol; exit: SchematicPoint }

const samePoint = (a: SchematicPoint, b: SchematicPoint) => a.x === b.x && a.y === b.y
const distance = (a: SchematicPoint, b: SchematicPoint) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
const intersects = (a: Bounds, b: Bounds) => a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom
const segment = (node: string, a: SchematicPoint, b: SchematicPoint): Segment => ({ node, a, b, left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) })
const segments = (wire: SchematicWire) => wire.points.slice(1).map((end, index) => segment(wire.node, wire.points[index], end))
const onSegment = (point: SchematicPoint, line: Segment) => point.x >= line.left && point.x <= line.right && point.y >= line.top && point.y <= line.bottom

/** Include references, pin labels and space for optional voltage readings in the routing keepout. */
function symbolBounds(symbol: SchematicSymbol, layout: SchematicLayout): Bounds {
  const bounds = {
    left: Math.min(symbol.x - symbol.width / 2, ...symbol.pins.map(pin => pin.x)) - 12,
    right: Math.max(symbol.x + symbol.width / 2, ...symbol.pins.map(pin => pin.x)) + 12,
    top: Math.min(symbol.y - 80, symbol.y - symbol.height / 2 - 50),
    bottom: Math.max(symbol.y + symbol.height / 2 + 38, ...symbol.pins.map(pin => pin.y + 38)),
  }
  for (const pin of symbol.pins) {
    const net = layout.nets.find(net => net.id === pin.node)!
    const text = net.label + (net.probes.length ? ` · ${net.probes.join(' / ')}` : '')
    const width = Math.max(85, text.length * 6.7) + 16
    if (pin.side === 'left') bounds.left = Math.min(bounds.left, pin.x - width)
    else if (pin.side === 'right') bounds.right = Math.max(bounds.right, pin.x + width)
    else {
      bounds.right = Math.max(bounds.right, pin.x + width + 12)
      bounds.bottom = Math.max(bounds.bottom, pin.y + 48)
    }
  }
  return bounds
}

function simplify(points: SchematicPoint[]): SchematicPoint[] {
  const result: SchematicPoint[] = []
  for (const point of points) {
    if (result.length && samePoint(result.at(-1)!, point)) continue
    while (result.length > 1) {
      const a = result.at(-2)!, b = result.at(-1)!
      if ((a.x === b.x && b.x === point.x || a.y === b.y && b.y === point.y) && distance(a, b) + distance(b, point) === distance(a, point)) result.pop()
      else break
    }
    result.push({ x: point.x, y: point.y })
  }
  return result
}

/** Dots only where three or more wire directions meet, including same-net crossings. */
function addJunctions(layout: SchematicLayout, wires: SchematicWire[]) {
  const lines = wires.flatMap(segments)
  const candidates = new Map<string, SchematicPoint & { node: string }>()
  const add = (point: SchematicPoint, node: string) => candidates.set(`${node}:${point.x}:${point.y}`, { ...point, node })
  for (const line of lines) { add(line.a, line.node); add(line.b, line.node) }
  for (const a of lines) for (const b of lines) {
    if (a.node !== b.node || !intersects(a, b)) continue
    if (a.left === a.right && b.top === b.bottom) add({ x: a.left, y: b.top }, a.node)
  }
  for (const point of candidates.values()) {
    const directions = new Set<string>()
    for (const line of lines) {
      if (line.node !== point.node || !onSegment(point, line)) continue
      if (line.left < point.x) directions.add('left')
      if (line.right > point.x) directions.add('right')
      if (line.top < point.y) directions.add('top')
      if (line.bottom > point.y) directions.add('bottom')
    }
    if (directions.size > 2) layout.junctions.push(point)
  }
}

/**
 * Route each connection independently on a bounded set of orthogonal channels.
 * Retained pin labels connect unroutable branches and other sections. Wires never
 * cross unrelated nets, including the pin stubs emitted by the KiCad exporter.
 */
export function routeSchematicSection(layout: SchematicLayout, symbols: SchematicSymbol[], area: Bounds) {
  if (symbols.length > 16 || symbols.reduce((count, symbol) => count + symbol.pins.length, 0) > 64) return
  const obstacles = new Map(symbols.map(symbol => [symbol, symbolBounds(symbol, layout)]))
  const endpoints: Endpoint[] = []
  const reserved: Segment[] = []
  for (const symbol of symbols) for (const pin of symbol.pins) {
    const bounds = obstacles.get(symbol)!
    const dx = pin.side === 'left' ? -1 : pin.side === 'right' ? 1 : 0
    const dy = pin.side === 'top' ? -1 : pin.side === 'bottom' ? 1 : 0
    reserved.push(segment(pin.node, pin, { x: pin.x + dx * 20, y: pin.y + dy * 20 }))
    if (!pin.connected || pin.node.startsWith('unconnected:')) continue
    endpoints.push({ pin, symbol, exit: {
      x: dx < 0 ? bounds.left - 16 : dx > 0 ? bounds.right + 16 : pin.x,
      y: dy < 0 ? bounds.top - 16 : dy > 0 ? bounds.bottom + 16 : pin.y,
    } })
  }
  const xChannels = [...new Set([area.left, area.right, ...endpoints.map(endpoint => endpoint.exit.x), ...[...obstacles.values()].flatMap(bounds => [bounds.left - 32, bounds.right + 32])])].filter(x => x >= area.left && x <= area.right)
  const yChannels = [...new Set([area.top, area.bottom, ...endpoints.map(endpoint => endpoint.exit.y), ...[...obstacles.values()].flatMap(bounds => [bounds.top - 16, bounds.bottom + 16])])].filter(y => y >= area.top && y <= area.bottom)
  const wires: SchematicWire[] = []
  const withinArea = (point: SchematicPoint) => point.x >= area.left && point.x <= area.right && point.y >= area.top && point.y <= area.bottom
  const clear = (line: Segment, owner?: SchematicSymbol) => {
    if (!withinArea(line.a) || !withinArea(line.b)) return false
    for (const [symbol, bounds] of obstacles) if (symbol !== owner && intersects(line, bounds)) return false
    // Leave a visible gap; touching an unrelated wire/pin can also short the SCH export.
    return reserved.every(other => other.node === line.node || !intersects(line, { left: other.left - 8, right: other.right + 8, top: other.top - 8, bottom: other.bottom + 8 }))
  }
  const route = (a: Endpoint, b: Endpoint): SchematicPoint[] | undefined => {
    const node = a.pin.node, start = a.exit, end = b.exit
    if (!clear(segment(node, a.pin, start), a.symbol) || !clear(segment(node, b.pin, end), b.symbol)) return
    const candidates = [
      [start, { x: end.x, y: start.y }, end],
      [start, { x: start.x, y: end.y }, end],
      ...xChannels.map(x => [start, { x, y: start.y }, { x, y: end.y }, end]),
      ...yChannels.map(y => [start, { x: start.x, y }, { x: end.x, y }, end]),
    ].map(simplify)
    const cost = (points: SchematicPoint[]) => points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0) + points.length * 20
    candidates.sort((a, b) => cost(a) - cost(b))
    const path = candidates.find(points => segments({ node, points }).every(line => clear(line)))
    return path && simplify([a.pin, ...path, b.pin])
  }
  // Short signal nets first; shared supply buses may keep labels when space runs out.
  const nets = layout.nets.filter(net => endpoints.filter(endpoint => endpoint.pin.node === net.id).length > 1)
    .toSorted((a, b) => Number(a.sources.some(source => /GND|^[+−]/.test(source))) - Number(b.sources.some(source => /GND|^[+−]/.test(source))) || a.pins.length - b.pins.length)
  for (const net of nets) {
    const pins = endpoints.filter(endpoint => endpoint.pin.node === net.id)
    const component = new Map(pins.map((pin, index) => [pin, index]))
    const pairs = pins.flatMap((a, index) => pins.slice(index + 1).map(b => ({ a, b, length: distance(a.exit, b.exit) }))).sort((a, b) => a.length - b.length)
    for (const { a, b } of pairs) {
      if (component.get(a) === component.get(b)) continue
      const points = route(a, b)
      if (!points) continue
      const wire = { node: net.id, points }
      wires.push(wire)
      reserved.push(...segments(wire))
      const previous = component.get(b), next = component.get(a)!
      for (const pin of pins) if (component.get(pin) === previous) component.set(pin, next)
    }
  }
  layout.wires.push(...wires)
  addJunctions(layout, wires)
}
