# LABOR Playground

A local circuit workbench built with React, TypeScript, Vite, SVG, and shadcn/ui. Start with an editable RC filter, change the capacitor, and see the result from a real ngspice simulation running in a browser worker.

This build implements the editable workbench, starter component library, and six examples expanding on [plan.md](./plan.md). The workbench uses a documented virtual board inspired by LABOR; it is not a calibrated reproduction of the physical hardware.

## Try it

Use Node.js 24 (see `.nvmrc`) and npm:

```sh
nvm use
npm ci
npm run dev
```

Open the URL printed by Vite. No API keys, environment variables, accounts, or backend services are required. The app bundles its engine and assets, and circuit simulation stays on your device.

1. Select **C1**, then try the **220 nF** preset. CH2 shows the changed filter output.
2. Choose a part and click a hole, or drag it from the tray. Press **R** to rotate the placement. Drag an existing component to move it.
3. Choose **Jumper wire** and click two free terminals. Select a wire to change its color, remove it, or move an endpoint.
4. Select a scope probe and click a terminal. Use **Capture** or leave **Auto update** enabled. Open **Measurements** below the scope for minimum/maximum voltage, frequency, A/B cursors, and the CH1 − CH2 differential meter.
5. Click **Listen** for a short audio preview of the selected channel. Audio starts muted; **Mute** remains available.
6. Try **Capacitor charge / decay**, **Op-amp gain stage**, or **Envelope shaping** from Examples. Each experiment has a **What to try** guide in the inspector. The gain stage requires both visible supply connections; removing either blocks capture.
7. Open **DC operating point** below the scope for initial node voltages. Select a component to read its DC current and power in the inspector. **Trigger** frames rising or falling crossings without changing the circuit.
8. **Export circuit** saves JSON. **Import** restores it, while browser recovery remembers the latest circuit when storage is available.

Drag the frequency knob in a straight line; hold Shift for fine adjustment. Its numeric input and arrow keys edit the same parameter. Potentiometer wiper drags commit as a single undoable action.

Keyboard: **W** wire, **V** select, **R** rotate placement, **Escape** cancel, **Delete/Backspace** remove selection, **Ctrl/Cmd+Z** undo, **Ctrl/Cmd+Shift+Z** or **Ctrl+Y** redo. Breadboard holes also support arrow navigation and Enter/Space activation.

## Included in this build

- A 30-column breadboard with separate five-hole strips, a center trench, and explicitly split, unpowered rails. Connected-net highlighting and **Show connections** expose its topology.
- Eight component types: resistor, non-polarized capacitor, polarized electrolytic capacitor, potentiometer, generic silicon diode, generic red LED, switch, and generic dual op-amp. Placement checks every lead; DIP-8 parts straddle the trench in either orientation. Probes attach without occupying holes.
- Six ordinary editable examples: RC low-pass filter, voltage divider, diode clipper, capacitor charge/decay, op-amp gain stage, and envelope shaping.
- Oscillator waveform/frequency/amplitude controls, a DC CV source, GND, and ±12 V source terminals. A separate capture stimulus selects periodic input or a 0 → amplitude → 0 charging/decay step. The EG terminal supplies a held gate, 1 ms trigger, or exponential decay envelope (1–40 ms time constant), with a virtual 5 V level and 100 Ω output resistance. **Fire** starts a fresh event capture.
- A separate DC operating-point solve followed by real 100 ms transient captures through `eecircuit-engine` 1.8.0, isolated in a dedicated worker. Edits coalesce, outdated results are discarded, and a timed-out worker can be recreated.
- A two-channel scope with independent voltage scales, shared time scale, autoscale, min/max/peak-to-peak/time-weighted mean, conservative frequency detection, persistent A/B time cursors, Δt/ΔV, and a differential voltage meter. Basic rising/falling triggering frames the first confirmed crossing; no crossing is explicitly reported. Cursors retain absolute capture times. DC and irregular signals display frequency unavailable.
- An initial DC meter using the separate operating-point solve, including CH1 − CH2 voltage. The inspector shows signed DC currents and absorbed power for resistors, switches, potentiometers, diodes, LEDs, and ideal capacitors. Channel labels highlight their breadboard connections.
- A short, deliberate audio preview using timestamp resampling, filtering, DC removal, gain limiting, and fades. It does not loop arbitrary captures.
- Measured reverse-bias warnings for polarized capacitors and explicit missing-supply/input diagnostics for op-amps. Warnings identify the affected part; no destruction animation or hidden repair connection is added.
- Undo/redo, example restore, clear board, validated JSON import/export, and optional browser recovery. No waveform or audio arrays are saved with the circuit.

