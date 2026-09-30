import type { CircuitDocument, CircuitExample } from './circuit.ts'

const baseDocument = (title: string): CircuitDocument => ({
  schemaVersion: 1, boardVersion: 'virtual-1', title,
  parts: [], wires: [], probes: { CH1: null, CH2: null },
  instruments: { frequency: 220, amplitude: 2.5, waveform: 'sine', cv: 5 },
})

const timerPins = ['e13', 'e14', 'e15', 'e16', 'f16', 'f15', 'f14', 'f13']
const timerParts: CircuitDocument['parts'] = [
  { id: 'U1', kind: 'timer555', value: 1, pins: timerPins },
  { id: 'C2', kind: 'capacitor', value: 10e-9, pins: ['j16', 'j20'] },
  { id: 'C3', kind: 'capacitor', value: 100e-9, pins: ['h9', 'h13'] },
]
const timerWires: CircuitDocument['wires'] = [
  { id: 'W1', from: 'vplus', to: 'tp10', color: '#d98870' },
  { id: 'W2', from: 'gnd', to: 'tn10', color: '#6a839b' },
  { id: 'W3', from: 'j13', to: 'tp13', color: '#d98870' },
  { id: 'W4', from: 'b16', to: 'tp12', color: '#d98870' },
  { id: 'W5', from: 'b13', to: 'tn13', color: '#6a839b' },
  { id: 'W6', from: 'i20', to: 'tn12', color: '#6a839b' },
  { id: 'W7', from: 'j9', to: 'tn9', color: '#6a839b' },
]

