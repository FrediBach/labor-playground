/** Passive state inspection for the pinned rp2-pico-1.20.0-v1 firmware.
 * Layouts: MicroPython v1.20.0 py/{obj.h,qstr.h,objstr.h,objlist.h,objtuple.h}.
 * Reads use backing memory only: no Python callbacks, repr, properties or bus reads.
 */
export interface PicoStateValue { type: string; value: string; children?: PicoStateVariable[]; truncated?: boolean }
export interface PicoStateVariable { name: string; value: PicoStateValue }
export interface PicoStateSnapshot { ns: number; variables: PicoStateVariable[] }
export interface PicoStateTrace { snapshots: PicoStateSnapshot[]; intervalNs: number; sampledThroughNs: number; truncated?: boolean; unavailable?: string }
export const PICO_STATE_INTERVAL_NS = 1_000_000
export const PICO_STATE_LIMITS = { traceBytes: 1_000_000, snapshots: 10_001, variables: 128, children: 32, depth: 4, stringBytes: 256, nodes: 512 } as const
export const PICO_STATE_MAILBOX = { start: 0x20042010, commit: 0x20042050, magic: 0x53544154 } as const
const PROBE = '__name__'
const TYPE_NAMES = ['int', 'float', 'str', 'bytes', 'list', 'tuple', 'dict', 'set', 'bytearray'] as const
/** Runs in a separate namespace before capture zero. No hooks run during main.py. */
export const PICO_STATE_PRELUDE = `import machine as _machine
import __main__ as _main
for _index, _object in enumerate((_main.__dict__, int, float, str, bytes, list, tuple, dict, set, bytearray, None, False, True, "${PROBE}")):
    _machine.mem32[${PICO_STATE_MAILBOX.start} + _index * 4] = id(_object)
_machine.mem32[${PICO_STATE_MAILBOX.commit}] = ${PICO_STATE_MAILBOX.magic}
`
const SRAM = 0x20000000, FLASH = 0x10000000
const hiddenNames = new Set(['__name__', '_labor_code', 'machine', 'os', 'bdev', 'rp2'])
const scalar = (type: string, value: string): PicoStateValue => ({ type, value })

export function samplePicoState(trace: PicoStateTrace | undefined, seconds: number): PicoStateSnapshot | null {
  if (!trace || !Number.isFinite(seconds) || seconds < 0) return null
  const ns = seconds * 1e9
  let lo = 0, hi = trace.snapshots.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (trace.snapshots[mid].ns <= ns) lo = mid + 1; else hi = mid }
  return lo ? trace.snapshots[lo - 1] : null
}

