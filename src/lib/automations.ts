import type { CircuitDocument, Part } from './circuit.ts'
import type { Capture } from './simulation-types.ts'

export const AUTOMATION_LIMIT = 24
export const AUTOMATION_EDGE_SECONDS = 1e-6

export interface Automation {
  id: string
  name: string
  enabled: boolean
  trigger: { kind: 'time'; atMs: number } | { kind: 'voltage'; channel: 'CH1' | 'CH2'; direction: 'rising' | 'falling'; threshold: number; afterMs: number }
  action: { target: 'cv' | 'amplitude' | 'frequency' | 'gate' | 'potentiometer' | 'switch'; partId?: string; value: number; durationMs: number }
}

export interface AutomationEvent { automationId: string; time: number }
export interface AutomationPoint { time: number; value: number }
export type AutomationTimelines = Map<string, AutomationPoint[]>

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Automation settings must be objects.')
  return value as Record<string, unknown>
}
function number(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}.`)
  return value
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unsupported automation setting.')
}

/** Imported expressions never reach SPICE: only bounded numbers and known targets. */
export function validateAutomations(input: unknown, _parts?: Part[]): Automation[] {
  if (!Array.isArray(input) || input.length > AUTOMATION_LIMIT) throw new Error(`A circuit may contain up to ${AUTOMATION_LIMIT} automations.`)
  const ids = new Set<string>()
  return input.map(entry => {
    const row = record(entry)
    keys(row, ['id', 'name', 'enabled', 'trigger', 'action'])
    if (typeof row.id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(row.id) || ids.has(row.id.toLowerCase())) throw new Error('Every automation needs a unique short alphanumeric ID.')
    ids.add(row.id.toLowerCase())
    if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 80) throw new Error('Automation names must contain 1–80 characters.')
    if (typeof row.enabled !== 'boolean') throw new Error('Automation enabled must be true or false.')
    const rawTrigger = record(row.trigger)
    let trigger: Automation['trigger']
    if (rawTrigger.kind === 'time') {
      keys(rawTrigger, ['kind', 'atMs'])
      trigger = { kind: 'time', atMs: number(rawTrigger.atMs, 'Automation start time', 0, 10_000) }
    } else if (rawTrigger.kind === 'voltage') {
      keys(rawTrigger, ['kind', 'channel', 'direction', 'threshold', 'afterMs'])
      if (rawTrigger.channel !== 'CH1' && rawTrigger.channel !== 'CH2') throw new Error('Automation voltage events require CH1 or CH2.')
      if (rawTrigger.direction !== 'rising' && rawTrigger.direction !== 'falling') throw new Error('Automation voltage direction must be rising or falling.')
      trigger = { kind: 'voltage', channel: rawTrigger.channel, direction: rawTrigger.direction, threshold: number(rawTrigger.threshold, 'Automation voltage threshold', -1000, 1000), afterMs: number(rawTrigger.afterMs, 'Automation arm time', 0, 10_000) }
    } else throw new Error('Unsupported automation trigger.')
    const action = record(row.action)
    keys(action, ['target', 'partId', 'value', 'durationMs'])
    if (!['cv', 'amplitude', 'frequency', 'gate', 'potentiometer', 'switch'].includes(action.target as string)) throw new Error('Unsupported automation action.')
    const target = action.target as Automation['action']['target']
    const [min, max] = target === 'cv' ? [-5, 5] : target === 'amplitude' ? [0, 5] : target === 'frequency' ? [20, 2000] : [0, 1]
    const value = number(action.value, 'Automation target value', min, max)
    const durationMs = number(action.durationMs, 'Automation action duration', 0, 10_000)
    if ((target === 'gate' || target === 'switch') && value !== 0 && value !== 1) throw new Error('Automation switch and gate values must be 0 or 1.')
    if ((target === 'switch' || (target === 'gate' && value === 0)) && durationMs !== 0) throw new Error('Automation switch and gate-low actions must have zero duration.')
    const isPart = target === 'potentiometer' || target === 'switch'
    if (isPart && (typeof action.partId !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(action.partId))) throw new Error('Automation component actions need a valid component ID.')
    if (!isPart && action.partId !== undefined) throw new Error('Instrument automations cannot target a component.')
    return { id: row.id, name: row.name, enabled: row.enabled, trigger, action: { target, ...(isPart ? { partId: action.partId as string } : {}), value, durationMs } }
  })
}

/** Recoverable editor issues do not invalidate an otherwise usable circuit. */
export function automationIssue(automation: Automation, document: CircuitDocument, durationSeconds = 10): string | null {
  const { action, trigger } = automation
  if (action.target === 'switch' || action.target === 'potentiometer') {
    const part = document.parts.find(part => part.id === action.partId)
    if (!part || part.kind !== action.target) return `Choose an existing ${action.target === 'switch' ? 'switch' : 'potentiometer'}; ${action.partId ?? 'the target'} is unavailable.`
  }
  if (action.target === 'gate' && document.instruments.envelope?.mode !== 'gate') return 'Set EG to Gate mode to automate its button.'
  if (action.target === 'frequency' && document.stimulus === 'step') return 'Frequency automation requires a periodic oscillator stimulus.'
  if (trigger.kind === 'voltage' && !document.probes[trigger.channel]) return `Connect ${trigger.channel} to use its voltage event.`
  if ((trigger.kind === 'time' ? trigger.atMs : trigger.afterMs) >= durationSeconds * 1000) return 'This automation starts at or after the recording ends. Increase the recording duration.'
  return null
}

export function scheduledAutomationEvents(document: CircuitDocument, durationSeconds: number): AutomationEvent[] {
  return (document.automations ?? []).filter(automation => automation.enabled && automation.trigger.kind === 'time' && !automationIssue(automation, document, durationSeconds))
    .map(automation => ({ automationId: automation.id, time: automation.trigger.kind === 'time' ? automation.trigger.atMs / 1000 : 0 }))
    .sort((a, b) => a.time - b.time)
}

export function automationTargetKey(action: Automation['action']): string {
  return action.target === 'switch' || action.target === 'potentiometer' ? `${action.target}:${action.partId}` : action.target
}

export function automationInitialValue(document: CircuitDocument, action: Automation['action']): number {
  if (action.target === 'switch' || action.target === 'potentiometer') {
    const part = document.parts.find(part => part.id === action.partId)
    return action.target === 'switch' ? part?.value ?? 0 : part?.position ?? 0.5
  }
  return action.target === 'gate' ? Number(document.instruments.envelope?.gateHigh ?? false) : document.instruments[action.target]
}

export function automationValueAt(points: readonly AutomationPoint[], time: number): number {
  let before = points[0]
  for (const point of points.slice(1)) {
    if (point.time > time) return before.value + Math.max(0, (time - before.time) / (point.time - before.time)) * (point.value - before.value)
    before = point
  }
  return before.value
}

/** A later action interrupts the prior ramp or pulse on the same control. */
export function automationTimelines(document: CircuitDocument, events: readonly AutomationEvent[], durationSeconds = 10): AutomationTimelines {
  const rows = document.automations ?? []
  const timelines: AutomationTimelines = new Map()
  for (const automation of rows) {
    if (automation.enabled && !automationIssue(automation, document, durationSeconds)) timelines.set(automationTargetKey(automation.action), [{ time: 0, value: automationInitialValue(document, automation.action) }])
  }
  const ordered = events.map(event => ({ ...event, index: rows.findIndex(row => row.id === event.automationId) }))
    .filter(event => event.index >= 0 && Number.isFinite(event.time) && event.time >= 0 && event.time < durationSeconds)
    .sort((a, b) => a.time - b.time || a.index - b.index)
  for (const event of ordered) {
    const action = rows[event.index].action
    const key = automationTargetKey(action)
    const points = timelines.get(key)
    if (!points) continue
    const startValue = automationValueAt(points, event.time)
    const retained = points.filter(point => point.time < event.time)
    retained.push({ time: event.time, value: startValue })
    const isButton = action.target === 'gate' || action.target === 'switch'
    const edge = action.target === 'gate' && action.durationMs > 0 ? Math.min(AUTOMATION_EDGE_SECONDS, action.durationMs / 2000) : AUTOMATION_EDGE_SECONDS
    retained.push({ time: event.time + (isButton ? edge : Math.max(edge, action.durationMs / 1000)), value: action.value })
    if (action.target === 'gate' && action.value === 1 && action.durationMs > 0) {
      retained.push({ time: event.time + action.durationMs / 1000, value: 1 }, { time: event.time + action.durationMs / 1000 + edge, value: 0 })
    }
    timelines.set(key, retained)
  }
  return timelines
}

export function automationControlValues(document: CircuitDocument, events: readonly AutomationEvent[], timeSeconds: number) {
  const result = { cv: document.instruments.cv, amplitude: document.instruments.amplitude, frequency: document.instruments.frequency, gate: Number(document.instruments.envelope?.gateHigh ?? false), parts: {} as Record<string, number> }
  for (const part of document.parts) if (part.kind === 'switch' || part.kind === 'potentiometer') result.parts[part.id] = part.kind === 'switch' ? part.value : part.position ?? 0.5
  for (const [key, points] of automationTimelines(document, events)) {
    const value = automationValueAt(points, timeSeconds)
    if (key.includes(':')) result.parts[key.slice(key.indexOf(':') + 1)] = value
    else result[key as 'cv' | 'amplitude' | 'frequency' | 'gate'] = value
  }
  return result
}

/** First genuine crossing after arming. An already-high level is not an edge. */
export function automationCrossing(automation: Automation, capture: Pick<Capture, 'time' | 'channels'>, causalCursor = 0): number | null {
  if (automation.trigger.kind !== 'voltage') return null
  const { channel, direction, threshold, afterMs } = automation.trigger
  const values = capture.channels[channel]
  const earliest = Math.max(causalCursor, afterMs / 1000)
  if (values.length !== capture.time.length) return null
  for (let index = 1; index < values.length; index++) {
    const before = values[index - 1], after = values[index]
    if (direction === 'rising' ? before >= threshold || after < threshold : before <= threshold || after > threshold) continue
    const crossing = capture.time[index - 1] + (capture.time[index] - capture.time[index - 1]) * (threshold - before) / (after - before)
    if (crossing + 1e-12 >= earliest) return Math.max(crossing, earliest)
  }
  return null
}

export function automationPwl(points: readonly AutomationPoint[], scale = 1): string {
  if (points.length === 1) return (points[0].value * scale).toExponential(12)
  return `PWL(${points.map(point => `${point.time.toExponential(12)} ${(point.value * scale).toExponential(12)}`).join(' ')})`
}

/** Exact integral of the piecewise-linear frequency control (cycles, not radians). */
export function automationPhase(points: readonly AutomationPoint[]): string {
  const sections: string[] = []
  let phase = 0
  for (let index = 0; index < points.length; index++) {
    const point = points[index], next = points[index + 1]
    const slope = next ? (next.value - point.value) / (next.time - point.time) : 0
    const elapsed = `(time-${point.time.toExponential(12)})`
    const expression = `(${phase.toExponential(12)}+${point.value.toExponential(12)}*${elapsed}+${(slope / 2).toExponential(12)}*${elapsed}^2)`
    if (next) {
      sections.push(`time<${next.time.toExponential(12)}?${expression}:`)
      phase += (next.time - point.time) * (point.value + next.value) / 2
    } else sections.push(expression)
  }
  return `(${sections.join('')})`
}

/** Native waveform breakpoints must follow phase, including frequency ramps.
 * A behavioral comparator alone can skip its short transition entirely when the
 * solver takes a larger step, shifting or losing voltage-triggered actions. */
export function automationWaveformTiming(frequency: readonly AutomationPoint[], durationSeconds: number, waveform: 'square' | 'triangle'): AutomationPoint[] {
  const result: AutomationPoint[] = []
  let section = 0, phaseAtSection = 0
  for (let halfCycle = 0; ; halfCycle++) {
    const targetPhase = halfCycle / 2
    while (section + 1 < frequency.length) {
      const here = frequency[section], next = frequency[section + 1]
      const phaseAtNext = phaseAtSection + (next.time - here.time) * (here.value + next.value) / 2
      if (phaseAtNext >= targetPhase) break
      phaseAtSection = phaseAtNext
      section++
    }
    const here = frequency[section], next = frequency[section + 1]
    const slope = next ? (next.value - here.value) / (next.time - here.time) : 0
    const cycles = targetPhase - phaseAtSection
    // Stable quadratic inversion, including a decreasing frequency ramp.
    const elapsed = 2 * cycles / (here.value + Math.sqrt(Math.max(0, here.value ** 2 + 2 * slope * cycles)))
    const time = here.time + elapsed
    if (time >= durationSeconds) break
    const value = halfCycle % 2 === 0 ? 1 : -1
    result.push({ time, value: -value })
    if (waveform === 'square') result.push({ time: time + AUTOMATION_EDGE_SECONDS, value })
  }
  return result
}
