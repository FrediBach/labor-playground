import type { CircuitDocument, CircuitExample } from './circuit.ts'

const document = (title: string): CircuitDocument => ({
  schemaVersion: 1,
  boardVersion: 'virtual-1',
  title,
  parts: [],
  wires: [],
  probes: { CH1: null, CH2: null },
  instruments: { frequency: 100, amplitude: 2.5, waveform: 'sine', cv: 5 },
})

export const passiveExamples: CircuitExample[] = [
  {
    id: 'cv-attenuator',
    name: 'CV attenuator',
    level: 'Basic',
    description: 'Set modulation depth with a passive potentiometer divider.',
    whatToChange: 'Select P1 and move its wiper from 50% to 25%, then try 75%.',
    whatToObserve: 'CH1 stays at 5 V. CH2 changes from 2.50 V to 1.25 V, then 3.75 V.',
    why: 'With CCW grounded and CW connected to CV, the unloaded wiper voltage is the input multiplied by the wiper fraction. This is the basic modulation-depth control; a connected module can lower the output by loading the divider.',
    hardware: 'Use a 10 kΩ linear potentiometer, LABOR variable DC and GND. Identify the physical wiper and end terminals; the virtual footprint is illustrative. Start at 5 V measured on the real source; the virtual knob is not calibrated to LABOR.',
    document: {
      ...document('CV attenuator'),
      parts: [{ id: 'P1', kind: 'potentiometer', value: 10_000, position: 0.5, pins: ['a13', 'a14', 'a15'] }],
      wires: [
        { id: 'W1', from: 'cv', to: 'b15', color: '#c8a55b' },
        { id: 'W2', from: 'gnd', to: 'b13', color: '#6a839b' },
      ],
      probes: { CH1: 'c15', CH2: 'c14' },
    },
  },
  {
    id: 'ac-coupling',
    name: 'AC coupling / high-pass',
    level: 'Basic',
    description: 'Pass audio while removing a DC offset between synth stages.',
    whatToChange: 'Keep the oscillator at 100 Hz and change C1 from 100 nF to 470 nF.',
    whatToObserve: 'CH2 grows from about 1.33 V peak to 2.35 V peak, and leads CH1 by a smaller angle. A steady DC input would settle to 0 V at CH2.',
    why: 'C1 passes changes while R1 gives the output a DC return to ground. The corner moves from about 158 Hz to 34 Hz, including the virtual source’s 100 Ω resistance. This removes DC from audio; it also removes sustained pitch or gate CV.',
    hardware: 'Use a 10 kΩ resistor and a 100 nF nonpolar film or ceramic capacitor rated at least 25 V. Connect LABOR oscillator output and GND to the same circuit nodes. Measure the real frequency and amplitude; virtual breadboard coordinates and source settings are illustrative.',
    document: {
      ...document('AC coupling / high-pass'),
      parts: [
        { id: 'C1', kind: 'capacitor', value: 100e-9, pins: ['a9', 'a10'] },
        { id: 'R1', kind: 'resistor', value: 10_000, pins: ['c10', 'c16'] },
      ],
      wires: [
        { id: 'W1', from: 'osc', to: 'b9', color: '#56c7c2' },
        { id: 'W2', from: 'gnd', to: 'b16', color: '#6a839b' },
      ],
      probes: { CH1: 'd9', CH2: 'd10' },
    },
  },
  {
    id: 'gate-to-trigger',
    name: 'Gate-to-trigger pulses',
    level: 'Intermediate',
    description: 'Turn the edges of a sustained gate into short bipolar pulses.',
    whatToChange: 'Capture the built-in 5 V step, then change C1 from 100 nF to 470 nF and capture again.',
    whatToObserve: 'CH2 pulses positive when CH1 rises at 1 ms and negative when it falls at 51 ms. Each pulse decays to 37% in about 1.01 ms; the larger capacitor stretches this to 4.75 ms.',
    why: 'The capacitor passes a gate’s edges and then charges until the output returns to ground. The time constant is (R1 + 100 Ω) × C1. This demonstrates trigger shaping, but its negative falling-edge pulse is not a protected logic-compatible trigger output.',
    hardware: 'Use a 10 kΩ resistor and a 100 nF nonpolar capacitor rated at least 25 V with LABOR EG OUT in gate mode and GND. Press and release the gate button to make the two pulses. Transfer circuit nodes rather than hole coordinates; the real gate level and hold time differ from this virtual 5 V, 50 ms step.',
    document: {
      ...document('Gate-to-trigger pulses'),
      stimulus: 'step',
      instruments: { frequency: 100, amplitude: 5, waveform: 'square', cv: 5 },
      parts: [
        { id: 'C1', kind: 'capacitor', value: 100e-9, pins: ['a9', 'a10'] },
        { id: 'R1', kind: 'resistor', value: 10_000, pins: ['c10', 'c16'] },
      ],
      wires: [
        { id: 'W1', from: 'osc', to: 'b9', color: '#56c7c2' },
        { id: 'W2', from: 'gnd', to: 'b16', color: '#6a839b' },
      ],
      probes: { CH1: 'd9', CH2: 'd10' },
    },
  },
  {
    id: 'envelope-follower',
    name: 'Diode envelope follower',
    level: 'Intermediate',
    description: 'Extract a positive control level from the peaks of an audio signal.',
    whatToChange: 'Change C1 from 100 nF to 470 nF, then lower the oscillator amplitude from 5 V to 2.5 V.',
    whatToObserve: 'CH2 stays positive with small 1 kHz ripples. A larger capacitor reduces ripple and extends release from about 10 ms to 47 ms; lowering the input amplitude lowers the detected level.',
    why: 'D1 charges C1 on positive peaks through the 1 kΩ current-limiting resistor. Between peaks, C1 discharges through the 100 kΩ R2, giving release ≈ R2 × C1. The output loses the diode’s forward voltage; it is unbuffered and a connected load shortens the release. A steady sine produces a steady envelope, not an audible low-frequency waveform.',
    hardware: 'Use a 1N4148 with its striped cathode toward C1/R2, 1 kΩ and 100 kΩ resistors, and a 100 nF nonpolar capacitor rated at least 25 V. Feed a measured 1 kHz sine from LABOR and share GND; use an external attenuator to change amplitude. The generic diode and virtual source do not predict exact real detector levels; transfer circuit nodes rather than hole coordinates.',
    document: {
      ...document('Diode envelope follower'),
      instruments: { frequency: 1000, amplitude: 5, waveform: 'sine', cv: 5 },
      parts: [
        { id: 'R1', kind: 'resistor', value: 1000, pins: ['a6', 'a10'] },
        { id: 'D1', kind: 'diode', value: 1, pins: ['c10', 'c13'] },
        { id: 'C1', kind: 'capacitor', value: 100e-9, pins: ['e13', 'f13'] },
        { id: 'R2', kind: 'resistor', value: 100_000, pins: ['b13', 'b17'] },
      ],
      wires: [
        { id: 'W1', from: 'osc', to: 'b6', color: '#56c7c2' },
        { id: 'W2', from: 'gnd', to: 'bn5', color: '#6a839b' },
        { id: 'W3', from: 'j13', to: 'bn13', color: '#6a839b' },
        { id: 'W4', from: 'd17', to: 'bn12', color: '#6a839b' },
      ],
      probes: { CH1: 'd6', CH2: 'd13' },
    },
  },
]
