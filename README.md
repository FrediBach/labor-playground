# Pico Labor

A local circuit workbench built with React, TypeScript, Vite, SVG, and shadcn/ui. Start with an editable RC filter, change the capacitor, and see the result from a real ngspice simulation running in a browser worker.

This build implements the editable workbench, thirty-three-part component library, Pico programming, automations, and forty-two examples expanding on [plan.md](./plan.md). The workbench uses a documented virtual board inspired by LABOR; it is not a calibrated reproduction of the physical hardware.

The [Pico runtime](./docs/pico-runtime.md) adds local MicroPython execution, Monaco semantic IntelliSense, and GPIO/PWM-to-ngspice captures. Select a Pico example, edit `main.py`, and press **Simulate** in the top bar (or **Run** in the editor). Circuit-fed inputs, ADC feedback, PIO and multicore are unsupported. The [implementation plan](./docs/pico-implementation-plan.md) records the release scope and later feedback milestone.

**Pico · OLED display** demonstrates a four-wire SSD1306 128×64 display with text, a counter, and an animated progress bar. Load the example, Simulate, then play or scrub its one-second recording. The self-contained MicroPython example also runs on a physical Pico; see the [OLED guide](./docs/pico-runtime.md#ssd1306-oled-display) for wiring and model limits.

## Try it

Use Node.js 24 (see `.nvmrc`) and npm:

```sh
nvm use
npm ci
npm run dev
```

Open the URL printed by Vite. No API keys, environment variables, accounts, or backend services are required. The app bundles its engine and assets, and circuit simulation stays on your device.

The center workspace has **Circuit**, **Schema**, **Results**, **Automations**, and **Overview** tabs, plus **Pico Code** when a Pico is present. Switching tabs preserves zoom, scope settings, recording position, and editor state. Use Left/Right, Home, and End on the tab bar to navigate with the keyboard.

**Schema** generates an annotated electrical schematic with component references, values, pin numbers, supplies, probes, and shared net labels. Small circuits use direct wiring; larger circuits use matching labels to keep connections readable. Drag or scroll to pan, use the zoom buttons or Ctrl/⌘ + wheel to zoom, and **Fit** to see the entire sheet. **Voltages** overlays recorded node voltages relative to GND at the same playback position as Results; scrub or play from either tab. Edits that require simulation hide outdated readings. **SVG** and **PNG** export the entire sheet, including enabled voltage annotations. **SCH** downloads an editable KiCad legacy schematic in a ZIP with its companion symbol library and local library table. Extract all files into the same folder, then open the `.sch` file in KiCad. Symbols, physical pin numbers, wires, net labels, group outlines, and enabled voltage snapshot notes are included; the virtual instrument sources remain named nets with setting notes. The export does not include firmware, behavioral simulation models, footprints, or PCB layout. Under **Component groups**, select parts and apply a group name to enclose them together; the inspector’s **Schema group** field also assigns or clears membership. Group changes support undo and travel with project JSON, browser recovery, and folder sync without invalidating a capture.

1. Select **C1**, then try the **220 nF** preset. CH2 shows the changed filter output.
2. Find a part with search or the category filter, then click a hole or drag the part from the tray. The catalog scrolls independently; Raspberry Pi Pico, jumper wires, and both scope probes stay above it. Press **R** to rotate the placement. Drag an existing component to move it. Select a two-lead part and use **Move** beside either pin to change its spacing, with a preview before committing.
3. Choose **Jumper wire** and click two free terminals. Select a wire to change its color, remove it, or move an endpoint.
4. Click **CH1** or **CH2** on the integrated scope (or select a probe from the tray), then click a terminal. Use **Simulate** in the sticky top bar or leave **Auto update** enabled. **View results** opens the **Results** tab; its **Capture** button repeats the same simulation. The small display shows the current capture; the full scope in **Results** provides adjustable scales and **Measurements**, including A/B cursors and the CH1 − CH2 differential meter.
5. Use the **Audio / Power** module: choose a channel, then click the **Phones / Listen** jack for a one-shot preview or select **Steady loop** for a verified repeating signal. Turn **Volume** while listening. Audio starts muted; **Mute** and circuit edits stop playback.
6. Explore **Examples**, grouped into Basic, Intermediate, and Advanced. Start with attenuation and filtering, then try envelope following, CV mixing, an attenuverter, and the Sallen–Key filter. Each experiment has **What to try** and **Build on EDU LABOR** guides in **Overview**, alongside circuit checks, a live parts list, and the generated netlist. Select **Inspect** beside a part or circuit issue to open that component on the board and in the inspector. The right sidebar contains only the selected component or wire’s values, connections, measurements, and model details. Active circuits require both visible supply connections; removing either blocks capture.
7. In **Results**, choose **Duration** (100 ms–10 s), then use the **Simulation recording** timeline to inspect any moment. **Play**, **Loop**, and speeds from 0.001× to 2× replay the recording; LED brightness, pin voltages, currents, power, and stored energy follow its selected time. Pico GPIO states and its onboard LED follow the recorded firmware events. Open **DC operating point** below the scope for initial node voltages. Select a component to read its DC current and power in the inspector. **Trigger** frames rising or falling crossings without changing the circuit. In Pico code, `import scope` and call `scope.log("target", value, unit="V")` to add named numeric traces on the same time axis. **Show Pico logs** and **Show automation events** independently toggle code traces and clickable automation markers; see the [Pico logging guide](./docs/pico-runtime.md#log-code-values-to-the-oscilloscope).
8. Open **Automations** and choose **Add automation** to move a knob, operate a switch, or press and release a gate during the capture. Start at a fixed simulation time, when CH1/CH2 crosses a voltage, or after another automation finishes. Use **Flow** for branching and measurements, and **Tests** for saved circuit checks. Try **Automated knob sweep** or **Voltage-triggered gate release** in Examples, then select a recorded automation event to inspect its result. See the [automation guide](./docs/automations.md) for triggers, ramps, and repeatable experiments.
9. **Export circuit** saves JSON, including automation definitions. **Import** restores it, while browser recovery remembers the latest circuit when storage is available.

Drag any instrument knob up or right to increase its value; hold Shift for fine adjustment. Numeric inputs and arrow keys edit the same parameter. **Manual Gate** fires the envelope/trigger or latches the held gate, depending on **Type**.

Use **Place** on the lower **Multipurpose Control Board** to add a potentiometer or switch to the breadboard. Wire its pins on the board, then operate its matching front-panel control. The inspector and control board share the same values, and a knob drag commits as one undoable action.

Use **Pan**, Space-drag, or the middle mouse button to move a zoomed board. **Fit breadboard** frames the holes; **Fit all / Fit workbench** includes the source terminals. Ordinary trackpad scrolling works inside the zoomed view. Drag the grip below the scope trace to resize it, or focus the grip and use Up/Down; Enter restores its default height. These view changes do not alter the circuit or undo history.

Board shortcuts apply in **Circuit**. Keyboard: **Ctrl/Cmd+Enter** simulate (including from the Pico editor or a numeric field), **W** wire, **V** select, **R** rotate placement, **Escape** cancel, **Delete/Backspace** remove selection, **Ctrl/Cmd+Z** undo, **Ctrl/Cmd+Shift+Z** or **Ctrl+Y** redo. Breadboard holes also support arrow navigation and Enter/Space activation. Additional shortcuts: **H** pan, **1/2** place probes, **+/−** zoom, **0** fit breadboard, **F** fit workbench, **C** connections, and **[/]** toggle the library/inspector. **Alt+1–5** opens Circuit, Code (when available), Automations, Results, and Overview. Text fields and editor shortcuts keep their normal behavior. Press **?** outside a text field for the searchable guide and complete shortcut reference.

### Local folder sync

Choose **Connect folder**, then **Sync now** or **Ctrl/Cmd+S** to synchronize `circuit.json` in a dedicated project folder. The file contains the circuit, instruments, automations, and embedded Pico source. Connecting does not write files. Sync loads external-only changes and saves workbench-only changes; concurrent changes require choosing **Keep workbench** or **Load folder version**. An existing different project also requires this choice. Folder loads are undoable, errors leave the workbench intact, and other folder files are untouched.

Sync is manual and the folder must be reconnected after a page reload. Folder access uses the [File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access) and requires a supported secure browser context (such as desktop Chrome/Edge on HTTPS or localhost). Import/Export remain available elsewhere. **Ctrl/Cmd+S** exports when no folder is connected; **Ctrl/Cmd+O** imports. Disconnecting preserves the files.

## Included in this build

- A LABOR-inspired birch chassis with black module panels, an integrated capture display, tactile knobs and gate button, metallic patch points, and a cream breadboard. The 30-column virtual board and existing source models remain distinct from the physical hardware.
- A 30-column breadboard with separate five-hole strips, a center trench, and explicitly split, unpowered rails. Connected-net highlighting and **Show connections** expose its topology. Pan, center-preserving zoom, and separate breadboard/workbench fit actions keep parts reachable.
- Thirty-three component types: resistor, non-polarized capacitor, polarized electrolytic capacitor, inductor, potentiometer, generic silicon diode, Schottky diode, adjustable Zener diode, generic red LED, NPN and PNP transistors, switch, TL072-style dual op-amp, TL074-style quad op-amp, 555 timer, LM13700-style dual OTA, N-channel JFET, N-channel MOSFET, LM393-style dual comparator, CD4066-style quad analog switch, P-channel MOSFET, LED/LDR optocoupler, CD40106-style hex Schmitt inverter, CD4053-style triple signal selector, CD4013-style dual flip-flop, CD4070-style XOR gates, CD4081-style AND gates, PC817-style phototransistor optocoupler, CD4024-style ripple counter, CD4093-style Schmitt NAND gates, CD4001-style NOR gates, LM4040-style 2.5 V shunt reference, and SSD1306 OLED display. The searchable library groups these into Passive, Diodes & LEDs, Transistors, Controls & ICs, and Displays; its Pico, wire colors, and scope probes remain outside the scrolling catalog. Placement checks every lead; DIP-4, DIP-8, DIP-14, and DIP-16 parts straddle the trench in either orientation. Two-lead parts support individual pin movement with 1–8 hole spacings, polarity preservation, previews, keyboard controls, and occupancy checks. Probes attach without occupying holes.
- Thirty-three ordinary editable examples, grouped by difficulty: the original RC low-pass, voltage divider, diode clipper, capacitor charge/decay, op-amp gain stage, and envelope shaping, plus CV attenuation, AC coupling, gate-to-trigger shaping, diode envelope following, CV/audio mixing, a buffered attenuverter, a Sallen–Key two-pole low-pass, a 555 clock oscillator, a 555 trigger-to-pulse circuit, a TL074 buffered signal splitter, an LM13700 voltage-controlled amplifier, a JFET source follower, a MOSFET gate inverter, comparator audio-to-gate conversion, a CD4066 track-and-hold, a Schmitt RC oscillator, a CD4053 audio/CV selector, an optical audio gate, a P-channel high-side switch, a sub-octave divider, an XOR digital ring modulator, an AND gated clock, an optocoupler gate receiver, a seven-stage clock divider, a Schmitt NAND gated oscillator, a NOR clock inhibit, and a 2.5 V CV reference. The seven earlier synth circuits use component values in the EDU LABOR full-kit inventory. The partial kit needs separately sourced experimental components; physical source levels and breadboard coordinates differ from the simulation.
- Up to 24 editable automations per circuit, with fixed-time or rising/falling voltage triggers. Automate CV, oscillator amplitude/frequency, gate pulses or held states, placed potentiometers, and switches. Each runs once per capture; knob movements can ramp over a chosen duration. Two additional examples demonstrate a timed knob sweep and capacitor-voltage-triggered gate release. Definitions support undo/redo, export/import, and browser recovery.
- Oscillator waveform/frequency/amplitude controls, a DC CV source, GND, and ±12 V source terminals. A separate capture stimulus selects periodic input or a 0 → amplitude → 0 charging/decay step. The EG terminal supplies a held gate, 1 ms trigger, or exponential decay envelope (1–40 ms time constant), with a virtual 5 V level and 100 Ω output resistance. **Fire** starts a fresh event capture.
- A separate DC operating-point solve followed by real 100 ms–10 s transient captures through `eecircuit-engine` 1.8.0, isolated in a dedicated worker. Edits coalesce, outdated results are discarded, and a timed-out worker can be recreated.
- A resizable two-channel scope with independent voltage scales, shared time scale, autoscale, min/max/peak-to-peak/time-weighted mean, conservative frequency detection, persistent A/B time cursors, Δt/ΔV, and a differential voltage meter. Basic rising/falling triggering frames the first confirmed crossing; no crossing is explicitly reported. Cursors retain absolute capture times. DC and irregular signals display frequency unavailable.
- A complete transient recording of component pin voltages and supported currents, with seekable playback, looping, a scope playhead, and LED state visualization. The inspector’s **Signal history** plots each selected component pin or wire without attaching a scope probe, with a shared voltage scale, selectable traces, zoomable time windows, and a cursor linked to recording playback. Two-lead components also offer a dashed pin 1 − pin 2 trace. Click or drag the graph to seek; use arrow keys for small steps and Home/End for the capture boundaries. Current, power, and energy follow the cursor, separately from initial DC; behavioral IC currents remain unavailable. Longer runs use adaptive stepping and explicit sample, memory, and execution limits.
- An initial DC meter using the separate operating-point solve, including CH1 − CH2 voltage. The inspector shows signed DC currents and absorbed power for resistors, switches, potentiometers, diodes, LEDs, and ideal capacitors. Channel labels highlight their breadboard connections.
- Deliberate one-shot audio and optional sustained playback of a verified steady region. Loops require at least three matching cycles and phase-aligned boundaries; irregular or one-shot signals cannot loop. Timestamp resampling, periodic filtering, DC removal, gain limiting, and start/stop fades keep monitor processing separate from measurements. Live level changes do not restart playback.
- Editable inductors (1 µH–10 H, with a documented 1 Ω winding resistance) and Zener voltages (2.4–24 V), with generic Schottky and NPN/PNP models. Transistors use a rigid, labeled C–B–E footprint; physical device pinouts vary. The inspector reports initial DC currents and power for all five added types. These educational models do not model thermal damage, and inductor current restarts from the DC operating point with each capture.
- An LM13700-style dual OTA with current-controlled transconductance, differential-input saturation, finite output compliance, linearizing diodes, and separate Darlington buffers. Its VCA example varies audio gain with CV. The TL072 name identifies the existing dual model’s pinout and intended circuits; its electrical behavior and saved `opamp` kind remain unchanged. All named ICs are educational approximations.
- A stateful 555 approximation with external RC timing, CTRL voltage, RESET, finite output drive, and a discharge path. Each capture starts with a 1 µs power-on reset; its DC reading represents that reset state. The TL074-style part supplies four independent feedback amplifiers with the DIP-14 pin numbering; it is an educational static model without bandwidth or slew-rate behavior. Both ICs require visible power connections and include pin-by-pin inspector guidance. IC current/power readouts remain unavailable; use the scope for their behavior.
- Measured reverse-bias warnings for polarized capacitors and explicit missing-supply/input diagnostics for op-amps. Warnings identify the affected part; no destruction animation or hidden repair connection is added.
- A docked original Pico with 26 GPIO headers, explicit common ground, local firmware/language workers, Run/Stop/Reset, a bounded console, and five editable Pico examples. Source and circuit round-trip in schema-2 projects; legacy schema-1 documents remain supported.
- Undo/redo, example restore, clear board, validated JSON import/export, and optional browser recovery. No waveform or audio arrays are saved with the circuit.

## Current boundaries

This is a desktop-first prototype. Captures restart at the DC operating point; they do not preserve capacitor charge through edits or run a continuous circuit timeline. Scope measurements describe the transient capture; its differential meter reads CH1 − CH2 at a cursor or as a time-weighted capture mean. The separate DC panel describes the solved initial state, so periodic and one-shot waveforms can have different DC and capture-mean readings.

The initial envelope is 30 components, 120 wires, and 60 active external electrical nodes. Floating component nodes and direct ideal-supply shorts block capture instead of receiving hidden repair connections. The oscillator and EG source each include a documented virtual 100 Ω output resistor. Other source and component models are deliberately simplified.

Automations restart from the saved control values with every capture. Voltage triggers require a crossing after their earliest time; they do not fire simply because the signal starts above or below the threshold. Each enabled automation runs once, and playback looping does not rerun it. Automations operate within a finite capture and do not control physical hardware. See the [automation guide](./docs/automations.md) for action behavior and examples.

Physical interface boards, advanced scope triggering, and continuous simulation/audio streaming are deferred. Recording playback replays completed data without solving again. The audio monitor separately previews up to the first second or 100,000 samples of a long capture, and labels this preview window. Steady-loop listening replays a completed capture and stops when the circuit changes. The TL072-style dual and TL074-style quad op-amps use educational static models with visible rails and bounded output; bandwidth, slew rate, and physical supply-current behavior are not modeled. Polarized capacitors use an ideal electrical model with polarity diagnostics, not a damage model. New two-lead adjustments are limited to 1–8 hole spacings, while older imported placements remain valid. Potentiometer, transistor, and IC footprints stay rigid. The board has no general schematic editor or autorouter. Cross-browser, accessibility, and performance acceptance work remains part of the roadmap.

Read [the hardware specification](./docs/hardware-spec.md) for verified manual references and the virtual board's exact connections. Read [the performance analysis](./docs/performance.md) for measured bottlenecks and improvements. Read [the engine notes](./docs/engine-notes.md) for worker behavior, numerical assumptions, bounds, audio processing, and licensing provenance.

The [custom components plan](./docs/custom-components-plan.md) records the architecture assessment and proposed implementation for user-defined resistance/current and capacitance/voltage curves.

The [automation guide](./docs/automations.md#dependent-flows) covers Simple/Flow editing, reusable measured results, repeatable circuit tests, and the local `npm run test:circuit` command. The [design plan](./docs/automation-flows-plan.md) records the execution contract and release checklist.

## Checks and builds

```sh
npm test          # Compiler, actual ngspice numerical fixtures, audio, worker scheduling
npm run lint      # Oxlint, including React hook rules
npm run typecheck # TypeScript checks
npm run build     # TypeScript checks and production assets in dist/
npm run test:e2e  # Playwright browser integration tests
npm run preview   # Serve the production build locally
```

The unit/numerical suite covers topology and import validation, real ngspice divider/filter/diode behavior, potentiometer endpoints, RL time constants, Schottky forward/reverse behavior, adjustable Zener breakdown, NPN/PNP cutoff/gain/saturation and signed DC currents, capacitor charging/decay, op-amp gain and supply-dependent clipping, envelope timing and loading, the new synth examples and their suggested changes, separate operating-point currents and power, 555 astable/monostable timing and reset/control behavior, all four quad-amplifier sections, LM13700 bias/gain/diode/buffer behavior and VCA control, polarity checks, trigger framing, measurement interpolation, audio, and worker recovery. Browser tests cover categorized library search, pinned tools, new part placement and recovery, example selection and build guides, placement, 8/14/16-pin movement and import, component controls and undo, individual lead editing, board navigation, scope resizing, live audio and mute behavior, live measurements, DC readings, envelope controls, trigger framing, stale results, import/export, and recovery. Run the application workflows against the production bundle with:

```sh
npm run build
LABOR_PRODUCTION=1 npm run test:e2e -- examples.spec.ts workbench.spec.ts components.spec.ts measurements.spec.ts instruments.spec.ts trigger.spec.ts lead-editing.spec.ts viewport.spec.ts monitor.spec.ts
```

Browser tests require Chromium (`npx playwright install chromium` if needed). See `playwright.config.ts` for the configured browser and isolated local server on port 5177.

## Project layout

| Path | Responsibility |
| --- | --- |
| `src/App.tsx` | Workbench composition, document actions, import/export, audio controls |
| `src/components/workbench/` | SVG breadboard, component artwork, inspector, numeric controls, Canvas scope |
| `src/components/ui/` | Project-owned shadcn components |
| `src/lib/circuit.ts` | Versioned documents, virtual geometry, validation, connectivity compiler, examples |
| `src/lib/passive-examples.ts`, `src/lib/active-examples.ts`, `src/lib/ic-examples.ts` | Modular synth experiments, hardware notes, and editable circuit documents |
| `src/lib/automation-examples.ts`, `docs/automations.md` | Timed and voltage-triggered experiments and the automation guide |
| `src/lib/lm13700.ts` | Bounded dual OTA, bias and linearizing diodes, output compliance, and Darlington buffers |
| `src/lib/timer555.ts` | Bounded analog 555 model, latch, CTRL divider, and discharge/output behavior |
| `src/lib/use-document.ts` | Undo history and browser recovery |
| `src/lib/simulation*.ts` | Simulation hook, worker client, worker, capture extraction, limits |
| `src/lib/measurements.ts` | Time-weighted statistics, frequency detection, cursor interpolation, differential voltage |
| `src/lib/trigger.ts` | Threshold-crossing detection and bounded capture framing |
| `src/lib/audio.ts`, `src/lib/audio-loop.ts` | Explicit Web Audio playback, settled-cycle selection, periodic resampling, monitor level |
| `src/lib/part-editing.ts`, `src/lib/board-viewport.ts` | Lead-edit validation and view geometry |
| `tests/` | Compiler, numerical, audio, worker, and browser checks |
| `docs/` | Hardware/model specification and simulation integration notes |

Use `@/` to import from `src/`. The document format only accepts supported component data and physical terminal references; imported scripts, external models, and arbitrary SPICE directives are not executed.

## Production deployment

The public site is **https://picolabor.com**. Import this repository into Vercel and use Node.js 24. The checked-in `vercel.json` configures the Vite build, `dist` output, security headers, and immutable caching for fingerprinted assets. Add `picolabor.com` in the Vercel project's Domains settings and configure the DNS records Vercel provides. If adding `www.picolabor.com`, redirect it to the apex domain there.

The canonical URL, Open Graph and Twitter metadata live in `index.html`; crawler files and branding assets live in `public`. To regenerate the PNG sharing image and icons after changing the vector artwork, run `node scripts/generate-branding.mjs` (requires Playwright Chromium).

### Custom components

Create project-local **resistors with R(|I|)** and **non-polarized capacitors with differential C(V)** from the parts library. The keyboard-accessible table includes engineering units, curve preview and validation. Definitions can be placed, assigned to compatible parts, duplicated, edited across shared instances, or copied independently. Save is one undoable transaction; Cancel leaves the circuit unchanged. Clear board preserves definitions; in-use definitions must be reassigned or removed before deletion.

Curves interpolate linearly and extend at constant endpoint values. Resistors obey `V = I × R(abs(I))`; capacitors use integrated charge `Q(V) = ∫ C(u) du` and stored energy `E(V) = ∫ u C(u) du`. Current and power come from the solver. Captures warn when endpoint extension was used. Nominal values and resistor bands represent R(0) or C(0), not a live reading. Each capture starts at its DC operating point.

Schema 3 embeds definitions in exports, browser recovery, folder sync and history, including Pico projects. Schemas 1 and 2 remain supported. Limits: 32 definitions, 2–64 points each, 30 placed parts, 200 kB formatted project JSON; current axis 0–1 A with ≥1 µA spacing, voltage axis −100–100 V with ≥1 mV spacing and an explicit zero point. R spans 10 Ω–10 MΩ, C spans 100 pF–10 mF. Slopes are bounded at 10⁹ Ω/A or 1 F/V, and differential resistance must stay positive. Models are instantaneous and lossless where applicable; thermal memory and hysteresis are outside this release.

Try the **Current-sensitive resistor** and **Voltage-sensitive capacitor** examples. See [engine notes](docs/engine-notes.md) for numerical tests and resource measurements.

### Additional synth building blocks

The **N-channel JFET** and **N-channel MOSFET** use nonlinear ngspice device models with junction behavior and capacitance, rigid D–G–S footprints, and measured drain/gate currents and power. They are generic devices; physical transistor pinouts and parameters vary.

The **LM393-style dual comparator** has open-collector outputs requiring external pull-ups, finite sink resistance/current, input bias, and a finite response time. The **CD4066-style quad analog switch** has four independent bilateral channels, supply- and signal-dependent resistance, off leakage, and terminal capacitance. Both have numbered DIP packages, supply validation, and searchable synth-use keywords. Their original behavioral approximations use the [LM393](https://www.ti.com/lit/ds/symlink/lm393.pdf) and [CD4066B](https://www.ti.com/lit/ds/symlink/cd4066b.pdf) pinouts; they are not manufacturer macromodels. See each inspector’s **Model details** for parameters and omissions. Dynamic overvoltage, temperature, noise, and damage are not simulated; the analog switch also omits charge injection.

Try **JFET source follower**, **MOSFET gate inverter**, **Comparator audio-to-gate**, and **CD4066 track-and-hold** in Examples. The comparator example biases audio into its input range and produces a 0–5 V gate. The track-and-hold demonstrates acquisition and leakage droop on a 5 V supply; a CD4066 must not be powered across the workbench’s ±12 V rails.

The next group adds **CD40106-style Schmitt inverters**, a **CD4053-style signal selector**, a **generic LED/LDR optocoupler**, and a **P-channel MOSFET**. Try **Schmitt RC oscillator**, **CD4053 audio/CV selector**, **Optical audio gate**, and **P-channel high-side switch**.

The Schmitt model retains state between its two thresholds and includes input capacitance, finite output resistance, and a deterministic 1 µs startup so RC oscillators start in every capture. The selector separates logic ground from its analog negative rail, supports all three bilateral SPDT channels and inhibit, and includes finite resistance, capacitance, leakage, and break-before-make. Pin numbering follows the [CD40106B](https://www.ti.com/lit/ds/symlink/cd40106b.pdf) and [CD4053B](https://www.ti.com/lit/ds/symlink/cd4053b.pdf) data sheets; the models remain original approximations.

The optocoupler has two electrically isolated sides and reports their currents separately. Its nonlinear light/resistance curve has 2 ms attack and 20 ms release time constants; DC starts at equilibrium illumination. Its four-pin DIP carrier is virtual, not a vendor footprint. Real optical parts vary substantially. The P-channel MOSFET includes signed terminal currents, body-diode behavior and gate capacitance. Each inspector documents the model assumptions and omissions.

The clock/logic group adds **CD4013-style dual D flip-flops**, **CD4070-style XOR gates**, **CD4081-style AND gates**, and a **PC817-style phototransistor optocoupler**. Try **CD4013 sub-octave divider**, **XOR digital ring modulator**, **AND gated clock**, and **Optocoupler gate receiver**. All pins are numbered and unused logic inputs require explicit connections. The library now contains 33 parts and 42 examples.

The flip-flop uses two-stage storage with non-overlapping clock phases and asynchronous SET/RESET. Captures initialize Q low for 1 µs; real hardware needs an explicit reset for predictable startup. Both asynchronous inputs high makes both outputs high. Simultaneous release deterministically retains reset in this approximation; metastability and setup/hold violations are not modeled. Gate models include input capacitance, finite response, and supply-dependent output resistance. These are audio/LFO models, not high-speed timing-validation tools. Pin references: [CD4013B](https://www.ti.com/lit/ds/symlink/cd4013b.pdf), [CD4070B](https://www.ti.com/lit/ds/symlink/cd4070b.pdf), [CD4081B](https://www.ti.com/lit/ds/symlink/cd4081b.pdf).

The PC817-style part uses the LED/anode, cathode, emitter, collector DIP-4 order and an optically driven transistor with saturation and stored charge. Edit **Current transfer ratio** from 50–600% to explore nominal device variation, and read LED/collector currents separately in the inspector. Its original model is not a calibrated manufacturer bin, a validated MIDI receiver, or an isolation-safety assessment. See the [Sharp phototransistor family](https://global.sharp/products/device/lineup/selection/opto/pc/dip_4pin.html) and the inspector’s model details.


The timing/reference group adds **CD4024-style ripple counters**, **CD4093-style Schmitt NAND gates**, **CD4001-style NOR gates**, and an **LM4040-style 2.5 V shunt reference**. Try **Seven-stage clock divider**, **Schmitt NAND gated oscillator**, **NOR clock inhibit**, and **2.5 V CV reference**.

The counter divides falling clock edges by 2 through 128 using seven ripple stages and an asynchronous active-high reset. Its NC pins have no internal electrical connection. A deterministic 1 µs reset starts each simulated capture; real hardware needs a reset stimulus. The Schmitt NAND has independent hysteresis on both inputs (nominally 40%/60% of supply); its RC oscillator stops high when disabled. NOR outputs are high only when both inputs are low. The CMOS models include input capacitance, finite response and output resistance, with 3–18 V supplies. Their timing, thresholds, and startup are educational approximations rather than calibrated manufacturer macromodels. Pin/function references: [CD4024B](https://www.ti.com/lit/ds/symlink/cd4024b.pdf), [CD4093B](https://www.ti.com/lit/ds/symlink/cd4093b.pdf), [CD4001B](https://www.ti.com/lit/ds/symlink/cd4001b.pdf).

The shunt reference uses the [TI LM4040 TO-92 pin order](https://www.ti.com/lit/ds/symlink/lm4040.pdf): pin 1 floats or connects to anode, pin 2 is cathode, pin 3 is anode. This differs from SOT-23. The model sinks current, regulates near 2.5 V above a nominal 60 µA knee, and includes 0.5 Ω incremental resistance, forward conduction, and effective capacitance. Its inspector reports cathode current and absorbed power. Reducing the example load to 1 kΩ demonstrates loss of regulation when the feed resistor cannot supply enough current. Tolerance, temperature drift, noise, and device failure are omitted; behavior above 15 mA is not qualified. NC pins are excluded from required DC measurements, without inventing a ground connection for them.
