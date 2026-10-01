/** Numeric values supplied by main.py, on the same clock as GPIO capture. */
export interface PicoScopeChannel { name: string; unit: string; time: number[]; values: number[] }
export const PICO_SCOPE_LIMITS = { channels: 16, nameBytes: 64, unitBytes: 16, samples: 25_000, traceBytes: 1_000_000, packetBytes: 640 } as const
type ScopeLimits = { [Key in keyof typeof PICO_SCOPE_LIMITS]: number }
const hasControlCharacters = (text: string) => Array.from(text).some(character => { const code = character.charCodeAt(0); return code < 32 || code === 127 })

// These addresses sit immediately beyond SRAM. The bridge consumes all writes
// here before rp2040js sees them, so logging never overwrites firmware memory.
export const PICO_SCOPE_MAILBOX = { start: 0x20042000, data: 0x20042004, commit: 0x20042008, magic: 0x53434f50 } as const

/** A bounded packet decoder, independent of USB buffering and console limits. */
export class PicoScopeRecorder {
  readonly channels: PicoScopeChannel[] = []
  private readonly byName = new Map<string, PicoScopeChannel>()
  private readonly encoder = new TextEncoder()
  private readonly decoder = new TextDecoder('utf-8', { fatal: true })
  private packet: Uint8Array | undefined
  private offset = 0
  private samples = 0
  private bytes = 2
  private readonly durationNs: number
  private readonly limits: ScopeLimits
  constructor(durationNs: number, limits: ScopeLimits = PICO_SCOPE_LIMITS) { this.durationNs = durationNs; this.limits = limits }

  write(address: number, value: number, width: 8 | 16 | 32, ns: number): boolean {
    const bus = address >>> 0
    if (bus < PICO_SCOPE_MAILBOX.start || bus >= PICO_SCOPE_MAILBOX.commit + 4) return false
    if (bus === PICO_SCOPE_MAILBOX.start && width === 32) {
      if (!Number.isInteger(value) || value <= 0 || value > this.limits.packetBytes) throw new Error('Pico scope log packet limit exceeded.')
      if (this.packet) throw new Error('Pico scope log packet was interrupted.')
      this.packet = new Uint8Array(value); this.offset = 0
    } else if (bus === PICO_SCOPE_MAILBOX.data && width === 8) {
      if (!this.packet || this.offset >= this.packet.length) throw new Error('Malformed Pico scope log packet.')
      this.packet[this.offset++] = value
    } else if (bus === PICO_SCOPE_MAILBOX.commit && width === 32 && value === PICO_SCOPE_MAILBOX.magic) {
      if (!this.packet || this.offset !== this.packet.length) throw new Error('Incomplete Pico scope log packet.')
      const packet = this.packet
      this.packet = undefined; this.offset = 0
      this.record(packet, ns)
    } else throw new Error('Malformed Pico scope log mailbox write.')
    return true
  }

  private record(packet: Uint8Array, ns: number) {
    let record: unknown
    try { record = JSON.parse(this.decoder.decode(packet)) } catch { throw new Error('Malformed Pico scope log data.') }
    if (!Array.isArray(record) || record.length !== 3) throw new Error('Malformed Pico scope log data.')
    const [name, value, unit] = record
    if (typeof name !== 'string' || !name.trim() || hasControlCharacters(name) || this.encoder.encode(name).length > this.limits.nameBytes) throw new Error(`Pico scope log names must contain 1–${this.limits.nameBytes} UTF-8 bytes without control characters.`)
    if (typeof unit !== 'string' || hasControlCharacters(unit) || this.encoder.encode(unit).length > this.limits.unitBytes) throw new Error(`Pico scope log units must contain at most ${this.limits.unitBytes} UTF-8 bytes without control characters.`)
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Pico scope log values must be finite numbers.')
    if (!Number.isFinite(ns) || ns < 0) throw new Error('Pico scope log timestamp is invalid.')
    if (ns >= this.durationNs) return
    let channel = this.byName.get(name)
    if (channel && channel.unit !== unit) throw new Error(`Pico scope log "${name}" must keep the same unit.`)
    if (!channel && this.channels.length >= this.limits.channels) throw new Error(`Pico scope channel limit exceeded (${this.limits.channels}). Reuse existing log names.`)
    if (this.samples >= this.limits.samples) throw new Error('Pico scope sample limit exceeded. Log less often or shorten the capture.')
    const time = ns / 1e9
    // Count the actual serialized numeric arrays and channel metadata without
    // repeatedly serializing the growing trace in the emulation loop.
    const addedBytes = String(time).length + String(value).length + 2 + (channel ? 0 : this.encoder.encode(JSON.stringify({ name, unit, time: [], values: [] })).length + 1)
    if (this.bytes + addedBytes > this.limits.traceBytes) throw new Error('Pico scope trace byte limit exceeded. Log less often or shorten the capture.')
    if (!channel) {
      channel = { name, unit, time: [], values: [] }
      this.channels.push(channel); this.byName.set(name, channel)
    }
    channel.time.push(time); channel.values.push(value)
    this.samples++; this.bytes += addedBytes
  }
}

/** Installed before capture; main.py keeps its own filename and line numbers. */
export const PICO_SCOPE_PRELUDE = `import sys as _sys
import machine as _machine
import json as _json
import math as _math
class _Scope:
    @staticmethod
    def log(name, value, unit=""):
        if not isinstance(name, str) or not name.strip() or len(name.encode()) > ${PICO_SCOPE_LIMITS.nameBytes}:
            raise ValueError("scope.log name must contain 1-${PICO_SCOPE_LIMITS.nameBytes} UTF-8 bytes")
        if not isinstance(unit, str) or len(unit.encode()) > ${PICO_SCOPE_LIMITS.unitBytes}:
            raise ValueError("scope.log unit must contain at most ${PICO_SCOPE_LIMITS.unitBytes} UTF-8 bytes")
        if isinstance(value, bool):
            value = int(value)
        if not isinstance(value, (int, float)) or isinstance(value, float) and not _math.isfinite(value):
            raise ValueError("scope.log value must be a finite number")
        payload = _json.dumps((name, value, unit)).encode()
        if len(payload) > ${PICO_SCOPE_LIMITS.packetBytes}:
            raise ValueError("scope.log packet is too large")
        _machine.mem32[${PICO_SCOPE_MAILBOX.start}] = len(payload)
        for byte in payload:
            _machine.mem8[${PICO_SCOPE_MAILBOX.data}] = byte
        _machine.mem32[${PICO_SCOPE_MAILBOX.commit}] = ${PICO_SCOPE_MAILBOX.magic}
_sys.modules["scope"] = _Scope
`

export const PICO_SCOPE_STUB = `"""Simulator numeric logging, synchronized with the oscilloscope recording."""
def log(name: str, value: float, unit: str = "") -> None:
    """Record a finite value at the current simulated time.

    Reuse a name for one trace, keeping its unit consistent. Names are limited
    to 64 UTF-8 bytes and units to 16. Up to 16 traces and 25,000 total samples
    are captured per run. Logs are independent of print() and console limits.
    """
    ...
`
