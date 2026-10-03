import type { CircuitDocument, CircuitExample } from './circuit.ts'

const base = (title: string): CircuitDocument => ({
  schemaVersion: 1, boardVersion: 'virtual-1', title, parts: [], wires: [],
  probes: { CH1: null, CH2: null },
  instruments: { frequency: 220, amplitude: 0.5, waveform: 'sine', cv: 5 },
})
const wires = (pairs: [string, string][]): CircuitDocument['wires'] => pairs.map(([from, to], i) => ({ id: `W${i + 1}`, from, to, color: '#6a839b' }))

export const synthExamples: CircuitExample[] = [
  {
    id: 'jfet-buffer', name: 'JFET source follower', level: 'Intermediate',
    description: 'Buffer a small audio signal with a self-biased, high-impedance JFET stage.',
    whatToChange: 'Change R1 from 2.2 kΩ to 4.7 kΩ, or increase oscillator amplitude from 0.5 V to 2 V.',
    whatToObserve: 'CH2 follows CH1 with gain slightly below one and a positive DC offset. Large negative excursions drive the transistor toward cutoff.',
    why: 'The normally-on JFET develops a positive source voltage across R1. This makes gate-to-source voltage negative and establishes self-bias. Negative feedback through the source resistor reduces gain and output impedance. This is a buffer, not a precision CV follower: its DC offset depends strongly on the selected transistor.',
    hardware: 'Use an N-channel depletion JFET, check its actual pinout, and expect substantial IDSS and pinch-off variation. The virtual D–G–S device is generic. Use 2.2 kΩ from source to ground, 1 MΩ from gate to ground, and a 100 nF supply bypass. AC-couple the output when the next stage requires zero DC offset.',
    document: {
      ...base('JFET source follower'),
      parts: [
        { id: 'J1', kind: 'njfet', value: 1, pins: ['c10', 'c11', 'c12'] },
        { id: 'R1', kind: 'resistor', value: 2200, pins: ['a12', 'a16'] },
        { id: 'R2', kind: 'resistor', value: 1e6, pins: ['a11', 'a18'] },
      ],
      wires: wires([['vplus', 'b10'], ['osc', 'b11'], ['gnd', 'tn10'], ['b16', 'tn11'], ['b18', 'tn12']]),
      probes: { CH1: 'd11', CH2: 'd12' },
    },
  },
  {
    id: 'mosfet-gate-inverter', name: 'MOSFET gate inverter', level: 'Intermediate',
    description: 'Turn a 0–5 V control into an inverted gate with a pull-up and an enhancement MOSFET.',
    whatToChange: 'Set CV to 0 V, then 5 V. Sweep slowly through 2 V to see the turn-on threshold. Change R1 to 1 kΩ and compare the low output voltage.',
    whatToObserve: 'CH2 is near +12 V with CV at zero and near ground with CV at 5 V. The loaded low level is finite because the transistor has on resistance.',
    why: 'Below threshold the MOSFET is off, so R1 pulls the drain high. Positive gate-to-source voltage turns on the channel and sinks current. The insulated gate draws essentially no steady current, but its capacitance still requires current during transitions.',
    hardware: 'Choose an N-channel small-signal enhancement MOSFET with suitable voltage ratings and check its actual pinout. Use a 10 kΩ drain pull-up and 1 MΩ gate pull-down. This generic model is not a guaranteed 2N7000 substitution. The 12 V output needs level shifting before a 3.3 V GPIO.',
    document: {
      ...base('MOSFET gate inverter'),
      instruments: { ...base('').instruments, cv: 0 },
      parts: [
        { id: 'M1', kind: 'nmos', value: 1, pins: ['c10', 'c11', 'c12'] },
        { id: 'R1', kind: 'resistor', value: 10_000, pins: ['a6', 'a10'] },
        { id: 'R2', kind: 'resistor', value: 1e6, pins: ['a11', 'a18'] },
      ],
      wires: wires([['vplus', 'b6'], ['cv', 'b11'], ['gnd', 'tn10'], ['b12', 'tn11'], ['b18', 'tn12']]),
      probes: { CH1: 'd11', CH2: 'd10' },
    },
  },
  {
    id: 'comparator-gate', name: 'Comparator audio-to-gate', level: 'Intermediate',
    description: 'Extract a 0–5 V gate from a biased audio waveform using an open-collector comparator.',
    whatToChange: 'Change the oscillator waveform or frequency. Increase R1 from 10 kΩ to 100 kΩ and inspect the output edges.',
    whatToObserve: 'CH2 is high while CH1 exceeds 2.5 V and low below it. The high voltage comes from the 5 V pull-up, while the comparator uses a 0–12 V supply.',
    why: 'The comparator sinks output current when its inverting input exceeds its noninverting input. It releases the output for the opposite comparison. R1 then raises the output to CV. Two resistor dividers bias the audio and set the comparison threshold at half CV. Output capacitance and the finite comparison response round the edges. External positive feedback can add hysteresis for noisy signals.',
    hardware: 'LM393 DIP-8: pin 8 to +12 V, pin 4 to ground; add a 100 nF bypass capacitor. Use a 10 kΩ pull-up from pin 1 to regulated +5 V. Bias pin 3 with equal 100 kΩ resistors to audio and +5 V; set pin 2 to 2.5 V with two 100 kΩ divider resistors. Define the unused inputs. Check common-mode limits and output levels before connecting other equipment.',
    document: {
      ...base('Comparator audio-to-gate'),
      instruments: { ...base('').instruments, amplitude: 2.5 },
      parts: [
        { id: 'U1', kind: 'lm393', value: 1, pins: ['e11', 'e12', 'e13', 'e14', 'f14', 'f13', 'f12', 'f11'] },
        { id: 'R1', kind: 'resistor', value: 10_000, pins: ['a6', 'a11'] },
        { id: 'R2', kind: 'resistor', value: 10_000, pins: ['j6', 'j12'] },
        { id: 'R3', kind: 'resistor', value: 100_000, pins: ['a5', 'a13'] },
        { id: 'R4', kind: 'resistor', value: 100_000, pins: ['c6', 'c13'] },
        { id: 'R5', kind: 'resistor', value: 100_000, pins: ['c8', 'c12'] },
        { id: 'R6', kind: 'resistor', value: 100_000, pins: ['d12', 'd18'] },
      ],
      wires: wires([['vplus', 'j11'], ['a14', 'tn13'], ['gnd', 'tn10'], ['cv', 'tp10'], ['b6', 'tp11'], ['i6', 'tp12'], ['b8', 'tp14'], ['b18', 'tn11'], ['j14', 'tn12'], ['j13', 'tp13'], ['osc', 'b5']]),
      probes: { CH1: 'b13', CH2: 'b11' },
    },
  },
  {
    id: 'analog-track-hold', name: 'CD4066 track-and-hold', level: 'Advanced',
    description: 'Sample a biased audio signal onto a capacitor, then watch it hold and slowly droop.',
    whatToChange: 'Change C1 from 10 nF to 100 nF for a slower acquisition and longer hold. In the envelope controls choose Gate and hold it high to track continuously.',
    whatToObserve: 'CH2 follows CH1 during the 1–2 ms trigger pulse, then holds near the sampled voltage and slowly decays through R3 and switch leakage.',
    why: 'R1 and R2 bias the bipolar oscillator into the 0–5 V signal range. The enabled bilateral switch charges C1 through the source impedance and its own on resistance. When disabled, finite off resistance and R3 cause droop. A practical sample-and-hold also needs a high-input-impedance output buffer.',
    hardware: 'CD4066B DIP-14: pin 14 to +5 V, pin 7 to ground; fit a 100 nF bypass. Channel A is pins 1–2, enabled by pin 13. Keep all signals and enables between the rails and tie unused enables low. Use 10 kΩ for R1/R2, 10 MΩ for R3, and 10 nF for C1. Charge injection and dielectric absorption are outside this approximation.',
    document: {
      ...base('CD4066 track-and-hold'),
      instruments: { frequency: 220, amplitude: 2, waveform: 'sine', cv: 5, envelope: { mode: 'trigger', gateHigh: false, decayMs: 20 } },
      parts: [
        { id: 'U1', kind: 'cd4066', value: 1, pins: ['e11', 'e12', 'e13', 'e14', 'e15', 'e16', 'e17', 'f17', 'f16', 'f15', 'f14', 'f13', 'f12', 'f11'] },
        { id: 'R1', kind: 'resistor', value: 10_000, pins: ['a5', 'a11'] },
        { id: 'R2', kind: 'resistor', value: 10_000, pins: ['c6', 'c11'] },
        { id: 'C1', kind: 'capacitor', value: 10e-9, pins: ['a12', 'a20'] },
        { id: 'R3', kind: 'resistor', value: 10e6, pins: ['c12', 'c20'] },
      ],
      wires: wires([['cv', 'tp10'], ['gnd', 'tn1'], ['osc', 'b5'], ['b6', 'tp11'], ['j11', 'tp12'], ['eg', 'j12'], ['b20', 'tn2'], ['b13', 'tn3'], ['b14', 'tn4'], ['b15', 'tn5'], ['b16', 'tn6'], ['b17', 'tn7'], ['j17', 'tn8'], ['j16', 'tn9'], ['j15', 'tn10'], ['j14', 'tn11'], ['j13', 'tn12']]),
      probes: { CH1: 'b11', CH2: 'b12' },
    },
  },
]
