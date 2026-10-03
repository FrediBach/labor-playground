import type { CircuitDocument, CircuitExample } from './circuit.ts'

const base = (title: string): CircuitDocument => ({
  schemaVersion: 1, boardVersion: 'virtual-1', title, parts: [], wires: [],
  probes: { CH1: null, CH2: null },
  instruments: { frequency: 220, amplitude: 2.5, waveform: 'sine', cv: 5 },
})
const wires = (pairs: [string, string][]): CircuitDocument['wires'] => pairs.map(([from, to], i) => ({
  id: `W${i + 1}`, from, to,
  color: from === 'osc' ? '#56c7c2' : from === 'cv' || to.startsWith('tp') ? '#d98870' : from === 'eg' ? '#b899ce' : '#6a839b',
}))

export const synthUtilityExamples: CircuitExample[] = [
  {
    id: 'schmitt-oscillator', name: 'Schmitt RC oscillator', level: 'Intermediate',
    description: 'Make a clock from one Schmitt inverter, a resistor, and a capacitor.',
    whatToChange: 'Increase C1 from 10 nF to 100 nF to slow the clock by roughly ten times. Increase R1 from 100 kΩ to 1 MΩ for another decade.',
    whatToObserve: 'CH1 charges and discharges between about 1.9 V and 2.9 V. CH2 is an approximately 0–5 V clock near 1.2 kHz at the default values.',
    why: 'The capacitor charges through R1 until the upper threshold flips the output low. It discharges until the lower threshold flips the output high again. Hysteresis sets two distinct thresholds and makes oscillation possible. The simulator initializes the output high for 1 µs on every capture; its DC solution describes that initialization.',
    hardware: 'Use CD40106B DIP-14, pin 14 to +5 V and pin 7 to ground. Connect 100 kΩ between pins 1 and 2 and 10 nF from pin 1 to ground. Tie unused inputs low, leave unused outputs open, and add 100 nF supply bypass. This unipolar clock needs attenuation or AC coupling for an audio input. Actual thresholds and frequency vary between chips.',
    document: {
      ...base('Schmitt RC oscillator'),
      parts: [
        { id: 'U1', kind: 'cd40106', value: 1, pins: ['e11', 'e12', 'e13', 'e14', 'e15', 'e16', 'e17', 'f17', 'f16', 'f15', 'f14', 'f13', 'f12', 'f11'] },
        { id: 'R1', kind: 'resistor', value: 100_000, pins: ['a11', 'a12'] },
        { id: 'C1', kind: 'capacitor', value: 10e-9, pins: ['c11', 'c7'] },
      ],
      wires: wires([['cv', 'j11'], ['gnd', 'tn1'], ['b7', 'tn2'], ['b17', 'tn3'], ['b13', 'tn4'], ['b15', 'tn5'], ['j16', 'tn6'], ['j14', 'tn7'], ['j12', 'tn8']]),
      probes: { CH1: 'b11', CH2: 'b12' },
    },
  },
  {
    id: 'signal-selector', name: 'CD4053 audio/CV selector', level: 'Intermediate',
    description: 'Switch between a bipolar audio signal and a DC voltage with a separate logic control.',
    whatToChange: 'Toggle the manual Gate. Low selects the oscillator; high selects +5 V CV. Change the oscillator waveform and compare both states.',
    whatToObserve: 'CH1 shows the oscillator. CH2 follows it with the gate low and switches to nearly +5 V with the gate high. The 10 kΩ load causes a small voltage drop through the switch.',
    why: 'Section A connects COM A to AX or AY. The analog negative supply is −12 V, while logic ground remains 0 V, so a 0–5 V gate can select bipolar signals. The total analog supply span is 17 V. The three sections have separate selects; INH disables all three. Each path is bilateral and has finite resistance.',
    hardware: 'CD4053B DIP-16: VDD pin 16 to +5 V, VSS pin 8 to ground, VEE pin 7 to −12 V. Wire AX pin 12 to audio, AY pin 13 to +5 V, COM A pin 14 to a 10 kΩ load, and SEL A pin 11 to the gate. Ground INH and unused logic and signal pins. Bypass both rails locally. Do not substitute +12 V for VDD with VEE at −12 V: 24 V exceeds the total span.',
    document: {
      ...base('CD4053 audio/CV selector'),
      instruments: { ...base('').instruments, envelope: { mode: 'gate', gateHigh: false, decayMs: 20 } },
      parts: [
        { id: 'U1', kind: 'cd4053', value: 1, pins: ['e11', 'e12', 'e13', 'e14', 'e15', 'e16', 'e17', 'e18', 'f18', 'f17', 'f16', 'f15', 'f14', 'f13', 'f12', 'f11'] },
        { id: 'R1', kind: 'resistor', value: 10_000, pins: ['j13', 'j21'] },
      ],
      wires: wires([['cv', 'tp1'], ['gnd', 'tn1'], ['vminus', 'b17'], ['j11', 'tp2'], ['j14', 'tp3'], ['osc', 'j15'], ['eg', 'j16'], ['i21', 'tn2'], ['b11', 'tn3'], ['b12', 'tn4'], ['b13', 'tn5'], ['b14', 'tn6'], ['b15', 'tn7'], ['b16', 'tn8'], ['b18', 'tn9'], ['j18', 'tn10'], ['j17', 'tn11'], ['j12', 'tn12']]),
      probes: { CH1: 'i15', CH2: 'i13' },
    },
  },
  {
    id: 'optical-gain', name: 'Optical audio gate', level: 'Intermediate',
    description: 'Use an LED and photoresistor to open an audio path with a smooth, lingering release.',
    whatToChange: 'Fire the envelope, or select Gate and hold it high. Change R1 from 1 kΩ to 4.7 kΩ to reduce LED current and output level.',
    whatToObserve: 'CH1 is the input sine. CH2 fades up after the LED lights and decays with a soft tail as the optical state releases. The inspector shows LED and LDR currents separately.',
    why: 'R1 limits the LED current. Light reduces the isolated LDR resistance, allowing audio into the R2 load. Optical state rises with a 2 ms time constant and falls with a 20 ms time constant, while the resistance curve is nonlinear. Adding a capacitor across R2 turns this attenuator into a simple low-pass gate.',
    hardware: 'Use an LED/LDR optocoupler or a light-tight LED/photoresistor assembly. Check its actual LED polarity and lead layout: the simulator uses a virtual DIP-4 carrier. Use 1 kΩ in series with the LED and 10 kΩ as the audio load. Real optocouplers vary widely in resistance, response time, and light history; this is a generic model.',
    document: {
      ...base('Optical audio gate'),
      parts: [
        { id: 'O1', kind: 'vactrol', value: 1, pins: ['e11', 'e12', 'f12', 'f11'] },
        { id: 'R1', kind: 'resistor', value: 1000, pins: ['a6', 'a11'] },
        { id: 'R2', kind: 'resistor', value: 10_000, pins: ['j12', 'j18'] },
      ],
      wires: wires([['eg', 'b6'], ['gnd', 'tn1'], ['b12', 'tn2'], ['i18', 'tn3'], ['osc', 'j11']]),
      probes: { CH1: 'i11', CH2: 'i12' },
    },
  },
  {
    id: 'pmos-high-side', name: 'P-channel high-side switch', level: 'Intermediate',
    description: 'Switch a positive 5 V rail into a load using a P-channel MOSFET.',
    whatToChange: 'Toggle the manual Gate: low turns the load on, high turns it off. Change R1 from 10 kΩ to 1 kΩ to see the loaded voltage drop.',
    whatToObserve: 'CH1 reads the gate voltage. CH2 rises close to +5 V when the gate is low and falls to zero when the gate reaches the source voltage.',
    why: 'The source sits at +5 V. Pulling the gate to ground gives VGS = −5 V and turns on the P-channel device. R2 pulls its gate toward its source when the driver is disconnected. Drain current is negative under the D-to-S sign convention, but absorbed device power is positive.',
    hardware: 'Choose a P-channel enhancement MOSFET rated for the supply and load. Check its physical pinout. Use a 10 kΩ load and 1 MΩ gate-to-source pull-up. This example uses a 5 V source and 0–5 V gate; switching a higher rail needs a suitable gate driver and gate-voltage protection.',
    document: {
      ...base('P-channel high-side switch'),
      instruments: { ...base('').instruments, envelope: { mode: 'gate', gateHigh: false, decayMs: 20 } },
      parts: [
        { id: 'M1', kind: 'pmos', value: 1, pins: ['c10', 'c11', 'c12'] },
        { id: 'R1', kind: 'resistor', value: 10_000, pins: ['a10', 'a6'] },
        { id: 'R2', kind: 'resistor', value: 1e6, pins: ['a11', 'a12'] },
      ],
      wires: wires([['cv', 'b12'], ['eg', 'b11'], ['gnd', 'b6']]),
      probes: { CH1: 'd11', CH2: 'd10' },
    },
  },
]
