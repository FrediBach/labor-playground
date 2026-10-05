import { useEffect, useRef } from 'react'
import { monaco } from '@/lib/monaco'
import { SPICE_LANGUAGE } from '@/lib/spice-language'

export default function NetlistEditor({ netlist }: { netlist: string }) {
  const container = useRef<HTMLDivElement>(null)
  const model = useRef<monaco.editor.ITextModel | null>(null)

  useEffect(() => {
    const textModel = monaco.editor.createModel('', SPICE_LANGUAGE)
    model.current = textModel
    const editor = monaco.editor.create(container.current!, {
      model: textModel, theme: 'vs-dark', readOnly: true,
      ariaLabel: 'Generated SPICE netlist', automaticLayout: true,
      fixedOverflowWidgets: true, editContext: false,
      minimap: { enabled: false }, fontSize: 12, lineHeight: 20,
      padding: { top: 10, bottom: 10 }, scrollBeyondLastLine: false,
      wordWrap: 'on', domReadOnly: true, tabFocusMode: true,
    })
    return () => { editor.dispose(); textModel.dispose(); model.current = null }
  }, [])

  useEffect(() => { model.current?.setValue(netlist) }, [netlist])

  return <div className="overview-netlist-editor" ref={container} onKeyDown={event => event.stopPropagation()} />
}
