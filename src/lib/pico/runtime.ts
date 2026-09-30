import { Simulator, USBCDC, ConsoleLogger, LogLevel } from 'rp2040js'

export const PICO_LIMITS = { captureNs: 100_000_000, bootNs: 10_000_000_000, instructions: 200_000_000, wallMs: 60_000, events: 20_000, consoleBytes: 16_384, traceBytes: 2_000_000, sourceBytes: 32_768 } as const
export interface PinState { gpio: number; state: number; function: number; enabled: boolean; pullUp: boolean; pullDown: boolean }
export interface PinEvent extends PinState { ns: number }
export interface PicoTrace { initial: PinState[]; events: PinEvent[]; durationNs: number; console: string; instructions: number; elapsedMs: number }
export interface RuntimeOptions { source: string; bootrom: ArrayBuffer; firmware: ArrayBuffer; signal?: AbortSignal; batchSize?: number; onConsole?: (text: string) => void; onPhase?: (phase: 'preparing' | 'running') => void }
const MARKER = 0x20041ffc

/** Strict UF2 loader: only the bundled profile's flash payload is accepted. */
export function loadFirmware(simulator: Simulator, buffer: ArrayBuffer) {
  if (!buffer.byteLength || buffer.byteLength % 512) throw new Error('Invalid Pico firmware size.')
  const view = new DataView(buffer)
  for (let offset = 0; offset < buffer.byteLength; offset += 512) {
    const address = view.getUint32(offset + 12, true) - 0x10000000
    const size = view.getUint32(offset + 16, true)
    if (view.getUint32(offset, true) !== 0x0a324655 || view.getUint32(offset + 4, true) !== 0x9e5d5157 || view.getUint32(offset + 508, true) !== 0x0ab16f30 || size > 476 || address < 0 || address + size > simulator.rp2040.flash.length) throw new Error('Invalid Pico UF2 block.')
    simulator.rp2040.flash.set(new Uint8Array(buffer, offset + 32, size), address)
  }
}

