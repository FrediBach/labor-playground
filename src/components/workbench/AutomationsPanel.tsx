import { useEffect, useId, useRef, useState } from 'react'
import { Activity, ArrowRight, Check, Clock3, Copy, Pencil, Plus, Trash2, Workflow, X } from 'lucide-react'
import { AUTOMATION_LIMIT, automationIssue, automationTargetKey, type Automation } from '@/lib/automations'
import { envelopeSettings, type CircuitDocument } from '@/lib/circuit'
import { useRecording } from '@/lib/recording-context'
import type { Capture, SimulationStatus } from '@/lib/simulation-types'
import './AutomationsPanel.css'

type Target = Automation['action']['target']
type Draft = {
  id: string
  name: string
  enabled: boolean
  triggerKind: 'time' | 'voltage'
  atMs: string
  channel: 'CH1' | 'CH2'
  direction: 'rising' | 'falling'
  threshold: string
  afterMs: string
  target: Target
  partId: string
  value: string
  transition: 'step' | 'ramp' | 'pulse'
  durationMs: string
}

const CONTROL_NAMES: Record<Target, string> = {
  cv: 'CV output', amplitude: 'Signal amplitude', frequency: 'Signal frequency',
  gate: 'EG gate', potentiometer: 'Potentiometer', switch: 'Switch',
}
const CONTROL_BOUNDS: Record<Target, { min: number; max: number; unit: string }> = {
  cv: { min: -5, max: 5, unit: 'V' }, amplitude: { min: 0, max: 5, unit: 'V pk' },
  frequency: { min: 20, max: 2000, unit: 'Hz' }, gate: { min: 0, max: 1, unit: '' },
  potentiometer: { min: 0, max: 100, unit: '%' }, switch: { min: 0, max: 1, unit: '' },
}
const numberLabel = (value: number) => Number(value.toFixed(3)).toLocaleString()
const automationId = () => `A${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`

function controlName(action: Automation['action']) {
  return action.partId ? `${action.partId} ${CONTROL_NAMES[action.target].toLowerCase()}` : CONTROL_NAMES[action.target]
}

function triggerLabel(trigger: Automation['trigger']) {
  if (trigger.kind === 'time') return `At ${numberLabel(trigger.atMs)} ms`
  return `${trigger.channel} ${trigger.direction === 'rising' ? 'rises above' : 'falls below'} ${numberLabel(trigger.threshold)} V${trigger.afterMs > 0 ? ` after ${numberLabel(trigger.afterMs)} ms` : ''}`
}

function actionLabel(action: Automation['action']) {
  const name = controlName(action)
  if (action.target === 'switch') return `${action.value ? 'Close' : 'Open'} ${action.partId ?? 'switch'}`
  if (action.target === 'gate') return action.durationMs > 0 ? `Pulse EG high for ${numberLabel(action.durationMs)} ms` : `Set EG ${action.value ? 'high · 5 V' : 'low · 0 V'}`
  const value = action.target === 'potentiometer' ? action.value * 100 : action.value
  return `${action.durationMs > 0 ? 'Ramp' : 'Set'} ${name} to ${numberLabel(value)} ${CONTROL_BOUNDS[action.target].unit}${action.durationMs > 0 ? ` over ${numberLabel(action.durationMs)} ms` : ''}`
}

function toDraft(automation: Automation): Draft {
  const { trigger, action } = automation
  return {
    id: automation.id, name: automation.name, enabled: automation.enabled,
    triggerKind: trigger.kind, atMs: String(trigger.kind === 'time' ? trigger.atMs : 10),
    channel: trigger.kind === 'voltage' ? trigger.channel : 'CH1',
    direction: trigger.kind === 'voltage' ? trigger.direction : 'rising',
    threshold: String(trigger.kind === 'voltage' ? trigger.threshold : 2.5),
    afterMs: String(trigger.kind === 'voltage' ? trigger.afterMs : 0),
    target: action.target, partId: action.partId ?? '',
    value: String(action.target === 'potentiometer' ? action.value * 100 : action.value),
    transition: action.durationMs > 0 ? action.target === 'gate' ? 'pulse' : 'ramp' : 'step',
    durationMs: String(action.durationMs || 10),
  }
}

