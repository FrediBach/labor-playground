import type { CircuitDocument, CircuitExample, ComponentKind, Part } from './circuit.ts'
import type { AutomationProgram, CircuitTest, FlowDefinition, FlowNode, TestFixture } from './automation-graph.ts'
import { isSwitchKind } from './utility-cell-models.ts'

/** Private authoring helper: every named connection becomes a visible jumper.
 * Reserve whole strips before placing anything, then allocate separate holes
 * for leads and jumpers. Only the ordinary physical document is saved.
 */
function utilityBoard() {
  const document: CircuitDocument = {
    schemaVersion: 4, boardVersion: 'virtual-1', board: { columns: 60, rows: 3 },
    title: 'Cascadable 1U utility cells', parts: [], wires: [], probes: { CH1: null, CH2: null },
    instruments: { frequency: 100, amplitude: 1, waveform: 'sine', cv: 2 },
  }
  const entries: { part: Part; nets: string[] }[] = []
  const add = (id: string, kind: ComponentKind, value: number, nets: string[], group: string, position?: number) => {
    entries.push({ part: { id, kind, value, pins: [], schemaGroup: group, ...(position === undefined ? {} : { position }) }, nets })
  }
  const finish = () => {
    const reserved = new Set<string>(), nets = new Map<string, string[]>()
    const bank = (row: number) => row ? `r${row + 1}:` : ''
    // Packages first. The virtual adapters retain the real IC pin numbers.
    for (const entry of [...entries].sort((a, b) => Number(b.nets.length > 3) - Number(a.nets.length > 3))) {
      const dip = entry.nets.length > 3, width = dip ? entry.nets.length / 2 : entry.nets.length
      let pins: string[] | undefined
      for (let row = 0; row < 3 && !pins; row++) for (const side of dip ? ['top'] : ['top', 'bottom']) {
        for (let column = 1; column <= 61 - width; column++) {
          const strips = (dip ? ['top', 'bottom'] : [side]).flatMap(s => Array.from({ length: width }, (_, i) => `${row}:${s}:${column + i}`))
          if (strips.some(strip => reserved.has(strip))) continue
          strips.forEach(strip => reserved.add(strip))
          pins = dip
            ? [...Array.from({ length: width }, (_, i) => `${bank(row)}e${column + i}`), ...Array.from({ length: width }, (_, i) => `${bank(row)}f${column + width - 1 - i}`)]
            : entry.nets.map((_, i) => `${bank(row)}${side === 'top' ? 'a' : 'j'}${column + i}`)
          break
        }
        if (pins) break
      }
      if (!pins) throw new Error(`Utility example does not fit: ${entry.part.id}`)
      entry.part.pins = pins
      entry.nets.forEach((name, i) => nets.set(name, [...(nets.get(name) ?? []), pins[i]]))
    }
    document.parts = entries.map(entry => entry.part)
    const sources = ['vplus', 'vminus', 'gnd', 'osc', 'cv']
    const used = new Map<string, number>()
    const hole = (pin: string) => {
      if (sources.includes(pin)) return pin
      const match = /^(r[23]:)?([a-j])(\d+)$/.exec(pin)!
      const count = used.get(pin) ?? 0
      if (count >= 2) throw new Error('Example jumper exhausted its strip')
      used.set(pin, count + 1)
      return `${match[1] ?? ''}${'abcde'.includes(match[2]) ? ['b', 'c'][count] : ['h', 'i'][count]}${match[3]}`
    }
    for (const [name, pins] of nets) {
      const chain = sources.includes(name) ? [name, ...pins] : pins
      for (let i = 1; i < chain.length; i++) document.wires.push({
        id: `W${document.wires.length + 1}`, from: hole(chain[i - 1]), to: hole(chain[i]),
        color: name === 'gnd' ? '#6a839b' : name === 'vplus' || name === 'ref5' ? '#d98870' : name === 'vminus' || name === 'refn5' ? '#798bbf' : '#56c7c2',
      })
    }
    const terminal = (name: string) => {
      const pin = nets.get(name)?.[0]
      if (!pin) throw new Error(`Unknown example net ${name}`)
      return pin
    }
    document.probes = { CH1: terminal('A_out'), CH2: terminal('B_sum') }
    return { document, terminal }
  }
  return { add, finish }
}

