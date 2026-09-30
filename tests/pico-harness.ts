import { languageWorkspace, listenLanguage, monaco } from '../src/lib/pico/language'
import { PicoClient } from '../src/lib/pico/client'
listenLanguage(text => document.getElementById('status')!.textContent = text)
const workspace = await languageWorkspace('from machine import Pin, PWM\nimport time\nled = Pin(25, Pin.OUT)\nled.\n')
const editor = monaco.editor.create(document.getElementById('editor')!, { model: workspace.model, theme: 'vs-dark', editContext: false, automaticLayout: true })
Object.assign(window, { picoHarness: { ...workspace, editor, monaco, runtime: new PicoClient() } })
