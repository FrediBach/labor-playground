import type { CircuitDocument, CircuitExample } from './circuit.ts'

const base = (title: string): CircuitDocument => ({
  schemaVersion: 1, boardVersion: 'virtual-1', title, parts: [], wires: [],
  probes: { CH1: null, CH2: null },
  instruments: { frequency: 220, amplitude: 5, waveform: 'square', cv: 5 },
})
const wires = (pairs: [string, string][]): CircuitDocument['wires'] => pairs.map(([from, to], i) => ({
  id: `W${i + 1}`, from, to, color: from === 'osc' ? '#56c7c2' : from === 'cv' || to.startsWith('tp') ? '#d98870' : from === 'eg' ? '#b899ce' : '#6a839b',
}))
const dip14 = (column: number) => [...Array.from({ length: 7 }, (_, i) => `e${column + i}`), ...Array.from({ length: 7 }, (_, i) => `f${column + 6 - i}`)]
const grounds = (pins: string[]): [string, string][] => [['gnd', 'tn1'], ...pins.map((pin, i): [string, string] => [pin, `tn${i + 2}`])]

export const synthLogicExamples: CircuitExample[] = [
  {
    id: 'clock-divider', name: 'CD4013 sub-octave divider', level: 'Intermediate',
    description: 'Divide a clock by two and four with two cascaded flip-flops.',
    whatToChange: 'Change oscillator frequency from 220 Hz to 440 Hz. Compare CH1 and CH2 frequencies, then try a slower clock for rhythmic division.',
    whatToObserve: 'CH1 is approximately 110 Hz and CH2 is approximately 55 Hz at the default input frequency. Both outputs swing between approximately 0 and 5 V.',
    why: 'Each inverted output feeds its own D input, so each positive clock edge toggles Q. The first Q clocks the second section, giving divide-by-two and divide-by-four. Equal resistors bias the bipolar oscillator into the logic supply range. The simulator resets Q low for 1 µs at capture start; real hardware requires an explicit reset for a predictable initial phase.',
    hardware: 'Use CD4013B DIP-14 on 5 V, with pin 14 at +5 V, pin 7 at ground, and 100 nF bypass. Tie both SET and RESET inputs low for normal operation. Wire /Q A pin 2 to D A pin 5, Q A pin 1 to CLK B pin 11, and /Q B pin 12 to D B pin 9. Feed a clean 0–5 V clock to pin 3. Use an external reset pulse for predictable hardware startup.',
    document: {
      ...base('CD4013 sub-octave divider'),
      parts: [
        { id: 'U1', kind: 'cd4013', value: 1, pins: dip14(11) },
        { id: 'R1', kind: 'resistor', value: 100_000, pins: ['a7', 'a13'] },
        { id: 'R2', kind: 'resistor', value: 100_000, pins: ['c8', 'c13'] },
      ],
      wires: wires([['cv', 'tp1'], ['j11', 'tp2'], ['b8', 'tp3'], ['osc', 'b7'], ['c12', 'c15'], ['b11', 'j14'], ['j13', 'j16'], ...grounds(['b17', 'b14', 'b16', 'j17', 'j15'])]),
      probes: { CH1: 'c11', CH2: 'j12' },
    },
  },
  {
    id: 'xor-ring-modulator', name: 'XOR digital ring modulator', level: 'Advanced',
    description: 'Combine two pulse trains to create a changing digital timbre.',
    whatToChange: 'Sweep oscillator frequency from 220 Hz to 440 Hz, or change C1 from 10 nF to 22 nF to lower the second clock frequency.',
    whatToObserve: 'CH1 is the biased oscillator pulse train. CH2 is high whenever the oscillator and the independent Schmitt clock disagree, creating a more complex pulse pattern.',
    why: 'A Schmitt RC oscillator supplies one XOR input. The workbench oscillator, biased to the 0–5 V range, supplies the other. XOR behaves like multiplication of two bipolar square waves after level conversion, producing a digital ring-modulation effect. It processes logic thresholds rather than preserving analog signal amplitude.',
    hardware: 'Use CD4070B and CD40106B on a common 5 V supply, each with 100 nF bypass. Connect the Schmitt output to XOR pin 2, the other 0–5 V pulse source to pin 1, and take the output from pin 3. Tie unused inputs low. For an audio output, add DC blocking, attenuation, and buffering; do not treat an XOR gate as a precision analog multiplier.',
    document: {
      ...base('XOR digital ring modulator'),
      parts: [
        { id: 'U1', kind: 'cd40106', value: 1, pins: dip14(3) },
        { id: 'U2', kind: 'cd4070', value: 1, pins: dip14(17) },
        { id: 'R1', kind: 'resistor', value: 100_000, pins: ['a3', 'a4'] },
        { id: 'C1', kind: 'capacitor', value: 10e-9, pins: ['c3', 'c7'] },
        { id: 'R2', kind: 'resistor', value: 100_000, pins: ['a12', 'a17'] },
        { id: 'R3', kind: 'resistor', value: 100_000, pins: ['c13', 'c17'] },
      ],
      wires: wires([['cv', 'tp1'], ['j3', 'tp2'], ['j17', 'tp3'], ['b13', 'tp4'], ['osc', 'b12'], ['c4', 'b18'], ...grounds(['b9', 'b5', 'b7', 'j8', 'j6', 'j4', 'b23', 'b21', 'b22', 'j23', 'j22', 'j19', 'j18'])]),
      probes: { CH1: 'b17', CH2: 'b19' },
    },
  },
  {
    id: 'and-clock-gate', name: 'AND gated clock', level: 'Intermediate',
    description: 'Let a clock through only while a manual gate is held high.',
    whatToChange: 'Toggle the manual Gate, then change oscillator frequency. The output stops low whenever the gate is released.',
    whatToObserve: 'With Gate high, CH2 follows the 0–5 V clock on CH1. With Gate low, CH2 stays at zero.',
    why: 'An AND gate is high only when both inputs are high. One input receives the biased clock and the other receives the manual gate. This makes a basic rhythmic enable. Changing enable in the middle of a clock pulse can shorten the output pulse; this is not a glitch-free clock-gating circuit.',
    hardware: 'Use CD4081B DIP-14, pin 14 at +5 V, pin 7 at ground, and a 100 nF bypass. Feed clock to pin 1 and enable to pin 2; output is pin 3. Define all unused inputs. For glitch-free clock control, synchronize enable before gating. Real CMOS gates have limited drive; buffer a heavily loaded output.',
    document: {
      ...base('AND gated clock'),
      instruments: { ...base('').instruments, envelope: { mode: 'gate', gateHigh: true, decayMs: 20 } },
      parts: [
        { id: 'U1', kind: 'cd4081', value: 1, pins: dip14(11) },
        { id: 'R1', kind: 'resistor', value: 100_000, pins: ['a6', 'a11'] },
        { id: 'R2', kind: 'resistor', value: 100_000, pins: ['c7', 'c11'] },
      ],
      wires: wires([['cv', 'tp1'], ['j11', 'tp2'], ['b7', 'tp3'], ['osc', 'b6'], ['eg', 'b12'], ...grounds(['b17', 'b15', 'b16', 'j17', 'j16', 'j13', 'j12'])]),
      probes: { CH1: 'b11', CH2: 'b13' },
    },
  },
  {
    id: 'opto-gate-input', name: 'Optocoupler gate receiver', level: 'Intermediate',
    description: 'Turn an LED drive pulse into an inverted gate on an isolated transistor output.',
    whatToChange: 'Increase R1 from 1 kΩ to 4.7 kΩ, then lower O1 current transfer ratio from 100% to 50%. Observe how weak optical drive raises the output low level.',
    whatToObserve: 'CH1 shows the LED drive pulse. CH2 normally rests near 5 V and falls while the LED conducts, with a short turn-on and release delay.',
    why: 'The LED drives the phototransistor without an internal electrical connection between the two sides. R2 pulls the collector high while the LED is dark. Illuminating the transistor sinks current and pulls the collector low, provided LED current times CTR is enough for the load. The example references both sides to workbench ground; the component model itself preserves their separation.',
    hardware: 'Use a PC817-family DIP-4 with a series resistor at LED pin 1 and LED cathode pin 2 returned to the input reference. Output emitter pin 3 goes to the output reference; collector pin 4 needs a pull-up. This example uses 1 kΩ LED resistance and a 10 kΩ pull-up to 5 V. Verify CTR bin, current, voltage, and switching speed for the chosen device. This is a gate receiver, not a validated MIDI input or isolation-safety design.',
    document: {
      ...base('Optocoupler gate receiver'),
      instruments: { ...base('').instruments, envelope: { mode: 'trigger', gateHigh: false, decayMs: 20 } },
      parts: [
        { id: 'O1', kind: 'pc817', value: 100, pins: ['e11', 'e12', 'f12', 'f11'] },
        { id: 'R1', kind: 'resistor', value: 1000, pins: ['a6', 'a11'] },
        { id: 'R2', kind: 'resistor', value: 10_000, pins: ['j6', 'j11'] },
      ],
      wires: wires([['eg', 'b6'], ['cv', 'i6'], ...grounds(['b12', 'j12'])]),
      probes: { CH1: 'c6', CH2: 'i11' },
    },
  },
]