function buildCells() {
  const b = utilityBoard()
  const ref = 'Shared references'
  b.add('UREF', 'opa4197', 1, ['ref5', 'ref5', 'rawref', 'vplus', 'gnd', 'refinv', 'refn5', 'clamp', 'clamp', 'divider', 'vminus', 'gnd', 'idle', 'idle'], ref)
  b.add('DREF', 'lm4040', 5, ['refnc', 'rawref', 'gnd'], ref)
  for (const [id, value, a, c] of [
    ['RREF1', 2200, 'vplus', 'rawref'], ['RREF2', 10_000, 'ref5', 'refinv'], ['RREF3', 10_000, 'refinv', 'refn5'],
    ['RREF4', 4640, 'ref5', 'divider'], ['RREF5', 5490, 'divider', 'gnd'],
  ] as const) b.add(id, 'resistor', value, [a, c], ref)
  for (const [i, net] of ['rawref', 'vplus', 'vminus'].entries()) b.add(`CREF${i + 1}`, 'capacitor', 100e-9, [net, 'gnd'], ref)

  for (const cell of ['A', 'B']) {
    const n = (net: string) => net === 'mixIn' ? cell === 'A' ? 'gnd' : 'A_forward' : ['gnd', 'vplus', 'vminus', 'ref5', 'refn5', 'clamp', 'osc', 'cv'].includes(net) ? net : `${cell}_${net}`
    const add = (id: string, kind: ComponentKind, value: number, nets: string[], group: string, position?: number) => b.add(`${cell}_${id}`, kind, value, nets.map(n), `${cell} · ${group}`, position)
    add('U1', 'opa4197', 1, ['x', 'x', 'input', 'vplus', 'gnd', 'N', 'control', 'v', 'tia', 'gnd', 'vminus', 'level', 'invert', 'w'], 'Input, LEVEL and VCA')
    add('U2', 'opa4197', 1, ['b', 'b', 'offset', 'vplus', 'average', 'pgain', 'p', 'driver', 'feedback', 'u', 'vminus', 'mixIn', 'm', 'm'], 'Offset, OUT and MIX input')
    add('U3', 'opa197', 1, ['nc1', 'sgain', 'saverage', 'vminus', 'nc5', 'S', 'vplus', 'nc8'], 'Positive SUM')
    add('U4', 'ssi2162', 1, ['mode', 'refin', 'vctl', 'N', 'gnd', 'vminus', 'tia', 'vctl', 'signal', 'vplus'], 'Linear VCA')
    add('Q1', 'pnp', 1, ['N', 'clamp', 'vctl'], 'VCA cutoff clamp')
    add('P1', 'potentiometer', 10_000, ['x', 'level', 'gnd'], 'LEVEL: −1 to +1', .75)
    add('P2', 'potentiometer', 100_000, ['refn5', 'offset', 'ref5'], 'OFFSET: −5 to +5 V', .5)
    add('SW1', 'dpdt', 0, ['p', 'u', 'x', 'gnd', 'q', 'p'], 'Mode: 0 PROCESS / 1 DIRECT')
    // Explicit switch contacts model patch insertion; jack sleeves share GND.
    b.add(`${cell}_IN`, 'spdt', cell === 'A' ? 1 : 0, [cell === 'A' ? 'gnd' : 'A_x', n('tip'), cell === 'A' ? 'osc' : 'cv'], `${cell} · IN: 0 normal / 1 patched`)
    add('CV', 'spdt', 0, ['ref5', 'cvtip', 'cv'], 'CV: 0 +5 V normal / 1 patched')
    add('SUM', 'switch', 1, ['sum', 'forward'], 'SUM: 1 normal / 0 patched')
    add('TAP', 'switch', 0, ['out', 'load'], 'OUT tap: 1 loads local OUT')
    add('RLOAD', 'resistor', 10_000, ['load', 'gnd'], 'OUT test load')
    if (cell === 'B') b.add(`${cell}_RLINK`, 'resistor', 1_000_000, [n('forward'), 'gnd'], `${cell} · Next MIX input load`)
    const resistors: [number, string, string][] = [
      [10_000, 'tip', 'input'], [10_000_000, 'tip', 'gnd'], [100_000, 'cvtip', 'N'], [100_000, 'refn5', 'refin'],
      [1000, 'control', 'vctl'], [110, 'refin', 'shunt1'], [110, 'signal', 'shunt2'], [10_000, 'w', 'signal'], [10_000, 'v', 'tia'],
      [10_000, 'x', 'invert'], [10_000, 'w', 'invert'], [10_000, 'v', 'average'], [10_000, 'b', 'average'], [10_000, 'p', 'pgain'], [10_000, 'pgain', 'gnd'],
      [100, 'driver', 'out'], [10_000, 'out', 'feedback'], [1_000_000, 'mixIn', 'gnd'],
      [10_000, 'm', 'saverage'], [10_000, 'q', 'saverage'], [10_000, 'S', 'sgain'], [10_000, 'sgain', 'gnd'], [100, 'S', 'sum'],
    ]
    resistors.forEach(([value, a, c], i) => {
      if (cell === 'A' && i === 17) return // First MIX is hard grounded; its parallel R18 is redundant.
      // R18 is the ONLY incoming pull-down: a broken normal leaves it at zero.
      const nets = [a, c].map(net => net === 'mixIn' ? cell === 'A' ? 'gnd' : 'A_forward' : n(net))
      b.add(`${cell}_R${i + 1}`, 'resistor', value, nets, `${cell} · ${i < 11 ? 'Input and VCA' : i < 17 ? 'Offset and OUT' : 'Positive SUM'}`)
    })
    const capacitors: [number, string, string][] = [
      [2.2e-9, 'shunt1', 'gnd'], [2.2e-9, 'shunt2', 'gnd'], [100e-12, 'N', 'control'], [100e-12, 'tia', 'v'], [1e-9, 'feedback', 'driver'],
    ]
    capacitors.forEach(([value, a, c], i) => add(`C${i + 1}`, 'capacitor', value, [a, c], 'Compensation'))
    for (let i = 0; i < 8; i++) add(`C${i + 6}`, 'capacitor', 100e-9, [i % 2 ? 'vminus' : 'vplus', 'gnd'], 'Supply bypass')
    add('C14', 'electrolytic', 10e-6, ['vplus', 'gnd'], 'Bulk supply')
    add('C15', 'electrolytic', 10e-6, ['gnd', 'vminus'], 'Bulk supply')
  }
  return b.finish()
}

