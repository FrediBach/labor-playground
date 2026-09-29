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

Numeric oscillator frequency bounds, amplitude, output impedance, rail breaks, precise breadboard dimensions, and detailed supply current limits are not specified in the inspected feature pages. Repeated printed connector labels alone are not sufficient evidence of internal commoning. Before claiming physical fidelity, verify these details against schematics and the actual board revision, then introduce a matching board definition. Interface boards, the output amplifier, physical audio sockets, and +5 V fixed supply are deferred. A virtual gate/trigger/decay-envelope source follows the documented mode choices; its numeric behavior is a deliberate virtual model. A generic dual op-amp is available as a virtual component; it is not a hardware instrument model.

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

Instrument terminals have y=52. The original OSC, CV, GND, +12 V and −12 V terminals retain x=135, 295, 455, 615 and 775 respectively. EG OUT is added at x=855 without changing any earlier terminal or hole coordinate. Outputs are electrically separate unless the user connects them.

| ID | Label / virtual range | Internal model |
| --- | --- | --- |
| osc | OSC; 20–2,000 Hz; 0–5 V peak | Sine, triangle, square, or capture-step voltage source relative to GND; 100 Ω series output resistance |
| cv | CV; −5 to +5 V | Ideal DC source relative to GND; no current limit |
| gnd | GND | Explicit reference node 0 |
| vplus | +12 V | Ideal fixed source relative to GND; no current limit |
| vminus | −12 V | Ideal fixed source relative to GND; no current limit |
| eg | EG OUT; gate/trigger/envelope; 5 V peak | Behavioral voltage source relative to GND; 100 Ω series output resistance; exponential decay time constant 1–40 ms |

The oscillator ranges and impedances are deliberate virtual choices. Virtual CV is restricted to ±5 V, compared with the manual's physical ±8 V range. Ideal CV and supply sources are educational simplifications. Direct shorts between these ideal source terminals block capture. OSC and EG shorts are bounded by their separate modeled 100 Ω resistances. Source output impedance is part of the circuit calculation and therefore slightly affects a loaded oscillator’s measured amplitude.

EG OUT reproduces the manual’s three mode choices without an ADSR interface. These numeric settings describe the virtual source, not measured physical LABOR behavior:

- **Gate:** a saved high/low state holds the ideal source at 5 V or 0 V throughout the capture and at the DC operating point.
- **Trigger:** one positive pulse begins at 1 ms, with 1 µs rise/fall transitions. The falling edge begins at 2 ms, so the rising-to-falling interval is 1 ms. A finite piecewise-linear source defines one pulse per capture and supplies breakpoints at the edges; it has no repeating clock.
- **Envelope:** a rapid exponential attack begins at 1 ms with a 0.1 µs rise time constant, reaching 99.995% of 5 V within 1 µs. The decay begins at 1.001 ms, with its time constant adjustable from 1 to 40 ms and defaulting to 20 ms. The native ngspice `EXP(0 5 1m 0.1u 1.001m decay)` source evaluates both transitions in the circuit simulation; after the negligible rise tail it follows `5 × exp(−(time − 1.001 ms) / decay)`. This avoids interactions between multiple pulse timing sources. The 10 µs maximum capture timestep can undersample the very short attack. Loaded terminal voltage includes the 100 Ω output resistance. Long decays can extend beyond the captured 100 ms window.

The source is referenced internally to instrument GND, while breadboard rails still require jumpers. It is independent of oscillator amplitude, waveform, and Periodic/Step selection. Trigger/envelope mode starts at 0 V for the DC operating point. Each Capture or Fire action restarts the complete circuit from its initial operating point; there is no preserved envelope phase or capacitor charge. Gate hold is a document setting that participates in undo and JSON saving. The source is always available at EG OUT and affects a circuit only through explicit wiring.

## Models and capture policy

The component library contains ideal resistors, non-polarized and polarized capacitors, a generic silicon diode, a generic red LED, a static switch, a linear potentiometer, and a generic dual op-amp. Models have no manufacturer branding. Each component definition exposes its assumptions in `model` and its ordered `pinNames`.

- **Diode/LED:** pin order is anode then cathode; existing generic models remain unchanged.
- **Switch:** 1 Ω closed and 1 GΩ open.
- **Potentiometer:** ordered pins CCW, wiper, CW; 100 Ω–1 MΩ total resistance. `position` is 0 at CCW, 1 at CW, defaulting to 0.5 when omitted. The two resistances are `max(1 Ω, position × total)` and `max(1 Ω, (1 − position) × total)`. The endpoint floor therefore adds 1 Ω to the nominal end-to-end resistance at an extreme. Three consecutive holes form the footprint. Horizontal and vertical rotation are supported, but the rigid footprint cannot span the trench. Vertical same-strip placement is electrically bypassed and warns.
- **Electrolytic capacitor:** ordered pins positive then negative, rendered with polarity marks. The ideal capacitor has no ESR, leakage, breakdown, or damage behavior. Detected reverse bias produces a warning without changing the simulated capacitance; it does not stop capture.
- **Dual op-amp:** a deliberately static behavioral model, with open-loop gain 100,000, 100 MΩ differential input resistance and 50 Ω output resistance per half. Its internal output targets the supply midpoint plus the amplified differential input, clipped 1 V inside the two visible supply voltages. Each controlled source returns to its visible negative supply pin. Supply separation must exceed 2 V for amplification. As separation falls toward 2 V, the available output swing collapses continuously to the supply midpoint; reversed dynamic supplies collapse the internal source to V−. This continuous limiting avoids a discontinuity during DC source stepping. Missing, directly reversed, and insufficient known supplies block capture. Circuit-dependent supply voltages warn because their separation cannot be known before simulation. Both inputs on each half require an external DC path; differential input resistance is not used to conceal a disconnected input. Connect an unused half as a grounded follower. No hidden supply or ground connection is inserted. The model omits bandwidth, slew rate, common-mode input limits, offset, supply-current accounting, noise, current limiting and damage. Output resistance models loading but is not a supply-current or short-circuit protection model.

