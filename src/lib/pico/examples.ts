import { picoOledExample } from './oled-example.ts'
import { picoStateExample } from './state-example.ts'
import type { CircuitExample, CircuitDocument } from '../circuit.ts'
import { createPico } from './profile.ts'
function circuit(title: string, source: string, kind: 'console' | 'led' | 'pulse' | 'filter'): CircuitDocument {
  const document: CircuitDocument = { schemaVersion: 2, boardVersion: 'virtual-1', title, parts: [], wires: [{ id: 'WG', from: 'pico:3', to: 'gnd', color: '#91bfad' }], probes: { CH1: null, CH2: null }, instruments: { frequency: 220, amplitude: 0, waveform: 'sine', cv: 0 }, pico: { ...createPico(), source } }
  if (kind !== 'console') {
    document.wires.push({ id: 'WP', from: 'pico:1', to: 'a4', color: '#de8564' }, { id: 'WR', from: 'pico:8', to: 'a12', color: '#91bfad' })
    document.probes = { CH1: 'b4', CH2: 'b8' }
    document.parts = [{ id: 'R1', kind: 'resistor', value: kind === 'led' ? 330 : 1000, pins: ['c4', 'c8'] }, kind === 'filter' ? { id: 'C1', kind: 'capacitor', value: 10e-6, pins: ['d8', 'd12'] } : kind === 'led' ? { id: 'D1', kind: 'led', value: 1, pins: ['d8', 'd12'] } : { id: 'R2', kind: 'resistor', value: 10000, pins: ['d8', 'd12'] }]
  }
  return document
}
const pwm = createPico().source
const lesson = { whatToChange: 'Change the timing or duty cycle in main.py, choose a capture duration, then Run.', whatToObserve: 'Compare serial output and the solved CH1/CH2 voltages. Scrub the recording to inspect the circuit at a moment in time.', why: 'The emulator records output events before ngspice calculates the loaded circuit.', hardware: 'Original Pico, virtually USB-powered. Explicit common ground; no circuit-fed inputs.' }
export const picoExamples: CircuitExample[] = [
  { ...lesson, id: 'pico-console', name: 'Pico · onboard LED & console', level: 'Basic', description: 'Run a 100 ms experiment. GP25 is the onboard LED, not a header pin.', document: circuit('Pico onboard LED and console', 'from machine import Pin\nimport time\nled = Pin(25, Pin.OUT)\nfor count in range(5):\n    led.toggle()\n    print("LED", count)\n    time.sleep_ms(10)\n', 'console') },
  { ...lesson, id: 'pico-led', name: 'Pico · external LED', level: 'Basic', description: 'GP0 drives a red LED through 330 Ω. Run to calculate the loaded pin voltage.', document: circuit('Pico external LED', 'from machine import Pin\nled = Pin(0, Pin.OUT)\nled.value(1)\nprint("External LED on")\n', 'led') },
  { ...lesson, id: 'pico-pulse', name: 'Pico · pulse train', level: 'Intermediate', description: 'A 100 Hz pulse train from MicroPython appears on CH1; the divider appears on CH2.', document: circuit('Pico pulse train', 'from machine import Pin\nimport time\npin = Pin(0, Pin.OUT)\nwhile True:\n    pin.on()\n    time.sleep_ms(5)\n    pin.off()\n    time.sleep_ms(5)\n', 'pulse') },
  { ...lesson, id: 'pico-pwm', name: 'Pico · PWM low-pass filter', level: 'Intermediate', description: 'Edit duty_u16 from 32768 to 16384, then Run. CH2 settles near half its previous voltage.', document: circuit('Pico PWM low-pass filter', pwm, 'filter') },
  picoOledExample,
  picoStateExample,
]
