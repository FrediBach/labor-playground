// Center the dock between the breadboard panel edge and the workbench edge.
export const PICO_DOCK_CENTER_X = (917 + 1110) / 2
export const PICO_PROFILE = 'rp2-pico-1.20.0-v1'
export const PROJECT_LIMITS = { bytes: 200_000, sourceBytes: 32_768 } as const
export const PICO_CAPTURE_DURATIONS_MS = [100, 500, 1000, 5000, 10000] as const
export type PicoCaptureMs = typeof PICO_CAPTURE_DURATIONS_MS[number]
export interface PicoConfiguration { board: 'pico'; profile: typeof PICO_PROFILE; source: string; captureMs: PicoCaptureMs }
export const DEFAULT_PICO_SOURCE = `from machine import Pin, PWM
import time

# Select a capture duration. Connect GP0 and a Pico GND.
pwm = PWM(Pin(0))
pwm.freq(1000)
pwm.duty_u16(32768)  # Half of 65535 = 50% duty
print("Pico PWM: 1 kHz, 50%")
while True:
    time.sleep_ms(1)
`
export function createPico(): PicoConfiguration { return { board: 'pico', profile: PICO_PROFILE, source: DEFAULT_PICO_SOURCE, captureMs: 100 } }
const labels = ['GP0','GP1','GND','GP2','GP3','GP4','GP5','GND','GP6','GP7','GP8','GP9','GND','GP10','GP11','GP12','GP13','GND','GP14','GP15','GP16','GP17','GND','GP18','GP19','GP20','GP21','GND','GP22','RUN','GP26','GP27','AGND','GP28','ADC_VREF','3V3','3V3_EN','GND','VSYS','VBUS']
export const PICO_PINS = labels.map((label, index) => ({
  id: `pico:${index + 1}`, number: index + 1, label,
  gpio: label.startsWith('GP') ? Number(label.slice(2)) : null,
  supported: label.startsWith('GP') || ['GND', 'AGND', '3V3'].includes(label),
  group: label === 'GND' || label === 'AGND' ? 'pico-ground' : `pico:${index + 1}`,
  x: PICO_DOCK_CENTER_X + (index < 20 ? -70 : 70), y: 75 + (index < 20 ? index : 39 - index) * 22,
}))
export const picoGround = 'pico:3'
export function validatePico(raw: unknown): PicoConfiguration {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid Pico configuration.')
  const config = raw as Record<string, unknown>
  if (config.board !== 'pico' || config.profile !== PICO_PROFILE) throw new Error('Unsupported Pico board or runtime profile. This project requires an incompatible firmware profile.')
  if (!PICO_CAPTURE_DURATIONS_MS.includes(config.captureMs as PicoCaptureMs)) throw new Error('Pico capture duration must be 100 ms, 500 ms, 1 s, 5 s, or 10 s.')
  if (typeof config.source !== 'string' || new TextEncoder().encode(config.source).length > PROJECT_LIMITS.sourceBytes) throw new Error('main.py must fit within 32 KiB.')
  return { board: 'pico', profile: PICO_PROFILE, source: config.source, captureMs: config.captureMs as PicoCaptureMs }
}