The DIP-8 pin order was verified against [TI's TL07xx datasheet, Figure 4-5 and Table 4-3](https://www.ti.com/lit/ds/symlink/tl072.pdf) on 2026-09-29: 1 OUT A, 2 IN− A, 3 IN+ A, 4 V−, 5 IN+ B, 6 IN− B, 7 OUT B, 8 V+. This establishes the footprint only; the model is not a TL072 simulation. At 0°, pin 1 anchors at eN and pins 1–4 advance along e while pins 5–8 return along f. At 180°, pin 1 anchors at fN and the column direction reverses. Other orientations and off-trench placement are rejected, including on import. Existing two-lead documents retain their arbitrary lead spacing.

The compiler follows [ngspice analysis and model documentation](https://ngspice.sourceforge.io/docs.html), including exponential and piecewise-linear sources in sections 4.1.3–4.1.4 and B-source voltage expressions in section 5.1.1 of the [ngspice user manual](https://ngspice.sourceforge.io/docs/ngspice-39-manual.pdf). The op-amp uses bounded expressions in that documented behavioral source, verified against the shipped WASM engine. Each capture performs a transient analysis for 100 ms, beginning with the DC operating point. Timestep is at most 10 µs and is further limited to one eightieth of the oscillator period. No `.uic` flag, hidden grounding resistor, or previous capacitor charge is supplied. Open or floating circuit nodes without a modeled DC return are reported before simulation. Operating-point compilation replaces the transient directive with `.op`, retaining identical device and node names. It saves diode/LED branch-current vectors explicitly along with all node voltages. DC operating-point values are distinct from means of a transient capture; trigger/envelope sources are still 0 V at that initial point. Periodic captures retain the selected sine/triangle/square waveform. Step captures temporarily drive OSC from 0 V to the amplitude at 1 ms, hold it until 51 ms, and return to 0 V, with 1 µs transitions and a 1 s repeat period. Only one pulse occurs in the 100 ms capture; the stored oscillator waveform is preserved.

Import boundaries: schema 1, board `virtual-1`, at most 30 components, 120 wires, 60 active external electrical nodes, 100 kB serialized data, finite bounded parameters, valid terminal references, unique IDs, and no overlapping occupancy. The compiler returns deterministic nodes and a physical-terminal map so probes retain their attachment across edits. Arbitrary SPICE, scripts, model URLs, and imported extra properties are never compiled. Fixed model expansion is bounded by six devices and two internal nodes per component: at most 180 component-model devices and 60 internal model nodes, in addition to at most seven instrument devices (five original source devices plus two for EG OUT). Schema 1 remains backward compatible: omitted `stimulus` means periodic, omitted potentiometer `position` means midpoint, and these optional fields are not injected into legacy imports. An omitted `instruments.envelope` uses mode `envelope`, `gateHigh: false`, and `decayMs: 20` without adding that object during import. When supplied, all three settings are required; mode, boolean gate state, finite 1–40 ms decay, and allowed property names are validated. Rigid potentiometer and IC footprints are validated during import; pin count and occupancy apply to every lead.

## Example circuits

- **RC low-pass:** 10 kΩ plus 100 nF; 220 Hz sine at 2.5 V peak; explicit output return to GND. Nominal RC corner 159 Hz, with oscillator source impedance included in simulation.
- **Voltage divider:** ideal 5 V CV and two 10 kΩ resistors; midpoint 2.5 V.
- **Diode clipper:** oscillator through 1 kΩ into opposing generic silicon diodes with an explicit GND return.
- **Capacitor charge/decay:** 10 kΩ and 1 µF polarized capacitor, plus the oscillator’s 100 Ω source impedance; a 5 V capture step rises at 1 ms and falls at 51 ms. Effective time constant 10.1 ms, verified on both the rise and decay.
- **Op-amp gain stage:** non-inverting gain 2 from equal 10 kΩ feedback resistors, with visible ±12 V supplies. The second amplifier is a grounded follower. Changing the feedback resistor to 20 kΩ gives gain 3; sufficiently large gains clip near ±11 V subject to output loading.

- **Envelope shaping:** EG OUT drives 10 kΩ and 100 nF; CH1 follows the input envelope and CH2 shows the rounded attack. The 20 ms default decay is independent of the RC filter’s 1.01 ms time constant including source resistance. Increasing the capacitor to 470 nF lowers and delays the output peak.

All six examples are ordinary editable documents. Scope channels attach to physical terminals. The JSON document stores no traces or audio data.

## Editing and view geometry

Resistors, capacitors, electrolytics, diodes, LEDs, and switches can move one lead independently. The other lead, pin order, component value, and polarity are preserved. A new edited spacing must be between 24 and 192 SVG units (1–8 hole pitches), use distinct breadboard holes, and respect occupied holes. Imported legacy two-lead spacing remains valid; these bounds apply to new individual-lead edits. Each completed move is one undo action. Wires and probes remain attached to their physical holes. Potentiometer and DIP-8 geometry stays rigid.

Pan, zoom, fit actions, and scope height are presentation state only. They do not change saved documents, connectivity, captures, or undo history. At 100% the responsive viewport fits the 920 × 550 workbench extent, including source terminals. Fit breadboard frames the board body at (46, 79), with extent 828 × 450; source terminals may be outside this closer view. Zoom buttons preserve the visible center subject to the scroll bounds.
