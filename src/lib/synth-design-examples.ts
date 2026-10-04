import type { CircuitDocument, CircuitExample, ComponentKind, Part } from './circuit.ts'

/** Example-only layout authoring. Named connections become ordinary visible
 * jumpers; saved documents and the compiler never see a second netlist format.
 * ICs occupy row 1; each passive has its own pair/triple of strips in row 2.
 */
function board(title: string) {
  const document: CircuitDocument = {
    schemaVersion: 1, boardVersion: 'virtual-1', board: { columns: 60, rows: 2 }, title,
    parts: [], wires: [], probes: { CH1: null, CH2: null },
    instruments: { frequency: 300, amplitude: 0.5, waveform: 'sine', cv: 0 },
  }
  const nets = new Map<string, string[]>()
  let chips = 0, passives = 0
  const connect = (name: string, pin: string) => nets.set(name, [...(nets.get(name) ?? []), pin])
  const add = (id: string, kind: ComponentKind, value: number, names: string[], group: string, position?: number) => {
    const dip = names.length >= 4
    const slot = dip ? chips++ * 12 + 3 : (passives++ % 14) * 4 + 3
    const side = passives <= 14 ? 'a' : 'j'
    const pins = dip
      ? [...Array.from({ length: names.length / 2 }, (_, i) => `e${slot + i}`), ...Array.from({ length: names.length / 2 }, (_, i) => `f${slot + names.length / 2 - 1 - i}`)]
      : names.map((_, i) => `r2:${side}${slot + i}`)
    const part: Part = { id, kind, value, pins, schemaGroup: group }
    if (position !== undefined) part.position = position
    document.parts.push(part)
    names.forEach((name, i) => connect(name, pins[i]))
  }
  const r = (id: string, value: number, a: string, b: string, group: string) => add(id, 'resistor', value, [a, b], group)
  const c = (id: string, value: number, a: string, b: string, group: string) => add(id, 'capacitor', value, [a, b], group)
  const finish = (ch1: string, ch2: string) => {
    const uses = new Map<string, number>()
    const hole = (pin: string) => {
      if (['osc', 'cv', 'gnd', 'vplus', 'vminus', 'eg'].includes(pin)) return pin
      const match = /^(r2:)?([a-j])(\d+)$/.exec(pin)!
      const count = uses.get(pin) ?? 0
      uses.set(pin, count + 1)
      return `${match[1] ?? ''}${'abcde'.includes(match[2]) ? ['b', 'c'][count] : ['h', 'i'][count]}${match[3]}`
    }
    for (const [name, pins] of nets) {
      const source = ['osc', 'cv', 'gnd', 'vplus', 'vminus', 'eg'].includes(name)
      const chain = source ? [name, ...pins] : pins
      for (let i = 1; i < chain.length; i++) document.wires.push({
        id: `W${document.wires.length + 1}`, from: hole(chain[i - 1]), to: hole(chain[i]),
        color: name === 'gnd' ? '#6a839b' : name === 'vplus' || name === 'cv' ? '#d98870' : name === 'vminus' ? '#798bbf' : '#56c7c2',
      })
    }
    const maxColumn = Math.max(...document.parts.flatMap(p => p.pins.map(pin => Number(/\d+$/.exec(pin)![0]))))
    document.board!.columns = maxColumn <= 30 ? 30 : maxColumn <= 45 ? 45 : 60
    const firstProbe = nets.get(ch1)?.[0], secondProbe = nets.get(ch2)?.[0]
    if (!firstProbe || !secondProbe) throw new Error(`Missing example probe connection: ${title}`)
    document.probes = { CH1: firstProbe, CH2: secondProbe }
    return document
  }
  return { document, add, r, c, finish }
}

