import type { SchematicSymbol } from './schematic.ts'

/** SVG layout pixels to KiCad legacy schematic mils. */
export const KICAD_SCALE = 10

type Point = readonly [number, number]

// Legacy library identifiers and pin names are unquoted, whitespace-separated tokens.
function token(value: string): string {
  return value.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').trim().replace(/\s+/g, '~').replace(/"/g, "'").replace(/\\/g, '/') || '~'
}

/**
 * A self-contained symbol for the companion -cache.lib. Geometry is baked into
 * the current orientation; schematic instances use the standard 1 0 0 -1 matrix.
 * Library coordinates have Y pointing up, unlike the SVG layout.
 */
export function legacySymbolDefinition(symbol: SchematicSymbol, symbolName: string, alias?: string): string {
  const name = token(symbolName)
  const passive = symbol.pins.length === 2 && symbol.kind !== 'pico'
  const transistor = ['npn', 'pnp', 'nmos', 'pmos', 'njfet'].includes(symbol.kind)
  const potentiometer = symbol.kind === 'potentiometer'
  const block = !passive && !transistor && !potentiometer
  const reference = ({ resistor: 'R', capacitor: 'C', electrolytic: 'C', inductor: 'L', diode: 'D', schottky: 'D', zener: 'D', led: 'D', npn: 'Q', pnp: 'Q', nmos: 'Q', pmos: 'Q', njfet: 'Q', switch: 'SW', spdt: 'SW', dpdt: 'SW', potentiometer: 'RV' } as Record<string, string>)[symbol.kind] ?? 'U'
  const angle = symbol.rotation * Math.PI / 180
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const mil = (value: number) => Math.round(value * KICAD_SCALE)
  const position = ([x, y]: Point): Point => [mil(x * cos - y * sin), mil(-x * sin - y * cos)]
  const drawing: string[] = []
  const line = (points: readonly Point[], filled = false) => {
    drawing.push(`P ${points.length} 0 1 18 ${points.flatMap(point => position(point)).join(' ')} ${filled ? 'F' : 'N'}`)
  }
  const circle = (x: number, y: number, radius: number) => {
    const [cx, cy] = position([x, y])
    drawing.push(`C ${cx} ${cy} ${mil(radius)} 0 1 18 N`)
  }
  const rectangle = (left: number, top: number, right: number, bottom: number) => {
    line([[left, top], [right, top], [right, bottom], [left, bottom], [left, top]])
  }

  let passiveLead = 18
  if (passive) {
    if (symbol.kind === 'resistor') {
      passiveLead = 27
      rectangle(-27, -9, 27, 9)
    } else if (symbol.kind === 'capacitor' || symbol.kind === 'electrolytic') {
      passiveLead = 7
      line([[-7, -20], [-7, 20]])
      line([[7, -20], [7, 20]])
      if (symbol.kind === 'electrolytic') {
        line([[-24, -22], [-14, -22]])
        line([[-19, -27], [-19, -17]])
      }
    } else if (symbol.kind === 'inductor') {
      passiveLead = 32
      // Sample the same four cubic loops used by the on-screen IEC symbol.
      for (let loop = 0; loop < 4; loop++) {
        const start = -32 + loop * 16
        const points: Point[] = []
        for (let step = 0; step <= 16; step++) {
          const t = step / 16, u = 1 - t
          points.push([start + 16 * (3 * u * t * t + t * t * t), -69 * u * t])
        }
        line(points)
      }
    } else if (symbol.kind === 'switch') {
      passiveLead = 23
      circle(-23, 0, 3)
      circle(23, 0, 3)
      line(symbol.part?.value === 1 ? [[-20, 0], [20, 0]] : [[-20, -1], [18, -23]])
    } else {
      line([[-18, -18], [18, 0], [-18, 18], [-18, -18]])
      line([[18, -18], [18, 18]])
      if (symbol.kind === 'zener') {
        line([[11, -22], [18, -22], [18, -18]])
        line([[18, 18], [18, 22], [25, 22]])
      }
      if (symbol.kind === 'schottky') {
        line([[11, -13], [11, -20], [18, -20]])
        line([[18, 20], [25, 20], [25, 13]])
      }
      if (symbol.kind === 'led') {
        line([[-5, -25], [9, -39]])
        line([[8, -25], [22, -39]])
        line([[3, -38], [9, -39], [8, -33]])
        line([[16, -38], [22, -39], [21, -33]])
      }
    }
  } else if (transistor) {
    circle(2, 0, 35)
    const bipolar = symbol.kind === 'npn' || symbol.kind === 'pnp'
    const inward = symbol.kind === 'pnp' || symbol.kind === 'pmos'
    if (bipolar) {
      line([[-16, -19], [-16, 19]])
      line([[-16, -11], [25, -35]])
      line([[-16, 11], [25, 35]])
      line(inward ? [[-4, 18], [6, 19], [1, 27], [-4, 18]] : [[21, 32], [11, 30], [15, 23], [21, 32]], true)
    } else {
      line([[-16, -18], [-16, 18]])
      line([[-7, -20], [-7, -9]])
      line([[-7, -5], [-7, 5]])
      line([[-7, 9], [-7, 20]])
      line([[-7, -16], [25, -16], [25, -35]])
      line([[-7, 16], [25, 16], [25, 35]])
      if (symbol.kind === 'njfet') {
        line([[-16, 0], [-26, -5], [-26, 5], [-16, 0]], true)
      } else {
        line(inward ? [[3, 0], [12, -5], [12, 5], [3, 0]] : [[13, 0], [4, -5], [4, 5], [13, 0]], true)
        line([[-7, 0], [25, 0], [25, 35]])
      }
    }
  } else if (potentiometer) {
    rectangle(-27, -9, 27, 9)
    line([[-5, 20], [0, 11], [5, 20]])
  } else {
    rectangle(-symbol.width / 2, -symbol.height / 2, symbol.width / 2, symbol.height / 2)
  }

  for (const pin of symbol.pins) {
    // Round in sheet coordinates first, matching the exported wires exactly.
    const x = mil(pin.x) - mil(symbol.x), y = mil(symbol.y) - mil(pin.y)
    const direction = ({ left: 'R', right: 'L', top: 'D', bottom: 'U' } as const)[pin.side]
    let length: number
    if (passive) length = 60 - passiveLead
    else if (transistor) length = pin.number === 2 ? 64 : 55
    else if (potentiometer) length = pin.number === 2 ? 49 : 33
    else length = pin.side === 'left' || pin.side === 'right'
      ? Math.abs(pin.x - symbol.x) - symbol.width / 2
      : Math.abs(pin.y - symbol.y) - symbol.height / 2
    // Unspecified IC pins retain connectivity without claiming unsupported ERC roles.
    const electricalType = passive || potentiometer ? 'P' : 'U'
    drawing.push(`X ${token(pin.name)} ${pin.number} ${x} ${y} ${mil(Math.max(0, length))} ${direction} 100 110 1 1 ${electricalType}`)
  }

  const fieldY = mil(block ? symbol.height / 2 + 36 : 65)
  return [
    '#', `# ${name}`, '#',
    `DEF ${name} ${reference} 0 ${block ? 100 : 0} Y ${block ? 'Y' : 'N'} 1 F N`,
    `F0 "${reference}" 0 ${fieldY} 140 H V C CNN`,
    `F1 "${name}" 0 ${fieldY - 190} 120 H V C CNN`,
    ...(alias ? [`ALIAS ${token(alias)}`] : []),
    'DRAW', ...drawing, 'ENDDRAW', 'ENDDEF',
  ].join('\n')
}
