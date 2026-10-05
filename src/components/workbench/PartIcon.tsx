import type { ComponentKind } from '@/lib/circuit'
import { PARTS } from '@/lib/circuit'
import { PartGlyph } from './PartGlyph'

export function PartIcon({ kind, value, position, pinNames, large = false }: {
  kind: ComponentKind
  value?: number
  position?: number
  pinNames?: string[]
  large?: boolean
}) {
  const definition = PARTS[kind]
  const halfWidth = definition.package ? Math.max(60, ((pinNames ?? definition.pinNames).length / 2 - 1) * 12 + 24) : 60
  const widePackage = halfWidth > 60
  return (
    <svg viewBox={kind === 'ssd1306' ? '-85 -10 170 130' : `${-halfWidth} -45 ${halfWidth * 2} 90`} width={large ? widePackage ? 180 : 106 : 54} height={large ? 68 : 36} aria-hidden="true">
      <PartGlyph kind={kind} value={value ?? PARTS[kind].defaultValue} position={position} pinNames={pinNames} />
    </svg>
  )
}
