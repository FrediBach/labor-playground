import type { CircuitExample } from '../circuit.ts'
import { createPico } from './profile.ts'

export const STATE_AND_LOGS_SOURCE = `from machine import Pin, PWM
import time
import scope

# Run, then open Results. Three views share the recording cursor:
# CH2: the real simulated filter output.
# Pico logs: numbers explicitly recorded by scope.log().
# Pico variables: globals sampled automatically, including nested state.
levels = (25, 75, 50, 0)
settings = {"tick_ms": 20, "ticks_per_step": 5}
history = []
state = {"phase": "starting", "duty": 0, "ticks": 0, "history": history}

pwm = PWM(Pin(0))
pwm.freq(1000)

def apply_duty(percent: int):
    pwm.duty_u16(percent * 65535 // 100)
    # This local variable is absent from Pico variables, but can be logged.
    target_voltage = 3.3 * percent / 100
    scope.log("duty", percent, unit="%")
    scope.log("target", target_voltage, unit="V")

for step, duty in enumerate(levels):
    state["phase"] = "off" if duty == 0 else "driving"
    state["duty"] = duty
    history.append(duty)
    apply_duty(duty)
    for tick in range(settings["ticks_per_step"]):
        # No scope.log here: inspect state to see these intermediate changes.
        state["ticks"] = step * settings["ticks_per_step"] + tick + 1
        time.sleep_ms(settings["tick_ms"])

state["phase"] = "complete"
print("Complete: open Results, scrub, and expand state in Pico variables.")
`

export const picoStateExample: CircuitExample = {
  id: 'pico-state-logs', name: 'Pico · variables & scope logs', level: 'Intermediate',
  description: 'Compare automatic application-state snapshots, explicit numeric logs, and a measured PWM filter output in one 500 ms recording.',
  whatToChange: 'Change levels in main.py from (25, 75, 50, 0) to another sequence of duty percentages from 0 to 100. Change settings["tick_ms"] to adjust the pace; choose a longer recording if needed. Try adding scope.log("ticks", state["ticks"]) after the tick assignment to turn an automatically inspected value into a plotted trace.',
  whatToObserve: 'Run and open Results. The full 500 ms view shows all four steps. The duty and target logs record one value per step; CH2 approaches each target through the R1/C1 filter. At 50 ms, expand state and its history in Pico variables: duty is 25 and history is [25]. Move to 90 ms: ticks changes while both log values hold. At 150 ms, duty is 75 and history is [25, 75]. At Recording end, phase is "complete" and history has all four levels. Filter variables by target_voltage: it is local to apply_duty, so only the explicit target log records it.',
  why: 'Pico variables automatically samples globals every 1 ms, including strings, dictionaries, and lists; brief changes between samples can be missed. scope.log() records only the numbers you choose, when each call executes, with a name and optional unit. It can expose function-local calculations such as target_voltage. Both follow the same playback cursor. The target trace is the ideal 3.3 V × duty average, not an input measurement. CH1 shows actual GPIO pulses, and CH2 shows their loaded, smoothed response through R1 = 1 kΩ and C1 = 10 µF (about a 10 ms time constant).',
  hardware: 'Connect Pico GP0 (physical pin 1) through a 1 kΩ resistor to the filter output. Connect a 10 µF capacitor from that output to Pico GND and join Pico GND to LABOR GND. Probe GP0 with CH1 and the filter output with CH2. Pico variables and scope are simulator features: remove import scope and the scope.log calls before running on a physical Pico. The PWM circuit and remaining code work without them.',
  document: {
    schemaVersion: 2, boardVersion: 'virtual-1', title: 'Pico variables and scope logs',
    pico: { ...createPico(), source: STATE_AND_LOGS_SOURCE, captureMs: 500 },
    parts: [
      { id: 'R1', kind: 'resistor', value: 1000, pins: ['c4', 'c8'] },
      { id: 'C1', kind: 'capacitor', value: 10e-6, pins: ['d8', 'd12'] },
    ],
    wires: [
      { id: 'WG', from: 'pico:3', to: 'gnd', color: '#91bfad' },
      { id: 'WP', from: 'pico:1', to: 'a4', color: '#de8564' },
      { id: 'WR', from: 'pico:8', to: 'a12', color: '#91bfad' },
    ],
    probes: { CH1: 'b4', CH2: 'b8' },
    instruments: { frequency: 220, amplitude: 0, waveform: 'sine', cv: 0 },
  },
}
