import type { CircuitDocument, CircuitExample } from './circuit.ts'

const base = (title: string): CircuitDocument => ({
  schemaVersion: 1, boardVersion: 'virtual-1', title, parts: [], wires: [], probes: { CH1: null, CH2: null },
  instruments: { frequency: 512, amplitude: 5, waveform: 'square', cv: 5, envelope: { mode: 'gate', gateHigh: false, decayMs: 20 } },
})
const dip = (column: number) => [...Array.from({ length: 7 }, (_, i) => `e${column + i}`), ...Array.from({ length: 7 }, (_, i) => `f${column + 6 - i}`)]
const wires = (pairs: [string, string][]): CircuitDocument['wires'] => pairs.map(([from, to], i) => ({ id: `W${i + 1}`, from, to, color: from === 'osc' ? '#56c7c2' : from === 'eg' ? '#b899ce' : from === 'cv' || from === 'vplus' || to.startsWith('tp') ? '#d98870' : '#6a839b' }))
const grounds = (pins: string[]): [string, string][] => [['gnd', 'tn1'], ...pins.map((pin, i): [string, string] => [pin, `tn${i + 2}`])]

export const synthTimingExamples: CircuitExample[] = [
  {
    id: 'ripple-divider', name: 'Seven-stage clock divider', level: 'Intermediate',
    description: 'Explore binary clock divisions and reset with a CD4024 counter.',
    whatToChange: 'Change oscillator frequency or hold Gate high to reset the counter. Move a probe to another Q output to explore divisions from 2 to 128.',
    whatToObserve: 'At 512 Hz input, CH1 on Q3 is 64 Hz and CH2 on Q4 is 32 Hz. Gate high clears all outputs; releasing it restarts counting on falling clock edges.',
    why: 'Seven cascaded flip-flops divide the clock by successive powers of two. The clock input has hysteresis, and each stage ripples into the next with a finite delay. Equal resistors translate the bipolar oscillator into the 0–5 V logic range. Capture startup clears the simulated counter; hardware needs a reset pulse for a predictable phase.',
    hardware: 'Use CD4024B DIP-14: VDD pin 14, VSS pin 7, clock pin 1, active-high RESET pin 2. Q1 through Q7 are pins 12, 11, 9, 6, 5, 4, 3. Pins 8, 10, 13 are NC. Add 100 nF supply bypass and a defined reset level. Ripple outputs are not simultaneous; decode them carefully if creating triggers.',
    document: {
      ...base('Seven-stage clock divider'),
      parts: [{ id: 'U1', kind: 'cd4024', value: 1, pins: dip(11) }, { id: 'R1', kind: 'resistor', value: 100_000, pins: ['a6', 'a11'] }, { id: 'R2', kind: 'resistor', value: 100_000, pins: ['c7', 'c11'] }],
      wires: wires([['cv', 'tp1'], ['j11', 'tp2'], ['b7', 'tp3'], ['osc', 'b6'], ['eg', 'b12'], ...grounds(['b17'])]),
      probes: { CH1: 'j16', CH2: 'b16' },
    },
  },
  {
    id: 'nand-oscillator', name: 'Schmitt NAND gated oscillator', level: 'Intermediate',
    description: 'Enable an RC oscillator with one input of a Schmitt NAND gate.',
    whatToChange: 'Release Gate to stop oscillation with the output high. Hold Gate again to resume. Change C1 from 100 nF to 220 nF to slow the oscillator.',
    whatToObserve: 'CH1 shows the capacitor moving between about 2 and 3 V. CH2 is a 0–5 V pulse train. Gate low holds CH2 high and lets C1 charge toward 5 V.',
    why: 'With enable high, the NAND acts as a Schmitt inverter. Its resistor charges and discharges the capacitor between two thresholds, producing oscillation. A low enable forces the NAND output high independently of the capacitor voltage. The modeled thresholds and output resistance set the approximate frequency.',
    hardware: 'Use CD4093B on 5 V with 100 nF bypass. Gate 1 uses inputs 1/2 and output 3. Connect 100 kΩ from output 3 to input 1, 100 nF from input 1 to ground, and a 0–5 V enable to input 2. Tie unused inputs to ground. Gate-low stops this circuit HIGH; add an inverter if a low stopped level is needed.',
    document: {
      ...base('Schmitt NAND gated oscillator'),
      instruments: { ...base('').instruments, envelope: { mode: 'gate', gateHigh: true, decayMs: 20 } },
      parts: [{ id: 'U1', kind: 'cd4093', value: 1, pins: dip(11) }, { id: 'R1', kind: 'resistor', value: 100_000, pins: ['a11', 'a13'] }, { id: 'C1', kind: 'capacitor', value: 100e-9, pins: ['c11', 'c17'] }],
      wires: wires([['cv', 'j11'], ['eg', 'b12'], ...grounds(['b17', 'b15', 'b16', 'j17', 'j16', 'j13', 'j12'])]),
      probes: { CH1: 'b11', CH2: 'b13' },
    },
  },
  {
    id: 'nor-clock-inhibit', name: 'NOR clock inhibit', level: 'Intermediate',
    description: 'Invert a pulse clock and silence it with an active-high inhibit gate.',
    whatToChange: 'Hold Gate high to force the output low, then release it to restore the inverted clock. Change oscillator frequency to hear or inspect a different pulse rate.',
    whatToObserve: 'CH1 is the level-shifted clock; CH2 is high only when CH1 and Gate are both low. Holding Gate high silences the output.',
    why: 'NOR is the inverse of OR. A low inhibit lets the clock input act as an inverter, while a high inhibit overrides it and holds the output low. Changing inhibit mid-pulse can truncate a pulse; this simple logic circuit does not synchronize the enable.',
    hardware: 'Use CD4001B DIP-14 on 5 V: pin 14 VDD, pin 7 VSS, inputs 1/2, output 3. Add supply bypass and tie all unused inputs to ground. Supply clean 0–5 V signals; raw bipolar audio needs conditioning before reaching CMOS inputs.',
    document: {
      ...base('NOR clock inhibit'),
      parts: [{ id: 'U1', kind: 'cd4001', value: 1, pins: dip(11) }, { id: 'R1', kind: 'resistor', value: 100_000, pins: ['a6', 'a11'] }, { id: 'R2', kind: 'resistor', value: 100_000, pins: ['c7', 'c11'] }],
      wires: wires([['cv', 'tp1'], ['j11', 'tp2'], ['b7', 'tp3'], ['osc', 'b6'], ['eg', 'b12'], ...grounds(['b17', 'b15', 'b16', 'j17', 'j16', 'j13', 'j12'])]),
      probes: { CH1: 'b11', CH2: 'b13' },
    },
  },
  {
    id: 'precision-cv-reference', name: '2.5 V CV reference', level: 'Basic',
    description: 'Generate a nominal 2.5 V CV reference from the +12 V supply.',
    whatToChange: 'Change load R2 from 10 kΩ to 2.2 kΩ, then to 1 kΩ. Compare the output voltage and reference current as the available shunt current runs out.',
    whatToObserve: 'CH1 is +12 V and CH2 is near 2.5 V. Moderate loading keeps the output regulated; the 1 kΩ load pulls it below 2.5 V because R1 cannot supply enough current.',
    why: 'R1 limits supply current. The shunt reference absorbs current left over after the load, keeping the cathode near 2.5 V while at least about 60 µA is available. It cannot source current into an excessive load. A buffer is needed when driving several CV inputs.',
    hardware: 'TI LM4040 2.5 V TO-92 pin 2 is cathode and pin 3 is anode; pin 1 must float or connect to anode. Pin order differs for SOT-23. Feed cathode from +12 V through 4.7 kΩ, ground anode, and connect a 10 kΩ load. Choose the actual tolerance grade and account for load, temperature, and current limits when designing calibrated pitch CV.',
    document: {
      ...base('2.5 V CV reference'),
      parts: [{ id: 'U1', kind: 'lm4040', value: 2.5, pins: ['e13', 'e14', 'e15'] }, { id: 'R1', kind: 'resistor', value: 4700, pins: ['a8', 'a14'] }, { id: 'R2', kind: 'resistor', value: 10_000, pins: ['c14', 'c18'] }],
      wires: wires([['vplus', 'b8'], ...grounds(['b15', 'b18'])]),
      probes: { CH1: 'c8', CH2: 'b14' },
    },
  },
]
