export interface ExportFile { name: string; content: string }

const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let value = byte
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Small UTF-8, stored ZIP archives; one download keeps a schematic with its library. */
export function createZip(files: readonly ExportFile[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const entries = files.map(file => {
    if (!file.name || /[/\\\p{Cc}\p{Zl}\p{Zp}]/u.test(file.name) || file.name === '.' || file.name === '..') throw new Error('Invalid export filename.')
    const name = encoder.encode(file.name), data = encoder.encode(file.content)
    if (name.length > 65535 || data.length > 0xffffffff) throw new Error('Export exceeds ZIP limits.')
    return { name, data, crc: crc32(data) }
  })
  if (entries.length > 65535 || new Set(files.map(file => file.name)).size !== entries.length) throw new Error('Invalid export entries.')
  const localSize = entries.reduce((sum, file) => sum + 30 + file.name.length + file.data.length, 0)
  const centralSize = entries.reduce((sum, file) => sum + 46 + file.name.length, 0)
  if (localSize + centralSize + 22 > 0xffffffff) throw new Error('Export exceeds ZIP limits.')
  const bytes = new Uint8Array(localSize + centralSize + 22), view = new DataView(bytes.buffer)
  let offset = 0
  const positions: number[] = []
  for (const entry of entries) {
    positions.push(offset)
    view.setUint32(offset, 0x04034b50, true)
    view.setUint16(offset + 4, 20, true)
    view.setUint16(offset + 6, 0x0800, true)
    view.setUint16(offset + 12, 0x0021, true) // 1980-01-01; deterministic archive.
    view.setUint32(offset + 14, entry.crc, true)
    view.setUint32(offset + 18, entry.data.length, true)
    view.setUint32(offset + 22, entry.data.length, true)
    view.setUint16(offset + 26, entry.name.length, true)
    bytes.set(entry.name, offset + 30)
    bytes.set(entry.data, offset + 30 + entry.name.length)
    offset += 30 + entry.name.length + entry.data.length
  }
  entries.forEach((entry, index) => {
    view.setUint32(offset, 0x02014b50, true)
    view.setUint16(offset + 4, 20, true)
    view.setUint16(offset + 6, 20, true)
    view.setUint16(offset + 8, 0x0800, true)
    view.setUint16(offset + 14, 0x0021, true)
    view.setUint32(offset + 16, entry.crc, true)
    view.setUint32(offset + 20, entry.data.length, true)
    view.setUint32(offset + 24, entry.data.length, true)
    view.setUint16(offset + 28, entry.name.length, true)
    view.setUint32(offset + 42, positions[index], true)
    bytes.set(entry.name, offset + 46)
    offset += 46 + entry.name.length
  })
  view.setUint32(offset, 0x06054b50, true)
  view.setUint16(offset + 8, entries.length, true)
  view.setUint16(offset + 10, entries.length, true)
  view.setUint32(offset + 12, centralSize, true)
  view.setUint32(offset + 16, localSize, true)
  return bytes
}