function sem() {
  const b = board('SEM-inspired OTA state-variable filter')
  b.add('U1', 'quadopamp', 1, ['hp', 'sum', 'damp', 'vplus', 'int1', 'bp', 'bp', 'lp', 'lp', 'int2', 'vminus', 'gnd', 'idle', 'idle'], 'Summer and buffers')
  b.add('U2', 'lm13700', 1, ['bias1', 'diode1', 'gnd', 'drive1', 'int1', 'vminus', 'gnd', 'unused1', 'unused2', 'gnd', 'vplus', 'int2', 'drive2', 'gnd', 'diode2', 'bias2'], 'Voltage-controlled integrators')
  b.r('R1', 100_000, 'osc', 'sum', 'Summer and buffers')
  b.r('R2', 100_000, 'lp', 'sum', 'Summer and buffers')
  b.r('R3', 100_000, 'hp', 'sum', 'Summer and buffers')
  b.r('R4', 20_000, 'bp', 'damp', 'Resonance')
  b.r('R5', 10_000, 'damp', 'gnd', 'Resonance')
  for (const [i, input] of ['hp', 'bp'].entries()) {
    b.r(`R${6 + i * 3}`, 100_000, input, `drive${i + 1}`, 'Voltage-controlled integrators')
    b.r(`R${7 + i * 3}`, 1_000, `drive${i + 1}`, 'gnd', 'Voltage-controlled integrators')
    b.r(`R${8 + i * 3}`, 100_000, 'cv', `bias${i + 1}`, 'Cutoff bias')
    b.c(`C${i + 1}`, 10e-9, `int${i + 1}`, 'gnd', 'Voltage-controlled integrators')
  }
  b.c('C3', 100e-9, 'vplus', 'gnd', 'Supply bypass')
  b.c('C4', 100e-9, 'vminus', 'gnd', 'Supply bypass')
  return b.finish('bp', 'lp')
}

function ms20() {
  const b = board('MS-20-inspired resonant low-pass')
  b.add('U1', 'quadopamp', 1, ['pole1', 'pole1', 'cap1', 'vplus', 'cap2', 'lp', 'lp', 'res', 'feedback', 'resonance', 'vminus', 'gnd', 'idle', 'idle'], 'Buffers and resonance')
  b.add('U2', 'lm13700', 1, ['bias1', 'diode1', 'drive1', 'return1', 'cap1', 'vminus', 'gnd', 'unused1', 'unused2', 'gnd', 'vplus', 'cap2', 'return2', 'drive2', 'diode2', 'bias2'], 'OTA low-pass poles')
  for (const [i, input] of ['osc', 'pole1'].entries()) {
    const n = i + 1
    b.r(`R${1 + i * 5}`, 10_000, input, `drive${n}`, 'OTA low-pass poles')
    b.r(`R${2 + i * 5}`, 220, `drive${n}`, 'gnd', 'OTA low-pass poles')
    b.r(`R${3 + i * 5}`, 10_000, i === 0 ? 'pole1' : 'lp', `return${n}`, 'OTA low-pass poles')
    b.r(`R${4 + i * 5}`, 220, `return${n}`, 'gnd', 'OTA low-pass poles')
    b.r(`R${5 + i * 5}`, 220_000, 'cv', `bias${n}`, 'Cutoff bias')
    // The first timing capacitor returns to the resonance amplifier, NOT
    // ground. This frequency-dependent positive feedback is essential to
    // the late MS-20 topology; ordinary feedback into an OTA input differs.
    b.c(`C${n}`, 10e-9, `cap${n}`, i === 0 ? 'res' : 'gnd', 'OTA low-pass poles')
  }
  b.r('R11', 10_000, 'res', 'feedback', 'Resonance')
  b.r('R12', 1_800, 'feedback', 'gnd', 'Resonance')
  b.add('P1', 'potentiometer', 100_000, ['gnd', 'resonance', 'lp'], 'Resonance', 0.15)
  b.add('D1', 'led', 1, ['res', 'feedback'], 'Resonance limiter')
  b.add('D2', 'led', 1, ['feedback', 'res'], 'Resonance limiter')
  b.c('C3', 100e-9, 'vplus', 'gnd', 'Supply bypass')
  b.c('C4', 100e-9, 'vminus', 'gnd', 'Supply bypass')
  return b.finish('osc', 'lp')
}

