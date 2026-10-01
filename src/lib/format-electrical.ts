export function formatElectrical(value: number | null | undefined, unit: 'V' | 'A' | 'W' | 'J'): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (Math.abs(value) < 1e-12) return `0.000 ${unit}`
  const magnitude = Math.abs(value)
  const [factor, prefix] = unit === 'V' || magnitude >= 1 ? [1, ''] : magnitude >= 1e-3 ? [1e3, 'm'] : magnitude >= 1e-6 ? [1e6, 'µ'] : [1e9, 'n']
  return `${(value * factor).toFixed(3)} ${prefix}${unit}`
}
