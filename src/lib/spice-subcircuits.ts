import { parseSpiceModels, parseSpiceNumber, spiceModelText, validateSpiceModel, SPICE_IMPORT_BYTES, type SpiceModel } from './spice-models.ts'

export interface SubcircuitElement {
  name: string
  kind: 'R' | 'C' | 'L' | 'V' | 'I' | 'E' | 'G' | 'F' | 'H' | 'D' | 'Q'
  nodes: string[]
  value?: number
  model?: string
  control?: string
}
export interface SpiceSubcircuit {
  device: 'SUBCKT'
  entryPoint: string
  terminals: string[]
  ground: boolean
  elements: SubcircuitElement[]
  models: SpiceModel[]
}
export type ImportedSpice = SpiceModel | SpiceSubcircuit
export const SUBCIRCUIT_LIMITS = { terminals: 16, devices: 256, nodes: 128, depth: 8 } as const
const identifier = /^[a-zA-Z0-9_][a-zA-Z0-9_.+-]{0,79}$/
const key = (name: string) => name.toLowerCase()
function token(value: unknown): string {
  if (typeof value !== 'string' || !identifier.test(value)) throw new Error(`Invalid SPICE identifier: ${String(value).slice(0, 80)}.`)
  return value
}
function element(fields: string[]): SubcircuitElement {
  const name = token(fields[0]), kind = name[0].toUpperCase() as SubcircuitElement['kind']
  let count: number, value: number | undefined, model: string | undefined, control: string | undefined
  if ('RCLVI'.includes(kind)) {
    if ((kind === 'V' || kind === 'I') && fields[3]?.toUpperCase() === 'DC') fields = [...fields.slice(0, 3), ...fields.slice(4)]
    count = 2; value = parseSpiceNumber(fields[3] ?? '')
    if ('RCL'.includes(kind) && value <= 0) throw new Error(`${name}: R, C and L values must be positive.`)
  } else if (kind === 'E' || kind === 'G') { count = 4; value = parseSpiceNumber(fields[5] ?? '') }
  else if (kind === 'F' || kind === 'H') { count = 2; control = token(fields[3]); value = parseSpiceNumber(fields[4] ?? '') }
  else if (kind === 'D') { count = 2; model = token(fields[3]) }
  else if (kind === 'Q') {
    if (fields.length === 5) fields = [...fields.slice(0, 4), '0', fields[4]]
    count = 4; model = token(fields[5])
  } else throw new Error(`${name}: supported subcircuit elements are R, C, L, D, Q, DC V/I, linear E/G/F/H and X calls. Behavioral expressions and other devices are unsupported.`)
  if (fields.length !== count + (control ? 3 : 2)) throw new Error(`${name}: unsupported device options or terminal count.`)
  return { name, kind, nodes: fields.slice(1, count + 1).map(token), ...(value === undefined ? {} : { value }), ...(model ? { model } : {}), ...(control ? { control } : {}) }
}
function elementText(e: SubcircuitElement): string {
  return [e.name, ...e.nodes, ...(e.control ? [e.control] : []), e.model ?? String(e.value)].join(' ')
}
export function subcircuitText(model: SpiceSubcircuit): string {
  return [`.SUBCKT ${model.entryPoint} ${model.terminals.join(' ')}`, ...model.models.map(m => spiceModelText(m)), ...model.elements.map(elementText), `.ENDS ${model.entryPoint}`].join('\n')
}
export const importedSpiceText = (model: ImportedSpice) => model.device === 'SUBCKT' ? subcircuitText(model) : spiceModelText(model)
export const subcircuitTerminals = (model: SpiceSubcircuit) => [...model.terminals, ...(model.ground ? ['0 (reference)'] : [])]
export const subcircuitPackagePins = (model: SpiceSubcircuit) => Math.max(2, Math.ceil(subcircuitTerminals(model).length / 2) * 2)

