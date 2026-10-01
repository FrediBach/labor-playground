import { Activity, CircuitBoard, ClipboardList, Code2, ListStart } from 'lucide-react'
import type { KeyboardEvent } from 'react'

export type WorkspaceTab = 'circuit' | 'results' | 'automations' | 'code' | 'overview'

export function WorkspaceTabs({ active, onChange, hasPico, automationCount, issueCount }: {
  active: WorkspaceTab
  onChange: (tab: WorkspaceTab) => void
  hasPico: boolean
  automationCount: number
  issueCount: number
}) {
  const tabs = [
    { id: 'circuit' as const, label: 'Circuit', icon: CircuitBoard },
    { id: 'results' as const, label: 'Results', icon: Activity },
    { id: 'automations' as const, label: 'Automations', icon: ListStart },
    ...(hasPico ? [{ id: 'code' as const, label: 'Pico Code', icon: Code2 }] : []),
    { id: 'overview' as const, label: 'Overview', icon: ClipboardList },
  ]

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
    if (next === null) return
    event.preventDefault()
    onChange(tabs[next].id)
    const button = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]
    button?.focus({ preventScroll: true })
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  return <div className="workspace-tabs" role="tablist" aria-label="Workspace">
    {tabs.map(({ id, label, icon: Icon }, index) => <button
      key={id} type="button" role="tab" id={`workspace-tab-${id}`} aria-controls={`workspace-panel-${id}`}
      aria-selected={active === id} tabIndex={active === id ? 0 : -1} aria-label={label}
      aria-description={id === 'overview' && issueCount > 0 ? `${issueCount} circuit ${issueCount === 1 ? 'issue' : 'issues'}` : undefined}
      onClick={() => onChange(id)} onKeyDown={event => navigate(event, index)}
    ><Icon size={15} aria-hidden="true" /><span>{label}</span>{id === 'automations' && automationCount > 0 && <span className="workspace-tab-count" aria-hidden="true">{automationCount}</span>}{id === 'overview' && issueCount > 0 && <span className="workspace-tab-count has-issues" aria-hidden="true">{issueCount}</span>}</button>)}
  </div>
}