function wasp() {
  const b = board('WASP-inspired CMOS state-variable filter')
  b.document.instruments = { frequency: 300, amplitude: 0.2, waveform: 'sine', cv: 5 }
  b.add('U1', 'cd4069', 1, ['sum', 'hp', 'int1', 'bp', 'int2', 'lp', 'gnd', 'nbp', 'invert', 'ref', 'refin', 'unused', 'gnd', 'cv'], 'CMOS amplifiers')
  b.add('U2', 'lm13700', 1, ['bias1', 'diode1', 'drive1', 'ref', 'int1', 'vminus', 'gnd', 'unused1', 'unused2', 'gnd', 'cv', 'int2', 'ref', 'drive2', 'diode2', 'bias2'], 'OTA integrators')
  b.r('R1', 1_000_000, 'ref', 'refin', 'Midrail reference')
  b.c('C0', 1e-6, 'osc', 'input', 'AC input')
  b.r('R2', 100_000, 'input', 'sum', 'State-variable summer')
  b.r('R3', 100_000, 'hp', 'sum', 'State-variable summer')
  b.r('R4', 100_000, 'lp', 'sum', 'State-variable summer')
  b.r('R5', 100_000, 'nbp', 'sum', 'Resonance')
  b.r('R6', 100_000, 'bp', 'invert', 'Resonance')
  b.r('R7', 100_000, 'nbp', 'invert', 'Resonance')
  for (const [i, input] of ['hp', 'bp'].entries()) {
    const n = i + 1
    b.r(`R${8 + i * 4}`, 51_000, input, `drive${n}`, 'OTA integrators')
    b.r(`R${9 + i * 4}`, 1_000, `drive${n}`, 'ref', 'OTA integrators')
    b.r(`R${10 + i * 4}`, 330_000, 'cv', `bias${n}`, 'Cutoff bias')
    b.r(`R${11 + i * 4}`, 1_000_000, `int${n}`, i === 0 ? 'bp' : 'lp', 'OTA integrators')
    b.c(`C${n}`, 10e-9, `int${n}`, i === 0 ? 'bp' : 'lp', 'OTA integrators')
  }
  b.c('C3', 100e-9, 'cv', 'gnd', 'Supply bypass')
  b.c('C4', 100e-9, 'vminus', 'gnd', 'Supply bypass')
  return b.finish('bp', 'lp')
}

function triangle() {
  const b = board('Triangle-core analog oscillator')
  b.document.instruments.envelope = { mode: 'trigger', gateHigh: false, decayMs: 20 }
  b.add('U1', 'lm393', 1, ['square', 'gnd', 'threshold', 'vminus', 'gnd', 'gnd', 'unused', 'vplus'], 'Schmitt comparator')
  b.add('U2', 'opamp', 1, ['triangle', 'integrator', 'gnd', 'vminus', 'gnd', 'idle', 'idle', 'vplus'], 'Integrator')
  b.r('R1', 100_000, 'square', 'integrator', 'Integrator')
  b.c('C1', 10e-9, 'triangle', 'integrator', 'Integrator')
  b.r('R2', 100_000, 'triangle', 'threshold', 'Schmitt comparator')
  b.r('R3', 200_000, 'square', 'threshold', 'Schmitt comparator')
  b.r('R4', 4_700, 'vplus', 'square', 'Output pull-ups')
  b.r('R5', 10_000, 'vplus', 'unused', 'Output pull-ups')
  b.r('R6', 1_000_000, 'eg', 'threshold', 'Startup trigger')
  b.r('R7', 10_000_000, 'triangle', 'integrator', 'Integrator DC return')
  b.c('C2', 100e-9, 'vplus', 'gnd', 'Supply bypass')
  b.c('C3', 100e-9, 'vminus', 'gnd', 'Supply bypass')
  return b.finish('triangle', 'square')
}

