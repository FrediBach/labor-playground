import { PARTS, boardGeometry, createEmptyDocument, getPlacement, validateDocument, type CircuitDocument, type ComponentKind } from './circuit.ts'
import { PROJECT_LIMITS } from './project-limits.ts'

export const KICAD_IMPORT_BYTES = 2_000_000
type SExpr = (string | SExpr)[]
const children = (node: SExpr, name: string): SExpr[] => node.filter((item): item is SExpr => Array.isArray(item) && item[0] === name)
const child = (node: SExpr, name: string): SExpr => children(node, name)[0] ?? []
const atom = (node: SExpr, index = 1): string => typeof node[index] === 'string' ? node[index] : ''
const field = (node: SExpr, name: string) => atom(child(node, name))
function parse(text: string): SExpr {
  if (new TextEncoder().encode(text).length > KICAD_IMPORT_BYTES) throw new Error('KiCad files must be smaller than 2 MB.')
  if (text.startsWith('EESchema')) throw new Error('Open this legacy .sch file in KiCad and save it as .kicad_sch with embedded symbols first.')
  const root: SExpr = [], stack = [root]
  const tokens: string[] = []
  const tokenizer = /\s+|"(?:\\.|[^"\\])*"|[()]|[^\s()"]+/gy
  let offset = 0
  while (offset < text.length) {
    tokenizer.lastIndex = offset
    const match = tokenizer.exec(text)
    if (!match) throw new Error('Malformed quoted string in KiCad file.')
    offset = tokenizer.lastIndex
    if (match[0].trim()) tokens.push(match[0])
  }
  if (tokens.length > 300_000) throw new Error('KiCad schematic is too complex.')
  for (const token of tokens) {
    if (token === '(') {
      const next: SExpr = []; stack.at(-1)!.push(next); stack.push(next)
      if (stack.length > 64) throw new Error('KiCad nesting limit exceeded.')
    } else if (token === ')') {
      if (stack.length === 1) throw new Error('Unexpected closing parenthesis in KiCad file.')
      stack.pop()
    } else stack.at(-1)!.push(token.startsWith('"') ? token.slice(1, -1).replace(/\\([\\"nrt])/g, (_, c: string) => ({ n: '\n', r: '\r', t: '\t' })[c] ?? c) : token)
  }
  if (stack.length !== 1 || root.length !== 1 || !Array.isArray(root[0]) || root[0][0] !== 'kicad_sch') throw new Error('Expected a complete .kicad_sch schematic.')
  return root[0]
}
type Point = { x: number; y: number }
export interface KicadPin { number: string; name: string; net: string }
export interface KicadComponent { reference: string; library: string; value: string; pins: KicadPin[]; suggested: ComponentKind | null }
export interface KicadImport { title: string; components: KicadComponent[]; nets: { id: string; labels: string[] }[] }
export interface KicadSelection { kind: ComponentKind | ''; value: string; pins: string[] }
export type KicadSources = Record<string, string>
const pointKey = (p: Point) => `${Math.round(p.x * 100000)},${Math.round(p.y * 100000)}`
function point(node: SExpr): Point {
  const x = Number(atom(node)), y = Number(atom(node, 2))
  if (!atom(node) || !atom(node, 2) || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 100000 || Math.abs(y) > 100000) throw new Error('Invalid KiCad coordinate.')
  return { x, y }
}
function suggest(library: string): ComponentKind | null {
  const aliases: Record<string, ComponentKind> = { 'Device:R': 'resistor', 'Device:R_Small': 'resistor', 'Device:C': 'capacitor', 'Device:C_Small': 'capacitor', 'Device:C_Polarized': 'electrolytic', 'Device:L': 'inductor', 'Device:D': 'diode', 'Device:D_Schottky': 'schottky', 'Device:D_Zener': 'zener', 'Device:LED': 'led', 'Device:R_Potentiometer': 'potentiometer', 'Switch:SW_SPST': 'switch', 'Switch:SW_SPDT': 'spdt', 'Switch:SW_DPDT_x2': 'dpdt', 'Amplifier_Operational:TL072': 'opamp', 'Amplifier_Operational:TL074': 'quadopamp', 'Timer:NE555': 'timer555', 'Amplifier_Operational:LM13700': 'lm13700' }
  const devices: Record<string, ComponentKind> = { 'Transistor_BJT:2N3904': 'npn', 'Transistor_BJT:2N3906': 'pnp', 'Transistor_BJT:BC547': 'npn', 'Transistor_BJT:BC557': 'pnp', 'Device:Q_NPN_BCE': 'npn', 'Device:Q_NPN_CBE': 'npn', 'Device:Q_PNP_BCE': 'pnp', 'Device:Q_PNP_CBE': 'pnp', 'Diode:1N4148': 'diode', 'Diode:1N5819': 'schottky', 'Amplifier_Operational:OPA197': 'opa197', 'Amplifier_Operational:OPA4197': 'opa4197', 'Comparator:LM393': 'lm393', 'Isolator:PC817': 'pc817' }
  return Object.hasOwn(aliases, library) ? aliases[library] : Object.hasOwn(devices, library) ? devices[library] : null
}

/** Read a self-contained single sheet. Unsupported electrical constructs fail before review. */
export function readKicadSchematic(text: string, filename = 'KiCad circuit'): KicadImport {
  const root = parse(text)
  for (const name of ['sheet', 'bus', 'bus_entry', 'bus_alias', 'hierarchical_label']) if (children(root, name).length) throw new Error(`KiCad ${name.replaceAll('_', ' ')} is not supported. Import a flat single-sheet schematic without buses.`)
  const libraries = new Map(children(child(root, 'lib_symbols'), 'symbol').map(node => [atom(node), node]))
  const points = new Map<string, Point>(), parent = new Map<string, string>()
  const add = (p: Point) => { const key = pointKey(p); points.set(key, p); if (!parent.has(key)) parent.set(key, key); return key }
  const find = (key: string): string => { let current = key; while (parent.get(current) !== current) current = parent.get(current)!; while (key !== current) { const next = parent.get(key)!; parent.set(key, current); key = next } return current }
  const join = (a: string, b: string) => { parent.set(find(a), find(b)) }
  const wires = children(root, 'wire').map(wire => {
    const ends = children(child(wire, 'pts'), 'xy').map(point)
    if (ends.length !== 2) throw new Error('A KiCad wire must have two endpoints.')
    const [a, b] = ends; join(add(a), add(b)); return { a, b }
  })
  if (wires.length > 4000) throw new Error('Too many KiCad wire segments.')
  for (const junction of children(root, 'junction')) add(point(child(junction, 'at')))
  const labels: { name: string; key: string }[] = []
  for (const tag of ['label', 'global_label']) for (const label of children(root, tag)) labels.push({ name: atom(label), key: add(point(child(label, 'at'))) })
  const components = new Map<string, KicadComponent>()
  const units = new Set<string>()
  for (const instance of children(root, 'symbol')) {
    const library = field(instance, 'lib_id'), definition = libraries.get(library)
    const property = (name: string) => atom(children(instance, 'property').find(p => atom(p) === name) ?? [], 2)
    const reference = property('Reference'), value = property('Value')
    if (!definition || child(definition, 'extends').length) throw new Error(`Missing embedded symbol definition for ${reference || library}.`)
    if (!reference || reference.includes('?')) throw new Error('Annotate all components in KiCad before importing.')
    const unit = Number(field(instance, 'unit') || 1), style = Number(field(instance, 'convert') || field(instance, 'body_style') || 1)
    const unitKey = `${reference}:${unit}`
    if (units.has(unitKey)) throw new Error(`Duplicate reference/unit ${unitKey}.`)
    units.add(unitKey)
    const origin = point(child(instance, 'at')), angle = Number(atom(child(instance, 'at'), 3) || 0)
    if (![0, 90, 180, 270].includes(angle)) throw new Error(`Unsupported rotation on ${reference}.`)
    const mirror = field(instance, 'mirror'), radians = angle * Math.PI / 180
    if (mirror && !['x', 'y'].includes(mirror)) throw new Error(`Unsupported mirror on ${reference}.`)
    if (child(instance, 'pin_map_override').length) throw new Error(`Pin map overrides are not supported on ${reference}.`)
    const pinNodes = [...children(definition, 'pin'), ...children(definition, 'symbol').flatMap(body => {
      const suffix = /_(\d+)_(\d+)$/.exec(atom(body))
      return suffix && (Number(suffix[1]) === 0 || Number(suffix[1]) === unit) && (Number(suffix[2]) === 0 || Number(suffix[2]) === style) ? children(body, 'pin') : []
    })]
    const pins = pinNodes.map(pin => {
      const local = point(child(pin, 'at'))
      // KiCad inverts library Y, rotates, then mirrors in sheet coordinates.
      const dx = local.x * Math.cos(radians) - local.y * Math.sin(radians)
      const dy = -local.x * Math.sin(radians) - local.y * Math.cos(radians)
      const net = add({ x: origin.x + dx * (mirror === 'y' ? -1 : 1), y: origin.y + dy * (mirror === 'x' ? -1 : 1) })
      if (pin.includes('hide') || field(pin, 'hide') === 'yes') {
        if (atom(pin) === 'power_in') labels.push({ name: field(pin, 'name'), key: net })
      }
      return { number: field(pin, 'number'), name: field(pin, 'name'), net }
    })
    if (!pins.length) throw new Error(`No embedded pins found for ${reference}.`)
    if (library.startsWith('power:')) {
      if (pins.length !== 1) throw new Error(`Unsupported power symbol ${library}.`)
      if (library !== 'power:PWR_FLAG') labels.push({ name: value, key: pins[0].net })
      continue
    }
    const existing = components.get(reference)
    if (existing && (existing.library !== library || existing.value !== value)) throw new Error(`Inconsistent units for ${reference}.`)
    if (existing) existing.pins.push(...pins)
    else components.set(reference, { reference, library, value, pins, suggested: suggest(library) })
  }
  if (!components.size || components.size > PROJECT_LIMITS.parts) throw new Error(`Import requires 1–${PROJECT_LIMITS.parts} components.`)
  if (points.size > 10000) throw new Error('Too many KiCad connection points.')
  // Only explicit endpoints, pins, labels and junctions split wires. Bare crossings do not connect.
  for (const [key, p] of points) for (const { a, b } of wires) {
    const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)
    if (Math.abs(cross) < 1e-7 && p.x >= Math.min(a.x, b.x) - 1e-7 && p.x <= Math.max(a.x, b.x) + 1e-7 && p.y >= Math.min(a.y, b.y) - 1e-7 && p.y <= Math.max(a.y, b.y) + 1e-7) join(key, pointKey(a))
  }
  const names = new Map<string, string>()
  for (const { name, key } of labels) { if (names.has(name)) join(key, names.get(name)!); else names.set(name, key) }
  // Repeated physical pin numbers across units denote one package terminal.
  for (const component of components.values()) {
    const numbers = new Map<string, string>()
    for (const pin of component.pins) {
      if (!pin.number) throw new Error(`Missing pin number on ${component.reference}.`)
      if (numbers.has(pin.number)) join(pin.net, numbers.get(pin.number)!)
      else numbers.set(pin.number, pin.net)
    }
  }
  const nets = new Map<string, { id: string; labels: string[] }>()
  for (const key of points.keys()) { const id = find(key); if (!nets.has(id)) nets.set(id, { id, labels: [] }) }
  for (const { name, key } of labels) { const net = nets.get(find(key))!; if (!net.labels.includes(name)) net.labels.push(name) }
  for (const component of components.values()) {
    component.pins.forEach(pin => { pin.net = find(pin.net) })
    const unique = new Map<string, KicadPin>()
    for (const pin of component.pins) unique.set(pin.number, pin)
    component.pins = [...unique.values()].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
  }
  return { title: (field(child(root, 'title_block'), 'title') || filename.replace(/\.kicad_sch$/i, '')).slice(0, 100), components: [...components.values()], nets: [...nets.values()] }
}

export function parseKicadValue(text: string): number | null {
  const value = text.trim().replace(/[µμ]/g, 'u').replace(/(?:ohms?|Ω|[FVH])$/i, '').trim()
  const factors: Record<string, number> = { R: 1, r: 1, k: 1e3, K: 1e3, M: 1e6, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12 }
  const embedded = /^(\d+)([RrkKMmunp])(\d+)$/.exec(value)
  const suffix = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([RrkKMmunp]?)$/.exec(value)
  const result = embedded ? Number(`${embedded[1]}.${embedded[3]}`) * factors[embedded[2]] : suffix ? Number(suffix[1]) * (factors[suffix[2]] ?? 1) : NaN
  return Number.isFinite(result) ? result : null
}
export function selectKicadComponent(component: KicadComponent, kind: ComponentKind | ''): KicadSelection {
  if (!kind) return { kind, value: '', pins: [] }
  const definition = PARTS[kind]
  const aliases: Record<string, string> = { Anode: 'A', Cathode: 'K', Collector: 'C', Base: 'B', Emitter: 'E', Drain: 'D', Gate: 'G', Source: 'S', '−': '-' }
  const pins = definition.pinNames.map((name, index) => {
    const byName = component.pins.filter(pin => pin.name === name || pin.name === aliases[name])
    return byName.length === 1 ? byName[0].number : component.pins.find(pin => pin.number === String(index + 1))?.number ?? ''
  })
  const variable = ['resistor', 'capacitor', 'electrolytic', 'inductor', 'potentiometer'].includes(kind)
  return { kind, value: variable ? String(parseKicadValue(component.value) ?? '') : String(definition.defaultValue), pins }
}

/** Allocate isolated physical strips, then visible jumpers. Never repair missing power implicitly. */
export function buildKicadDocument(source: KicadImport, selections: KicadSelection[], sources: KicadSources): CircuitDocument {
  const document = createEmptyDocument(); document.title = source.title; document.board = { columns: 60, rows: 3 }
  const geometry = boardGeometry(document), usedGroups = new Set<string>(), occupied = new Set<string>()
  const netGroups = new Map<string, string[]>()
  for (const [index, component] of source.components.entries()) {
    const selection = selections[index]
    if (!selection?.kind || !Object.hasOwn(PARTS, selection.kind)) throw new Error(`Choose a matching component for ${component.reference}.`)
    const definition = PARTS[selection.kind]
    const mappedPins = new Set(selection.pins.filter(Boolean))
    if (selection.pins.length !== definition.pinNames.length || mappedPins.size !== selection.pins.filter(Boolean).length || component.pins.some(pin => !mappedPins.has(pin.number))) throw new Error(`Map every KiCad pin exactly once for ${component.reference}.`)
    const value = Number(selection.value)
    if (!selection.value.trim() || !Number.isFinite(value) || value < definition.min || value > definition.max) throw new Error(`${component.reference}: enter a value between ${definition.min} and ${definition.max} ${definition.unit}.`)
    const pins = geometry.holes.map(hole => getPlacement(selection.kind as ComponentKind, hole.id, 0, document)).find(candidate => candidate && candidate.every(pin => !usedGroups.has(geometry.terminalById[pin].group)) && new Set(candidate.map(pin => geometry.terminalById[pin].group)).size === candidate.length)
    if (!pins) throw new Error('This schematic does not fit on the largest breadboard.')
    document.parts.push({ id: component.reference, kind: selection.kind, value, pins })
    pins.forEach((pin, pinIndex) => {
      const group = geometry.terminalById[pin].group; usedGroups.add(group); occupied.add(pin)
      const number = selection.pins[pinIndex], imported = component.pins.find(p => p.number === number)
      if (number && !imported) throw new Error(`Invalid pin mapping for ${component.reference}.`)
      if (imported) { const groups = netGroups.get(imported.net) ?? []; groups.push(group); netGroups.set(imported.net, groups) }
    })
  }
  const freeHole = (group: string) => {
    const hole = geometry.holes.find(h => h.group === group && !occupied.has(h.id))
    if (!hole) throw new Error('Not enough free holes for imported connections.')
    occupied.add(hole.id); return hole.id
  }
  const ids = new Set(document.parts.map(part => part.id))
  const wire = (from: string, to: string) => { let id = `KW${document.wires.length + 1}`; while (ids.has(id)) id += '_'; ids.add(id); document.wires.push({ id, from, to, color: '#73b7a1' }) }
  const supplied = new Set<string>()
  for (const net of source.nets) {
    const groups = netGroups.get(net.id) ?? []
    for (let index = 1; index < groups.length; index++) wire(freeHole(groups[index - 1]), freeHole(groups[index]))
    const terminal = sources[net.id]
    if (terminal) {
      if (!['gnd', 'vplus', 'vminus', 'cv', 'osc', 'eg'].includes(terminal)) throw new Error('Invalid source terminal.')
      if (supplied.has(terminal)) throw new Error('A workbench source cannot be assigned to separate KiCad nets.')
      supplied.add(terminal)
      if (groups.length) wire(terminal, freeHole(groups[0]))
    }
  }
  return validateDocument(document)
}