export const icExamples: CircuitExample[] = [
  {
    id: '555-astable', name: '555 clock oscillator', level: 'Intermediate',
    description: 'Make a free-running synth clock with a 555 timer and an external RC network.',
    whatToChange: 'Change C1 from 100 nF to 220 nF, then change R1 from 10 kΩ to 22 kΩ.',
    whatToObserve: 'CH1 charges and discharges between about 4 V and 8 V. CH2 switches between about 0.1 V and 10.8 V at roughly 480 Hz, with a two-thirds high duty cycle. A larger C1 lowers the frequency; a larger R1 lengthens only the high portion.',
    why: 'R1 and R2 charge C1 while OUT is high. At two-thirds of VCC, THRESH resets the latch and DISCH drains C1 through R2. When TRIG falls below one-third of VCC, the latch sets again. Frequency is approximately 1.44 / ((R1 + 2 × R2) × C1), with high time 0.693 × (R1 + R2) × C1 and low time 0.693 × R2 × C1. The control-pin capacitor filters the threshold reference. Capture includes a brief model startup reset, so measure settled cycles.',
    hardware: 'Use a DIP-8 NE555 on +12 V: pin 1 GND, pin 8 VCC, pin 4 RESET tied high. Use two 10 kΩ resistors, a 100 nF timing capacitor, 10 nF from CTRL pin 5 to GND, and 100 nF supply bypass close to the IC. This is a unipolar clock; check the receiving module’s input range before connecting it. The educational timer model does not predict exact device output drive or supply noise.',
    document: {
      ...baseDocument('555 clock oscillator'),
      parts: [
        ...structuredClone(timerParts),
        { id: 'R1', kind: 'resistor', value: 10_000, pins: ['j7', 'j11'] },
        { id: 'R2', kind: 'resistor', value: 10_000, pins: ['h14', 'h18'] },
        { id: 'C1', kind: 'capacitor', value: 100e-9, pins: ['g18', 'g22'] },
      ],
      wires: [
        ...structuredClone(timerWires),
        { id: 'W8', from: 'i7', to: 'tp7', color: '#d98870' },
        { id: 'W9', from: 'i11', to: 'i14', color: '#c8a55b' },
        { id: 'W10', from: 'j18', to: 'a14', color: '#c8a55b' },
        { id: 'W11', from: 'i18', to: 'j15', color: '#c8a55b' },
        { id: 'W12', from: 'j22', to: 'tn14', color: '#6a839b' },
      ],
      probes: { CH1: 'i18', CH2: 'b15' },
    },
  },
  {
    id: '555-monostable', name: '555 trigger-to-pulse', level: 'Intermediate',
    description: 'Turn a falling gate edge into a fixed-length positive pulse.',
    whatToChange: 'Capture the built-in 5 V step, then change timing resistor R1 from 100 kΩ to 220 kΩ.',
    whatToObserve: 'CH1 briefly dips from 5 V toward 0 V when the gate falls at 51 ms. CH2 goes high to about 3.8 V for 11 ms, then returns low. Increasing R1 stretches the pulse to about 24 ms.',
    why: 'C4 couples the falling gate edge to TRIG, while R2 quickly pulls TRIG back to 5 V. R3 limits edge current and D1 clamps the positive edge near the supply. Triggering releases DISCH and lets C1 charge through R1; THRESH ends the pulse at two-thirds of VCC. Pulse length is approximately 1.1 × R1 × C1. The input trigger returns high before the timing interval ends, so holding the original gate does not determine the pulse length.',
    hardware: 'Power a DIP-8 NE555 from a measured +5 V source and GND; tie RESET pin 4 to +5 V. Use R1 100 kΩ, R2 10 kΩ, R3 1 kΩ, C1/C3 100 nF, C2/C4 10 nF, and a 1N4148 with its striped cathode toward +5 V. A 5 V gate’s falling edge triggers the circuit. Keep the supply bypass close to the IC. The model approximates thresholds and timing; real output swing depends on the load.',
    document: {
      ...baseDocument('555 trigger-to-pulse'),
      stimulus: 'step',
      instruments: { frequency: 100, amplitude: 5, waveform: 'square', cv: 5 },
      parts: [
        ...structuredClone(timerParts),
        { id: 'R1', kind: 'resistor', value: 100_000, pins: ['j7', 'j14'] },
        { id: 'C1', kind: 'capacitor', value: 100e-9, pins: ['h14', 'h18'] },
        { id: 'R2', kind: 'resistor', value: 10_000, pins: ['a9', 'a14'] },
        { id: 'R3', kind: 'resistor', value: 1_000, pins: ['a3', 'a6'] },
        { id: 'C4', kind: 'capacitor', value: 10e-9, pins: ['c6', 'c14'] },
        { id: 'D1', kind: 'diode', value: 1, pins: ['d14', 'd10'] },
      ],
      wires: [
        ...structuredClone(timerWires).map((wire) => wire.id === 'W1' ? { ...wire, from: 'cv' } : wire),
        { id: 'W8', from: 'i7', to: 'tp7', color: '#d98870' },
        { id: 'W9', from: 'i14', to: 'j15', color: '#c8a55b' },
        { id: 'W10', from: 'j18', to: 'tn14', color: '#6a839b' },
        { id: 'W11', from: 'b9', to: 'tp9', color: '#d98870' },
        { id: 'W12', from: 'b10', to: 'tp11', color: '#d98870' },
        { id: 'W13', from: 'osc', to: 'b3', color: '#56c7c2' },
      ],
      probes: { CH1: 'b14', CH2: 'b15' },
    },
  },
  {
    id: 'quad-buffer', name: 'TL074 buffered signal splitter', level: 'Intermediate',
    description: 'Use all four amplifiers to make buffered positive and inverted copies of an audio or CV signal.',
    whatToChange: 'Change R2 from 100 kΩ to 200 kΩ, then reduce the oscillator frequency to see the same operation on a slow modulation signal.',
    whatToObserve: 'CH1 and CH2 initially have equal 2.5 V peak amplitudes and opposite polarity. With R2 at 200 kΩ, CH2 doubles to about 5 V peak while CH1 stays at 2.5 V.',
    why: 'U1A buffers the input. U1B inverts it with gain −R2/R1. U1C and U1D are output followers for the positive and negative copies, so all four amplifier sections have defined input connections. This utility passes DC and audio. Negative feedback sets the gains, and the educational model clips about 1 V inside the connected supply rails; it does not model bandwidth, slew rate, or the TL074’s input common-mode range.',
    hardware: 'Use a DIP-14 TL074 with pin 4 at +12 V and pin 11 at −12 V. Use two 100 kΩ resistors, plus a 100 nF bypass capacitor from each supply to GND near the IC. Confirm the DIP-14 pin numbering: its supply pins differ from a TL072. The virtual amplifier is a generic educational model, not a calibrated TL074 manufacturer model.',
    document: {
      ...baseDocument('TL074 buffered signal splitter'),
      parts: [
        { id: 'U1', kind: 'quadopamp', value: 1, pins: ['e11', 'e12', 'e13', 'e14', 'e15', 'e16', 'e17', 'f17', 'f16', 'f15', 'f14', 'f13', 'f12', 'f11'] },
        { id: 'R1', kind: 'resistor', value: 100_000, pins: ['b11', 'b16'] },
        { id: 'R2', kind: 'resistor', value: 100_000, pins: ['d16', 'd17'] },
        { id: 'C1', kind: 'capacitor', value: 100e-9, pins: ['a14', 'a18'] },
        { id: 'C2', kind: 'capacitor', value: 100e-9, pins: ['g14', 'g18'] },
      ],
      wires: [
        { id: 'W1', from: 'osc', to: 'b13', color: '#56c7c2' },
        { id: 'W2', from: 'vplus', to: 'tp10', color: '#d98870' },
        { id: 'W3', from: 'vminus', to: 'bn10', color: '#798bbf' },
        { id: 'W4', from: 'gnd', to: 'tn10', color: '#6a839b' },
        { id: 'W5', from: 'c14', to: 'tp14', color: '#d98870' },
        { id: 'W6', from: 'h14', to: 'bn14', color: '#798bbf' },
        { id: 'W7', from: 'b15', to: 'tn15', color: '#6a839b' },
        { id: 'W8', from: 'b18', to: 'tn11', color: '#6a839b' },
        { id: 'W9', from: 'j18', to: 'tn12', color: '#6a839b' },
        { id: 'W10', from: 'a11', to: 'a12', color: '#c8a55b' },
        { id: 'W11', from: 'c11', to: 'j15', color: '#56c7c2' },
        { id: 'W12', from: 'b17', to: 'j13', color: '#b899ce' },
        { id: 'W13', from: 'j17', to: 'j16', color: '#c8a55b' },
        { id: 'W14', from: 'j11', to: 'j12', color: '#c8a55b' },
      ],
      probes: { CH1: 'h17', CH2: 'h11' },
    },
  },
]