function saw() {
  const b = board('Constant-current sawtooth oscillator')
  b.document.instruments.cv = 5
  b.add('U1', 'timer555', 1, ['gnd', 'ramp', 'pulse', 'vplus', 'control', 'ramp', 'discharge', 'vplus'], 'Threshold and reset')
  b.add('Q1', 'pnp', 1, ['ramp', 'base', 'emitter'], 'Constant-current charge')
  b.r('R1', 22_000, 'vplus', 'emitter', 'Constant-current charge')
  b.r('R2', 10_000, 'vplus', 'base', 'Base reference')
  b.r('R3', 47_000, 'base', 'gnd', 'Base reference')
  b.r('R4', 1_000, 'ramp', 'discharge', 'Reset current limit')
  b.c('C1', 100e-9, 'ramp', 'gnd', 'Timing ramp')
  b.c('C2', 10e-9, 'control', 'gnd', 'Threshold bypass')
  b.c('C3', 100e-9, 'vplus', 'gnd', 'Supply bypass')
  return b.finish('ramp', 'pulse')
}

function lpg() {
  const b = board('Vactrol low-pass gate')
  b.document.instruments = { frequency: 1_000, amplitude: 2.5, waveform: 'sine', cv: 5, envelope: { mode: 'envelope', gateHigh: false, decayMs: 20 } }
  b.add('O1', 'vactrol', 1, ['led', 'gnd', 'filtered', 'osc'], 'Optical low-pass gate')
  b.r('R1', 680, 'eg', 'led', 'LED drive')
  b.r('R2', 100_000, 'filtered', 'gnd', 'Optical low-pass gate')
  b.c('C1', 100e-9, 'filtered', 'gnd', 'Optical low-pass gate')
  b.add('U1', 'opamp', 1, ['out', 'out', 'filtered', 'vminus', 'gnd', 'idle', 'idle', 'vplus'], 'Output buffer')
  b.c('C2', 100e-9, 'vplus', 'gnd', 'Supply bypass')
  b.c('C3', 100e-9, 'vminus', 'gnd', 'Supply bypass')
  return b.finish('osc', 'out')
}

function slew() {
  const b = board('Asymmetric slew / portamento')
  b.document.stimulus = 'step'
  b.document.instruments.amplitude = 5
  b.add('U1', 'quadopamp', 1, ['out', 'out', 'lag', 'vplus', 'gnd', 'idle1', 'idle1', 'idle2', 'idle2', 'gnd', 'vminus', 'gnd', 'idle3', 'idle3'], 'Output buffer')
  b.add('D1', 'diode', 1, ['osc', 'rise'], 'Rise')
  b.r('R1', 10_000, 'rise', 'lag', 'Rise')
  b.r('R2', 100_000, 'osc', 'lag', 'Fall and DC path')
  b.c('C1', 100e-9, 'lag', 'gnd', 'Slew capacitor')
  b.c('C2', 100e-9, 'vplus', 'gnd', 'Supply bypass')
  b.c('C3', 100e-9, 'vminus', 'gnd', 'Supply bypass')
  return b.finish('osc', 'out')
}