/** Parse a self-contained library, flattening X calls with local node/model scope. */
export function parseSpiceLibrary(source: string): ImportedSpice[] {
  if (!/^\s*\.subckt\b/im.test(source)) return parseSpiceModels(source)
  if (new TextEncoder().encode(source).length > SPICE_IMPORT_BYTES) throw new Error('SPICE files must be at most 64 kB.')
  const statements: string[] = []
  for (const raw of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('*')) continue
    const text = line.split(/[;$]/, 1)[0].trim()
    if (!text) continue
    if (text.startsWith('+')) {
      if (!statements.length) throw new Error('Continuation without a preceding statement.')
      statements[statements.length - 1] += ` ${text.slice(1)}`
    } else statements.push(text)
  }
  interface Definition { name: string; terminals: string[]; lines: string[][]; models: SpiceModel[] }
  const definitions = new Map<string, Definition>(), globalModels: SpiceModel[] = []
  let active: Definition | undefined
  for (const statement of statements) {
    const fields = statement.split(/\s+/), command = fields[0].toLowerCase()
    if (command === '.subckt') {
      if (active) throw new Error('Nested .SUBCKT declarations are unsupported. Put definitions alongside each other and use X calls.')
      const name = token(fields[1]), terminals = fields.slice(2).map(token)
      if (terminals.length < 2 || terminals.length > 16 || terminals.includes('0') || new Set(terminals.map(key)).size !== terminals.length) throw new Error(`${name}: declare 2–16 unique terminals other than global node 0.`)
      if (definitions.has(key(name)) || definitions.size >= 32) throw new Error('Use at most 32 uniquely named subcircuits.')
      active = { name, terminals, lines: [], models: [] }; definitions.set(key(name), active)
    } else if (command === '.ends') {
      if (!active || fields.length > 2 || fields[1] && key(fields[1]) !== key(active.name)) throw new Error('Unmatched .ENDS declaration.')
      active = undefined
    } else if (command === '.model') {
      const model = parseSpiceModels(statement)[0], models = active?.models ?? globalModels
      if (models.some(m => key(m.entryPoint) === key(model.entryPoint)) || models.length >= 32) throw new Error('Use at most 32 uniquely named device models per scope.')
      models.push(model)
    } else {
      if (!active || command.startsWith('.')) throw new Error(`Unsupported subcircuit directive: ${fields[0]}. Includes, control commands and analyses cannot be imported.`)
      active.lines.push(fields)
      if (active.lines.length > SUBCIRCUIT_LIMITS.devices) throw new Error('Subcircuit device limit exceeded (256).')
    }
  }
  if (active) throw new Error(`Missing .ENDS for ${active.name}.`)
  if (globalModels.some(m => definitions.has(key(m.entryPoint)))) throw new Error('Model and subcircuit entry-point names must be distinct.')
  const results: SpiceSubcircuit[] = []
  for (const root of definitions.values()) {
    const elements: SubcircuitElement[] = [], models: SpiceModel[] = []
    let nodeCount = 0, instanceCount = 0
    function expand(definition: Definition, bindings: string[], stack: Set<string>) {
      if (stack.has(key(definition.name)) || stack.size >= SUBCIRCUIT_LIMITS.depth) throw new Error('Recursive subcircuits or call depth above 8 are unsupported.')
      if (++instanceCount > 256) throw new Error('Subcircuit expansion exceeds 256 instances.')
      const nodes = new Map(definition.terminals.map((terminal, index) => [key(terminal), bindings[index]]))
      nodes.set('0', '0')
      const node = (name: string) => {
        token(name)
        if (!nodes.has(key(name))) {
          if (++nodeCount > SUBCIRCUIT_LIMITS.nodes) throw new Error('Subcircuit expansion exceeds 128 internal nodes.')
          let generated = `internal_${nodeCount}`
          while (root.terminals.some(t => key(t) === key(generated))) generated += '_'
          nodes.set(key(name), generated)
        }
        return nodes.get(key(name))!
      }
      const modelScope = new Map([...globalModels, ...definition.models].map(m => [key(m.entryPoint), m]))
      const modelNames = new Map<string, string>()
      const deviceNames = new Map<string, string>()
      for (const fields of definition.lines) {
        const name = token(fields[0])
        if (deviceNames.has(key(name))) throw new Error(`${definition.name}: duplicate device ${name}.`)
        deviceNames.set(key(name), `${name[0].toUpperCase()}I${instanceCount}_${deviceNames.size}`)
      }
      for (const fields of definition.lines) {
        if (/^x/i.test(fields[0])) {
          const child = definitions.get(key(fields.at(-1)!))
          if (!child || fields.length !== child.terminals.length + 2) throw new Error(`${fields[0]}: missing subcircuit dependency or incorrect terminal count.`)
          expand(child, fields.slice(1, -1).map(node), new Set([...stack, key(definition.name)]))
          continue
        }
        const e = element(fields)
        e.name = deviceNames.get(key(e.name))!; e.nodes = e.nodes.map(node)
        if (e.control) {
          const control = deviceNames.get(key(e.control))
          if (!control || !control.startsWith('V')) throw new Error(`${e.name}: controlling voltage source is missing from this scope.`)
          e.control = control
        }
        if (e.model) {
          const model = modelScope.get(key(e.model))
          if (!model || (e.kind === 'D' ? model.device !== 'D' : model.device === 'D')) throw new Error(`${e.name}: missing or incompatible .MODEL ${e.model}.`)
          if (!modelNames.has(key(e.model))) {
            const name = `MODEL_${models.length}`; modelNames.set(key(e.model), name)
            if (models.length >= 32) throw new Error('Expanded subcircuits support at most 32 device models.')
            models.push({ ...model, entryPoint: name })
          }
          e.model = modelNames.get(key(e.model))!
        }
        elements.push(e)
        if (elements.length > SUBCIRCUIT_LIMITS.devices) throw new Error('Subcircuit expansion exceeds 256 devices.')
      }
    }
    expand(root, root.terminals, new Set())
    if (!elements.length) throw new Error(`${root.name}: a subcircuit must contain devices.`)
    const ground = elements.some(e => e.nodes.includes('0'))
    if (root.terminals.length + Number(ground) > 16) throw new Error(`${root.name}: terminals plus the explicit ground reference must fit 16 pins.`)
    results.push({ device: 'SUBCKT', entryPoint: root.name, terminals: root.terminals, ground, elements, models })
  }
  return [...results, ...globalModels]
}

