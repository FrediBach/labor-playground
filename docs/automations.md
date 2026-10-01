# Automations

Automations operate the workbench controls during a simulation. Use them to repeat a knob movement, press or release a gate, switch a connection, or react to a measured voltage. They are saved with the circuit, so an example or exported project can include a complete experiment.

Open the **Automations** tab, choose **Add automation**, and set its trigger and action. Give it a name that describes the experiment, such as “Release at 3 V,” then choose **Save automation**. Capture again with **Simulate** or **Capture** to see the result. The panel shows which automations ran and when; select a recorded event to open **Results** at that moment in the simulation recording.

## Choose when to start

**Time** starts the action at a fixed time measured from the beginning of the capture. A start time of 10 ms means 10 ms of simulated circuit time, independent of playback speed or the time the calculation takes.

**Voltage** watches CH1 or CH2 for a rising or falling crossing of a chosen voltage. Connect that probe to the terminal you want to observe. A rising trigger at 3 V needs the signal to cross from below 3 V to above it; a signal that starts above 3 V does not fire immediately. An optional earliest time lets you ignore the beginning of the recording. The trigger uses the probed circuit voltage, independent of the scope’s display scale and framing trigger.

Each enabled automation runs at most once per capture. If its time is outside the capture, or its voltage never crosses the threshold in the chosen direction, it does not run. Increase **Duration**, adjust the threshold, or check the probe connection when an expected event is missing. Up to 24 automations can be saved in a circuit.

## Choose what to change

| Control | Action | Duration |
| --- | --- | --- |
| CV | Change the variable DC source voltage | Zero changes immediately; a positive duration makes a linear ramp |
| Oscillator amplitude | Change the oscillator amplitude | Zero changes immediately; a positive duration makes a linear ramp |
| Oscillator frequency | Change the oscillator frequency | Zero changes immediately; a positive duration makes a linear ramp |
| Potentiometer | Move a placed potentiometer’s wiper to a chosen percentage | Zero changes immediately; a positive duration makes a linear ramp |
| Gate | Set the EG gate high or low | High with a positive duration makes a pulse, returning low when it ends; zero leaves the chosen state held |
| Switch | Open or close a placed switch | Changes immediately |

A ramp begins at the value the control has reached when the action starts. Its target is an absolute value, not an amount to add. A later action on the same control replaces an earlier movement or pending pulse release. Gate automations use the envelope generator’s **Gate** type. Choose an existing potentiometer or switch before saving an action for it. Oscillator frequency actions require the periodic stimulus; a single charging/decay step has no repeating frequency to change.

The automation changes the electrical simulation as it runs. A switch can interrupt current, a ramp can change a filter’s input, and a voltage event can end a charging cycle. Seeking or playing the completed recording shows the recorded result; it does not execute the automation again.

## Try the examples

**Automated knob sweep** connects a 10 kΩ potentiometer between 5 V CV and ground. P1 begins at 10%. The first automation moves it to 90% from 10 to 50 ms; the second moves it to 20% from 60 to 90 ms. CH1 remains at 5 V while CH2 follows the wiper from 0.5 V to 4.5 V and back to 1 V. Shorten the first duration to make the slope steeper, or disable the second automation to hold the high value.

**Voltage-triggered gate release** charges a 1 µF capacitor through 10 kΩ. A timed automation raises EG at 10 ms. When the capacitor voltage on CH2 crosses 3 V, a voltage automation lowers EG and the capacitor begins to discharge. With the source’s 100 Ω output resistance, the time constant is 10.1 ms and release occurs around 19.3 ms into the recording. Raising the threshold to 4 V moves release to around 26.3 ms. Increasing the capacitor slows both charging and discharge.

Both examples fit the default 100 ms recording. Their **What to try** and **Build on EDU LABOR** notes explain the circuits and distinguish simulated automation from a manual hardware experiment.

## Editing and repeatability

The saved front-panel settings and component values define the start of every capture. An automation’s final value does not replace those saved settings. Running the same circuit again starts from the same controls and a fresh DC operating point; capacitor charge is not carried between captures.

Use the enable control to compare an experiment with and without an automation while preserving its settings. Editing, adding, deleting, and enabling automations participate in the normal undo/redo history. A circuit edit makes the previous recording stale; capture again to evaluate the new setup.

**Export circuit**, **Import**, browser recovery, and example restore include automation definitions. Exported files contain the configuration, not simulation recordings. Older circuit files without automations continue to work normally.

Automations are scoped to one finite simulation capture. They do not schedule real-world tasks, repeatedly fire on every crossing, or control physical hardware. Playback looping replays the completed recording rather than preserving electrical state across new simulations.
