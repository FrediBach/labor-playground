import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runPico } from '../src/lib/pico/runtime.ts'
import { PicoStateRecorder, PICO_STATE_LIMITS, PICO_STATE_MAILBOX, samplePicoState } from '../src/lib/pico/state.ts'
import type { PicoStateSnapshot, PicoStateTrace } from '../src/lib/pico/state.ts'

const buffer = (name: string) => { const bytes = readFileSync(new URL(`../public/pico/${name}`, import.meta.url)); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
const assets = { bootrom: buffer('bootrom.bin'), firmware: buffer('micropython.uf2') }
const named = (snapshot: PicoStateSnapshot | null, name: string) => snapshot?.variables.find(variable => variable.name === name)?.value

test('passive globals track values, nested mutation, deletion and dynamic names at the recording cursor', async () => {
  const result = await runPico({ ...assets, source: `import time
count = 1
_private = 'visible'
config = {'ready': False, 'items': [1, 2]}
time.sleep_ms(15)
count = 2
config['ready'] = True
config['items'][0] = 7
globals()['dynamic_' + str(count)] = 'created'
time.sleep_ms(15)
del count
del config['ready']
time.sleep_ms(15)
` })
  const trace = result.state!
  assert.equal(trace.unavailable, undefined)
  assert.equal(trace.intervalNs, 1_000_000)
  assert.equal(trace.sampledThroughNs, result.durationNs)
  const before = samplePicoState(trace, .01), after = samplePicoState(trace, .025), deleted = samplePicoState(trace, .05)
  assert.equal(named(before, 'count')?.value, '1')
  assert.equal(named(after, 'count')?.value, '2')
  assert.equal(named(deleted, 'count'), undefined)
  assert.equal(named(before, '_private')?.value, '"visible"')
  assert.equal(named(after, 'dynamic_2')?.value, '"created"')
  assert.equal(named(before, 'config')?.children?.find(item => item.name === '"ready"')?.value.value, 'False')
  assert.equal(named(after, 'config')?.children?.find(item => item.name === '"items"')?.value.children?.[0].value.value, '7')
  assert.equal(named(deleted, 'config')?.children?.find(item => item.name === '"ready"'), undefined)
  assert.deepEqual(samplePicoState(trace, 0)?.variables, [])
  assert.ok(trace.snapshots.length < 20, 'unchanged periodic samples are not duplicated')
  assert.ok(trace.snapshots.every(snapshot => snapshot.ns <= result.durationNs))
})

test('state reader preserves primitive representations and bounds containers without executing user code', async () => {
  const result = await runPico({ ...assets, source: `number = -23
large = -(2**80 + 123)
fraction = 1.25
yes = True
nothing = None
empty = {}
sequence = ()
nul = 'a\\x00b'
raw = b'\\xff\\x00A'
mutable = bytearray(raw)
unique = {1, 2, 3}
cycle = []
cycle.append(cycle)
long_text = 'z' * 300
many = list(range(40))
class dict:
    def __repr__(self):
        print('REPR CALLED')
        raise Exception('Inspector must not execute repr')
    @property
    def secret(self):
        raise Exception('Inspector must not execute properties')
opaque = dict()
def fn():
    private_local = 9
fn()
` })
  assert.equal(result.console, '')
  const last = samplePicoState(result.state, .1)
  const expected: Record<string, string> = { number: '-23', large: '-1208925819614629174706299', fraction: '1.25', yes: 'True', nothing: 'None', nul: '"a\\u0000b"', raw: 'b"\\xff\\x00A"', mutable: 'bytearray(b"\\xff\\x00A")' }
  for (const [name, value] of Object.entries(expected)) assert.equal(named(last, name)?.value, value, name)
  assert.deepEqual(named(last, 'empty')?.children, [])
  assert.deepEqual(named(last, 'sequence')?.children, [])
  assert.deepEqual(named(last, 'unique')?.children?.map(child => child.value.value).sort(), ['1', '2', '3'])
  assert.equal(named(last, 'cycle')?.children?.[0].value.value, '<circular reference>')
  assert.equal(named(last, 'long_text')?.truncated, true)
  assert.equal(named(last, 'many')?.truncated, true)
  assert.equal(named(last, 'many')?.children?.length, PICO_STATE_LIMITS.children)
  assert.deepEqual(named(last, 'opaque'), { type: 'dict', value: '<dict>' })
  assert.equal(named(last, 'private_local'), undefined, 'function locals are not claimed as globals')
})

test('state capture is deterministic across emulator batches and survives console truncation', async () => {
  const source = `from machine import Pin
import time
pin = Pin(0, Pin.OUT)
for count in range(3):
    pin.toggle()
    time.sleep_ms(5)
print('x' * 17000)
finished = True
`
  const first = await runPico({ ...assets, durationSeconds: .5, source, batchSize: 1000 })
  const second = await runPico({ ...assets, durationSeconds: .5, source, batchSize: 100000 })
  assert.deepEqual(first.state, second.state)
  assert.deepEqual(first.events, second.events)
  assert.match(first.console, /Console truncated/)
  assert.equal(named(samplePicoState(first.state, .5), 'finished')?.value, 'True')
})

function memoryFixture(limits = PICO_STATE_LIMITS) {
  const sram = new Uint8Array(264 * 1024), flash = new Uint8Array(512 * 1024)
  const ram = new DataView(sram.buffer), rom = new DataView(flash.buffer)
  const word = (address: number, value: number) => (address >= 0x20000000 ? ram : rom).setUint32(address - (address >= 0x20000000 ? 0x20000000 : 0x10000000), value, true)
  const root = 0x1003ade0, globals = 0x20001000, table = globals + 32, dictType = 0x1000101c
  word(0x20006af0, root)
  word(root, 0); word(root + 4, 0); word(root + 8, 10); word(root + 12, 2); word(root + 20, 0x10002000)
  flash.set([8, 1], 0x2000)
  word(root + 24, 0x10002010); word(root + 28, 0x10002020)
  flash.set(new TextEncoder().encode('__name__\0'), 0x2010); flash.set(new TextEncoder().encode('x\0'), 0x2020)
  word(globals, dictType); word(globals + 4, 1 << 3); word(globals + 8, 1); word(globals + 12, table)
  word(table, 10); word(table + 4, 3)
  const recorder = new PicoStateRecorder({ sram, flash }, limits)
  const metadata = [globals, 0x10001004, 0x10001008, 0x1000100c, 0x10001010, 0x10001014, 0x10001018, dictType, 0x10001020, 0x10001024, 6, 14, 30, 2]
  metadata.forEach((value, index) => recorder.write(PICO_STATE_MAILBOX.start + index * 4, value, 32))
  recorder.write(PICO_STATE_MAILBOX.commit, PICO_STATE_MAILBOX.magic, 32)
  return { recorder, change: (value: number) => word(table + 4, value * 2 + 1), word, globals }
}

test('state budgets stop collecting with an explicit cutoff and preserve earlier snapshots', () => {
  const fixture = memoryFixture({ ...PICO_STATE_LIMITS, snapshots: 2 })
  fixture.recorder.sample(0)
  fixture.change(2); fixture.recorder.sample(1_000_000)
  fixture.change(3); fixture.recorder.sample(2_000_000)
  assert.equal(fixture.recorder.trace.truncated, true)
  assert.equal(fixture.recorder.trace.sampledThroughNs, 1_000_000)
  assert.deepEqual(fixture.recorder.trace.snapshots.map(snapshot => named(snapshot, 'x')?.value), ['1', '2'])
  fixture.change(4); fixture.recorder.sample(3_000_000)
  assert.equal(fixture.recorder.trace.snapshots.length, 2)
  const bytes = memoryFixture({ ...PICO_STATE_LIMITS, traceBytes: 130 })
  bytes.recorder.sample(0)
  assert.equal(bytes.recorder.trace.truncated, true)
  assert.deepEqual(bytes.recorder.trace.snapshots, [])
})

test('reader rejects unknown metadata safely and retries partially mutated tables', () => {
  const invalid = new PicoStateRecorder({ sram: new Uint8Array(4), flash: new Uint8Array(4) })
  assert.equal(invalid.write(0x20000000, 10, 32), false)
  assert.equal(invalid.write(PICO_STATE_MAILBOX.commit, 0, 32), true)
  invalid.sample(0)
  assert.match(invalid.trace.unavailable!, /unavailable/)
  const fixture = memoryFixture()
  fixture.recorder.sample(0)
  fixture.word(fixture.globals + 4, 2 << 3)
  fixture.recorder.sample(1_000_000)
  assert.equal(fixture.recorder.trace.sampledThroughNs, 0)
  fixture.word(fixture.globals + 4, 1 << 3)
  fixture.change(7); fixture.recorder.sample(2_000_000)
  assert.equal(named(samplePicoState(fixture.recorder.trace, .002), 'x')?.value, '7')
})

test('state cursor selects the latest recorded sample without reading into the future', () => {
  const trace: PicoStateTrace = { intervalNs: 1_000_000, sampledThroughNs: 9_000_000, snapshots: [
    { ns: 1_000_000, variables: [] }, { ns: 3_000_000, variables: [{ name: 'x', value: { type: 'int', value: '2' } }] },
  ] }
  for (const time of [-1, NaN, Infinity, 0, .0005]) assert.equal(samplePicoState(trace, time), null)
  assert.equal(samplePicoState(undefined, 1), null)
  assert.equal(samplePicoState(trace, .002), trace.snapshots[0])
  assert.equal(samplePicoState(trace, .003), trace.snapshots[1])
  assert.equal(samplePicoState(trace, .008), trace.snapshots[1])
})
