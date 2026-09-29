# Virtual workbench specification — `virtual-1`

This first implementation is a LABOR-inspired virtual breadboard. It is not a physical LABOR replica, and its coordinates, connector positions, source limits, and model impedances must not be used as a hardware wiring reference.

## Reference verification

Checked on 2026-09-29: the [Erica Synths product page](https://www.ericasynths.lv/edu-diy-labor/) lists the English user manual (June 12, 2024), project material, and interface board templates. The [official manual](https://www.ericasynths.lv/service/file/download/product_id/804/file_id/534/) was downloaded, text-extracted, and visually inspected on pages 10–14. The manual is not bundled with the application.

The following are verified physical LABOR facts, distinct from the virtual implementation below:

| Physical hardware | Manual reference |
| --- | --- |
| 830 tie-point breadboard; supply connections require jumpers | p. 10 |
| Power header, top to bottom: +12 V, +12 V, GND, +5 V, +5 V, GND, −12 V, −12 V | p. 10 panel diagram |
| Square/triangle/sine oscillator; low-frequency/audio range switch; frequency knob; square-wave pulse-width knob | p. 11 |
| Signal available from the SIGNAL OUT jack and header | p. 11 |
| Manual gate/trigger/envelope generator, with a decay knob for envelope mode; EG OUT jack and header | pp. 11–12 |
| Buffered variable CV source covering −8 to +8 V | p. 12 |
| AUDIO IN header feeds the output amplifier; AUDIO is line level, PHONES drives headphones | p. 12 |
| Interface adapters plug into 2×4 sockets; 16-pin breakout numbering alternates top/bottom left to right | p. 13 |
| Top-slot potentiometer: CCW → breakout 3/5, wiper → 7/9, CW → 11/13 | p. 13 |
| In the shown bottom-slot jack arrangement: signal → 8/10, switched contact → 4/6; sleeve is internally grounded | pp. 13–14 diagram |

The manual's general adapter description gives jack signal contacts 7/9 and switched contacts 3/5; the page-14 bottom-slot example routes these to the even-numbered breakout row. Slot orientation is therefore essential, and no interface adapter pinout is implemented in this first build.

Numeric oscillator frequency bounds, amplitude, output impedance, rail breaks, precise breadboard dimensions, and detailed supply current limits are not specified in the inspected feature pages. Repeated printed connector labels alone are not sufficient evidence of internal commoning. Before claiming physical fidelity, verify these details against schematics and the actual board revision, then introduce a matching board definition. The envelope generator, interface boards, output amplifier, physical audio sockets, +5 V fixed supply, and generic op-amp are deferred.

## Board coordinates and electrical groups

The SVG scene uses an approximately 920 × 550 coordinate system. Column `c` is positioned at `x = 100 + 24 × (c − 1)` for columns 1 through 30.

| Terminals | Y coordinates | Internally connected |
| --- | --- | --- |
| a–e | 170, 194, 218, 242, 266 | Five holes in the same column, above the trench |
| f–j | 326, 350, 374, 398, 422 | Five holes in the same column, below the trench |
| tp1–tp30 | 100 | 1–15 together; 16–30 together |
| tn1–tn30 | 124 | 1–15 together; 16–30 together |
| bp1–bp30 | 468 | 1–15 together; 16–30 together |
| bn1–bn30 | 492 | 1–15 together; 16–30 together |

There are 420 breadboard holes. The trench separates e from f. Every rail is split between columns 15 and 16. Different rails are never internally connected. Printed polarity/color carries no electrical meaning: every rail starts isolated and requires explicit jumpers to power or ground. Wires connect endpoints only; drawn crossings are not junctions. Components connect electrical nodes through their model without merging those nodes. A physical hole accepts one lead or wire endpoint. Probes do not occupy holes.

## Instrument terminals and virtual source models

Instrument terminals have y=52 and x=135, 295, 455, 615, 775 in this order. They are electrically separate unless the user connects them.

| ID | Label / virtual range | Internal model |
| --- | --- | --- |
| osc | OSC; 20–2,000 Hz; 0–5 V peak | Sine, triangle, or square voltage source relative to GND; 100 Ω series output resistance |
| cv | CV; −5 to +5 V | Ideal DC source relative to GND; no current limit |
| gnd | GND | Explicit reference node 0 |
| vplus | +12 V | Ideal fixed source relative to GND; no current limit |
| vminus | −12 V | Ideal fixed source relative to GND; no current limit |

The oscillator ranges and impedances are deliberate virtual choices. Virtual CV is restricted to ±5 V, compared with the manual's physical ±8 V range. Ideal CV and supply sources are educational simplifications. Direct shorts between these ideal source terminals block capture. An oscillator short is bounded by its modeled 100 Ω resistance. Source output impedance is part of the circuit calculation and therefore slightly affects a loaded oscillator’s measured amplitude.

## Models and capture policy

The component library contains ideal resistors and non-polarized capacitors, a generic silicon diode, a generic red LED, and a static switch. Models have no manufacturer branding. Diode pin order is anode then cathode. Switch resistance is 1 Ω closed and 1 GΩ open. Each component definition exposes its assumptions in `model`.

The compiler follows [ngspice analysis and model documentation](https://ngspice.sourceforge.io/docs.html). Each capture performs a transient analysis for 100 ms, beginning with the DC operating point. Timestep is at most 10 µs and is further limited to one eightieth of the oscillator period. No `.uic` flag, hidden grounding resistor, or previous capacitor charge is supplied. Open or floating circuit nodes without a modeled DC return are reported before simulation. DC displays summarize simulated capture data; a separate DC analysis interface is deferred.

Import boundaries: schema 1, board `virtual-1`, at most 30 components, 120 wires, 60 active external electrical nodes, 100 kB serialized data, finite bounded parameters, valid terminal references, unique IDs, and no overlapping occupancy. The compiler returns deterministic nodes and a physical-terminal map so probes retain their attachment across edits. Arbitrary SPICE, scripts, model URLs, and imported extra properties are never compiled.

## Example circuits

- **RC low-pass:** 10 kΩ plus 100 nF; 220 Hz sine at 2.5 V peak; explicit output return to GND. Nominal RC corner 159 Hz, with oscillator source impedance included in simulation.
- **Voltage divider:** ideal 5 V CV and two 10 kΩ resistors; midpoint 2.5 V.
- **Diode clipper:** oscillator through 1 kΩ into opposing generic silicon diodes with an explicit GND return.

All three examples are ordinary editable documents. Scope channels attach to physical terminals. The JSON document stores no traces or audio data.
