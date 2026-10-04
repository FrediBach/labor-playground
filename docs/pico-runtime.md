# Pico runtime profile

LABOR's first Pico profile is `rp2-pico-1.20.0-v1`. Select a Pico example or add **Raspberry Pi Pico** from the parts tray. Connect a Pico GND to workbench GND, edit `main.py`, choose a capture duration, and press **Run**. Loading, importing, recovering, and editing a program never run it automatically. The existing analog-only Auto update workflow is unchanged.

The dock represents the original, non-wireless RP2040 Pico. Its 40 numbered header positions follow the [official board layout](https://www.raspberrypi.com/documentation/microcontrollers/pico-series.html#non-wireless-board-layout). GP25 is the onboard LED and has no header terminal. GND and AGND join inside the board; neither connects to breadboard ground without a jumper. Unsupported power/control terminals are labeled but cannot be wired. No additional Pico instance is accepted.

## Send code to a physical Pico

1. Install the appropriate MicroPython firmware for your Pico if needed, following the [RP2 setup guide](https://docs.micropython.org/en/latest/rp2/tutorial/intro.html). This feature transfers Python source; it does not flash UF2 firmware.
2. Open the workbench in desktop Chrome or Edge on HTTPS or localhost. Connect the Pico with a USB data cable, without holding BOOTSEL. Close Thonny, other serial terminals, and other tabs using the port.
3. Open **Pico Code**, edit `main.py`, and click **Send to Pico**. Select the board in the browser’s port picker. Sending interrupts the current program, resets the interpreter, and replaces the board’s startup file, `main.py`.
4. Leave **Run after upload** checked to restart the Pico after saving. Uncheck it to leave the board at the REPL; the saved program will run on its next reset. The USB port is released when the operation finishes, including on errors or cancellation.

The uploader freezes the editor source when clicked, uses MicroPython’s [raw REPL protocol](https://docs.micropython.org/en/latest/reference/repl.html#raw-mode-and-raw-paste-mode) with paced, bounded commands, and checks that the device reports the RP2 platform. It sends UTF-8 bytes to a uniquely named `.labor-….py` temporary file, checks its size and compiles it on the board, then renames it over `main.py`. A failed transfer or syntax check before that rename preserves the previous startup file. Interrupted uploads can leave a temporary file on the board; it can be removed with a MicroPython file manager. Cancelling after the rename cannot undo the saved file.

The 32 KiB source limit applies. The board compiles with its installed firmware version, which may differ from the simulator’s pinned version. Only `main.py` is uploaded; imported libraries must already be installed. The simulator’s `scope` module is unavailable on hardware: remove its import and logging calls before sending. Wire physical peripherals to match the program. Simulation capture duration does not limit execution on the board.

The success message confirms saving and, when selected, the soft reboot acknowledgement. It does not verify that the program runs successfully. The console in the code panel remains the **simulation** console; this uploader does not capture hardware output. Serial permission is requested only by the Send button; loading projects, editing, and simulating never access hardware. [Web Serial](https://developer.chrome.com/docs/capabilities/serial) requires browser support and a secure context. Unsupported browsers show an explanation and disable the button.

Validation covers fragmented serial responses, UTF-8 transfers, cancellation, timeouts, disconnection, syntax failures, save-only mode, and mocked browser port selection. The generated file-writing commands also run against the bundled MicroPython firmware in the emulator. A physical USB transfer still requires validation with a connected Pico.

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

Virtual time advances in instruction order at the profile's 125 MHz timing. Worker batch size does not define timestamps. Changing CPU frequency, PIO and multicore execution are rejected. GPIO changes include direction, peripheral function, pulls and output levels, including mode changes with no logic-level transition. Events at exactly the selected end time are outside the half-open capture interval. If the script returns early, its final output state and hardware PWM continue through that end time. Python exceptions fail the capture; partial electrical results are never published.

The bridge is one way. Actual CPU bus reads of SIO GPIO input, GPIO status, and ADC registers, including indirect Python calls, fail the experiment. GPIO interrupt enabling also fails. This strict contract rejects output-pin reads too, because they observe the pin input path. PWM configuration getters, timing, and output-latch operations such as `Pin.toggle()` remain available. Digital input, ADC feedback, general external buses, PIO, and multicore are unavailable. The SSD1306 display is supported through a dedicated hardware I²C transaction model (below).

Stop terminates the active worker phase, discards partial results and stops audio. Reset also clears the console. Neither clears source or wiring. Source/wiring edits immediately make a capture stale and cancel the Pico pipeline. All Pico messages and the analog result carry a run identity.

## Inspect recorded application state

Run or Simulate your Pico code, open **Results**, and use the **Playback** timeline inside the oscilloscope. The scope's **Variable changes** strip marks recorded state snapshots on the same time axis as CH1/CH2 and Pico logs. Hover or focus a marker to read its changes, click to seek, or use its previous/next buttons to visit adjacent snapshots. Dense windows group nearby snapshots and show their count; zoom in to separate them. Hovering a waveform or log also updates the annotation summary at that time without seeking. No changes to `main.py` are needed.

The detailed **Pico variables** inspector below the scope follows the recording cursor, together with GPIO states and the OLED. Hover previews leave this cursor unchanged. The annotation strip describes the most recent recorded change at or before the inspected time; the inspector shows the complete retained state at the playback time. Both expose incomplete or unavailable state rather than presenting it as a current value.

The inspector shows global variable names, types, and captured values, including numbers, booleans, strings, bytes, and `None`. Expand lists, tuples, sets, and dictionaries to inspect their contents, filter by variable name, or use **Previous** / **Next change** to seek recorded changes. New, changed, and removed variables are marked relative to the preceding snapshot. Scrubbing backward restores earlier values, including earlier contents of mutable containers. Source or wiring edits invalidate these readings until the next successful run.

State is sampled every **1 ms of simulated time**, at an ARM instruction boundary, and at the recording end. Only changed snapshots are retained. The inspector shows the latest snapshot at or before the cursor, together with its time; it never interpolates values or displays a future snapshot. Changes between samples can be missed. A sample during an incomplete dictionary resize is skipped. This is sampled application state, not a line-by-line debugger. Use `scope.log()` for an explicit numeric observation at a particular point in your code.

The reader observes the emulator's RAM and flash directly. It never calls user `repr()`, properties, or other Python code during capture. Setup registers the global namespace before capture zero. The decoder is specific to the checksummed MicroPython 1.20 firmware profile; unsupported layouts produce an unavailable-state message while the electrical simulation continues.

Function-local variables are not captured automatically. Keep state you want to inspect in module-level variables or containers, or log a local numeric value explicitly with `scope.log()`. Hardware objects, functions, and other unsupported object types show a type summary. Large or deeply nested values have visibly limited previews; circular references are marked.

State recording has its own 1 MB budget, with up to 128 globals, 32 children per container, four container levels, 256 bytes per string preview, and 512 decoded values per snapshot. If the history budget is reached, the inspector labels the recording incomplete and shows the last captured values with their time. A shorter capture or smaller state permits more history. These snapshots are session-only and are not included in circuit JSON, recovery, or folder sync.

The standard firmware does not expose `sys.settrace()`; [MicroPython documents it as requiring a custom build](https://docs.micropython.org/en/v1.20.0/library/sys.html#sys.settrace). Passive sampling lets the existing firmware and original source line numbers remain in use.

### Try variables and logs together

Load **Pico · variables & scope logs** from the Intermediate examples and press **Run · 500 ms**. In **Results**, the scope initially frames the whole recording. GP0 steps through 25%, 75%, 50%, and 0% duty; CH2 shows the response of a 1 kΩ / 10 µF filter. The editable **Overview** and **Documentation** guides explain the experiment.

1. Seek to **50 ms**. The `duty` log reads 25% and `target` reads 0.825 V. In **Pico variables**, filter by `state`, expand it, and expand its `history` list: it contains `[25]`.
2. Seek to **90 ms**. `state["ticks"]` has advanced even though no new log was written. The two scope log values hold. These intermediate changes are captured automatically.
3. Seek to **150 ms**. Duty is now 75%, target is 2.475 V, and history contains `[25, 75]`. CH2 approaches the target gradually; the log is a calculated target, not a measurement of the circuit.
4. Go to **Recording end**. The phase is `"complete"` and history retains all four duty levels. Scrub backward to restore earlier state.
5. Filter variables by `target_voltage`. It does not appear because it is local to `apply_duty()`, but `scope.log("target", target_voltage, unit="V")` explicitly recorded its numeric values.

As an experiment, add `scope.log("ticks", state["ticks"])` after the tick assignment and run again. A third plotted trace now makes the automatically inspected counter visible as a numeric history. Logging takes simulated execution time; the 1 ms automatic sampler can miss brief changes, so neither view promises a snapshot at every Python statement.

## Log code values to the oscilloscope

The simulator provides a `scope` helper in MicroPython. Import it and call `scope.log(name, value, unit="")` wherever a numeric value changes:

```python
import scope
import time

for duty in (20, 40, 60, 80):
    scope.log("duty", duty, unit="%")
    scope.log("target", 3.3 * duty / 100, unit="V")
    time.sleep_ms(20)
```

Run the code, then open **Results**. Named log traces appear below CH1/CH2, sharing the scope's time window, hover time, and recording cursor. Each trace has its own automatic numeric scale and optional unit. Hover a trace for its time/value tooltip and synchronized readings in the other lanes. Click or drag a trace to seek, or focus it and use arrow keys and Home/End; Shift increases the arrow-key step. A value holds until that name is logged again; the interval before its first sample stays blank. Logging works without analog probes, and `print()` continues to write only to the serial console.

The scope's zoom buttons and **Fit** control update the time window for all lanes together. Drag a rectangle on the voltage graph to zoom into its time and voltage range; double-click restores the previous rectangle view, or doubles the time interval when there is no previous rectangle. Hold Space and drag the voltage graph to pan without seeking; Escape cancels the gesture and restores the starting pan view. Click the voltage graph to seek or Shift-drag to scrub. **Fit** restores the full time interval and resets vertical zoom and pan. Pico logs keep their own numeric scales when the voltage view changes. The window slider and pan arrows also move through the capture. The Playback timeline always covers the full capture, and exact time entry provides another way to inspect a particular moment. These view changes preserve the original log samples and electrical measurements.

**Show Pico logs** hides all code traces; each named trace button hides or restores one series. **Show automation events** independently hides or shows fired automation markers across the circuit waveforms and code traces. Select a named event to inspect its exact firing time. These display controls do not change the circuit, rerun code, or discard recorded samples. Editing source or wiring removes stale traces until the next successful simulation.

Log values must be finite numbers; booleans become 0 or 1. Reuse each name with the same unit. A capture allows up to 16 names, 25,000 total log samples, and 1 MB of serialized log data, within the total runtime trace budget. Names accept up to 64 UTF-8 bytes and units up to 16, without control characters. Exceeding a limit fails the capture with a message; add sleeps or log less often. Samples use the emulator clock when the logging call commits, independent of USB serial buffering or console truncation. Logging executes Python instructions, so its execution time is included in the simulation.

The helper and its editor completions are supplied by this simulator; `scope` is not a built-in module on a physical Pico. It records values your program supplies and does not enable circuit-fed GPIO or ADC reads.

## Limits

- Capture duration: 100 ms, 500 ms, 1 s, 5 s, or 10 s. The analog solver bounds recordings to one million samples and twelve million numeric values.
- Source: 32 KiB UTF-8; whole project: 200,000 UTF-8 bytes.
- Boot: at most 10 simulated seconds; whole emulator work: 1.5 billion instructions and 60 wall-clock seconds. The main-thread worker watchdog is 65 seconds. The ngspice timeout remains independent. Resource-heavy programs can reach these bounds before a long capture finishes.
- Runtime trace and electrical compilation: 25,000 state events and 4 MB serialized trace. This accommodates a single 1 kHz PWM output for 10 seconds.
- Console: 16 KiB UTF-8, visibly truncated. Logs, traces and emulator memory are not saved.
- Driver edges: 1 µs. Changes to the same driver or pull control less than 1 µs apart are rejected; independent driver and pull transitions can overlap during pin initialization. Output repetition is capped at 5 kHz per connected GPIO, with a shared 25,000-event budget. The 1 kHz examples and a 5 kHz RC fixture are tested; excessive frequency/density fails explicitly instead of silently dropping edges. Higher frequencies or multiple outputs may require a shorter capture.

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

## Longer-capture performance (2026-10-01)

The runtime now compares packed GPIO state before creating event objects, batches worker yields by elapsed time, and limits serial updates to 20 per second. All actual GPIO changes remain recorded with their original emulated timestamps. Before/after Node measurements on the same macOS ARM64 workspace, using real firmware with one 1 kHz PWM output and a `sleep_ms(1)` loop:

| Capture | Emulator wall time | Instructions | State events |
| --- | --- | --- | --- |
| 100 ms, before | 486 ms | 7,540,666 | 197 |
| 100 ms, after | 302 ms | 7,540,666 | 197 |
| 1 s, after | 2.26 s | 65,095,376 | 1,997 |
| 10 s, after | 21.74 s | 640,640,164 | 19,997 |

These are single-run emulator-only observations; they exclude ngspice, rendering, and language analysis. The 100 ms fixture retained identical instruction and event counts with approximately 38% lower wall time. A longer capture still executes firmware instructions, so its cost depends on the program and host device.

A separate full 10-second run of the supplied Pico PWM-to-RC example took 19.77 seconds in the emulator and 16.41 seconds in ngspice with the final adaptive-solver tolerance. The recording completed at exactly 10 seconds with 339,972 adaptive samples and 2,379,804 retained voltage/current values. Its final filtered voltage was 1.641 V, close to the expected 1.65 V average. The sample, trace, and time budgets all remained within their bounds.

## SSD1306 OLED display

Add **SSD1306 OLED display** from the Displays category or load **Pico · OLED display**. The example includes a small self-contained driver using MicroPython’s built-in `framebuf` text and graphics, so no Python library download is needed. Its default one-second capture includes ten counter/progress frames. Simulate, then play or scrub the recording; **Recording end** shows the last frame.

The fixed 128×64 module has GND, VCC, SCL, SDA pins, in that order, and address `0x3C`. Wire GND directly to Pico GND and VCC directly to Pico 3V3. SDA/SCL must each connect to one GPIO belonging to the same hardware I²C controller (for example GP0/GP1 on I²C0, or GP2/GP3 on I²C1). Each bus supports one display. Wiring errors are diagnosed before execution; firmware must select the matching pins with `machine.I2C`. Missing devices and wrong addresses receive no acknowledgement. `SoftI2C`, SPI, read transactions and hardware scrolling are unsupported.

The emulator sends actual RP2040 I²C writes to an SSD1306 controller model. It supports command/data control bytes including continuation, horizontal/vertical/page addressing, column/page windows, display on/off, inversion, entire-display mode, segment/COM direction, start line, offset, multiplex and contrast. Initialization commands for charge pump and analog timing are accepted without analog effects. Unsupported commands fail explicitly. Pixels are snapshotted at completed I²C transactions, with up to 256 changed frames per display and the existing 4 MB total Pico trace budget. A transaction unfinished at the capture boundary is not published. Every capture starts with a fresh display.

The analog solver includes the module’s 4.7 kΩ SDA/SCL pull-ups. Hardware I²C pins are represented as released pins, including configured pulls; the scope does **not** show bus clocks/data/ACK edges. Supply consumption, charge-pump behavior, timing tolerances and electrical feedback into the bus are not simulated. This model is intended for text/graphics programming with correctly wired modules.

References: [SSD1306 datasheet](https://cdn-shop.adafruit.com/datasheets/SSD1306.pdf), [MicroPython framebuffer and SSD1306 usage](https://docs.micropython.org/en/latest/esp8266/tutorial/ssd1306.html).