function fromDraft(draft: Draft): Automation {
  return {
    id: draft.id, name: draft.name.trim(), enabled: draft.enabled,
    trigger: draft.triggerKind === 'time'
      ? { kind: 'time', atMs: Number(draft.atMs) }
      : { kind: 'voltage', channel: draft.channel, direction: draft.direction, threshold: Number(draft.threshold), afterMs: Number(draft.afterMs) },
    action: {
      target: draft.target,
      ...(draft.target === 'potentiometer' || draft.target === 'switch' ? { partId: draft.partId } : {}),
      value: Number(draft.value) / (draft.target === 'potentiometer' ? 100 : 1),
      durationMs: draft.transition === 'step' ? 0 : Number(draft.durationMs),
    },
  }
}

function draftErrors(draft: Draft, document: CircuitDocument): string[] {
  const errors: string[] = []
  const validNumber = (value: string, min: number, max: number) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max
  if (!draft.name.trim()) errors.push('Give this automation a name.')
  if (draft.triggerKind === 'time') {
    if (!validNumber(draft.atMs, 0, 10_000)) errors.push('Start time must be between 0 and 10,000 ms.')
  } else {
    if (!validNumber(draft.threshold, -1000, 1000)) errors.push('Voltage threshold must be between −1,000 and 1,000 V.')
    if (!validNumber(draft.afterMs, 0, 10_000)) errors.push('Start watching must be between 0 and 10,000 ms.')
  }
  if ((draft.target === 'potentiometer' || draft.target === 'switch') && !document.parts.some(part => part.id === draft.partId && part.kind === draft.target)) errors.push('Choose a control that is on the breadboard.')
  const bounds = CONTROL_BOUNDS[draft.target]
  if (!validNumber(draft.value, bounds.min, bounds.max)) errors.push(`${CONTROL_NAMES[draft.target]} must be between ${bounds.min} and ${bounds.max}${bounds.unit ? ` ${bounds.unit}` : ''}.`)
  if (draft.transition !== 'step' && (!validNumber(draft.durationMs, 0, 10_000) || Number(draft.durationMs) === 0)) errors.push('Duration must be greater than 0 and at most 10,000 ms.')
  return errors
}

function automationWarning(automation: Automation, document: CircuitDocument, durationSeconds: number) {
  const issue = automationIssue(automation, document, durationSeconds)
  if (!issue) return null
  const { action, trigger } = automation
  if ((action.target === 'potentiometer' || action.target === 'switch') && !document.parts.some(part => part.id === action.partId && part.kind === action.target)) return 'Missing target · choose a control'
  if (action.target === 'gate' && envelopeSettings(document).mode !== 'gate') return 'EG must be in Gate mode'
  if (action.target === 'frequency' && document.stimulus === 'step') return 'Frequency has no effect on a step input'
  if (trigger.kind === 'voltage' && !document.probes[trigger.channel]) return `${trigger.channel} probe is not connected`
  if ((trigger.kind === 'time' ? trigger.atMs : trigger.afterMs) >= durationSeconds * 1000) return 'Outside recording duration'
  return issue
}

