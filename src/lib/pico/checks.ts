import type { ResultType } from 'eecircuit-engine'
import { PICO_MODEL } from './electrical.ts'
export interface PicoElectricalCheck { gpio: number; node: string }
/** Inspect actual solved voltages and driver conductances, including unprobed pins. */
export function checkPicoEnvelope(result: ResultType, checks: PicoElectricalCheck[]) {
  if (result.dataType !== 'real') throw new Error('Pico requires real electrical results.')
  const vectors = new Map(result.data.map(vector => [vector.name.toLowerCase(), vector.values]))
  for (const { gpio, node } of checks) {
    const voltage = node === '0' ? Array(result.numPoints).fill(0) as number[] : vectors.get(`v(${node.toLowerCase()})`)
    const high = vectors.get(`v(pico_${gpio}_high)`)
    const low = vectors.get(`v(pico_${gpio}_low)`)
    if (!voltage || !high || !low || [voltage, high, low].some(values => values.length !== result.numPoints)) throw new Error(`GP${gpio}: missing electrical envelope data.`)
    for (let index = 0; index < voltage.length; index++) {
      const v = voltage[index]
      if (![v, high[index], low[index]].every(Number.isFinite)) throw new Error(`GP${gpio}: invalid electrical result.`)
      if (v < PICO_MODEL.minVoltage || v > PICO_MODEL.maxVoltage) throw new Error(`GP${gpio}: ${v.toFixed(2)} V is outside the supported −0.3…3.6 V model envelope. Disconnect bipolar or conflicting sources.`)
      const current = Math.abs(low[index] * v + high[index] * (v - 3.3))
      if (current > PICO_MODEL.maxCurrent) throw new Error(`GP${gpio}: ${(current * 1000).toFixed(1)} mA exceeds the 20 mA model envelope. Add resistance or remove conflicting drives.`)
    }
  }
}
