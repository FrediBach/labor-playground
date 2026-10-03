# Automations

Automations operate the workbench controls during a simulation. Use them to repeat a knob movement, press or release a gate, switch a connection, or react to a measured voltage. They are saved with the circuit, so an example or exported project can include a complete experiment.

Open the **Automations** tab, choose **Add automation**, and set its trigger and action. Give it a name that describes the experiment, such as “Release at 3 V,” then choose **Save automation**. Capture again with **Simulate** or **Capture** to see the result. The panel shows which automations ran and when; select a recorded event to open **Results** at that moment in the simulation recording.

The **Results** oscilloscope marks actual firing times with dotted lines and numbered event labels. Its event buttons show the name, action, and time; select one to move the shared recording cursor. Markers also appear on Pico code log traces when present. Toggle **Show automation events** to hide these annotations without disabling the automations themselves. Only events that fired in the current capture appear.

## Choose when to start

**Time** starts the action at a fixed time measured from the beginning of the capture. A start time of 10 ms means 10 ms of simulated circuit time, independent of playback speed or the time the calculation takes.

**Voltage** watches CH1 or CH2 for a rising or falling crossing of a chosen voltage. Connect that probe to the terminal you want to observe. A rising trigger at 3 V needs the signal to cross from below 3 V to above it; a signal that starts above 3 V does not fire immediately. An optional earliest time lets you ignore the beginning of the recording. The trigger uses the probed circuit voltage, independent of the scope’s display scale and framing trigger.

Each enabled automation runs at most once per capture. If its time is outside the capture, or its voltage never crosses the threshold in the chosen direction, it does not run. Increase **Duration**, adjust the threshold, or check the probe connection when an expected event is missing. The Simple form retains its 24-invocation limit; the graph and project limits are listed below.

## Choose what to change

| Control | Action | Duration |
| --- | --- | --- |
| CV | Change the variable DC source voltage | Zero changes immediately; a positive duration makes a linear ramp |
| Oscillator amplitude | Change the oscillator amplitude | Zero changes immediately; a positive duration makes a linear ramp |
| Oscillator frequency | Change the oscillator frequency | Zero changes immediately; a positive duration makes a linear ramp |
| Potentiometer | Move a placed potentiometer’s wiper to a chosen percentage | Zero changes immediately; a positive duration makes a linear ramp |
| Gate | Set the EG gate high or low | High with a positive duration makes a pulse, returning low when it ends; zero leaves the chosen state held |
| Switch | Open or close a placed switch | Changes immediately |

A ramp begins at the value the control has reached when the action starts. Its target is an absolute value, not an amount to add. With the explicit replacement policy, a later action on the same control replaces an earlier movement or pending pulse release; new flows otherwise report a conflict. Gate automations use the envelope generator’s **Gate** type. Choose an existing potentiometer or switch before saving an action for it. Oscillator frequency actions require the periodic stimulus; a single charging/decay step has no repeating frequency to change.

The automation changes the electrical simulation as it runs. A switch can interrupt current, a ramp can change a filter’s input, and a voltage event can end a charging cycle. Seeking or playing the completed recording shows the recorded result; it does not execute the automation again.

## Try the examples

**Automated knob sweep** connects a 10 kΩ potentiometer between 5 V CV and ground. P1 begins at 10%. The first automation moves it to 90% from 10 to 50 ms; the second moves it to 20% from 60 to 90 ms. CH1 remains at 5 V while CH2 follows the wiper from 0.5 V to 4.5 V and back to 1 V. Shorten the first duration to make the slope steeper, or disable the second automation to hold the high value.

**Voltage-triggered gate release** charges a 1 µF capacitor through 10 kΩ. A timed automation raises EG at 10 ms. When the capacitor voltage on CH2 crosses 3 V, a voltage automation lowers EG and the capacitor begins to discharge. With the source’s 100 Ω output resistance, the time constant is 10.1 ms and release occurs around 19.3 ms into the recording. Raising the threshold to 4 V moves release to around 26.3 ms. Increasing the capacitor slows both charging and discharge.

Both examples fit the default 100 ms recording. Their **What to try** and **Build on EDU LABOR** notes in **Overview** explain the circuits and distinguish simulated automation from a manual hardware experiment.

## Editing and repeatability

The saved front-panel settings and component values define the start of every capture. An automation’s final value does not replace those saved settings. Running the same circuit again starts from the same controls and a fresh DC operating point; capacitor charge is not carried between captures.

Use the enable control to compare an experiment with and without an automation while preserving its settings. Editing, adding, deleting, and enabling automations participate in the normal undo/redo history. A circuit edit makes the previous recording stale; capture again to evaluate the new setup.

**Export circuit**, **Import**, browser recovery, and example restore include automation definitions. Exported files contain the configuration, not simulation recordings. Older circuit files without automations continue to work normally.

Automations are scoped to one finite simulation capture. They do not schedule real-world tasks, repeatedly fire on every crossing, or control physical hardware. Playback looping replays the completed recording rather than preserving electrical state across new simulations.

## Dependent flows

The **Simple** form now offers **After another automation**. Choose a predecessor and an optional delay. This replaces that invocation's previous trigger in one undoable edit. For the knob example, make Turn down start 10 ms after Turn up finishes: changing the first ramp's duration now moves the second automatically. Instantaneous actions complete after their 1 µs electrical transition; a pulse completes after returning low. A control finishing does not establish that a capacitor has settled.

**Flow** opens the same saved model. Select a step to edit its properties, choose a step type and **Add next step**, or use **Ordered steps** to choose dependencies without dragging. **Insert step** on a connection preserves its source and destination. **Arrange flow** is explicit; moving nodes does not change execution order or invalidate a recording. The canvas loads when visible and has fit/zoom controls. On small screens the inspector appears below the canvas.