export async function runPico(options: RuntimeOptions): Promise<PicoTrace> {
  if (new TextEncoder().encode(options.source).length > PICO_LIMITS.sourceBytes) throw new Error('main.py exceeds 32 KiB.')
  const sim = new Simulator()
  const mcu = sim.rp2040
  const started = performance.now()
  mcu.logger = new ConsoleLogger(LogLevel.Error)
  mcu.loadBootrom(new Uint32Array(options.bootrom))
  loadFirmware(sim, options.firmware)
  const cdc = new USBCDC(mcu.usbCtrl)
  let zero: number | undefined
  let initial: PinState[] = []
  const events: PinEvent[] = []
  let consoleText = '', stderr = '', stream: 'stdout' | 'stderr' | 'done' = 'stdout', handshake = '', phase: 'boot' | 'raw' | 'submitted' = 'boot'
  let consoleBytes = 0, consoleTruncated = false
  const encoder = new TextEncoder()
  let pending = new Uint8Array(), sent = 0, instructions = 0
  const snapshot = (gpio: number): PinState => {
    const pin = mcu.gpio[gpio]
    return { gpio, state: pin.value, function: pin.functionSelect, enabled: pin.outputEnable, pullUp: pin.pullupEnabled, pullDown: pin.pulldownEnabled }
  }
  const queue = (text: string) => { pending = new TextEncoder().encode(text); sent = 0 }
  cdc.onDeviceConnected = () => queue('\r\n')
  const decoder = new TextDecoder()
  cdc.onSerialData = data => {
    const text = decoder.decode(data, { stream: true })
    if (zero !== undefined) {
      for (const character of text) {
        if (character === String.fromCharCode(4)) { stream = stream === 'stdout' ? 'stderr' : 'done'; continue }
        if (stream === 'stdout') {
          const bytes = encoder.encode(character).length
          if (consoleBytes + bytes <= PICO_LIMITS.consoleBytes) { consoleText += character; consoleBytes += bytes } else consoleTruncated = true
        }
        if (stream === 'stderr' && stderr.length < PICO_LIMITS.consoleBytes) stderr += character
      }
      options.onConsole?.(consoleText + (consoleTruncated ? '\n[Console truncated]' : ''))
      return
    }
    handshake = (handshake + text).slice(-2048)
    if (phase === 'boot' && handshake.includes('>>>')) { phase = 'raw'; handshake = ''; queue('\x01') }
    else if (phase === 'raw' && handshake.includes('raw REPL; CTRL-B to exit\r\n>')) {
      phase = 'submitted'; handshake = ''
      // Compilation is excluded; capture starts at the marker write immediately before exec.
      queue(`import machine\n_labor_code = compile(${JSON.stringify(options.source)}, 'main.py', 'exec')\nmachine.mem32[${MARKER}] = 0x4c41424f\nexec(_labor_code)\n\x04`)
    }
    else if (phase === 'submitted' && handshake.endsWith(String.fromCharCode(4) + '>')) throw new Error(handshake.split(String.fromCharCode(4)).join(''))
  }
  const guardWrite = (address: number, value: number) => {
    const bus = address >>> 0
    const word = (bus & ~3) >>> 0
    if (zero !== undefined && (word === 0xd0000054 || (bus >= 0x50200000 && bus < 0x50400000))) throw new Error('Multicore and PIO are not supported by this Pico capture profile.')
    const canonical = bus & ~0x3000
    if (zero !== undefined && canonical >= 0x40014100 && canonical < 0x40014190 && value !== 0) throw new Error('Circuit-fed GPIO interrupts are not supported by this output-only bridge.')
  }
  // rp2040js routes narrow peripheral writes directly, rather than through
  // writeUint32. Guard every bus width, normalizing signed bitwise addresses.
  for (const width of ['writeUint8', 'writeUint16'] as const) {
    const original = mcu[width].bind(mcu)
    mcu[width] = (address, value) => { guardWrite(address, value); original(address, value) }
  }
  const write = mcu.writeUint32.bind(mcu)
  mcu.writeUint32 = (address, value) => {
    if (address === MARKER && value === 0x4c41424f && zero === undefined) {
      zero = sim.clock.nanos
      initial = mcu.gpio.map((_, index) => snapshot(index))
      options.onPhase?.('running')
      return
    }
    guardWrite(address, value)
    write(address, value)
  }
  const read = mcu.readUint32.bind(mcu)
  mcu.readUint32 = address => {
    // Guard actual bus observations, so aliases, getattr and native calls cannot bypass it.
    const bus = address >>> 0
    const canonical = bus >= 0x40000000 && bus < 0x50000000 ? bus & ~0x3000 : bus
    if (zero !== undefined && ((canonical >= 0xd0000004 && canonical < 0xd0000008) || (canonical >= 0x4004c000 && canonical < 0x4004d000) || (canonical >= 0x40014000 && canonical < 0x40014190 && (canonical >= 0x400140f0 || canonical % 8 < 4)))) throw new Error('Circuit-fed GPIO/ADC reads are not supported. This capture bridge supports outputs only.')
    return read(address)
  }
  for (const pin of mcu.gpio) {
    const update = pin.checkForUpdates.bind(pin)
    let previous = JSON.stringify(snapshot(pin.index))
    pin.checkForUpdates = () => {
      update()
      const state = snapshot(pin.index)
      const key = JSON.stringify(state)
      if (key === previous) return
      previous = key
      if (zero === undefined) return
      const ns = sim.clock.nanos - zero
      if (ns >= PICO_LIMITS.captureNs) return
      if (events.length >= PICO_LIMITS.events) throw new Error('Pico event limit exceeded. Reduce PWM frequency or the number of active outputs.')
      if (![4, 5, 31].includes(pin.functionSelect)) throw new Error(`GP${pin.index}: unsupported output function ${pin.functionSelect}.`)
      events.push({ ...state, ns })
    }
  }
  mcu.addClockListener(clock => { if (zero !== undefined && clock !== 125_000_000) throw new Error('Changing the Pico CPU frequency is unsupported in this capture profile.') })
  mcu.core.PC = 0x10000000
  options.onPhase?.('preparing')
  while (zero === undefined || sim.clock.nanos - zero < PICO_LIMITS.captureNs) {
    options.signal?.throwIfAborted()
    if (performance.now() - started > PICO_LIMITS.wallMs || instructions > PICO_LIMITS.instructions) throw new Error('Pico execution resource limit exceeded.')
    if (zero === undefined && sim.clock.nanos > PICO_LIMITS.bootNs) throw new Error(`Pico REPL startup timed out. ${handshake}`)
    for (let batch = 0; batch < (options.batchSize ?? 50_000); batch++) {
      while (sent < pending.length && !cdc.txFIFO.full) cdc.sendSerialByte(pending[sent++])
      const remaining = zero === undefined ? Infinity : PICO_LIMITS.captureNs - (sim.clock.nanos - zero)
      if (remaining <= 0) break
      if (mcu.core.waiting) sim.clock.tick(Math.min(sim.clock.nanosToNextAlarm, remaining))
      else { const cycles = mcu.core.executeInstruction(); sim.clock.tick(Math.min(cycles * 8, remaining)); instructions++ }
    }
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  if (stderr.trim()) throw new Error(stderr.replace(/  File "<stdin>", line \d+, in <module>\r?\n/g, ''))
  if (encoder.encode(JSON.stringify({ initial, events })).length > PICO_LIMITS.traceBytes) throw new Error('Pico trace byte limit exceeded. Reduce output event density.')
  return { initial, events, durationNs: PICO_LIMITS.captureNs, console: consoleText.split(String.fromCharCode(4)).join('') + (consoleTruncated ? '\n[Console truncated]' : ''), instructions, elapsedMs: performance.now() - started }
}
