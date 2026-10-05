/** Data-only import: no source text, directives or expressions reach the solver. */
export interface SpiceModel {
  device: 'D' | 'NPN' | 'PNP'
  entryPoint: string
  parameters: Record<string, number>
}
export const SPICE_IMPORT_BYTES = 64_000
const common = 'IS TNOM EG XTI KF AF LEVEL'
const allowed = {
  D: new Set(`${common} N RS TT CJO VJ M FC BV IBV`.split(' ')),
  NPN: new Set(`${common} BF NF VAF IKF ISE NE BR NR VAR IKR ISC NC RB IRB RBM RE RC CJE VJE MJE TF XTF VTF ITF PTF CJC VJC MJC XCJC TR CJS VJS MJS XTB FC`.split(' ')),
  PNP: new Set(`${common} BF NF VAF IKF ISE NE BR NR VAR IKR ISC NC RB IRB RBM RE RC CJE VJE MJE TF XTF VTF ITF PTF CJC VJC MJC XCJC TR CJS VJS MJS XTB FC`.split(' ')),
}
const positive = new Set('IS N NF NR NE NC BF BR VJ VJE VJC VJS EG IBV'.split(' '))
const signed = new Set('TNOM XTI XTB PTF'.split(' '))
const fractions = new Set('M MJE MJC MJS XCJC FC'.split(' '))

export function validateSpiceModel(input: unknown): SpiceModel {
  if (!input || typeof input !== 'object') throw new Error('Invalid SPICE model.')
  const model = input as SpiceModel
  if (!Object.hasOwn(allowed, model.device)) throw new Error('Only D, NPN and PNP .MODEL definitions are supported.')
  if (typeof model.entryPoint !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,79}$/.test(model.entryPoint)) throw new Error('Use a model name of 1–80 letters, digits, dots, hyphens or underscores.')
  if (!model.parameters || typeof model.parameters !== 'object' || Array.isArray(model.parameters)) throw new Error('Invalid SPICE parameters.')
  const parameters: Record<string, number> = {}
  for (const [key, value] of Object.entries(model.parameters).sort(([a], [b]) => a.localeCompare(b))) {
    if (!allowed[model.device].has(key)) throw new Error(`Unsupported ${model.device} parameter: ${key}.`)
    if (!Number.isFinite(value) || Math.abs(value) > 1e15) throw new Error(`${key} must be a finite number with magnitude at most 1e15.`)
    if (!signed.has(key) && (positive.has(key) ? value <= 0 : value < 0)) throw new Error(`${key} must be ${positive.has(key) ? 'positive' : 'nonnegative'}.`)
    if (fractions.has(key) && (value > 1 || key === 'FC' && value === 1)) throw new Error(`${key} must be ${key === 'FC' ? 'less than' : 'at most'} 1.`)
    if (key === 'TNOM' && value <= -273.15) throw new Error('TNOM must exceed absolute zero in °C.')
    if (key === 'LEVEL' && value !== 1) throw new Error('Only LEVEL=1 models are supported.')
    parameters[key] = value
  }
  return { device: model.device, entryPoint: model.entryPoint, parameters }
}

const scales: Record<string, number> = { '': 1, T: 1e12, G: 1e9, MEG: 1e6, K: 1e3, MIL: 25.4e-6, M: 1e-3, U: 1e-6, N: 1e-9, P: 1e-12, F: 1e-15 }
export function parseSpiceNumber(value: string): number {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(meg|mil|[tgkmunpf])?$/i.exec(value)
  if (!match) throw new Error(`Expected a numeric value, received “${value}”. Expressions and parameters are not supported.`)
  const number = Number(match[1]) * scales[(match[2] ?? '').toUpperCase()]
  if (!Number.isFinite(number) || Math.abs(number) > 1e15) throw new Error('Device values must be finite with magnitude at most 1e15.')
  return number
}

export function parseSpiceModels(source: string): SpiceModel[] {
  if (new TextEncoder().encode(source).length > SPICE_IMPORT_BYTES) throw new Error('SPICE files must be at most 64 kB.')
  const statements: string[] = []
  for (const raw of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('*')) continue
    const text = line.split(/[;$]/, 1)[0].trim()
    if (!text) continue
    if (text.startsWith('+')) {
      if (!statements.length) throw new Error('A continuation must follow a .MODEL definition.')
      statements[statements.length - 1] += ` ${text.slice(1)}`
    } else statements.push(text)
    if (statements.length > 32) throw new Error('Import at most 32 .MODEL definitions at a time.')
  }
  if (!statements.length) throw new Error('Paste or choose a file containing .MODEL definitions.')
  const names = new Set<string>()
  return statements.map(statement => {
    const match = /^\.model\s+(\S+)\s+(D|NPN|PNP)\b\s*(.*)$/i.exec(statement)
    if (!match) throw new Error('Only D, NPN and PNP .MODEL definitions are supported. Remove other directives, devices and subcircuits.')
    const [, entryPoint, rawDevice, rawBody] = match
    if (names.has(entryPoint.toLowerCase())) throw new Error(`Duplicate model name: ${entryPoint}.`)
    names.add(entryPoint.toLowerCase())
    let body = rawBody.trim()
    if (body.startsWith('(') && body.endsWith(')')) body = body.slice(1, -1).trim()
    const parameters: Record<string, number> = {}
    while (body) {
      const parameter = /^([a-z][a-z0-9]*)\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(meg|mil|[tgkmunpf])?(?=$|[\s,])/i.exec(body)
      if (!parameter) throw new Error(`${entryPoint}: expected a numeric PARAM=value near “${body.slice(0, 40)}”. Expressions and unsupported suffixes are not accepted.`)
      const key = parameter[1].toUpperCase()
      if (Object.hasOwn(parameters, key)) throw new Error(`${entryPoint}: duplicate parameter ${key}.`)
      parameters[key] = parseSpiceNumber(parameter[2] + (parameter[3] ?? ''))
      body = body.slice(parameter[0].length).replace(/^[\s,]+/, '')
    }
    return validateSpiceModel({ device: rawDevice.toUpperCase(), entryPoint, parameters })
  })
}

export function spiceModelText(model: SpiceModel, name = model.entryPoint): string {
  return `.model ${name} ${model.device}(${Object.entries(model.parameters).map(([key, value]) => `${key}=${value}`).join(' ')})`
}