const bipolar = 'Use ±12 V and a shared signal ground. Add 100 nF bypass capacitors at each physical IC supply pin. Models omit device tolerances, noise and temperature drift.'
export const synthDesignExamples: CircuitExample[] = [
  {
    id: 'sem-filter', name: 'SEM-inspired OTA state-variable filter', level: 'Advanced',
    description: 'Compare simultaneous band-pass and low-pass outputs from a two-integrator synth VCF.',
    whatToChange: 'Sweep OSC from 80 Hz to 1.2 kHz. Change CV from −5 V to +5 V to raise cutoff. Increase R4 from 20 kΩ to 47 kΩ for more resonance. Probe U1 pin 1 for high-pass.',
    whatToObserve: 'CH1 is band-pass and CH2 is low-pass, near a few hundred hertz at 0 V CV. Their relative amplitudes exchange as frequency crosses the filter center. Higher CV raises the center; larger R4 sharpens the resonant peak.',
    why: 'The SEM family uses a state-variable loop. Here a summer drives two inverting OTA integrators with separate buffers; band-pass feedback sets damping and low-pass feedback closes the loop. With equal integrators, f0 ≈ gm × input-divider ratio / (2πC) and Q ≈ (R4 + R5)/(3R5). This is an educational LM13700/TL074 adaptation, not an original SEM clone or a calibrated 1 V/octave VCF. Resistor-fed IABC remains nonzero at 0 V CV.',
    hardware: `${bipolar} U2 is an LM13700; its Darlington buffers and linearizing diodes are unused. The two integrators need matched capacitors and bias currents for an accurate response.`, document: sem(),
  },
  {
    id: 'ms20-filter', name: 'MS-20-inspired resonant low-pass', level: 'Advanced',
    description: 'Explore two OTA low-pass stages with diode-limited resonant feedback.',
    whatToChange: 'Sweep OSC frequency and turn P1 from 15% toward 25% (try 40% for self-oscillation). Change CV between −5 V and +5 V. Compare small inputs with 2 V amplitude.',
    whatToObserve: 'CH1 is the input; CH2 is a two-pole low-pass output. Resonance emphasizes the cutoff region and the opposing LEDs limit large feedback swings. Stronger feedback can enter sustained oscillation.',
    why: 'This follows the late MS-20 family and René Schmitz’s op-amp-buffered adaptation: local OTA feedback makes each low-pass pole, while an amplified second-stage signal drives the return end of the first timing capacitor. This capacitive positive feedback reduces damping; small-signal Q is approximately 1/(2 − K), where K is the resonance-amplifier gain times P1’s fraction. It differs from the existing Sallen–Key example and from the early Korg-35 filter. The LM13700, red LED limiter, larger capacitors and simple resistor bias are educational substitutions; the exponential CV converter and separate high-pass section are omitted. Reference: https://www.schmitzbits.de/ms20.html',
    hardware: `${bipolar} Connect LM13700 supplies and unused inputs as shown. P1 sets feedback amount, not cutoff. Real red LEDs and the reference design’s green LEDs limit at different voltages.`, document: ms20(),
  },
  {
    id: 'wasp-filter', name: 'WASP-inspired CMOS state-variable filter', level: 'Advanced',
    description: 'Use unbuffered CMOS inverters as analog amplifiers in an OTA filter loop.',
    whatToChange: 'Keep CV at +5 V: it powers the CMOS chip. Sweep OSC from 80 Hz to 1.2 kHz, then increase amplitude from 0.2 V to 2 V. Change both R10/R14 from 330 kΩ to 680 kΩ to lower cutoff; increase R5 to reduce damping.',
    whatToObserve: 'CH1 is band-pass and CH2 low-pass, both centered near +2.5 V. Increasing input level exposes CMOS compression and rail limiting. The two bias resistors move the filter center together.',
    why: 'The WASP uses CD4069UB inverters as analog amplifiers, with OTA integrators. A self-biased inverter establishes midrail, the input capacitor blocks DC, and the summer plus two integrators forms a state-variable loop. The finite CMOS gain and nonlinear transfer differ from op-amp feedback. This simplified adaptation uses an LM13700 on +5/−12 V, explicit leaky integrators and resistor cutoff control. It omits the original distortion switch, output mixer and CV converter. Its model demonstrates the topology, not the exact WASP timbre. Reference: https://www.schmitzbits.de/wasp.html',
    hardware: 'Use CD4069UB (unbuffered), not CD40106 or a buffered inverter. Pin 14 receives a regulated +5 V supply and pin 7 ground. The LM13700 uses +5 V and −12 V. Bypass both chips locally. The raw outputs have a DC offset: AC-couple and buffer them before patching audio hardware.', document: wasp(),
  },
  {
    id: 'triangle-core', name: 'Triangle-core analog oscillator', level: 'Advanced',
    description: 'An integrator and hysteretic comparator make simultaneous triangle and square waves.',
    whatToChange: 'Change C1 from 10 nF to 22 nF to slow both waves. Change R3 from 200 kΩ to 300 kΩ to reduce triangle amplitude and raise frequency. Use longer captures for slower timing values.',
    whatToObserve: 'CH1 ramps up and down; CH2 flips when the triangle reaches each threshold. The frequency is roughly 500 Hz. Unequal comparator output swings cause a small slope and duty-cycle asymmetry.',
    why: 'The comparator’s positive feedback establishes thresholds near half its output level. The op-amp integrates that output until the opposite threshold is reached. Ideally f ≈ 1/(4βR1C1), where β = R2/R3. R7 supplies a weak DC return for the integrator. The visible EG trigger through R6 nudges the otherwise noiseless model out of equilibrium; it is not the oscillator clock. This is a fixed-frequency core without an exponential converter.',
    hardware: `${bipolar} The LM393 has open-collector outputs, so retain R4/R5 pull-ups. Real oscillators normally start from offset and noise; the model uses the explicit trigger. Check comparator output range before connecting a logic input.`, document: triangle(),
  },
  {
    id: 'current-saw-core', name: 'Constant-current sawtooth oscillator', level: 'Intermediate',
    description: 'Charge a capacitor with a PNP current source and reset it quickly with a 555.',
    whatToChange: 'Change C1 from 100 nF to 220 nF. Change R1 from 22 kΩ to 47 kΩ to reduce charging current and frequency. Compare the ramp with the existing resistor-charged 555 clock example.',
    whatToObserve: 'CH1 rises almost linearly between about 4 V and 8 V, then resets rapidly. CH2 is high through the charging interval with a short low reset pulse. Frequency is around 170 Hz initially.',
    why: 'Q1 and R1 approximately set I = (12 V − Vbase − VBE)/R1; R2/R3 hold the base near 9.9 V. R4 limits reset current. The 555 switches its discharge transistor on at 2/3 supply and off at 1/3 supply. Between resets dV/dt = I/C, so f ≈ I/(4 V × C1). This current ramp is different from the exponential ramp in a resistor-charged astable. It is a fixed-frequency ramp core without temperature compensation, 1 V/octave tracking or a centered audio output.',
    hardware: 'Use a PNP with its actual collector/base/emitter pinout checked against the virtual C–B–E order. Supply the 555 from +12 V, with RESET high and both bypass capacitors fitted. Buffer and remove DC from the ramp before patching audio hardware.', document: saw(),
  },
  {
    id: 'vactrol-lpg', name: 'Vactrol low-pass gate', level: 'Intermediate',
    description: 'A plucked envelope changes loudness and brightness together through an optical resistor.',
    whatToChange: 'Compare C1 at 100 nF and 10 nF; increase EG decay from 20 ms to 40 ms. Sweep oscillator frequency while retaining the same envelope.',
    whatToObserve: 'CH1 stays constant; CH2 opens into a short tone then becomes quieter and darker. A smaller capacitor lets more high-frequency signal through. Optical release continues after the driving envelope falls.',
    why: 'Unlike the existing optical audio gate, this circuit has a shunt capacitor. The changing LDR resistance and C1 move a low-pass corner while R2 also sets low-frequency attenuation. The op-amp isolates the filter from its output load. This is a first-order vactrol LPG inspired by the family of Buchla-style low-pass gates, not a reproduction of the multi-pole 292 circuit or a calibrated vactrol.',
    hardware: `${bipolar} The optical part uses a virtual DIP-4 adapter; check the real LED/LDR pinout. Keep the 680 Ω LED resistor and remember that real vactrol attack/release times vary widely.`, document: lpg(),
  },
  {
    id: 'asymmetric-slew', name: 'Asymmetric slew / portamento', level: 'Intermediate',
    description: 'Smooth rising and falling CV changes at different rates with a buffered diode-RC network.',
    whatToChange: 'Change R2 from 100 kΩ to 220 kΩ for a slower fall. Change R1 from 10 kΩ to 47 kΩ for a slower initial rise. Replace the step source with periodic input to explore audio filtering.',
    whatToObserve: 'CH1 jumps to 5 V and back; CH2 initially rises quickly, approaches the final value more slowly, and falls exponentially with a roughly 10 ms time constant.',
    why: 'On a rising edge, D1 enables the lower-resistance R1 path. Near the target the diode stops conducting and R2 finishes charging C1. On a falling edge only R2 discharges it. The follower prevents a patch load from altering the timing. This is exponential portamento, not a constant-slope slew generator; the diode does not impose a permanent DC error because R2 remains connected.',
    hardware: `${bipolar} Orient D1’s cathode toward R1. Use a low-leakage capacitor and a FET-input op-amp for CV work; this simple utility has no calibrated musical glide law.`, document: slew(),
  },
]
