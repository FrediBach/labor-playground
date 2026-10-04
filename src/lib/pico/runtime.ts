import { SSD1306, type OledConnection, type OledTrace } from '../ssd1306.ts'
import { Simulator, USBCDC, ConsoleLogger, LogLevel } from 'rp2040js'
import { PICO_CAPTURE_DURATIONS_MS } from './profile.ts'
import { PicoScopeRecorder, PICO_SCOPE_PRELUDE } from './scope-log.ts'
import type { PicoScopeChannel } from './scope-log.ts'
import { PicoStateRecorder, PICO_STATE_PRELUDE, PICO_STATE_INTERVAL_NS } from './state.ts'
import type { PicoStateTrace } from './state.ts'

export const PICO_LIMITS = { captureNs: 100_000_000, maxCaptureNs: 10_000_000_000, bootNs: 10_000_000_000, instructions: 1_500_000_000, wallMs: 60_000, events: 25_000, consoleBytes: 16_384, traceBytes: 4_000_000, sourceBytes: 32_768 } as const
export interface PinState { gpio: number; state: number; function: number; enabled: boolean; pullUp: boolean; pullDown: boolean }
export interface PinEvent extends PinState { ns: number }
export interface PicoTrace { initial: PinState[]; events: PinEvent[]; durationNs: number; console: string; instructions: number; elapsedMs: number; scopeLogs?: PicoScopeChannel[]; displays?: OledTrace[]; state?: PicoStateTrace }
export interface RuntimeOptions { displays?: OledConnection[]; source: string; bootrom: ArrayBuffer; firmware: ArrayBuffer; durationSeconds?: number; signal?: AbortSignal; batchSize?: number; onConsole?: (text: string) => void; onPhase?: (phase: 'preparing' | 'running') => void }
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
  const durationSeconds = options.durationSeconds ?? PICO_LIMITS.captureNs / 1e9
  if (!PICO_CAPTURE_DURATIONS_MS.some(ms => ms === durationSeconds * 1000)) throw new Error('Pico capture duration must be 100 ms, 500 ms, 1 s, 5 s, or 10 s.')
  const captureNs = durationSeconds * 1e9
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
  const scope = new PicoScopeRecorder(captureNs)
  const state = new PicoStateRecorder({ sram: mcu.sram, flash: mcu.flash })
  let nextStateNs = PICO_STATE_INTERVAL_NS
  const displays = (options.displays ?? []).map(connection => ({ connection, controller: new SSD1306() }))
  for (const [index, bus] of mcu.i2c.entries()) {
    let attached: typeof displays[number] | undefined
    bus.onConnect = (address, mode) => {
      attached = displays.find(display => display.connection.bus === index && address === 0x3c && mode === 0
        && [display.connection.sda, display.connection.scl].every(gpio => mcu.gpio[gpio].functionSelect === 3))
      attached?.controller.start()
      bus.completeConnect(!!attached)
    }
    bus.onWriteByte = value => { attached?.controller.write(value); bus.completeWrite(!!attached) }
    bus.onStop = () => {
      if (zero !== undefined && sim.clock.nanos - zero < captureNs) attached?.controller.commit(sim.clock.nanos - zero)
      attached = undefined
      bus.completeStop()
    }
  }
  let consoleText = '', stderr = '', stream: 'stdout' | 'stderr' | 'done' = 'stdout', handshake = '', phase: 'boot' | 'raw' | 'submitted' = 'boot'
  let consoleBytes = 0, consoleTruncated = false, consoleDirty = false, lastConsoleUpdate = 0
  const displayConsole = () => consoleText + (consoleTruncated ? '\n[Console truncated]' : '')
  const flushConsole = (force = false) => {
    if (!consoleDirty || (!force && performance.now() - lastConsoleUpdate < 50)) return
    options.onConsole?.(displayConsole())
    consoleDirty = false
    lastConsoleUpdate = performance.now()
  }
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
          if (consoleBytes + bytes <= PICO_LIMITS.consoleBytes) { consoleText += character; consoleBytes += bytes; consoleDirty = true } else if (!consoleTruncated) { consoleTruncated = true; consoleDirty = true }
        }
        if (stream === 'stderr' && stderr.length < PICO_LIMITS.consoleBytes) stderr += character
      }
      flushConsole()
      return
    }
    handshake = (handshake + text).slice(-2048)
    if (phase === 'boot' && handshake.includes('>>>')) { phase = 'raw'; handshake = ''; queue('\x01') }
    else if (phase === 'raw' && handshake.includes('raw REPL; CTRL-B to exit\r\n>')) {
      phase = 'submitted'; handshake = ''
      // Compilation is excluded; capture starts at the marker write immediately before exec.
      queue(`import machine\nexec(compile(${JSON.stringify(PICO_SCOPE_PRELUDE)}, 'scope.py', 'exec'), {})\n_labor_code = compile(${JSON.stringify(options.source)}, 'main.py', 'exec')\nexec(compile(${JSON.stringify(PICO_STATE_PRELUDE)}, 'state.py', 'exec'), {})\nmachine.mem32[${MARKER}] = 0x4c41424f\nexec(_labor_code)\n\x04`)
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
    mcu[width] = (address, value) => {
      if (state.write(address, value, width === 'writeUint8' ? 8 : 16)) return
      if (zero !== undefined && scope.write(address, value, width === 'writeUint8' ? 8 : 16, sim.clock.nanos - zero)) return
      guardWrite(address, value); original(address, value)
    }
  }
  const write = mcu.writeUint32.bind(mcu)
  mcu.writeUint32 = (address, value) => {
    if (state.write(address, value, 32)) return
    if (address === MARKER && value === 0x4c41424f && zero === undefined) {
      zero = sim.clock.nanos
      initial = mcu.gpio.map((_, index) => snapshot(index))
      state.sample(0)
      options.onPhase?.('running')
      return
    }
    if (zero !== undefined && scope.write(address, value, 32, sim.clock.nanos - zero)) return
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
    // Register writes often leave the output unchanged. Compare packed values
    // before allocating a trace object instead of serializing every check.
    const stateKey = () => pin.value | pin.functionSelect << 3 | Number(pin.outputEnable) << 8 | Number(pin.pullupEnabled) << 9 | Number(pin.pulldownEnabled) << 10
    let previous = stateKey()
    pin.checkForUpdates = () => {
      update()
      const key = stateKey()
      if (key === previous) return
      previous = key
      if (zero === undefined) return
      const ns = sim.clock.nanos - zero
      if (ns >= captureNs) return
      if (events.length >= PICO_LIMITS.events) throw new Error('Pico event limit exceeded. Shorten the capture, reduce PWM frequency, or use fewer active outputs.')
      if (![4, 5, 31].includes(pin.functionSelect) && !(pin.functionSelect === 3 && displays.some(({ connection }) => connection.sda === pin.index || connection.scl === pin.index))) throw new Error(`GP${pin.index}: unsupported output function ${pin.functionSelect}.`)
      events.push({ ...snapshot(pin.index), ns })
    }
  }
  mcu.addClockListener(clock => { if (zero !== undefined && clock !== 125_000_000) throw new Error('Changing the Pico CPU frequency is unsupported in this capture profile.') })
  mcu.core.PC = 0x10000000
  options.onPhase?.('preparing')
  let lastYield = performance.now()
  while (zero === undefined || sim.clock.nanos - zero < captureNs) {
    options.signal?.throwIfAborted()
    if (performance.now() - started > PICO_LIMITS.wallMs || instructions > PICO_LIMITS.instructions) throw new Error('Pico execution resource limit exceeded. Shorten the capture or add sleeps to busy loops.')
    if (zero === undefined && sim.clock.nanos > PICO_LIMITS.bootNs) throw new Error(`Pico REPL startup timed out. ${handshake}`)
    for (let batch = 0; batch < (options.batchSize ?? 50_000); batch++) {
      while (sent < pending.length && !cdc.txFIFO.full) cdc.sendSerialByte(pending[sent++])
      const remaining = zero === undefined ? Infinity : captureNs - (sim.clock.nanos - zero)
      if (remaining <= 0) break
      if (mcu.core.waiting) sim.clock.tick(Math.min(sim.clock.nanosToNextAlarm, remaining, zero === undefined ? Infinity : nextStateNs - (sim.clock.nanos - zero)))
      else { const cycles = mcu.core.executeInstruction(); sim.clock.tick(Math.min(cycles * 8, remaining)); instructions++ }
      if (zero !== undefined && sim.clock.nanos - zero >= nextStateNs) {
        state.sample(sim.clock.nanos - zero)
        nextStateNs = (Math.floor((sim.clock.nanos - zero) / PICO_STATE_INTERVAL_NS) + 1) * PICO_STATE_INTERVAL_NS
      }
    }
    if (performance.now() - lastYield >= 16) {
      flushConsole()
      await new Promise(resolve => setTimeout(resolve, 0))
      lastYield = performance.now()
    }
  }
  flushConsole(true)
  if (stderr.trim()) throw new Error(stderr.replace(/  File "<stdin>", line \d+, in <module>\r?\n/g, ''))
  state.sample(captureNs)
  const scopeLogs = scope.channels
  const displayTraces = displays.map(({ connection, controller }) => ({ partId: connection.partId, frames: controller.frames }))
  if (encoder.encode(JSON.stringify({ initial, events, scopeLogs, displays: displayTraces })).length > PICO_LIMITS.traceBytes) throw new Error('Pico trace byte limit exceeded. Reduce output event or logging density.')
  return { initial, events, durationNs: captureNs, console: displayConsole(), instructions, elapsedMs: performance.now() - started, scopeLogs, displays: displayTraces, state: state.trace }
}