/** Shared ingress for saved JSON; never trust parser-only validation. */
export function validateSubcircuit(input: unknown): SpiceSubcircuit {
  if (!input || typeof input !== 'object') throw new Error('Invalid subcircuit definition.')
  const model = input as SpiceSubcircuit
  token(model.entryPoint)
  if (model.device !== 'SUBCKT' || !Array.isArray(model.terminals) || !Array.isArray(model.models) || !Array.isArray(model.elements) || model.elements.length > 256 || model.models.length > 32 || typeof model.ground !== 'boolean') throw new Error('Invalid or oversized subcircuit definition.')
  model.terminals.forEach(token)
  const models = model.models.map(validateSpiceModel)
  const elements = model.elements.map(raw => {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.nodes)) throw new Error('Invalid subcircuit element.')
    token(raw.name); raw.nodes.forEach(token)
    if (raw.model !== undefined) token(raw.model)
    if (raw.control !== undefined) token(raw.control)
    if (raw.value !== undefined && (typeof raw.value !== 'number' || !Number.isFinite(raw.value))) throw new Error('Invalid numeric device value.')
    const checked = element(elementText(raw).split(/\s+/))
    if (raw.kind !== checked.kind) throw new Error('Device name and kind must agree.')
    return checked
  })
  const parsed = parseSpiceLibrary(subcircuitText({ ...model, models, elements })).find(m => m.device === 'SUBCKT') as SpiceSubcircuit
  if (parsed.ground !== model.ground) throw new Error('Subcircuit ground reference does not match its devices.')
  return parsed
}

/** Renaming all internal identifiers isolates instances and compiler-owned nodes. */
export function expandSubcircuit(model: SpiceSubcircuit, bindings: string[], prefix: string) {
  const mapped = new Map(model.terminals.map((terminal, index) => [key(terminal), bindings[index]]))
  if (model.ground) mapped.set('0', bindings[model.terminals.length])
  let counter = 0
  const node = (name: string) => {
    if (!mapped.has(key(name))) mapped.set(key(name), `sub_${prefix}_${counter++}`)
    return mapped.get(key(name))!
  }
  const modelName = (name: string) => `SUBMODEL_${prefix}_${model.models.findIndex(m => key(m.entryPoint) === key(name))}`
  const deviceNames = new Map(model.elements.map((e, index) => [key(e.name), `${e.kind}SUB_${prefix}_${index}`]))
  const elements = model.elements.map(e => ({ ...e, name: deviceNames.get(key(e.name))!, nodes: e.nodes.map(node), ...(e.model ? { model: modelName(e.model) } : {}), ...(e.control ? { control: deviceNames.get(key(e.control))! } : {}) }))
  return { elements, internalNodes: counter, lines: [...model.models.map(m => spiceModelText(m, modelName(m.entryPoint))), ...elements.map(elementText)] }
}