export function AutomationsPanel({ document, onChange, durationSeconds, capture, status, onViewResults }: {
  document: CircuitDocument
  onChange: (document: CircuitDocument) => void
  durationSeconds: number
  capture: Capture | null
  status: SimulationStatus
  onViewResults?: () => void
}) {
  const automations = document.automations ?? []
  const [draft, setDraft] = useState<Draft | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [notice, setNotice] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const errorBox = useRef<HTMLDivElement>(null)
  const formId = useId()
  const { playback, seconds } = useRecording()
  const freshCapture = status === 'ready' ? capture : null
  const firedCount = automations.filter(automation => freshCapture?.automationEvents?.some(event => event.automationId === automation.id)).length
  const enabledCount = automations.filter(automation => automation.enabled).length
  const errors = draft ? draftErrors(draft, document) : []
  const editing = !!draft && automations.some(automation => automation.id === draft.id)
  const atLimit = automations.length >= AUTOMATION_LIMIT
  const draftAutomation = draft && errors.length === 0 ? fromDraft(draft) : null
  const draftWarning = draftAutomation ? automationWarning(draftAutomation, document, durationSeconds) : null

  useEffect(() => {
    if (draft && !dialog.current?.open) dialog.current?.showModal()
    else if (!draft && dialog.current?.open) dialog.current.close()
  }, [draft])

  function openEditor(automation?: Automation) {
    setSubmitted(false)
    setDraft(toDraft(automation ?? {
      id: automationId(), name: `Automation ${automations.length + 1}`, enabled: true,
      trigger: { kind: 'time', atMs: Number(Math.min(10, durationSeconds * 250).toFixed(3)) },
      action: { target: 'cv', value: document.instruments.cv === 2.5 ? 5 : 2.5, durationMs: 0 },
    }))
  }

  function updateDraft(patch: Partial<Draft>) {
    setDraft(current => current ? { ...current, ...patch } : current)
  }

  function setControl(value: string) {
    const [target, partId = ''] = value.split(':') as [Target, string?]
    const part = document.parts.find(part => part.id === partId)
    const initialValue = target === 'switch' ? part?.value === 1 ? 0 : 1
      : target === 'gate' ? 1
        : target === 'potentiometer' ? 75
          : target === 'frequency' ? 440 : 2.5
    updateDraft({ target, partId, value: String(initialValue), transition: 'step' })
  }

  function save() {
    setSubmitted(true)
    if (!draft || errors.length > 0) {
      requestAnimationFrame(() => errorBox.current?.focus())
      return
    }
    const automation = fromDraft(draft)
    const enableGate = automation.action.target === 'gate' && envelopeSettings(document).mode !== 'gate'
    onChange({
      ...document,
      ...(enableGate ? { instruments: { ...document.instruments, envelope: { ...envelopeSettings(document), mode: 'gate' } } } : {}),
      automations: editing ? automations.map(existing => existing.id === automation.id ? automation : existing) : [...automations, automation],
    })
    setNotice(`Automation ${editing ? 'saved' : 'added'}.${enableGate ? ' EG switched to Gate mode.' : ''} Simulate to run it.`)
    setDraft(null)
  }

  return <section className="automations-panel" id="automations" aria-labelledby={`${formId}-heading`} tabIndex={-1}>
    <div className="automations-heading">
      <div className="automations-title"><Workflow size={19} aria-hidden="true" /><div><h2 id={`${formId}-heading`}>Automations</h2><p>Timed actions and voltage triggers.</p></div></div>
      <button className="automation-add" onClick={() => openEditor()} disabled={atLimit} title={atLimit ? 'Maximum 24 automations per circuit' : undefined}><Plus size={16} />Add automation</button>
    </div>
    {automations.length === 0 ? <div className="automations-empty"><div className="automation-empty-flow" aria-hidden="true"><Clock3 size={18} /><span>10 ms</span><ArrowRight size={15} /><span>CV → 2.5 V</span></div><p>No automations</p><span>Schedule a knob change, pulse the gate, or react to a voltage crossing. Each automation runs once per simulation.</span></div> : <>
      <div className="automations-meta"><span>{enabledCount} enabled · once per simulation</span><span>{freshCapture ? `${firedCount} of ${enabledCount} fired` : status === 'calculating' ? 'Running automations…' : 'Simulate to run your automations'}</span></div>
      <ol className="automation-list">{automations.map((automation, index) => {
        const event = freshCapture?.automationEvents?.find(event => event.automationId === automation.id)
        const warning = automation.enabled ? automationWarning(automation, document, durationSeconds) : null
        const upcoming = !!event && seconds < event.time
        const interrupted = event && automation.action.durationMs > 0 && freshCapture?.automationEvents?.some(later => {
          if (later.time > seconds || later.time < event.time || later.time >= event.time + automation.action.durationMs / 1000) return false
          const laterIndex = automations.findIndex(row => row.id === later.automationId)
          if (laterIndex < 0 || later.automationId === automation.id || (later.time === event.time && laterIndex <= index)) return false
          return automationTargetKey(automations[laterIndex].action) === automationTargetKey(automation.action)
        })
        const result = !automation.enabled ? 'Disabled' : warning ?? (event ? `Fired at ${numberLabel(event.time * 1000)} ms` : freshCapture ? automation.trigger.kind === 'voltage' ? 'Threshold not reached' : 'Did not fire' : 'Ready for next simulation')
        return <li key={automation.id} className={`automation-row${!automation.enabled ? ' is-disabled' : ''}${event && !upcoming ? ' has-fired' : ''}`}>
          <label className="automation-enable"><input type="checkbox" checked={automation.enabled} aria-label={`Enable ${automation.name}`} onChange={() => {
            onChange({ ...document, automations: automations.map(existing => existing.id === automation.id ? { ...existing, enabled: !existing.enabled } : existing) })
            setNotice(`${automation.name} ${automation.enabled ? 'disabled' : 'enabled'}.`)
          }} /><span aria-hidden="true"><Check size={12} /></span></label>
          <div className="automation-description"><button className="automation-name" onClick={() => openEditor(automation)}>{automation.name}</button><div className="automation-recipe"><span>{automation.trigger.kind === 'time' ? <Clock3 size={12} /> : <Activity size={12} />}{triggerLabel(automation.trigger)}</span><ArrowRight className="automation-recipe-arrow" size={13} /><span>{actionLabel(automation.action)}</span></div><div className="automation-result-line">{event && !warning ? <button className={`automation-result fired${upcoming ? ' upcoming' : ''}`} title="Seek recording to this automation" onClick={() => { playback.seek(event.time); onViewResults?.() }}><Check size={12} />{result}<span>↗</span></button> : <span className={`automation-result${warning ? ' warning' : ''}`}>{result}</span>}{event && <span className="automation-playhead-state">{upcoming ? 'Ahead of playhead' : interrupted ? 'Superseded at playhead' : automation.action.durationMs > 0 && seconds < event.time + automation.action.durationMs / 1000 ? 'In progress at playhead' : 'Reached at playhead'}</span>}</div></div>
          <div className="automation-row-actions"><button className="icon-button" aria-label={`Edit ${automation.name}`} title="Edit automation" onClick={() => openEditor(automation)}><Pencil size={14} /></button><button className="icon-button" aria-label={`Duplicate ${automation.name}`} title={atLimit ? 'Maximum 24 automations' : 'Duplicate automation'} disabled={atLimit} onClick={() => openEditor({ ...automation, id: automationId(), name: `${automation.name} copy`.slice(0, 80) })}><Copy size={14} /></button><button className="icon-button automation-delete" aria-label={`Delete ${automation.name}`} title="Delete automation · Undo restores it" onClick={() => { onChange({ ...document, automations: automations.filter(existing => existing.id !== automation.id) }); setNotice(`${automation.name} deleted. Undo restores it.`) }}><Trash2 size={14} /></button></div>
        </li>
      })}</ol>
      <p className="automations-footnote">Controls start at their current settings on every run. A later action on the same control interrupts its ramp or pulse; simultaneous actions follow list order. Click a fired time to inspect the recording.{atLimit ? ' Maximum 24 automations per circuit.' : ''}</p>
    </>}
    <span className="automation-announcement" role="status">{notice}</span>

    <dialog ref={dialog} className="automation-dialog" aria-labelledby={`${formId}-editor-title`} aria-describedby={`${formId}-editor-description`} onCancel={() => setDraft(null)} onClose={() => setDraft(null)} onKeyDown={event => event.stopPropagation()}>
      {draft && <form noValidate onSubmit={event => { event.preventDefault(); save() }}>
        <div className="automation-dialog-heading"><div><span className="automation-eyebrow">EXPERIMENT SEQUENCE</span><h2 id={`${formId}-editor-title`}>{editing ? 'Edit automation' : 'New automation'}</h2></div><button className="icon-button" type="button" aria-label="Close automation editor" onClick={() => setDraft(null)}><X size={19} /></button></div>
        <p className="automation-dialog-description" id={`${formId}-editor-description`}>Choose when it starts and what it changes. Runs once each time you simulate.</p>
        <label className="automation-field automation-name-field"><span>Name</span><input autoFocus required maxLength={80} value={draft.name} onChange={event => updateDraft({ name: event.target.value })} placeholder="e.g. Sweep the filter" /></label>
        <fieldset className="automation-editor-group"><legend><span>1</span>When</legend>
          <div className="automation-trigger-tabs" role="group" aria-label="Automation trigger"><button type="button" aria-pressed={draft.triggerKind === 'time'} onClick={() => updateDraft({ triggerKind: 'time' })}><Clock3 size={15} />At a fixed time</button><button type="button" aria-pressed={draft.triggerKind === 'voltage'} onClick={() => updateDraft({ triggerKind: 'voltage' })}><Activity size={15} />On voltage crossing</button></div>
          {draft.triggerKind === 'time' ? <label className="automation-field"><span>Start time</span><div className="automation-unit-input"><input type="number" min={0} max={10000} step="any" required value={draft.atMs} onChange={event => updateDraft({ atMs: event.target.value })} /><span>ms</span></div><small>From the start of the simulation · recording is {numberLabel(durationSeconds * 1000)} ms</small></label> : <>
            <div className="automation-field-grid"><label className="automation-field"><span>Watch probe</span><select value={draft.channel} onChange={event => updateDraft({ channel: event.target.value as Draft['channel'] })}><option value="CH1">CH1{document.probes.CH1 ? '' : ' · unconnected'}</option><option value="CH2">CH2{document.probes.CH2 ? '' : ' · unconnected'}</option></select></label><label className="automation-field"><span>Crossing direction</span><select value={draft.direction} onChange={event => updateDraft({ direction: event.target.value as Draft['direction'] })}><option value="rising">Rises above</option><option value="falling">Falls below</option></select></label></div>
            <div className="automation-field-grid"><label className="automation-field"><span>Voltage threshold</span><div className="automation-unit-input"><input type="number" min={-1000} max={1000} step="any" required value={draft.threshold} onChange={event => updateDraft({ threshold: event.target.value })} /><span>V</span></div></label><label className="automation-field"><span>Start watching at</span><div className="automation-unit-input"><input type="number" min={0} max={10000} step="any" required value={draft.afterMs} onChange={event => updateDraft({ afterMs: event.target.value })} /><span>ms</span></div></label></div><p className="automation-field-help">Fires on the first crossing after watching starts. A voltage already past the threshold does not trigger it.</p>
          </>}
        </fieldset>
        <fieldset className="automation-editor-group"><legend><span>2</span>Then</legend>
          <label className="automation-field"><span>Control</span><select value={draft.partId ? `${draft.target}:${draft.partId}` : draft.target} onChange={event => setControl(event.target.value)}><optgroup label="Instruments"><option value="cv">CV output</option><option value="amplitude">Signal amplitude</option><option value="frequency" disabled={document.stimulus === 'step'}>Signal frequency{document.stimulus === 'step' ? ' · unavailable for step input' : ''}</option><option value="gate">EG gate / pulse</option></optgroup><optgroup label="Breadboard controls">{document.parts.filter(part => part.kind === 'potentiometer' || part.kind === 'switch').map(part => <option key={part.id} value={`${part.kind}:${part.id}`}>{part.id} · {CONTROL_NAMES[part.kind as Target]}</option>)}{!document.parts.some(part => part.kind === 'potentiometer' || part.kind === 'switch') && <option disabled>Add a potentiometer or switch to the board</option>}{draft.partId && !document.parts.some(part => part.id === draft.partId && part.kind === draft.target) && <option value={`${draft.target}:${draft.partId}`} disabled>{draft.partId} · missing control</option>}</optgroup></select></label>
          {draft.target === 'gate' || draft.target === 'switch' ? <label className="automation-field"><span>Action</span><select value={draft.transition === 'pulse' ? 'pulse' : draft.value} onChange={event => updateDraft(event.target.value === 'pulse' ? { value: '1', transition: 'pulse' } : { value: event.target.value, transition: 'step' })}>{draft.target === 'gate' ? <><option value="1">Set high · 5 V</option><option value="0">Set low · 0 V</option><option value="pulse">Pulse high, then return low</option></> : <><option value="1">Close switch</option><option value="0">Open switch</option></>}</select></label> : <div className="automation-field-grid"><label className="automation-field"><span>Change</span><select value={draft.transition} onChange={event => updateDraft({ transition: event.target.value as Draft['transition'] })}><option value="step">Set immediately</option><option value="ramp">Ramp smoothly</option></select></label><label className="automation-field"><span>{draft.target === 'potentiometer' ? 'Wiper position' : 'Target value'}</span><div className="automation-unit-input"><input type="number" required step="any" min={CONTROL_BOUNDS[draft.target].min} max={CONTROL_BOUNDS[draft.target].max} value={draft.value} onChange={event => updateDraft({ value: event.target.value })} /><span>{CONTROL_BOUNDS[draft.target].unit}</span></div><small>{CONTROL_BOUNDS[draft.target].min} to {CONTROL_BOUNDS[draft.target].max} {CONTROL_BOUNDS[draft.target].unit}</small></label></div>}
          {draft.transition !== 'step' && <label className="automation-field"><span>{draft.transition === 'pulse' ? 'Pulse width' : 'Ramp duration'}</span><div className="automation-unit-input"><input type="number" min={0.001} max={10000} required step="any" value={draft.durationMs} onChange={event => updateDraft({ durationMs: event.target.value })} /><span>ms</span></div><small>{draft.transition === 'pulse' ? 'The gate returns to 0 V after this time.' : 'Moves linearly from the control’s value when this automation fires.'}</small></label>}
          {draft.target === 'gate' && envelopeSettings(document).mode !== 'gate' && <p className="automation-editor-note">Saving will switch EG to Gate mode so this automation can control it.</p>}
        </fieldset>
        {draftWarning && !(draft.target === 'gate' && draftWarning === 'EG must be in Gate mode') && <p className="automation-editor-warning">{draftWarning}. {draftWarning.includes('duration') ? 'Choose a longer recording or an earlier start time before running.' : draftWarning.includes('probe') ? 'Attach the probe before running this automation.' : 'Update this control before running.'}</p>}
        {draftAutomation?.trigger.kind === 'time' && draftAutomation.action.durationMs > 0 && draftAutomation.trigger.atMs < durationSeconds * 1000 && draftAutomation.trigger.atMs + draftAutomation.action.durationMs > durationSeconds * 1000 && <p className="automation-editor-note">This {draft.transition === 'pulse' ? 'pulse' : 'ramp'} starts during the recording and finishes after it ends. Choose a longer recording to see the full action.</p>}
        {draftAutomation && <div className="automation-preview"><span>YOUR AUTOMATION</span><p>{triggerLabel(draftAutomation.trigger)} <ArrowRight size={13} aria-hidden="true" /> {actionLabel(draftAutomation.action)}</p></div>}
        {submitted && errors.length > 0 && <div className="automation-errors" role="alert" tabIndex={-1} ref={errorBox}><strong>Check these settings</strong><ul>{errors.map(error => <li key={error}>{error}</li>)}</ul></div>}
        <div className="automation-editor-footer"><label className="automation-enabled-field"><input type="checkbox" checked={draft.enabled} onChange={event => updateDraft({ enabled: event.target.checked })} />Enabled</label><div><button type="button" className="automation-cancel" onClick={() => setDraft(null)}>Cancel</button><button className="automation-save" type="submit">Save automation</button></div></div>
      </form>}
    </dialog>
  </section>
}
