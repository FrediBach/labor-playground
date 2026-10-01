import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runPico } from '../src/lib/pico/runtime.ts'
import { PicoScopeRecorder, PICO_SCOPE_LIMITS, PICO_SCOPE_MAILBOX, PICO_SCOPE_STUB } from '../src/lib/pico/scope-log.ts'

const buffer = (name: string) => { const bytes = readFileSync(new URL(`../public/pico/${name}`, import.meta.url)); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
const assets = { bootrom: buffer('bootrom.bin'), firmware: buffer('micropython.uf2') }
const packet = (recorder: PicoScopeRecorder, payload: string | Uint8Array, ns = 10_000_000) => {
  const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload
  assert.equal(recorder.write(PICO_SCOPE_MAILBOX.start, bytes.length, 32, ns), true)
  for (const byte of bytes) assert.equal(recorder.write(PICO_SCOPE_MAILBOX.data, byte, 8, ns), true)
  assert.equal(recorder.write(PICO_SCOPE_MAILBOX.commit, PICO_SCOPE_MAILBOX.magic, 32, ns), true)
}
const record = (recorder: PicoScopeRecorder, name: string, value: unknown, unit = '', ns = 10_000_000) => packet(recorder, JSON.stringify([name, value, unit]), ns)

test('scope mailbox records scalar channels at commit time without changing unrelated memory', () => {
  const recorder = new PicoScopeRecorder(100_000_000)
  assert.equal(recorder.write(0x20000000, 100, 32, 0), false)
  record(recorder, 'target', 3.3, 'V', 1_234_568)
  record(recorder, 'counter', -2)
  record(recorder, 'target', 1.25, 'V', 50_000_000)
  record(recorder, 'outside', 9, '', 100_000_000)
  assert.deepEqual(recorder.channels, [
    { name: 'target', unit: 'V', time: [.001234568, .05], values: [3.3, 1.25] },
    { name: 'counter', unit: '', time: [.01], values: [-2] },
  ])
  assert.match(PICO_SCOPE_STUB, /def log\(name: str, value: float, unit: str = ""\)/)
})

test('scope decoder rejects malformed packets, values, labels, units and timestamps', () => {
  for (const payload of ['{}', '[]', '["a", 1]', '["a", "1", ""]', '["a", null, ""]', '["a", 1e999, ""]', 'broken', new Uint8Array([0xff])]) {
    assert.throws(() => packet(new PicoScopeRecorder(100_000_000), payload), /Malformed|finite/)
  }
  for (const name of ['', '   ', 'a\nb', 'é'.repeat(33), 'a'.repeat(65)]) assert.throws(() => record(new PicoScopeRecorder(100_000_000), name, 1), /names/)
  for (const unit of ['a'.repeat(17), 'é'.repeat(9), '\n']) assert.throws(() => record(new PicoScopeRecorder(100_000_000), 'a', 1, unit), /units/)
  for (const ns of [-1, Infinity, NaN]) assert.throws(() => record(new PicoScopeRecorder(100_000_000), 'a', 1, '', ns), /timestamp/)
  const recorder = new PicoScopeRecorder(100_000_000)
  record(recorder, 'a', 1, 'V')
  assert.throws(() => record(recorder, 'a', 2, 'A'), /same unit/)
  assert.equal(recorder.channels[0].values.length, 1)
  for (const [address, width, value] of [
    [PICO_SCOPE_MAILBOX.data, 8, 65], [PICO_SCOPE_MAILBOX.start, 16, 3],
    [PICO_SCOPE_MAILBOX.start + 1, 8, 65], [PICO_SCOPE_MAILBOX.commit, 32, 0],
    [PICO_SCOPE_MAILBOX.start, 32, PICO_SCOPE_LIMITS.packetBytes + 1],
    [PICO_SCOPE_MAILBOX.start, 32, 0],
  ] as const) assert.throws(() => new PicoScopeRecorder(100_000_000).write(address, value, width, 0), /packet|mailbox/)
  const incomplete = new PicoScopeRecorder(100_000_000)
  incomplete.write(PICO_SCOPE_MAILBOX.start, 10, 32, 0)
  assert.throws(() => incomplete.write(PICO_SCOPE_MAILBOX.commit, PICO_SCOPE_MAILBOX.magic, 32, 0), /Incomplete/)
  assert.throws(() => incomplete.write(PICO_SCOPE_MAILBOX.start, 10, 32, 0), /interrupted/)
  const overflow = new PicoScopeRecorder(100_000_000)
  overflow.write(PICO_SCOPE_MAILBOX.start, 1, 32, 0)
  overflow.write(PICO_SCOPE_MAILBOX.data, 65, 8, 0)
  assert.throws(() => overflow.write(PICO_SCOPE_MAILBOX.data, 66, 8, 0), /Malformed/)
})

test('scope trace channel, sample and byte budgets fail before adding excess data', () => {
  const channels = new PicoScopeRecorder(100_000_000, { ...PICO_SCOPE_LIMITS, channels: 2 })
  record(channels, 'a', 1); record(channels, 'b', 2)
  assert.throws(() => record(channels, 'c', 3), /channel limit/)
  assert.equal(channels.channels.length, 2)
  const samples = new PicoScopeRecorder(100_000_000, { ...PICO_SCOPE_LIMITS, samples: 2 })
  record(samples, 'a', 1); record(samples, 'a', 2)
  assert.throws(() => record(samples, 'a', 3), /sample limit/)
  assert.deepEqual(samples.channels[0].values, [1, 2])
  const bytes = new PicoScopeRecorder(100_000_000, { ...PICO_SCOPE_LIMITS, traceBytes: 90 })
  record(bytes, 'a', 1)
  assert.throws(() => record(bytes, 'long-label', 2), /byte limit/)
  assert.equal(bytes.channels.length, 1)
})

test('real Pico scope logs use the GPIO clock and are deterministic across execution chunks', async () => {
  const source = `from machine import Pin
from scope import log
import time
p = Pin(0, Pin.OUT, value=0)
for i in range(3):
    p.on()
    log("target", i * .25, unit="V")
    log("échelle", 100 - i)
    p.off()
    time.sleep_ms(5)
print("ordinary console")`
  const first = await runPico({ ...assets, source, batchSize: 1000 })
  const second = await runPico({ ...assets, source, batchSize: 100000 })
  assert.deepEqual(first.scopeLogs, second.scopeLogs)
  assert.deepEqual(first.events, second.events)
  assert.deepEqual(first.scopeLogs?.map(channel => ({ name: channel.name, unit: channel.unit, values: channel.values })), [
    { name: 'target', unit: 'V', values: [0, .25, .5] },
    { name: 'échelle', unit: '', values: [100, 99, 98] },
  ])
  const target = first.scopeLogs![0]
  assert.ok(target.time.every(time => time >= 0 && time < .1))
  assert.ok(target.time[1] - target.time[0] > .005)
  const edges = first.events.filter(event => event.gpio === 0 && event.enabled)
  for (const time of target.time) {
    assert.equal(edges.filter(event => event.ns <= time * 1e9).at(-1)?.state, 1, 'log occurs after pin.on()')
    assert.equal(edges.find(event => event.ns > time * 1e9)?.state, 0, 'log occurs before pin.off()')
  }
  assert.equal(first.console, 'ordinary console\r\n')
})

test('scope logs survive console truncation and prints never become scope values', async () => {
  const trace = await runPico({ ...assets, durationSeconds: .5, source: `import scope
scope.log("counter", 1)
print('["fake", 42, "V"]')
print("x" * 17000)
scope.log("counter", 2)
` })
  assert.match(trace.console, /\[Console truncated\]/)
  assert.deepEqual(trace.scopeLogs?.map(channel => channel.values), [[1, 2]])
})

test('real scope API rejects invalid data and preserves user traceback line numbers', async () => {
  for (const call of ['scope.log("a", float("nan"))', 'scope.log("a", float("inf"))', 'scope.log("a", "one")', 'scope.log("", 1)']) {
    await assert.rejects(runPico({ ...assets, source: `import scope\n${call}` }), error => {
      assert.match(String(error), /File "main.py", line 2/)
      assert.match(String(error), /scope.log/)
      return true
    })
  }
  await assert.rejects(runPico({ ...assets, source: 'import scope\nscope.log("a", 1, "V")\nscope.log("a", 2, "A")' }), /same unit/)
  await assert.rejects(runPico({ ...assets, source: 'import scope\nfor i in range(17):\n    scope.log(str(i), i)' }), /channel limit/)
  const trace = await runPico({ ...assets, source: 'import scope\nscope.log("enabled", True)\nscope.log("enabled", False)\nprint("recovered")' })
  assert.deepEqual(trace.scopeLogs?.[0].values, [1, 0])
  assert.match(trace.console, /recovered/)
})
