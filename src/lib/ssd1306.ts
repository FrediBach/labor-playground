/** SSD1306 serial controller. Frame snapshots are committed at I²C STOP.
 * Command reference: https://cdn-shop.adafruit.com/datasheets/SSD1306.pdf
 */
export interface OledConnection { partId: string; bus: number; sda: number; scl: number }
export interface OledFrame { ns: number; pixels: number[]; contrast: number }
export interface OledTrace { partId: string; frames: OledFrame[] }
export const OLED_FRAME_LIMIT = 256

export class SSD1306 {
  readonly ram = new Uint8Array(1024)
  private column = 0
  private page = 0
  private columnStart = 0
  private columnEnd = 127
  private pageStart = 0
  private pageEnd = 7
  private mode = 2
  private on = false
  private invert = false
  private entire = false
  private remap = false
  private reverse = false
  private startLine = 0
  private offset = 0
  private multiplex = 63
  private contrast = 127
  private control = true
  private data = false
  private continuation = false
  private command = 0
  private args: number[] = []
  private needed = 0
  private dirty = false
  readonly frames: OledFrame[] = []

  start() { this.control = true }
  write(byte: number) {
    if (this.control) {
      if (byte & 0x3f) throw new Error('SSD1306: invalid I²C control byte.')
      this.data = !!(byte & 0x40)
      this.continuation = !!(byte & 0x80)
      this.control = false
      return
    }
    if (this.data) {
      const address = this.page * 128 + this.column
      if (this.ram[address] !== byte) { this.ram[address] = byte; this.dirty = true }
      if (this.mode === 1) {
        if (++this.page > this.pageEnd) { this.page = this.pageStart; if (++this.column > this.columnEnd) this.column = this.columnStart }
      } else if (this.mode === 0) {
        if (++this.column > this.columnEnd) { this.column = this.columnStart; if (++this.page > this.pageEnd) this.page = this.pageStart }
      } else this.column = (this.column + 1) & 127
    } else this.writeCommand(byte)
    this.control = this.continuation
  }
  private writeCommand(byte: number) {
    if (this.needed) {
      this.args.push(byte)
      if (--this.needed) return
      const [a, b] = this.args
      switch (this.command) {
        case 0x20: if (a > 2) throw new Error('SSD1306: invalid addressing mode.'); this.mode = a; break
        case 0x21: this.columnStart = this.column = a & 127; this.columnEnd = b & 127; break
        case 0x22: this.pageStart = this.page = a & 7; this.pageEnd = b & 7; break
        case 0x81: this.contrast = a; this.dirty = true; break
        case 0xd3: this.offset = a & 63; this.dirty = true; break
        case 0xa8: this.multiplex = a & 63; this.dirty = true; break
      }
      return
    }
    const parameters: Record<number, number> = { 0x20: 1, 0x21: 2, 0x22: 2, 0x81: 1, 0x8d: 1, 0xa8: 1, 0xd3: 1, 0xd5: 1, 0xd9: 1, 0xda: 1, 0xdb: 1 }
    if (parameters[byte]) { this.command = byte; this.args = []; this.needed = parameters[byte]; return }
    if (byte <= 0x0f) { this.column = (this.column & 0x70) | byte; return }
    if (byte >= 0x10 && byte <= 0x1f) { this.column = (this.column & 15) | ((byte & 7) << 4); return }
    if (byte >= 0xb0 && byte <= 0xb7) { this.page = byte & 7; return }
    if (byte >= 0x40 && byte <= 0x7f) { this.startLine = byte & 63; this.dirty = true; return }
    switch (byte) {
      case 0xae: this.on = false; break
      case 0xaf: this.on = true; break
      case 0xa4: this.entire = false; break
      case 0xa5: this.entire = true; break
      case 0xa6: this.invert = false; break
      case 0xa7: this.invert = true; break
      case 0xa0: this.remap = false; break
      case 0xa1: this.remap = true; break
      case 0xc0: this.reverse = false; break
      case 0xc8: this.reverse = true; break
      case 0x2e: case 0xe3: return // Scroll off / NOP
      default: throw new Error(`SSD1306: command 0x${byte.toString(16)} is not supported (hardware scrolling is unavailable).`)
    }
    this.dirty = true
  }
  commit(ns: number) {
    if (!this.dirty) return
    const pixels = Array<number>(1024).fill(0)
    // Typical 128×64 module orientation: A1/C8 is upright.
    if (this.on) for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
      const row = this.reverse ? y : 63 - y
      if (row > this.multiplex) continue
      const ry = (row + this.startLine - this.offset + 64) & 63
      const rx = this.remap ? x : 127 - x
      const lit = this.entire || (!!(this.ram[(ry >> 3) * 128 + rx] & (1 << (ry & 7))) !== this.invert)
      if (lit) pixels[(y >> 3) * 128 + x] |= 1 << (y & 7)
    }
    const previous = this.frames.at(-1)
    if (!previous || previous.contrast !== this.contrast || pixels.some((byte, index) => byte !== previous.pixels[index])) {
      if (this.frames.length >= OLED_FRAME_LIMIT) throw new Error('OLED frame limit exceeded. Shorten the capture or update the display less often.')
      this.frames.push({ ns, pixels, contrast: this.contrast })
    }
    this.dirty = false
  }
}

export function sampleOled(frames: readonly OledFrame[] | undefined, seconds: number): OledFrame | undefined {
  if (!frames || !Number.isFinite(seconds)) return undefined
  let low = 0, high = frames.length
  while (low < high) { const mid = (low + high) >>> 1; if (frames[mid].ns <= seconds * 1e9) low = mid + 1; else high = mid }
  return frames[low - 1]
}

export function oledPixelPath(frame?: OledFrame): string {
  if (!frame) return ''
  const path: string[] = []
  for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
    if (frame.pixels[(y >> 3) * 128 + x] & (1 << (y & 7))) path.push(`M${x} ${y}h1v1h-1z`)
  }
  return path.join('')
}
