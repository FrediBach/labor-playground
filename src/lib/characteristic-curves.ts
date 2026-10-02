/** SI coordinates; interpolation is linear and endpoint values extend constantly. */
export interface CurvePoint { x: number; y: number }
export function curveValue(points: readonly CurvePoint[], x: number): number {
  if (x <= points[0].x) return points[0].y
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    if (x <= b.x) return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x)
  }
  return points.at(-1)!.y
}
/** Integrate C(u), or u*C(u) for energy, with signed integration limits. */
export function curveIntegral(points: readonly CurvePoint[], voltage: number, energy = false): number {
  const low = Math.min(0, voltage), high = Math.max(0, voltage)
  const knots = [low, ...points.map(p => p.x).filter(x => x > low && x < high), high]
  let sum = 0
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1], b = knots[i], width = b - a
    const ca = curveValue(points, a), cb = curveValue(points, b)
    sum += energy ? width * (a * (2 * ca + cb) + b * (ca + 2 * cb)) / 6 : width * (ca + cb) / 2
  }
  return voltage < 0 ? -sum : sum
}
const n = (v: number) => `(${v.toExponential(16)})`
/** Local polynomials avoid cancellation from a global sum of hinge functions. */
export function curveExpression(points: readonly CurvePoint[], variable: string, integral = false): string {
  const first = points[0], last = points.at(-1)!
  const expression = (p: CurvePoint, slope: number) => integral
    ? `(${n(curveIntegral(points, p.x))}+${n(p.y)}*(${variable}-${n(p.x)})+${n(slope / 2)}*(${variable}-${n(p.x)})^2)`
    : `(${n(p.y)}+${n(slope)}*(${variable}-${n(p.x)}))`
  let result = expression(last, 0)
  for (let i = points.length - 2; i >= 0; i--) {
    const a = points[i], b = points[i + 1]
    result = `(${variable}<${n(b.x)}?${expression(a, (b.y - a.y) / (b.x - a.x))}:${result})`
  }
  return `(${variable}<${n(first.x)}?${expression(first, 0)}:${result})`
}