/** Structural bounds also protect reads while the VM is midway through a mutation. */
export class PicoStateRecorder {
  readonly trace: PicoStateTrace = { snapshots: [], intervalNs: PICO_STATE_INTERVAL_NS, sampledThroughNs: 0 }
  private readonly sram: Uint8Array
  private readonly flash: Uint8Array
  private readonly ramView: DataView
  private readonly flashView: DataView
  private readonly decoder = new TextDecoder()
  private readonly metadata: number[] = []
  private readonly types = new Map<number, string>()
  private readonly qstrs = new Map<number, string>()
  private readonly qstrLengths = new Map<number, number>()
  private readonly maps = new Map<number, Array<[number, number]>>()
  private pools: number[] = []
  private ready = false
  private previous = ''
  private bytes = 128
  private nodes = 0
  private baseline = new Map<string, number>()
  private readonly limits: { [Key in keyof typeof PICO_STATE_LIMITS]: number }
  constructor(memory: { sram: Uint8Array; flash: Uint8Array }, limits: { [Key in keyof typeof PICO_STATE_LIMITS]: number } = PICO_STATE_LIMITS) {
    this.limits = limits
    this.sram = memory.sram; this.flash = memory.flash
    this.ramView = new DataView(memory.sram.buffer, memory.sram.byteOffset, memory.sram.byteLength)
    this.flashView = new DataView(memory.flash.buffer, memory.flash.byteOffset, memory.flash.byteLength)
  }
  write(address: number, value: number, width: 8 | 16 | 32): boolean {
    const bus = address >>> 0
    if (bus < PICO_STATE_MAILBOX.start || bus >= PICO_STATE_MAILBOX.commit + 4) return false
    // The metadata channel is setup-only; user writes cannot replace the reader's roots.
    if (this.ready || this.trace.unavailable) return true
    if (width !== 32 || bus % 4) { this.trace.unavailable = 'State metadata was not recognized.'; return true }
    if (bus === PICO_STATE_MAILBOX.commit) {
      try {
        if (value !== PICO_STATE_MAILBOX.magic || this.metadata.length !== 14) throw new Error('metadata')
        TYPE_NAMES.forEach((name, index) => this.types.set(this.metadata[index + 1], name))
        if (this.word(this.metadata[0]) !== this.metadata[7]) throw new Error('globals')
        this.discoverPools(this.metadata[13] >>> 3, PROBE)
        if (this.qstr(this.metadata[13] >>> 3) !== PROBE) throw new Error('qstr')
        this.baseline = new Map(this.entries(this.metadata[0]).map(([key, item]) => [this.string(key), item]))
        this.ready = true
      } catch { this.trace.unavailable = 'State inspection is unavailable for this firmware memory layout.' }
    } else this.metadata[(bus - PICO_STATE_MAILBOX.start) / 4] = value >>> 0
    return true
  }
  sample(ns: number) {
    if (!Number.isFinite(ns) || ns < 0 || this.trace.truncated || this.trace.unavailable) return
    if (!this.ready) { this.trace.unavailable = 'State inspection could not initialize.'; return }
    try {
      this.nodes = 0; this.maps.clear()
      const entries = this.entries(this.metadata[0])
      const variables: PicoStateVariable[] = []
      for (const [key, item] of entries) {
        const name = this.string(key)
        if (name === '__name__' || name === '_labor_code' || (hiddenNames.has(name) && this.baseline.get(name) === item)) continue
        if (variables.length >= this.limits.variables) { variables.push({ name: '…', value: { type: 'limit', value: 'Additional variables omitted', truncated: true } }); break }
        variables.push({ name, value: this.value(item, 0, new Set()) })
      }
      variables.sort((a, b) => a.name.localeCompare(b.name))
      const serialized = JSON.stringify(variables)
      if (serialized !== this.previous) {
        const snapshot = { ns, variables }
        const added = new TextEncoder().encode(JSON.stringify(snapshot)).length + 1
        if (this.bytes + added > this.limits.traceBytes || this.trace.snapshots.length >= this.limits.snapshots) { this.trace.truncated = true; return }
        this.trace.snapshots.push(snapshot); this.bytes += added; this.previous = serialized
      }
      this.trace.sampledThroughNs = ns
    } catch {
      // A hash-table resize may be in flight at this instruction boundary. Keep
      // the last complete sample and retry on the next tick, never fail the run.
    }
  }
  private region(address: number, bytes: number): [DataView, number] {
    if (!Number.isInteger(address) || bytes < 0) throw new Error('address')
    if (address >= SRAM && address + bytes <= SRAM + this.sram.length) return [this.ramView, address - SRAM]
    if (address >= FLASH && address + bytes <= FLASH + this.flash.length) return [this.flashView, address - FLASH]
    throw new Error('address')
  }
  private word(address: number) { const [view, offset] = this.region(address, 4); return view.getUint32(offset, true) }
  private half(address: number) { const [view, offset] = this.region(address, 2); return view.getUint16(offset, true) }
  private text(address: number, length: number) { if (!length) return ''; const [view, offset] = this.region(address, length); return this.decoder.decode(new Uint8Array(view.buffer, view.byteOffset + offset, length)) }
  private cstring(address: number, limit = 256) {
    const [view, offset] = this.region(address, 1)
    let length = 0
    while (length < limit && offset + length < view.byteLength && view.getUint8(offset + length)) length++
    return this.text(address, length)
  }
  private discoverPools(probe: number, expected?: string) {
    // qstr_init in the checksummed RP2 v1.20.0 UF2 initializes last_pool at
    // this address. Validate its entire linked chain before trusting the ABI.
    const chain: number[] = []
    let pool = this.word(0x20006af0)
    while (pool && chain.length < 32) {
      if (chain.includes(pool)) throw new Error('pool cycle')
      const base = this.word(pool + 4), length = this.word(pool + 12), previous = this.word(pool)
      if (!length || length > 65_536 || base > 65_536) throw new Error('pool bounds')
      this.region(pool + 24, length * 4)
      if (previous && this.word(previous + 4) + this.word(previous + 12) !== base) throw new Error('pool chain')
      chain.push(pool); pool = previous
    }
    if (pool || chain.at(-1) !== 0x1003ade0 || this.word(chain.at(-1)! + 4) !== 0) throw new Error('pool root')
    this.pools = chain
    if (expected !== undefined) {
      const matching = chain.find(address => probe >= this.word(address + 4) && probe < this.word(address + 4) + this.word(address + 12))
      if (!matching || this.cstring(this.word(matching + 24 + (probe - this.word(matching + 4)) * 4)) !== expected) throw new Error('pool probe')
    }
  }
  private qstr(id: number): string {
    const cached = this.qstrs.get(id)
    if (cached !== undefined) return cached
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const pool of this.pools) {
        const base = this.word(pool + 4), length = this.word(pool + 12)
        if (id >= base && id < base + length) {
          const [view, offset] = this.region(this.word(pool + 20) + id - base, 1)
          const size = view.getUint8(offset)
          const result = this.text(this.word(pool + 24 + (id - base) * 4), Math.min(size, this.limits.stringBytes))
          this.qstrLengths.set(id, size); this.qstrs.set(id, result); return result
        }
      }
      this.discoverPools(id)
    }
    throw new Error('qstr')
  }
  private string(object: number): string {
    if ((object & 7) === 2) return this.qstr(object >>> 3)
    if (this.word(object) !== this.metadata[3]) throw new Error('string')
    return this.text(this.word(object + 12), Math.min(this.word(object + 8), this.limits.stringBytes))
  }
  private bytesLiteral(address: number, length: number): string {
    if (!length) return 'b""'
    const [view, offset] = this.region(address, length)
    let value = 'b"'
    for (let index = 0; index < length; index++) {
      const byte = view.getUint8(offset + index)
      value += byte === 34 || byte === 92 ? '\\' + String.fromCharCode(byte) : byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '\\x' + byte.toString(16).padStart(2, '0')
    }
    return value + '"'
  }
  private entries(object: number): Array<[number, number]> {
    const cached = this.maps.get(object)
    if (cached) return cached
    const used = this.word(object + 4) >>> 3, allocated = this.word(object + 8), table = this.word(object + 12)
    if (used > allocated || allocated > 65_536) throw new Error('map')
    if (allocated) this.region(table, allocated * 8)
    const entries: Array<[number, number]> = []
    for (let index = 0; index < allocated; index++) {
      const key = this.word(table + index * 8)
      if (key !== 0 && key !== 4) entries.push([key, this.word(table + index * 8 + 4)])
    }
    if (entries.length !== used) throw new Error('map mutation')
    this.maps.set(object, entries)
    return entries
  }
  private value(object: number, depth: number, seen: Set<number>): PicoStateValue {
    if (++this.nodes > this.limits.nodes) return { type: 'limit', value: 'Value limit reached', truncated: true }
    if (object & 1) return scalar('int', String(object >> 1))
    if (object === this.metadata[10]) return scalar('NoneType', 'None')
    if (object === this.metadata[11]) return scalar('bool', 'False')
    if (object === this.metadata[12]) return scalar('bool', 'True')
    if ((object & 7) === 2) {
      const id = object >>> 3, text = this.qstr(id), truncated = this.qstrLengths.get(id)! > this.limits.stringBytes
      return { type: 'str', value: JSON.stringify(text) + (truncated ? '…' : ''), ...(truncated ? { truncated: true } : {}) }
    }
    try {
      const typeAddress = this.word(object)
      const builtin = this.types.get(typeAddress)
      const type = builtin ?? this.qstr(this.half(typeAddress + 6))
      if (!builtin) return scalar(type, `<${type}>`)
      if (type === 'int') {
        const flags = this.word(object + 4), length = this.word(object + 8), data = this.word(object + 12)
        if (length > flags >>> 2) throw new Error('integer')
        if (length > 128) return { type, value: '<integer exceeds 2048 bits>', truncated: true }
        let integer = 0n
        for (let index = length - 1; index >= 0; index--) integer = (integer << 16n) | BigInt(this.half(data + index * 2))
        return scalar(type, String(flags & 1 ? -integer : integer))
      }
      if (type === 'float') { const [view, offset] = this.region(object + 4, 4); return scalar(type, String(view.getFloat32(offset, true))) }
      if (type === 'str' || type === 'bytes' || type === 'bytearray') {
        const length = this.word(object + 8), count = Math.min(length, this.limits.stringBytes)
        const data = this.word(object + 12)
        const text = type === 'str' ? JSON.stringify(this.text(data, count)) : this.bytesLiteral(data, count)
        return { type, value: (type === 'bytearray' ? `bytearray(${text})` : text) + (length > count ? '…' : ''), ...(length > count ? { truncated: true } : {}) }
      }
      if (!['list', 'tuple', 'dict', 'set', 'bytearray'].includes(type)) return scalar(type, `<${type}>`)
      if (seen.has(object)) return scalar(type, '<circular reference>')
      if (depth >= this.limits.depth) return { type, value: '<maximum depth>', truncated: true }
      const nextSeen = new Set(seen); nextSeen.add(object)
      if (type === 'dict') {
        const entries = this.entries(object)
        return { type, value: `${entries.length} entries`, children: entries.slice(0, this.limits.children).map(([key, item]) => ({ name: this.value(key, depth + 1, nextSeen).value, value: this.value(item, depth + 1, nextSeen) })), ...(entries.length > this.limits.children ? { truncated: true } : {}) }
      }
      if (type === 'set') {
        const allocated = this.word(object + 4), length = this.word(object + 8), data = this.word(object + 12)
        if (length > allocated || allocated > 65_536) throw new Error('set')
        if (allocated) this.region(data, allocated * 4)
        const items: number[] = []
        for (let index = 0; index < allocated; index++) { const item = this.word(data + index * 4); if (item !== 0 && item !== 4) items.push(item) }
        if (items.length !== length) throw new Error('set mutation')
        const children = items.slice(0, this.limits.children).map((item, index) => ({ name: `[${index}]`, value: this.value(item, depth + 1, nextSeen) }))
        return { type, value: `${length} items`, children, ...(length > children.length ? { truncated: true } : {}) }
      }
      if (type === 'list' || type === 'tuple') {
        const length = this.word(object + (type === 'list' ? 8 : 4)), data = type === 'list' ? this.word(object + 12) : object + 8
        if (length > 65_536 || (type === 'list' && length > this.word(object + 4))) throw new Error('sequence')
        if (length) this.region(data, length * 4)
        const children = Array.from({ length: Math.min(length, this.limits.children) }, (_, index) => ({ name: `[${index}]`, value: this.value(this.word(data + index * 4), depth + 1, nextSeen) }))
        return { type, value: `${length} items`, children, ...(length > children.length ? { truncated: true } : {}) }
      }
      return scalar(type, `<${type}>`)
    } catch { return scalar('unavailable', '<changing or unsupported value>') }
  }
}
