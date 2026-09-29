import type { ComponentKind } from '@/lib/circuit'
import { PARTS } from '@/lib/circuit'
import { PartGlyph } from './PartGlyph'

export function PartIcon({ kind, value, position, large = false }: {
  kind: ComponentKind
  value?: number
  position?: number
  large?: boolean
}) {
  return (
    <svg viewBox="-60 -45 120 90" width={large ? 106 : 54} height={large ? 68 : 36} aria-hidden="true">
      <PartGlyph kind={kind} value={value ?? PARTS[kind].defaultValue} position={position} />
    </svg>
  )
}
