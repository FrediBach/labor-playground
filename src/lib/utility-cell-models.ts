import type { PartDefinition } from './circuit.ts'

export function isSwitchKind(kind: string): kind is 'switch' | 'spdt' | 'dpdt' {
  return kind === 'switch' || kind === 'spdt' || kind === 'dpdt'
}

/** [common, throw 0, throw 1], in physical pin order on the virtual adapter. */
export function changeoverPoles(kind: 'spdt' | 'dpdt'): number[][] {
  return kind === 'spdt' ? [[1, 0, 2]] : [[1, 0, 2], [4, 5, 3]]
}

const opampModel = 'Original educational OPAx197 approximation: gain 10,000, 1 TΩ differential input resistance, and smooth saturation 0.1 V inside the connected rails. Requires 4.5–36 V supply separation. A 1 kΩ / 159.154943 nF dominant pole gives nominal unloaded 10 MHz gain-bandwidth, followed by 50 Ω in series with OUT (1.05 kΩ total DC output path). External loading also affects this pole. Zero nominal offset; no calibrated frequency response, slew rate, noise, bias, supply current, current limit, protection or thermal model. Cannot establish cable-load stability or precision pitch accuracy. Virtual DIP adapter retains the SOIC pin numbering.'
export const utilityCellParts: Record<'spdt' | 'dpdt' | 'opa197' | 'opa4197' | 'ssi2162', PartDefinition> = {
  spdt: {
    pinNames: ['Throw 0', 'Common', 'Throw 1'],
    label: 'SPDT changeover switch', unit: '', defaultValue: 0, min: 0, max: 1,
    description: 'Select either of two connections. Also represents an input jack selecting its normal or a patched signal.',
    model: 'Virtual three-pin adapter: common pin 2 selects pin 1 at 0 or pin 3 at 1. Selected contact 1 Ω, unselected contact 1 GΩ. Automatable; no contact bounce or mechanical transition model.',
  },
  dpdt: {
    package: 'DIP-6', pinNames: ['A0', 'A common', 'A1', 'B1', 'B common', 'B0'],
    label: 'DPDT changeover switch', unit: '', defaultValue: 0, min: 0, max: 1,
    description: 'Two linked changeover poles for mode and signal routing.',
    model: 'Virtual DIP-6 adapter, not a manufacturer footprint. At 0, pin 2 selects 1 and pin 5 selects 6; at 1, pin 2 selects 3 and pin 5 selects 4. Contacts use 1 Ω selected / 1 GΩ unselected. Both poles share one automation control. No bounce or mechanical transition model.',
  },
  opa197: {
    package: 'DIP-8', pinNames: ['NC', 'IN−', 'IN+', 'V−', 'NC', 'OUT', 'V+', 'NC'],
    label: 'OPA197-style op-amp', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'Single feedback amplifier with OPA197 SOIC-8 pin numbering on a virtual adapter.',
    supplyHint: 'Pin 7 V+, pin 4 V−; 4.5–36 V total. Pins 1, 5 and 8 are unconnected. Both inputs need external DC returns.',
    model: opampModel,
  },
  opa4197: {
    package: 'DIP-14', pinNames: ['OUT A', 'IN− A', 'IN+ A', 'V+', 'IN+ B', 'IN− B', 'OUT B', 'OUT C', 'IN− C', 'IN+ C', 'V−', 'IN+ D', 'IN− D', 'OUT D'],
    label: 'OPA4197-style quad op-amp', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'Four feedback amplifiers with OPA4197 SOIC-14 pin numbering on a virtual adapter.',
    supplyHint: 'Pin 4 V+, pin 11 V−; 4.5–36 V total. Wire every unused amplifier as a grounded follower.',
    model: opampModel,
  },
  ssi2162: {
    package: 'DIP-10', pinNames: ['MODE', 'IIN1', 'VC1', 'IOUT1', 'GND', 'V−', 'IOUT2', 'VC2', 'IIN2', 'V+'],
    label: 'SSI2162-style dual VCA', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'Two exponential current-in/current-out VCAs. A reference-channel feedback loop can provide linear CV control.',
    supplyHint: 'SSOP-10 numbering on a virtual DIP adapter. Pin 10 V+, 6 V−, 5 GND; use ±4 to ±18 V. MODE is omitted (Class AB). Use input resistors and output transimpedance amplifiers; VC=0 gives unity current gain.',
    model: 'Original nominal approximation: gain=10^(−VC/0.66 V), bounded to 0.00001–10. Signal input is a 1 Ω virtual-ground approximation; VC has 5 kΩ input resistance. Current transfer preserves polarity into an external inverting TIA, with a ±2 mA output bound. Explicit supplies and ground; no modeled MODE, distortion, channel mismatch, noise, temperature, feedthrough, bandwidth, input protection, or supply consumption. Power readings are unavailable.',
  },
}

export function omittedUtilityPin(kind: string, index: number): boolean {
  return kind === 'opa197' && [0, 4, 7].includes(index) || kind === 'ssi2162' && index === 0
}

export function ssi2162Lines(id: string, n: string[]): string[] {
  const ground = n[4], positive = `v(${n[9]},${ground})`, negative = `v(${ground},${n[5]})`
  // Continuous supply collapse keeps source-stepping DC solves well conditioned.
  // The compiler still rejects supplies outside the supported ±4–18 V range.
  const supplyScale = `min(1,max(0,${positive}/4))*min(1,max(0,${negative}/4))`
  return [[1, 2, 3], [8, 7, 6]].flatMap(([input, control, output], channel) => {
    const sense = `vca_${id}_${channel}`
    const gain = `pow(10,max(-5,min(1,-v(${n[control]},${ground})/0.66)))`
    return [
      `VSENSE_${id}_${channel} ${n[input]} ${sense} 0`,
      `RIN_${id}_${channel} ${sense} ${ground} 1`,
      `RCTL_${id}_${channel} ${n[control]} ${ground} 5k`,
      `BVCA_${id}_${channel} ${n[output]} ${ground} I = (${supplyScale})*max(-2m,min(2m,-i(VSENSE_${id}_${channel})*${gain}))`,
    ]
  })
}
