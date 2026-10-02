import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Simulation } from 'eecircuit-engine'
import { SSD1306, sampleOled, OLED_FRAME_LIMIT } from '../src/lib/ssd1306.ts'
import { compileCircuit, getPlacement, isValidFootprint, oledConnections, validateDocument } from '../src/lib/circuit.ts'
import { picoOledExample } from '../src/lib/pico/oled-example.ts'
import { runPico } from '../src/lib/pico/runtime.ts'
import { runCircuitCapture } from '../src/lib/simulation-analysis.ts'
import { operatingPointDescriptors } from '../src/lib/simulation-descriptors.ts'

const send = (oled: SSD1306, ...bytes: number[]) => { oled.start(); bytes.forEach(byte => oled.write(byte)) }
const command = (oled: SSD1306, ...bytes: number[]) => send(oled, 0, ...bytes)
const buffer = (name: string) => { const bytes = readFileSync(new URL(`../public/pico/${name}`, import.meta.url)); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }

test('SSD1306 addressing, control continuation, inversion, blanking and frame seeking', () => {
  const oled = new SSD1306()
  command(oled, 0xa1, 0xc8, 0xaf, 0x20, 0, 0x21, 3, 4, 0x22, 1, 2)
  send(oled, 0x40, 1, 2, 4, 8, 16)
  assert.equal(oled.ram[131], 16)
  assert.equal(oled.ram[132], 2)
  assert.equal(oled.ram[259], 4)
  assert.equal(oled.ram[260], 8)
  oled.commit(10)
  assert.equal(sampleOled(oled.frames, 0), undefined)
  assert.equal(sampleOled(oled.frames, 10e-9)?.pixels[131], 16)
  command(oled, 0xa7); oled.commit(20)
  assert.equal(sampleOled(oled.frames, 20e-9)?.pixels[131], 239)
  assert.equal(sampleOled(oled.frames, 10e-9)?.pixels[131], 16, 'earlier frame remains immutable')
  command(oled, 0xae); oled.commit(30)
  assert.ok(oled.frames.at(-1)!.pixels.every(byte => byte === 0))
  send(oled, 0x80, 0xaf, 0x80, 0xa6, 0x00, 0xa5); oled.commit(40)
  assert.ok(oled.frames.at(-1)!.pixels.every(byte => byte === 255))
  assert.throws(() => command(oled, 0x2f), /not supported/)
  assert.throws(() => send(oled, 0x41), /control byte/)
})

test('vertical/page modes, fragmented commands, remap and bounded recordings', () => {
  const oled = new SSD1306()
  command(oled, 0x20); command(oled, 1, 0x21, 2, 3, 0x22, 2, 3)
  send(oled, 0x40, 1, 2, 4, 8)
  assert.equal(oled.ram[258], 1); assert.equal(oled.ram[386], 2)
  assert.equal(oled.ram[259], 4); assert.equal(oled.ram[387], 8)
  command(oled, 0x20, 2, 0xb0, 0x00, 0x10, 0xaf)
  send(oled, 0x40, 1); oled.commit(0)
  assert.equal(oled.frames[0].pixels[1023], 128, 'default COM/segment orientation mirrors the physical module')
  command(oled, 0xa1, 0xc8); oled.commit(1)
  assert.equal(oled.frames[1].pixels[0], 1)
  const frames = new SSD1306()
  command(frames, 0xaf)
  for (let index = 0; index < OLED_FRAME_LIMIT; index++) { command(frames, index % 2 ? 0xa5 : 0xa4); frames.commit(index) }
  command(frames, 0xa4)
  assert.throws(() => frames.commit(OLED_FRAME_LIMIT), /frame limit/)
})

test('OLED placement, document roundtrip and actual wiring validation', () => {
  const doc = structuredClone(picoOledExample.document)
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))), doc)
  assert.deepEqual(getPlacement('ssd1306', 'e14'), ['e14', 'e15', 'e16', 'e17'])
  assert.deepEqual(getPlacement('ssd1306', 'a4', 180), ['a4', 'a3', 'a2', 'a1'])
  assert.equal(getPlacement('ssd1306', 'a28'), null)
  assert.equal(getPlacement('ssd1306', 'a1', 90), null)
  assert.equal(isValidFootprint('ssd1306', ['a1', 'b1', 'c1', 'd1']), false)
  assert.deepEqual(oledConnections(doc), [{ partId: 'OLED1', bus: 0, sda: 0, scl: 1 }])
  for (const wire of ['W1', 'W2', 'W3', 'W4']) {
    const broken = { ...doc, wires: doc.wires.filter(item => item.id !== wire) }
    assert.ok(compileCircuit(broken).diagnostics.some(item => item.severity === 'error'))
  }
  const swapped = structuredClone(doc)
  swapped.wires.find(w => w.id === 'W3')!.from = 'pico:1'
  swapped.wires.find(w => w.id === 'W4')!.from = 'pico:2'
  assert.throws(() => oledConnections(swapped), /hardware I²C pair/)
})

test('real MicroPython I²C drives recorded OLED pixels and solves module pull-ups', { timeout: 30000 }, async () => {
  const doc = picoOledExample.document
  const assets = { bootrom: buffer('bootrom.bin'), firmware: buffer('micropython.uf2') }
  const options = { ...assets, displays: oledConnections(doc), durationSeconds: 1, source: doc.pico!.source }
  const trace = await runPico(options)
  assert.match(trace.console, /OLED frame 9/)
  const frames = trace.displays![0].frames
  assert.ok(frames.length >= 10)
  assert.ok(frames.every(frame => frame.ns >= 0 && frame.ns < trace.durationNs))
  assert.ok(frames.at(-1)!.pixels.some(Boolean))
  assert.notDeepEqual(sampleOled(frames, 0.15)?.pixels, sampleOled(frames, 0.9)?.pixels)
  const transient = compileCircuit(doc, 'transient', trace, 1)
  const dc = compileCircuit(doc, 'operating-point', trace, 1)
  assert.deepEqual(transient.diagnostics, [])
  const nodes = transient.nodeByTerminal
  const engine = new Simulation(); await engine.start()
  const capture = await runCircuitCapture(engine, { type: 'run', revision: 1, durationSeconds: 1, netlist: transient.netlist, nodes: { CH1: nodes['d16'], CH2: nodes['d17'] }, operatingPoint: { netlist: dc.netlist, parts: operatingPointDescriptors(doc, nodes) }, picoChecks: [{ gpio: 0, node: nodes['d17'] }, { gpio: 1, node: nodes['d16'] }] })
  assert.ok(capture.channels.CH1.at(-1)! > 3.2)
  assert.ok(capture.channels.CH2.at(-1)! > 3.2)
  // Address and selected hardware pins determine whether the peripheral ACKs.
  const source = 'from machine import Pin, I2C\ni2c=I2C(0,sda=Pin(0),scl=Pin(1))\ni2c.writeto(0x3D,b"\\x00\\xaf")'
  await assert.rejects(runPico({ ...options, source, durationSeconds: 0.1 }), /OSError/)
  await assert.rejects(runPico({ ...options, source: source.replace('0x3D', '0x3C'), displays: [{ partId: 'OLED1', bus: 0, sda: 4, scl: 5 }], durationSeconds: 0.1 }), /unsupported output function|OSError/)
})