Waits use their displayed time reference: step activation, automation start, or capture start. Watch steps distinguish real rising/falling crossings from levels that may already be above/below a threshold. Measure steps expose named values in volts, amperes, hertz, seconds, ratios, or booleans. Conditions route Yes/No; they do not count as test assertions. Use **Finish → Export measurement** to make a measured value available from a reusable call. **Use result from** offers compatible outputs; saving rejects values unavailable on an incoming path.

Joins wait for all selected inputs or the first successful input. Other started branches continue; finishing one branch does not cancel them. New flows report conflicting control writes. **Replace current action** explicitly permits interruption. Migrated captures retain later-action-wins compatibility. An interrupted action cannot claim successful completion, and its completion-dependent successors do not run.

The Simple list only edits patterns it can represent completely. Advanced invocations have **Edit flow**. Removing a capture invocation retains its shared definition in the automation library. Other tests and invocations continue to use that definition; the form lists those uses before you save shared action edits.

## Circuit tests

Choose **Use as test** on an automation, or open **Tests → Add test**. The wizard saves a scenario, initial controls, recording duration, and at least one explicit requirement. It can snapshot the selected prerequisite chain, snapshot the whole capture wiring, follow the capture flow, or invoke a standalone definition. Snapshots retain shared action definitions but do not follow later capture wiring edits. The whole-capture option deliberately does follow them.

Choose a stable component pin (or a differential pair), a recorded branch current, or an explicitly live CH1/CH2 alias. Component-pin references follow the component's current placement. Removing that component produces an error; moving a scope probe does not change a terminal-bound test. Supported checks include a value/range, approximate equality with absolute/relative tolerance, directed crossing by a deadline, staying in a range, settling for a hold interval, window statistics, frequency, and typed results. The Flow inspector exposes the complete expectation settings.

Windows use original solver samples with interpolated endpoints. Means are time weighted. Frequency requires stable repeating periods; insufficient data is **Inconclusive**, never a passing zero. Approximate equality uses `max(absoluteTolerance, relativeTolerance × abs(expected))`; near zero requires an absolute tolerance. Timing describes the recorded, piecewise-linear simulation. Reports include sample count and maximum sample spacing; this is not a physical-hardware guarantee. Final-waveform watch consistency uses the solver’s 1 µV / 0.1% threshold precision, and measurement consistency uses 1e-6 in its SI unit / 0.01%. These consistency guards do not widen a test’s explicit allowed band.

**Add expectation from recording** uses the current recording cursor as an authoring hint. You must enter the allowed range explicitly. **Save and run**, **Run test**, **Run all tests**, and **Rerun failed** run cases serially from a frozen project snapshot. Ordinary automatic captures pause while a suite owns simulation. **Cancel tests** terminates the active workers and marks remaining enabled cases canceled. Editing a circuit during a run never changes the snapshot being tested.

A pass requires successful scenario completion and at least one executed required assertion. Executed failures remain failed even when their Failed output runs cleanup. Errors, insufficient data, unhandled timeouts, disabled prerequisites, and missing required execution prevent a pass. Untaken conditional branches do not manufacture assertions. An empty or entirely disabled suite has no passing result.

Test recordings remain separate from the ordinary capture. **Inspect recording** opens a labeled test recording at failure evidence, and **Ordinary recording** restores the capture. Result rows become **stale** after relevant circuit, fixture, or shared-flow changes. Names and graph layout do not stale them. Compact summaries survive browser recovery outside project JSON; full recordings are bounded to 64 MiB per run and are not persisted. A new run may evict earlier recordings; rerun a case to recover them.

Try importing [automation-regression.json](./examples/automation-regression.json). It checks that the capacitor-triggered gate release completes by 35 ms and C1 discharges below 50 mV within 50 ms after release. Increase C1 to 2.2 µF to fail the discharge check, then restore 1 µF and rerun. Both checks use C1's pins rather than probe aliases.

## Command-line tests and project compatibility

Run an exported project locally with the same evaluator and ngspice compiler:

```sh
npm run test:circuit -- docs/examples/automation-regression.json
npm run test:circuit -- project.json --json report.json --junit report.xml
```

The command uses a fresh, cancelable worker for each case, including fresh firmware traces for supported Pico tests. Exit 0 means all enabled cases passed. Exit 1 covers failing, inconclusive, canceled, or empty suites; invalid files and command errors exit 2. Reports contain evidence and version information, without waveform arrays. No hosted service is involved.

Versions 1–3 remain importable. Saving a graph edit or test upgrades that document to **schema 4**, replacing the legacy automation array with one canonical `automationProgram`. Migration does not independently write a connected folder; use the existing **Sync now** action. Undo restores the previous document. Older applications reject schema 4 rather than discarding flow behavior. Custom components and Pico remain supported. The formatted project file still must fit 200 kB.

Limits are 32 definitions (including capture/test entry flows), 32 cases, 256 stored nodes, 64 nodes per flow, four call levels, 256 expanded steps, 512 committed node events, and 32 causal solver passes. Existing sample, memory, duration and worker limits still apply. A valid-sized graph can exceed the runtime pass budget and receives an Error. Loops, scripts, automatic checking after edits, physical hardware, and analog GPIO/ADC feedback remain outside this release.

A local Node/ngspice benchmark on 2026-10-03 (`node --experimental-strip-types scripts/benchmark-automation-flows.ts`, 100 ms captures) measured eight dependent ramps at 267 ms / 9 solver passes / 8,032 samples, and 24 one-shot voltage automations at 767 ms / 25 passes / 8,272 samples. Process RSS was 545–552 MiB including the engine. These are fixture measurements, not a latency or memory guarantee for arbitrary circuits; watchdogs were not increased.
