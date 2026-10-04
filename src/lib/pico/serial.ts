import { PROJECT_LIMITS } from '../project-limits.ts'

// Local structural types keep Web Serial optional in browsers without the API.
export interface PicoSerialPort {
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
}
export interface PicoSerial { requestPort(): Promise<PicoSerialPort> }
export function browserSerial(): PicoSerial | undefined {
  if (typeof navigator === 'undefined' || !globalThis.isSecureContext) return undefined
  return (navigator as Navigator & { serial?: PicoSerial }).serial
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const rawPrompt = 'raw REPL; CTRL-B to exit\r\n>'
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

async function bounded<T>(work: Promise<T>, signal?: AbortSignal, timeout = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort = () => {}
  const stopped = new Promise<never>((_, reject) => {
    abort = () => reject(new DOMException('Transfer cancelled.', 'AbortError'))
    timer = setTimeout(() => reject(new Error('Pico did not respond. Check MicroPython is installed, reconnect USB, and close other serial apps.')), timeout)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
  try { return await Promise.race([work, stopped]) }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
}

class RawRepl {
  private buffer = new Uint8Array(0)
  private reader: ReadableStreamDefaultReader<Uint8Array>
  private writer: WritableStreamDefaultWriter<Uint8Array>
  private signal: AbortSignal
  constructor(port: PicoSerialPort, signal: AbortSignal) {
    if (!port.readable || !port.writable) throw new Error('The selected serial port has no readable/writable stream.')
    this.reader = port.readable.getReader()
    this.writer = port.writable.getWriter()
    this.signal = signal
  }
  async write(value: string) {
    this.signal.throwIfAborted()
    await bounded(this.writer.write(encoder.encode(value)), this.signal)
  }
  async until(marker: string) {
    const end = encoder.encode(marker)
    const deadline = Date.now() + 5000
    while (true) {
      this.signal.throwIfAborted()
      const index = this.buffer.findIndex((_, offset) => end.every((byte, i) => this.buffer[offset + i] === byte))
      if (index >= 0) {
        const result = decoder.decode(this.buffer.slice(0, index))
        this.buffer = this.buffer.slice(index + end.length)
        return result
      }
      if (this.buffer.length > 65536) throw new Error('Unexpectedly large response from the Pico.')
      const { value, done } = await bounded(this.reader.read(), this.signal, Math.max(1, deadline - Date.now()))
      if (done) throw new Error('Pico disconnected during transfer.')
      const joined = new Uint8Array(this.buffer.length + value.length)
      joined.set(this.buffer); joined.set(value, this.buffer.length); this.buffer = joined
    }
  }
  async execute(code: string) {
    // Standard raw REPL, with the same paced chunks used by MicroPython's
    // pyboard transport. Commands stay small regardless of the source size.
    for (let offset = 0; offset < code.length; offset += 128) {
      await this.write(code.slice(offset, offset + 128))
      await pause(10)
    }
    await this.write('\x04')
    if (await this.until('OK') !== '') throw new Error('Unexpected MicroPython command acknowledgement.')
    const output = await this.until('\x04')
    const error = await this.until('\x04')
    await this.until('>')
    if (error) throw new Error(error.trim())
    return output
  }
  async release() {
    try { await bounded(this.reader.cancel(), undefined, 1500) } catch { /* unplugged port */ }
    this.reader.releaseLock()
    this.writer.releaseLock()
  }
}

export interface PicoTransferOptions {
  source: string
  run: boolean
  signal: AbortSignal
  progress: (message: string) => void
}

/** Transfer a frozen source snapshot. Selecting the port must begin in a click handler. */
export async function sendToPico(serial: PicoSerial, options: PicoTransferOptions): Promise<void> {
  const { source, run, signal, progress } = options
  const bytes = encoder.encode(source)
  if (bytes.length > PROJECT_LIMITS.sourceBytes) throw new Error('main.py must fit within 32 KiB.')
  signal.throwIfAborted()
  // Do not await anything before requestPort: it requires user activation.
  const port = await serial.requestPort()
  let opened = false
  let repl: RawRepl | undefined
  let saved = false
  let cleanupFailed = false
  try {
    signal.throwIfAborted()
    progress('Connecting to Pico…')
    await port.open({ baudRate: 115200 }); opened = true
    signal.throwIfAborted()
    repl = new RawRepl(port, signal)
    await repl.write('\r\x03\x03')
    await pause(100)
    await repl.write('\x02\r\x01')
    await repl.until(rawPrompt)
    // Reset the interpreter without running the old main.py.
    await repl.write('\x04')
    await repl.until(rawPrompt)
    const platform = await repl.execute('import sys\nprint(sys.platform)')
    if (platform.trim() !== 'rp2') throw new Error('Select a Raspberry Pi Pico running MicroPython (RP2).')
    await repl.execute("import os\nos.chdir('/')")
    const temporary = `.labor-${crypto.randomUUID()}.py`
    await repl.execute(`_labor_file = open('${temporary}', 'wb')`)
    for (let offset = 0; offset < bytes.length; offset += 128) {
      const chunk = bytes.slice(offset, offset + 128)
      const literal = Array.from(chunk, byte => `\\x${byte.toString(16).padStart(2, '0')}`).join('')
      await repl.execute(`assert _labor_file.write(b'${literal}') == ${chunk.length}`)
      progress(`Sending main.py… ${Math.round(Math.min(offset + 128, bytes.length) / bytes.length * 100)}%`)
    }
    progress('Checking main.py…')
    await repl.execute(`_labor_file.close()\nwith open('${temporary}', 'rb') as _labor_file:\n _labor_source = _labor_file.read()\nassert len(_labor_source) == ${bytes.length}\ncompile(_labor_source, 'main.py', 'exec')\ndel _labor_source`)
    // RP2 LittleFS rename replaces the destination after upload and compilation
    // succeed. Never truncate main.py while a transfer is incomplete.
    await repl.execute(`import os\nos.rename('${temporary}', 'main.py')`)
    saved = true
    await repl.write('\x02')
    await repl.until('>>> ')
    if (run) {
      await repl.write('\x04')
      await repl.until('MPY: soft reboot')
    }
  } catch (error) {
    if (saved) throw new Error(`main.py was saved, but restarting or leaving the REPL failed. ${error instanceof Error ? error.message : String(error)}`)
    throw error
  } finally {
    try { await repl?.release() } catch { cleanupFailed = true }
    if (opened) {
      try { await bounded(port.close(), undefined, 2000) } catch { cleanupFailed = true }
    }
  }
  if (cleanupFailed) throw new Error('main.py was saved, but the USB port could not be released. Unplug and reconnect the Pico.')
}
