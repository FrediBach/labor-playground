# LABOR Playground

A local circuit workbench built with React, TypeScript, Vite, SVG, and shadcn/ui. Start with an editable RC filter, change the capacitor, and see the result from a real ngspice simulation running in a browser worker.

This is the first working slice of [plan.md](./plan.md). The workbench uses a documented virtual board inspired by LABOR; it is not a calibrated reproduction of the physical hardware.

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
4. Select a scope probe and click a terminal. Use **Capture** or leave **Auto update** enabled.
5. Click **Listen** for a short audio preview of the selected channel. Audio starts muted; **Mute** remains available.
6. **Export circuit** saves JSON. **Import** restores it, while browser recovery remembers the latest circuit when storage is available.

Keyboard: **W** wire, **V** select, **R** rotate placement, **Escape** cancel, **Delete/Backspace** remove selection, **Ctrl/Cmd+Z** undo, **Ctrl/Cmd+Shift+Z** or **Ctrl+Y** redo. Breadboard holes also support arrow navigation and Enter/Space activation.

## Included in this build

- A 30-column breadboard with separate five-hole strips, a center trench, and explicitly split, unpowered rails. Connected-net highlighting and **Show connections** expose its topology.
- Five component types: resistor, non-polarized capacitor, generic silicon diode, generic red LED, and switch. Placement prevents overlapping leads; probes attach without occupying holes.
- Three ordinary editable examples: RC low-pass filter, voltage divider, and diode clipper.
- Oscillator waveform/frequency/amplitude controls, a DC CV source, GND, and ±12 V source terminals.
- Real 100 ms transient captures through `eecircuit-engine` 1.8.0, isolated in a dedicated worker. Edits coalesce, outdated results are discarded, and a timed-out worker can be recreated.
- A two-channel scope with independent voltage scales, shared time scale, autoscale, peak-to-peak/mean measurements, and a pointer time/voltage readout.
- A short, deliberate audio preview using timestamp resampling, filtering, DC removal, gain limiting, and fades. It does not loop arbitrary captures.
- Undo/redo, example restore, clear board, validated JSON import/export, and optional browser recovery. No waveform or audio arrays are saved with the circuit.

## Current boundaries

This is a desktop-first prototype. Captures restart at the DC operating point; they do not preserve capacitor charge through edits or run a continuous circuit timeline. The scope's DC values come from transient results; there is no separate operating-point or differential-meter panel yet.

The initial envelope is 30 components, 120 wires, and 60 active external electrical nodes. Floating component nodes and direct ideal-supply shorts block capture instead of receiving hidden repair connections. The oscillator includes a documented virtual 100 Ω output resistor. Other source and component models are deliberately simplified.

Op-amps, potentiometers, polarized capacitor models, the envelope generator, physical interface boards, the remaining planned examples, advanced triggering/frequency measurement, and continuous audio are deferred. Component placement uses fixed lead spacing; the board offers zoom and scrolling but no general schematic editor or autorouter. Cross-browser, accessibility, and performance acceptance work remains part of the roadmap.

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

The unit/numerical suite currently has 24 tests, including the exact 2.5 V divider, the RC step's 1 ms time constant, filter gain, diode clipping, rail breaks, wire crossings, malformed imports, floating probes, and stuck-worker recovery. The browser suite has 8 tests covering editor actions, real waveform updates, recovery, and revision scheduling. The 4 workbench tests also pass against the production build:

```sh
npm run build
LABOR_PRODUCTION=1 npm run test:e2e -- tests/e2e/workbench.spec.ts
```

Browser tests require Chromium (`npx playwright install chromium` if needed). See `playwright.config.ts` for the configured browser and isolated local server on port 5177.

## Project layout

| Path | Responsibility |
| --- | --- |
| `src/App.tsx` | Workbench panels, inspector, instruments, import/export, audio controls |
| `src/components/workbench/` | SVG breadboard, component artwork, Canvas scope |
| `src/components/ui/` | Project-owned shadcn components |
| `src/lib/circuit.ts` | Versioned documents, virtual geometry, validation, connectivity compiler, examples |
| `src/lib/use-document.ts` | Undo history and browser recovery |
| `src/lib/simulation*.ts` | Simulation hook, worker client, worker, capture extraction, limits |
| `src/lib/audio.ts` | Capture resampling and explicit Web Audio playback |
| `tests/` | Compiler, numerical, audio, worker, and browser checks |
| `docs/` | Hardware/model specification and simulation integration notes |

Use `@/` to import from `src/`. The document format only accepts supported component data and physical terminal references; imported scripts, external models, and arbitrary SPICE directives are not executed.
