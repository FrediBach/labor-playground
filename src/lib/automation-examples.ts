import type { CircuitDocument, CircuitExample } from './circuit.ts'

const document = (title: string): CircuitDocument => ({
  schemaVersion: 1,
  boardVersion: 'virtual-1',
  title,
  parts: [],
  wires: [],
  probes: { CH1: null, CH2: null },
  instruments: { frequency: 440, amplitude: 2, waveform: 'sine', cv: 5 },
})

export const automationExamples: CircuitExample[] = [
  {
    id: 'automated-pot-sweep',
    name: 'Automated knob sweep',
    level: 'Basic',
    description: 'Record two timed knob movements in a single capture.',
    whatToChange: 'Open Automations and change the first movement’s duration from 40 ms to 20 ms. Then disable the second movement and capture again.',
    whatToObserve: 'CH1 stays at 5 V. CH2 starts at 0.5 V, rises to 4.5 V between 10 and 50 ms, then falls to 1 V between 60 and 90 ms. Shortening the first movement makes its slope steeper; disabling the second leaves the output at 4.5 V.',
    why: 'P1 is an unloaded voltage divider: its output is 5 V multiplied by the wiper position. Each automation starts once at its scheduled simulation time and moves from the position reached by the previous movement. Every capture begins again at the saved 10% position.',
    hardware: 'Connect a 10 kΩ linear potentiometer between variable DC and GND, with the wiper as the output. Set the source to 5 V with a meter. You can turn the knob manually to explore attenuation; the timed movements are a simulator feature and do not control physical LABOR hardware.',
    document: {
      ...document('Automated knob sweep'),
      parts: [{ id: 'P1', kind: 'potentiometer', value: 10_000, position: 0.1, pins: ['a13', 'a14', 'a15'] }],
      wires: [
        { id: 'W1', from: 'cv', to: 'b15', color: '#c8a55b' },
        { id: 'W2', from: 'gnd', to: 'b13', color: '#6a839b' },
      ],
      probes: { CH1: 'c15', CH2: 'c14' },
      automations: [
        {
          id: 'A1', name: 'Turn up', enabled: true,
          trigger: { kind: 'time', atMs: 10 },
          action: { target: 'potentiometer', partId: 'P1', value: 0.9, durationMs: 40 },
        },
        {
          id: 'A2', name: 'Turn down', enabled: true,
          trigger: { kind: 'time', atMs: 60 },
          action: { target: 'potentiometer', partId: 'P1', value: 0.2, durationMs: 30 },
        },
      ],
    },
  },
  {
    id: 'voltage-triggered-release',
    name: 'Voltage-triggered gate release',
    level: 'Intermediate',
    description: 'Release a gate when a charging capacitor reaches a chosen voltage.',
    whatToChange: 'Open Automations and change the release threshold from 3 V to 4 V. Then change C1 from 1 µF to 2.2 µF.',
    whatToObserve: 'CH1 rises at 10 ms and drops when CH2 reaches 3 V, about 19.3 ms into the capture. CH2 then decays toward zero. A 4 V threshold releases later, at about 26.3 ms; a larger capacitor makes both charging and decay slower.',
    why: 'The first automation holds EG high. The second watches the capacitor voltage on CH2 and releases EG on its first rising threshold crossing. The 10 kΩ resistor, 100 Ω source resistance, and 1 µF capacitor give a 10.1 ms time constant. The voltage event changes the circuit during this capture, so CH2 begins decaying immediately after release.',
    hardware: 'Build the RC section with a 10 kΩ resistor and a 1 µF non-polarized capacitor. Feed it from a gate source and measure the source and capacitor. A physical automatic threshold release also needs a comparator and gate-control circuit; the simulator’s Automations panel provides that control for this experiment.',
    document: {
      ...document('Voltage-triggered gate release'),
      instruments: {
        frequency: 440, amplitude: 2, waveform: 'sine', cv: 5,
        envelope: { mode: 'gate', gateHigh: false, decayMs: 20 },
      },
      parts: [
        { id: 'R1', kind: 'resistor', value: 10_000, pins: ['a9', 'a13'] },
        { id: 'C1', kind: 'capacitor', value: 1e-6, pins: ['c13', 'c17'] },
      ],
      wires: [
        { id: 'W1', from: 'eg', to: 'b9', color: '#c8a55b' },
        { id: 'W2', from: 'gnd', to: 'd17', color: '#6a839b' },
      ],
      probes: { CH1: 'c9', CH2: 'd13' },
      automations: [
        {
          id: 'A1', name: 'Start charging', enabled: true,
          trigger: { kind: 'time', atMs: 10 },
          action: { target: 'gate', value: 1, durationMs: 0 },
        },
        {
          id: 'A2', name: 'Release at threshold', enabled: true,
          trigger: { kind: 'voltage', channel: 'CH2', direction: 'rising', threshold: 3, afterMs: 0 },
          action: { target: 'gate', value: 0, durationMs: 0 },
        },
      ],
    },
  },
]
