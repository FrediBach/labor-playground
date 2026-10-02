import type { CircuitExample } from '../circuit.ts'
import { createPico } from './profile.ts'

// A self-contained driver keeps main.py usable on a physical Pico without downloads.
export const OLED_SOURCE = `from machine import Pin, I2C
import framebuf
import time

# SSD1306 128x64, address 0x3C. GND / 3V3 / GP1 SCL / GP0 SDA.
i2c = I2C(0, sda=Pin(0), scl=Pin(1), freq=400_000)

# Small driver using MicroPython's built-in text and drawing functions.
class OLED(framebuf.FrameBuffer):
    def __init__(self):
        self.buffer = bytearray(1024)
        super().__init__(self.buffer, 128, 64, framebuf.MONO_VLSB)
        self.cmd(0xAE, 0x20, 0, 0x40, 0xA1, 0xC8, 0xA8, 63,
                 0xD3, 0, 0xDA, 0x12, 0xD5, 0x80, 0xD9, 0xF1,
                 0xDB, 0x30, 0x81, 0xFF, 0xA4, 0xA6, 0x8D, 0x14)
        self.fill(0)
        self.show()
        self.cmd(0xAF)

    def cmd(self, *values):
        i2c.writeto(0x3C, b'\\x00' + bytes(values))

    def show(self):
        self.cmd(0x21, 0, 127, 0x22, 0, 7)
        i2c.writevto(0x3C, (b'\\x40', self.buffer))

oled = OLED()
for count in range(10):
    oled.fill(0)
    oled.text("HELLO, PICO!", 8, 6)
    oled.hline(8, 20, 112, 1)
    oled.text("Count: " + str(count), 8, 28)
    oled.rect(8, 46, 112, 12, 1)
    oled.fill_rect(10, 48, (count + 1) * 10, 8, 1)
    oled.show()
    print("OLED frame", count)
    time.sleep_ms(50)
`

export const picoOledExample: CircuitExample = {
  id: 'pico-oled', name: 'Pico · OLED display', level: 'Basic',
  description: 'Write text and an animated progress bar to a four-wire SSD1306 display.',
  whatToChange: 'Edit HELLO, PICO!, change the counter delay, or try oled.pixel(x, y, 1). Call oled.show() to send your drawing.',
  whatToObserve: 'Simulate, then play or scrub the recording to watch the counter and progress bar. Recording end shows the last frame.',
  why: 'The Pico sends a 1024-byte monochrome framebuffer over hardware I²C. Each bit controls one OLED pixel; text and shapes use MicroPython’s built-in framebuf module.',
  hardware: 'Use a 128×64 SSD1306 I²C module at 0x3C with onboard pull-ups. Check its printed pin labels: connect GND to Pico GND, VCC to 3V3 (pin 36), SCL to GP1 (pin 2), and SDA to GP0 (pin 1). The self-contained main.py also runs on a physical Pico. The simulator models transactions, not I²C electrical waveforms.',
  document: {
    schemaVersion: 2, boardVersion: 'virtual-1', title: 'Pico OLED display',
    pico: { ...createPico(), source: OLED_SOURCE, captureMs: 1000 },
    parts: [{ id: 'OLED1', kind: 'ssd1306', value: 1, pins: ['e14', 'e15', 'e16', 'e17'] }],
    wires: [
      { id: 'WG', from: 'pico:3', to: 'gnd', color: '#91bfad' },
      { id: 'W1', from: 'pico:8', to: 'd14', color: '#6a839b' },
      { id: 'W2', from: 'pico:36', to: 'd15', color: '#de8564' },
      { id: 'W3', from: 'pico:2', to: 'd16', color: '#c8a55b' },
      { id: 'W4', from: 'pico:1', to: 'd17', color: '#56c7c2' },
    ],
    probes: { CH1: null, CH2: null },
    instruments: { frequency: 220, amplitude: 0, waveform: 'sine', cv: 0 },
  },
}
