import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sendToPico, type PicoSerialPort } from '../src/lib/pico/serial.ts'
import { runPico } from '../src/lib/pico/runtime.ts'

function fixture(options: { fail?: string; platform?: string; disconnect?: boolean; silent?: boolean; afterCommand?: (code: string) => void } = {}) {
  const commands: string[] = []
  let controller: ReadableStreamDefaultController<Uint8Array>
  let code = '', raw = false, closed = false, cancelled = false, reboots = 0
  const reply = (text: string) => {
    // Deliberately fragment every protocol marker and UTF-8 sequence.
    for (const byte of new TextEncoder().encode(text)) controller.enqueue(new Uint8Array([byte]))
  }
  const port: PicoSerialPort = {
    readable: new ReadableStream({ start(value) { controller = value }, cancel() { cancelled = true } }),
    writable: new WritableStream({ write(bytes) {
      const value = new TextDecoder().decode(bytes)
      if (options.silent) return
      if (value === '\x02\r\x01') { raw = true; reply('raw REPL; CTRL-B to exit\r\n>') }
      else if (value === '\x02') { raw = false; reply('>>> ') }
      else if (value === '\x04' && !raw) { reboots++; reply('MPY: soft reboot\r\n') }
      else if (value === '\x04' && !code) reply('MPY: soft reboot\r\nraw REPL; CTRL-B to exit\r\n>')
      else if (value === '\x04') {
        commands.push(code)
        options.afterCommand?.(code)
        if (options.disconnect && code.includes('.write(')) controller.close()
        else reply(`OK${code.includes('print(sys.platform)') ? (options.platform ?? 'rp2') + '\r\n' : ''}\x04${options.fail && code.includes(options.fail) ? 'Traceback: SyntaxError: invalid syntax\r\n' : ''}\x04>`)
        code = ''
      } else if (!value.includes('\x03')) code += value
    } }),
    async open(options) { assert.equal(options.baudRate, 115200) },
    async close() { assert.equal(port.readable!.locked, false); assert.equal(port.writable!.locked, false); closed = true },
  }
  return { serial: { async requestPort() { return port } }, commands, get closed() { return closed }, get cancelled() { return cancelled }, get reboots() { return reboots } }
}
const upload = (device: ReturnType<typeof fixture>, source = 'print("hello 🌍")\n', run = true, controller = new AbortController()) => sendToPico(device.serial, { source, run, signal: controller.signal, progress() {} })

test('upload preserves UTF-8 and stages, compiles, renames, then reboots and releases locks', async () => {
  const device = fixture()
  const source = '# é🌍\\\"\r\n' + 'print("hello")\n'.repeat(30)
  await upload(device, source)
  const bytes = device.commands.filter(code => code.includes('.write(')).flatMap(code => [...code.matchAll(/\\x([0-9a-f]{2})/g)].map(match => parseInt(match[1], 16)))
  assert.equal(new TextDecoder().decode(new Uint8Array(bytes)), source)
  const compileIndex = device.commands.findIndex(code => code.includes('compile('))
  assert.ok(compileIndex > 0)
  assert.ok(device.commands.findIndex(code => code.includes('os.rename')) > compileIndex)
  assert.equal(device.reboots, 1)
  assert.equal(device.closed, true)
  assert.equal(device.cancelled, true)
})

test('save-only does not restart; wrong device, syntax errors and unplugging never replace main.py', async () => {
  const saved = fixture()
  await upload(saved, '', false)
  assert.equal(saved.reboots, 0)
  for (const options of [{ platform: 'esp32' }, { fail: 'compile(' }, { disconnect: true }, { fail: '.write(' }]) {
    const device = fixture(options)
    await assert.rejects(upload(device), /RP2|SyntaxError|disconnected/)
    assert.ok(!device.commands.some(code => code.includes('os.rename')))
    assert.equal(device.closed, true)
  }
})

test('cancellation interrupts a pending read, releases streams, and oversized source never opens a picker', async () => {
  const device = fixture({ silent: true })
  const controller = new AbortController()
  const work = upload(device, 'pass', true, controller)
  setTimeout(() => controller.abort(), 150)
  await assert.rejects(work, { name: 'AbortError' })
  assert.equal(device.closed, true)
  let requested = false
  await assert.rejects(sendToPico({ async requestPort() { requested = true; throw new Error('unexpected') } }, { source: 'é'.repeat(17000), run: false, signal: new AbortController().signal, progress() {} }), /32 KiB/)
  assert.equal(requested, false)
  const duringWrite = new AbortController()
  const interrupted = fixture({ afterCommand(code) { if (code.includes('.write(')) duringWrite.abort() } })
  await assert.rejects(upload(interrupted, 'print(1)\n'.repeat(100), true, duringWrite), { name: 'AbortError' })
  assert.ok(!interrupted.commands.some(code => code.includes('os.rename')))
  assert.equal(interrupted.closed, true)
})

test('unresponsive firmware times out and releases the port for retry', async () => {
  const device = fixture({ silent: true })
  await assert.rejects(upload(device), /did not respond/)
  assert.equal(device.closed, true)
})

test('actual bundled Pico firmware executes upload commands and replaces an existing main.py', async () => {
  const device = fixture()
  const source = 'print("héllo 🌍")\n'
  await upload(device, source, false)
  const buffer = (name: string) => {
    const bytes = readFileSync(new URL(`../public/pico/${name}`, import.meta.url))
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  }
  const trace = await runPico({ bootrom: buffer('bootrom.bin'), firmware: buffer('micropython.uf2'), durationSeconds: 1,
    // rp2040js does not emulate writable flash. Exercise the real firmware's
    // LittleFS on a RAM block device instead, including replacement semantics.
    source: `import os
class Blocks:
 def __init__(self):
  self.data = bytearray(65536)
 def readblocks(self, block, buf, offset=0):
  start = block * 512 + offset
  buf[:] = self.data[start:start + len(buf)]
 def writeblocks(self, block, buf, offset=0):
  start = block * 512 + offset
  self.data[start:start + len(buf)] = buf
 def ioctl(self, op, arg):
  if op == 4: return 128
  if op == 5: return 512
  if op == 6:
   self.data[arg * 512:(arg + 1) * 512] = b'\\xff' * 512
  return 0
blocks = Blocks()
os.VfsLfs2.mkfs(blocks)
os.mount(os.VfsLfs2(blocks), '/')
with open('main.py', 'w') as f:
 f.write('old source')
${device.commands.join('\n')}
with open('main.py') as f:
 print(f.read())` })
  assert.match(trace.console, /héllo 🌍/)
  assert.ok(!trace.console.includes('old source'))
})
