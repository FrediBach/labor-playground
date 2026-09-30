# Pico runtime profile

LABOR's first Pico profile is `rp2-pico-1.20.0-v1`. Select a Pico example or add **Raspberry Pi Pico** from the parts tray. Connect a Pico GND to workbench GND, edit `main.py`, and press **Run · 100 ms**. Loading, importing, recovering, and editing a program never run it automatically. The existing analog-only Auto update workflow is unchanged.

The dock represents the original, non-wireless RP2040 Pico. Its 40 numbered header positions follow the [official board layout](https://www.raspberrypi.com/documentation/microcontrollers/pico-series.html#non-wireless-board-layout). GP25 is the onboard LED and has no header terminal. GND and AGND join inside the board; neither connects to breadboard ground without a jumper. Unsupported power/control terminals are labeled but cannot be wired. No additional Pico instance is accepted.

## Pinned assets

| Asset | Version / provenance |
| --- | --- |
| Emulator | `rp2040js@1.4.0`, MIT |
| Firmware | `RPI_PICO-20230426-v1.20.0.uf2`, MicroPython |
| Boot ROM | B1, Raspberry Pi commit `00a4a19114195e20fb817bdfbca1165e157eef37`, from the rp2040js demo fixture |
| Board stubs | `micropython-rp2-pico-stubs@1.20.0.post5` |
| Standard-library stubs | `micropython-stdlib-stubs@1.1.0`, required by the board stub wheel |
| Editor | `monaco-editor@0.57.0`, native public LSP client and worker transport |
| Analyzer | `browser-basedpyright@1.40.1`, independent foreground/background workers |

`public/pico/manifest.json` records SHA-256 checksums. Asset loading validates them before use. Firmware, ROM, stubs, and license notices ship locally; Vite bundles the emulator, Monaco, and language workers. No runtime CDN, compilation service, or remote import resolution is used.

The stub overlay in `src/lib/pico/stub-overlay.ts` narrows RP2 Pin arguments and PWM method overloads while retaining the original documentation. The selected firmware accepts `PWM(pin)` followed by `freq(...)` and `duty_u16(...)`; it does **not** accept the newer PWM constructor keywords. Tests run these signatures against the bundled firmware. Source attribution: MicroPython v1.20.0 `ports/rp2/machine_pin.c`, `ports/rp2/machine_pwm.c`, `extmod/machine_pwm.c`, and the [RP2 quick reference](https://docs.micropython.org/en/v1.20.0/rp2/quickref.html).

Language configuration explicitly supplies the standard-library typeshed. Board modules such as `machine` and `time` override general-purpose library definitions. The analyzer exposes peripheral APIs independently of electrical support; a resolvable ADC or PIO symbol is not a promise that a circuit can use it. Dynamic Python and APIs outside the tested profile may still fail at runtime.

## Execution contract

Each Run freezes source and wiring under one revision, boots a fresh emulator, waits for the friendly/raw REPL handshakes, compiles `main.py`, and submits it through USB CDC. A reserved adapter marker write immediately before `exec` defines capture zero. Compilation and boot are excluded; the short interpreter dispatch into `main.py` is included. Tracebacks use `main.py` line numbers, and wrapper frames are removed.

Virtual time advances in instruction order at the profile's 125 MHz timing. Worker batch size does not define timestamps. Changing CPU frequency, PIO and multicore execution are rejected. GPIO changes include direction, peripheral function, pulls and output levels, including mode changes with no logic-level transition. Events at exactly 100 ms are outside the half-open capture interval. If the script returns early, its final output state and hardware PWM continue through 100 ms. Python exceptions fail the capture; partial electrical results are never published.

The bridge is one way. Actual CPU bus reads of SIO GPIO input, GPIO status, and ADC registers, including indirect Python calls, fail the experiment. GPIO interrupt enabling also fails. This strict contract rejects output-pin reads too, because they observe the pin input path. PWM configuration getters, timing, and output-latch operations such as `Pin.toggle()` remain available. Digital input, ADC feedback, external buses, PIO, and multicore are not first-release capabilities.

Stop terminates the active worker phase, discards partial results and stops audio. Reset also clears the console. Neither clears source or wiring. Source/wiring edits immediately make a capture stale and cancel the Pico pipeline. All Pico messages and the analog result carry a run identity.

## Limits

- Capture duration: 100 ms; 50,000 solved samples.
- Source: 32 KiB UTF-8; whole project: 200,000 UTF-8 bytes.
- Boot: at most 10 simulated seconds; whole emulator work: 200 million instructions and 60 wall-clock seconds. The main-thread worker watchdog is 65 seconds. The existing ngspice timeout remains independent.
- Runtime trace: 20,000 state events and 2 MB serialized trace; electrical compilation: at most 2,000 events.
- Console: 16 KiB UTF-8, visibly truncated. Logs, traces and emulator memory are not saved.
- Driver edges: 1 µs. Changes to the same driver or pull control less than 1 µs apart are rejected; independent driver and pull transitions can overlap during pin initialization. Output repetition is capped at 5 kHz per connected GPIO, with a shared 2,000-event budget. The 1 kHz examples and a 5 kHz RC fixture are tested; excessive frequency/density fails explicitly instead of silently dropping edges.

See [hardware-spec.md](hardware-spec.md) for the educational driver constants and supported electrical envelope. Actual solved node voltages feed scope and audio. Every analog experiment starts from the initial GPIO operating point; capacitor charge does not survive runs.

## Storage and undo

Schema 2 adds an optional Pico board/profile/source/capture configuration. Schema-1 circuits retain their original topology and behavior. Unknown profiles, oversized source and unsupported terminals are rejected on import. Only reproducible project data is saved, never firmware binaries, emulator state, serial logs or captures.

Text drafts have their own source sessions outside circuit history. Monaco owns text undo; circuit Undo changes wiring/components and preserves the current session's source. Collapsing the editor keeps its model, cursor and undo stack. Clear board preserves the current Pico source and removes wiring. Removing Pico removes its wires/probes; circuit Undo restores the board and draft. Loading/importing another project replaces the active source session; Undo restores the previous session. Browser storage failures retain the in-memory document and keep Export available.

## Validation

`npm test` includes real firmware timing/guards and real ngspice loading, high-impedance, pull, RC and envelope fixtures. `tests/e2e/pico*.spec.ts` exercise semantic editing, worker recovery, keyboard isolation, persistence and firmware capture. For optimized browser verification including test harnesses:

```sh
npm run build -- --mode test
LABOR_PRODUCTION=1 npm run test:e2e -- tests/e2e/pico.spec.ts tests/e2e/pico-workbench.spec.ts
```

Ordinary `npm run build` excludes the harness pages. The production test blocks external requests. Vite reports upstream emulator `eval` (Node performance fallback) and large Monaco/language assets; Python is always executed as emulated ARM firmware, never JavaScript.

## Measured desktop baseline (2026-09-30)

Production Vite test build on macOS ARM64, Node 25.5.0, Playwright Chromium 153.0.8010.12, 1440 × 1120 viewport. These are single-run observations, not cross-device performance guarantees.

| Measurement | Observed |
| --- | --- |
| Cold harness navigation to language readiness | 1.067 s |
| Semantic completion including browser automation overhead | 298 ms |
| Fresh boot plus 100 ms PWM emulation | 934 ms; 7,406,299 instructions; 198 events |
| Worker termination after execution starts | 0.1 ms (main-thread call/rejection latency) |
| Main-thread live JS heap | 24.6 MiB |
| Monaco worker live JS heap | 3.7 MiB |
| Language foreground / background live JS heaps | 88.6 / 138.4 MiB |

Memory is a CDP `Runtime.getHeapUsage` snapshot after the experiment: it excludes process overhead and the already-terminated emulator/ngspice workers. The analyzer is the dominant resident cost; the editor is lazy-loaded only for Pico projects. The automated measurement test also records backing storage, allocated heap, and cancellation latency. Resource limits are enforced independently of these observed timings.