## Current boundaries

This is a desktop-first prototype. Captures restart at the DC operating point; they do not preserve capacitor charge through edits or run a continuous circuit timeline. Scope measurements describe the transient capture; its differential meter reads CH1 − CH2 at a cursor or as a time-weighted capture mean. The separate DC panel describes the solved initial state, so periodic and one-shot waveforms can have different DC and capture-mean readings.

The initial envelope is 30 components, 120 wires, and 60 active external electrical nodes. Floating component nodes and direct ideal-supply shorts block capture instead of receiving hidden repair connections. The oscillator and EG source each include a documented virtual 100 Ω output resistor. Other source and component models are deliberately simplified.

Physical interface boards, advanced triggering, transient component-current displays, and continuous audio are deferred. The dual op-amp is an educational static model with visible rails and bounded output; bandwidth, slew rate, and physical supply-current behavior are not modeled. Polarized capacitors use an ideal electrical model with polarity diagnostics, not a damage model. Component placement uses fixed lead spacing; the board offers zoom and scrolling but no general schematic editor or autorouter. Cross-browser, accessibility, and performance acceptance work remains part of the roadmap.

Read [the hardware specification](./docs/hardware-spec.md) for verified manual references and the virtual board's exact connections. Read [the engine notes](./docs/engine-notes.md) for worker behavior, numerical assumptions, bounds, audio processing, and licensing provenance.

## Checks and builds

```sh
npm test          # Compiler, actual ngspice numerical fixtures, audio, worker scheduling
npm run lint      # Oxlint, including React hook rules
npm run typecheck # TypeScript checks
npm run build     # TypeScript checks and production assets in dist/
npm run test:e2e  # Playwright browser integration tests
npm run preview   # Serve the production build locally
```

The unit/numerical suite covers topology and import validation, real ngspice divider/filter/diode behavior, potentiometer endpoints, capacitor charging/decay, op-amp gain and supply-dependent clipping, envelope timing and loading, separate operating-point currents and power, polarity checks, trigger framing, measurement interpolation, audio, and worker recovery. Browser tests cover placement, eight-pin movement, component controls and undo, live measurements, DC readings, envelope controls, trigger framing, stale results, import/export, and recovery. Run the application workflows against the production bundle with:

```sh
npm run build
LABOR_PRODUCTION=1 npm run test:e2e -- workbench.spec.ts components.spec.ts measurements.spec.ts instruments.spec.ts trigger.spec.ts
```

Browser tests require Chromium (`npx playwright install chromium` if needed). See `playwright.config.ts` for the configured browser and isolated local server on port 5177.

## Project layout

| Path | Responsibility |
| --- | --- |
| `src/App.tsx` | Workbench composition, document actions, import/export, audio controls |
| `src/components/workbench/` | SVG breadboard, component artwork, inspector, numeric controls, Canvas scope |
| `src/components/ui/` | Project-owned shadcn components |
| `src/lib/circuit.ts` | Versioned documents, virtual geometry, validation, connectivity compiler, examples |
| `src/lib/use-document.ts` | Undo history and browser recovery |
| `src/lib/simulation*.ts` | Simulation hook, worker client, worker, capture extraction, limits |
| `src/lib/measurements.ts` | Time-weighted statistics, frequency detection, cursor interpolation, differential voltage |
| `src/lib/trigger.ts` | Threshold-crossing detection and bounded capture framing |
| `src/lib/audio.ts` | Capture resampling and explicit Web Audio playback |
| `tests/` | Compiler, numerical, audio, worker, and browser checks |
| `docs/` | Hardware/model specification and simulation integration notes |

Use `@/` to import from `src/`. The document format only accepts supported component data and physical terminal references; imported scripts, external models, and arbitrary SPICE directives are not executed.