function sequence(id: string, name: string, steps: FlowNode[]): FlowDefinition {
  const nodes: FlowNode[] = [{ id: 'Start', kind: 'start', label: 'Start', order: 0 }, ...steps, { id: 'Finish', kind: 'finish', label: 'Finish', order: steps.length + 1, outputs: {} }]
  return { id, name, inputs: [], outputs: [], nodes, conflictPolicy: 'error', layout: Object.fromEntries(nodes.map((n, i) => [n.id, { x: (i % 6) * 220, y: Math.floor(i / 6) * 160 }])), edges: nodes.slice(1).map((n, i) => ({ id: `E${i}`, source: nodes[i].id, target: n.id, outcome: nodes[i].kind === 'expect' ? 'passed' : 'done' })) }
}
const wait = (ms: number, order: number): FlowNode => ({ id: `Wait${order}`, kind: 'wait', label: `At ${ms} ms`, order, mode: 'time', seconds: ms / 1000, reference: 'capture' })
const action = (id: string, value: number, order: number, durationMs = 0): FlowNode => ({ id: `Action${order}`, kind: 'action', label: `${id} → ${value}`, order, action: { target: id.endsWith('P1') || id.endsWith('P2') ? 'potentiometer' : id === 'cv' ? 'cv' : 'switch', ...(id === 'cv' ? {} : { partId: id }), value, durationMs } })
const expect = (signalId: string, expected: number, ms: number, order: number, tolerance = .01): FlowNode => ({ id: `Expect${order}`, kind: 'expect', label: `${signalId} ≈ ${expected} V`, order, required: true, expectation: { kind: 'equal', observation: { signalId, statistic: 'sample', from: ms / 1000, to: ms / 1000, reference: 'capture' }, expected, absoluteTolerance: tolerance, relativeTolerance: 0 } })

