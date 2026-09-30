import { PICO_PROFILE } from './profile'
export async function loadPicoAsset(name: 'bootrom.bin' | 'micropython.uf2' | 'stubs.json', signal?: AbortSignal): Promise<ArrayBuffer> {
  const base = `${import.meta.env.BASE_URL}pico/`
  const manifestResponse = await fetch(base + 'manifest.json', { signal })
  if (!manifestResponse.ok) throw new Error('Cannot load Pico runtime manifest.')
  const manifest = await manifestResponse.json()
  if (manifest.id !== PICO_PROFILE || !/^[a-f0-9]{64}$/.test(manifest.assets?.[name])) throw new Error('Incompatible Pico runtime assets.')
  const response = await fetch(base + name, { signal })
  if (!response.ok) throw new Error(`Cannot load Pico asset ${name}.`)
  const bytes = await response.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const checksum = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  if (checksum !== manifest.assets[name]) throw new Error(`Pico asset checksum failed: ${name}. Reload the application assets.`)
  return bytes
}