function makeExample(): CircuitExample {
  const { document, terminal } = buildCells()
  const definitions: FlowDefinition[] = [sequence('Capture', 'Explore two utility cells', [
    wait(10, 1), action('A_P1', 1, 2, 10), wait(30, 3), action('A_P2', .6, 4, 5),
    wait(45, 5), action('A_SW1', 1, 6), wait(60, 7), action('A_SW1', 0, 8),
    wait(70, 9), action('A_SUM', 0, 10), wait(85, 11), action('B_IN', 1, 12),
  ])]
  const fixture = (): TestFixture => ({
    instruments: { ...document.instruments, cv: 2, amplitude: 0 },
    parts: document.parts.filter(p => p.kind === 'potentiometer' || isSwitchKind(p.kind)).map(p => ({ partId: p.id, kind: p.kind, ...(p.kind === 'potentiometer' ? { position: p.id.endsWith('P1') ? 1 : .5 } : { value: p.value }) })),
  })
  const tests: CircuitTest[] = []
  const addTest = (id: string, name: string, steps: FlowNode[], overrides: TestFixture['parts'] = [], cv = 2) => {
    const f = fixture(); f.instruments.cv = cv
    f.parts = f.parts.map(p => overrides.find(o => o.partId === p.partId) ?? p)
    definitions.push(sequence(id, name, steps))
    tests.push({ id: `Test_${id}`, name, enabled: true, tags: ['utility-cell'], flowId: id, durationSeconds: .1, fixture: f })
  }
  // Use the DC input through B_IN for repeatable tests of the complete B cell.
  const patchedB = { partId: 'B_IN', kind: 'spdt', value: 1 }
  addTest('Transfer', 'Signed LEVEL and offset after VCA', [
    expect('B_x', 2, 5, 1), expect('B_w', -2, 5, 2), expect('B_v', 2, 5, 3), expect('B_out', 2, 5, 4),
    action('B_P1', 0, 5), expect('B_out', -2, 15, 6), action('B_P1', .5, 7), expect('B_out', 0, 25, 8),
    action('B_P2', .75, 9), expect('B_out', 2.5, 35, 10), action('B_CV', 1, 11), action('cv', -2, 12), expect('B_out', 2.5, 50, 13),
  ], [patchedB])
  addTest('Vca', 'Linear CV: negative, zero, half and unity', [
    action('B_CV', 1, 1), expect('B_v', .8, 10, 2), action('cv', 0, 3), expect('B_v', 0, 25, 4),
    action('cv', -2.5, 5), expect('B_v', 0, 40, 6), action('cv', 2.5, 7), expect('B_v', 1.25, 55, 8),
    action('cv', 5, 9), expect('B_v', 5, 70, 10),
  ], [patchedB])
  addTest('Direct', 'DIRECT bypasses LEVEL, VCA and offset; excludes mix', [
    expect('B_out', 2, 10, 1), expect('B_q', 0, 10, 2), expect('B_sum', 0, 10, 3),
    action('B_SW1', 0, 4), expect('B_out', 2.5, 30, 5), expect('B_sum', 2.5, 30, 6),
  ], [patchedB, { partId: 'B_SW1', kind: 'dpdt', value: 1 }, { partId: 'B_P1', kind: 'potentiometer', position: .5 }, { partId: 'B_P2', kind: 'potentiometer', position: .75 }])
  addTest('Cascade', 'Positive sum, OUT tap and SUM break', [
    expect('B_sum', 3, 10, 1), action('A_TAP', 1, 2), expect('B_sum', 3, 25, 3),
    action('A_SUM', 0, 4), expect('B_m', 0, 40, 5), expect('B_sum', 2, 40, 6),
    action('A_SUM', 1, 7), expect('B_sum', 3, 55, 8), action('A_SW1', 1, 9), expect('B_sum', 2, 70, 10),
  ], [patchedB, { partId: 'A_P2', kind: 'potentiometer', position: .6 }])
  addTest('Source', 'IN override and raw SOURCE independence', [
    expect('B_x', 0, 10, 1), expect('A_out', 1, 10, 2), action('B_IN', 1, 3), expect('B_x', 2, 25, 4),
    action('A_P2', .7, 5), expect('B_x', 2, 40, 6), action('B_IN', 0, 7), expect('B_x', 0, 55, 8),
  ], [{ partId: 'A_P2', kind: 'potentiometer', position: .6 }])
  addTest('Offset', 'Offset source reaches both polarities', [
    expect('B_out', -5, 10, 1), action('B_P2', 1, 2), expect('B_out', 5, 30, 3),
  ], [patchedB, { partId: 'B_P1', kind: 'potentiometer', position: .5 }, { partId: 'B_P2', kind: 'potentiometer', position: 0 }])
  addTest('References', 'Shared +5 V, −5 V and clamp references', [
    expect('ref5', 5, 10, 1), expect('refn5', -5, 10, 2), expect('clamp', 5 * 5490 / (4640 + 5490), 10, 3),
  ])
  addTest('Range', 'Convert bipolar ±5 V into 0–5 V', [
    expect('B_out', 0, 10, 1), action('cv', 0, 2), expect('B_out', 2.5, 30, 3), action('cv', 5, 4), expect('B_out', 5, 50, 5),
  ], [patchedB, { partId: 'B_P1', kind: 'potentiometer', position: .75 }, { partId: 'B_P2', kind: 'potentiometer', position: .75 }], -5)
  const signalNames = ['ref5', 'refn5', 'clamp', ...['A', 'B'].flatMap(c => ['x', 'w', 'v', 'p', 'q', 'm', 'S', 'out', 'sum', 'vctl'].map(n => `${c}_${n}`))]
  const program: AutomationProgram = { version: 1, captureFlowId: 'Capture', definitions, tests, signals: signalNames.map(id => ({ id, name: id.replace('_', ' '), kind: 'voltage', positive: terminal(id), negative: 'gnd' })) }
  document.automationProgram = program
  document.documentation = { sections: [
    { id: 'design', kind: 'explanation', title: 'Cascadable 1U utility cell · v0.1', body: 'Implementation of Cascadable 1U Utility Cell Design.pdf (04 October 2026). Two complete DC-coupled cells share buffered +5 V, −5 V and +2.71 V references. Prefixes A_ and B_ identify the cell; R1–R23 and C1–C15 retain the proposal’s values. OPA197, OPA4197 and SSI2162 use explicit educational models on virtual breadboard adapters. Q1 uses the generic PNP model in place of a calibrated BC557.' },
    { id: 'equations', kind: 'explanation', title: 'Follow the signal', body: 'x is the buffered IN; LEVEL a = 2×P1−1; w = −a×x; g ≈ max(0,CV/5); v = −g×w; p = v+b, where b ≈ 10×P2−5. PROCESS sends p to local OUT and q; DIRECT sends x to OUT and grounds q. The positive adder gives S = incoming MIX + q. SOURCE always forwards x before processing and before the local OUT driver.' },
    { id: 'controls', kind: 'experiment', title: 'Patch and mode controls', body: 'A_IN/B_IN: throw 0 selects the left SOURCE normal (ground at cell A); throw 1 selects the patched source (OSC at A, CV at B). A_CV/B_CV: throw 0 selects the +5 V reference normal, throw 1 selects the CV instrument. SW1: throw 0 PROCESS, throw 1 DIRECT. SUM closed means no plug; open represents inserting a SUM plug and breaking forwarding. TAP closed connects a 10 kΩ test load to local OUT without changing either cascade. Select a switch on the board or in Overview and operate it in Inspector.' },
    { id: 'capture', kind: 'automation', targetId: 'Capture', title: 'Watch the default capture', body: 'CH1 is A OUT and CH2 is B SUM. At 10–20 ms A LEVEL rises from +0.5 to +1. At 30–35 ms A OFFSET rises to +1 V. At 45 ms A enters DIRECT and leaves the mix; at 60 ms it returns to PROCESS. At 70 ms A SUM breaks the mix link. At 85 ms B IN overrides SOURCE with +2 V. Each capture restarts from the saved controls. Disable or edit these steps in Automations → Flow for manual experiments.' },
    { id: 'tests', kind: 'experiment', title: 'Run the saved circuit tests', body: 'Automations → Tests → Run suite verifies signed LEVEL, linear CV and cutoff, offset after the VCA, DIRECT exclusion, positive mixing, local OUT taps, SUM break/rejoin, and independent SOURCE override. Tests freeze all controls and use terminal-bound signals, so moving CH1/CH2 does not change their meaning. DC checks allow 10 mV for finite amplifier gain, endpoint resistance, reference error and link loading. Additional numerical regressions cover +10 V CV, bipolar range conversion, supply faults and loaded outputs.' },
    { id: 'hardware', kind: 'note', title: 'Model and hardware limits', body: 'Retains both 110 Ω / 2.2 nF series input shunts, 100 pF feedback capacitors, local OUT feedback after its 100 Ω resistor, raw SUM feedback before its 100 Ω resistor, 100 nF bypasses and correctly polarized 10 µF bulk capacitors. A_R18 is omitted because the first MIX is hard grounded; B_R18 supplies the normal-break pull-down. B_RLINK represents the 1 MΩ input of a following cell. Model results do not validate cable-load stability, noise, distortion, resistor heating, short-circuit protection or panel fit. The OPA models omit current limiting and calibrated frequency response. Use the proposal’s conservative ±8 V accumulated-sum target; earlier clipping cannot be repaired by attenuating a later output. An unused PROCESS cell needs zero LEVEL and OFFSET.' },
  ] }
  for (const part of document.parts) document.documentation.sections.push({
    id: `part-${part.id}`, kind: 'component', targetId: part.id, title: `${part.id} · ${part.schemaGroup}`,
    body: `${part.schemaGroup}. ${part.id.startsWith('A_') || part.id.startsWith('B_') ? 'The suffix follows the component ledger in the proposal. ' : ''}Inspect this part to see its value, numbered connections and model limits.`,
  })
  for (const flow of definitions.filter(f => f.id !== 'Capture')) document.documentation.sections.push({
    id: `flow-${flow.id}`, kind: 'automation', targetId: flow.id, title: flow.name,
    body: 'Saved circuit test: ' + flow.name + '. Starts from its frozen fixture and checks solved terminal voltages with required expectations. Run it from Automations → Tests.',
  })
  const example: CircuitExample = {
    id: 'cascadable-utility-cell', name: 'Cascadable 1U utility cells', level: 'Advanced', document,
    description: 'Two DC-coupled signed VCAs with offset, DIRECT outputs and independent SOURCE/MIX cascades.',
    whatToChange: 'Run the default 100 ms capture, then open Automations → Tests and run the suite. Edit A_P1/B_P1 for LEVEL and A_P2/B_P2 for OFFSET. Operate the IN, CV, SW1, SUM and TAP switches using the control guide in Overview.',
    whatToObserve: 'CH1 follows A OUT; CH2 follows B SUM. DIRECT removes A from the mix while preserving its raw output. Opening A_SUM resets B’s incoming mix. Patching B_IN changes B’s source independently of the mix chain.',
    why: 'Each cell implements p = a×x×g+b with the proposal’s reference-channel SSI2162 feedback loop. Signed LEVEL precedes the VCA, offset follows it, and the two positive adders preserve polarity. Source forwarding comes from the input buffer; only the SUM normal breaks accumulated mixing.',
    hardware: 'Based on Cascadable 1U Utility Cell Design.pdf, v0.1, 04 October 2026. Use ±12 V, common ground and the shared reference board. Virtual adapters preserve IC pin numbers; switched jack contacts are explicit SPDT/SPST controls. Q1 is a generic PNP approximation. This example verifies nominal circuit function, not the document’s outstanding physical stability, noise, fault or mechanical checks.',
  }
  document.documentation.sections.unshift(...[
    ['purpose', 'What this circuit teaches', example.description], ['operation', 'How it works and why', example.why],
    ['experiment', 'Try it yourself', example.whatToChange], ['observations', 'What to observe', example.whatToObserve], ['build', 'Build on EDU LABOR', example.hardware],
  ].map(([id, title, body]) => ({ id, title, body, kind: 'explanation' as const })))
  return example
}

export const utilityCellExamples = [makeExample()]
