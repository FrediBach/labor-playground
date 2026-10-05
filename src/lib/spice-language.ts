import { monaco } from './monaco'

export const SPICE_LANGUAGE = 'labor-spice'

const help: Record<string, string> = {
  '.model': 'Device model definition: .model name type (parameters). Use F12 on a model name to go to its definition.',
  '.subckt': 'Subcircuit definition: .subckt name external-nodes. Instances begin with X.',
  '.ends': 'Ends a subcircuit definition.',
  '.end': 'Ends the netlist.',
  '.tran': 'Transient analysis: .tran output-step stop-time [start-time [maximum-step]]. Times are in seconds.',
  '.op': 'Calculates the DC operating point.',
  '.save': 'Selects voltage and current vectors to retain in the simulation results.',
  '.options': 'Sets numerical solver options and tolerances.',
  '.param': 'Defines named parameters for expressions.',
  '.ic': 'Specifies initial node voltages.',
  sin: 'Sine source: SIN(offset amplitude frequency [delay damping phase]).',
  pulse: 'Pulse source: PULSE(initial pulsed delay rise fall width period).',
  pwl: 'Piecewise-linear source: PWL(time value time value …).',
}
const devices: Record<string, string> = {
  r: 'Resistor: name node+ node− resistance (ohms).',
  c: 'Capacitor: name node+ node− capacitance (farads).',
  l: 'Inductor: name node+ node− inductance (henries).',
  v: 'Independent voltage source: name node+ node− voltage or waveform.',
  i: 'Independent current source: name node+ node− current or waveform.',
  b: 'Behavioral source: name node+ node− V=expression or I=expression.',
  d: 'Diode: name anode cathode model.',
  q: 'Bipolar transistor: name collector base emitter [substrate] model.',
  m: 'MOSFET: name drain gate source bulk model [parameters].',
  j: 'JFET: name drain gate source model.',
  x: 'Subcircuit instance: name nodes subcircuit-name [parameters].',
  e: 'Voltage-controlled voltage source: name node+ node− control+ control− gain.',
  g: 'Voltage-controlled current source: name node+ node− control+ control− transconductance.',
}

monaco.languages.register({ id: SPICE_LANGUAGE })
monaco.languages.setLanguageConfiguration(SPICE_LANGUAGE, {
  comments: { lineComment: '*' },
  brackets: [['(', ')'], ['{', '}']],
  wordPattern: /\.?[a-zA-Z_][\w.$]*|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[a-zA-Z]*/g,
})
monaco.languages.setMonarchTokensProvider(SPICE_LANGUAGE, {
  ignoreCase: true,
  tokenizer: { root: [
    [/^\s*\*.*/, 'comment'],
    [/[$;].*$/, 'comment'],
    [/^\s*\.[a-z]+/, 'keyword'],
    [/^\s*[a-z][\w.]*/, 'type.identifier'],
    [/^\s*\+/, 'operator'],
    [/\b(?:sin|pulse|pwl|v|i|abs|exp|log|sqrt|tanh|limit|table)\b/, 'predefined'],
    [/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:meg|[tgkmunpf])?\b/, 'number'],
    [/[a-z_][\w.]*/, 'identifier'],
    [/[=+*/^<>-]/, 'operator'],
    [/[(){}]/, '@brackets'],
  ] },
})

// Index only declarations, and rebuild only when the generated text changes.
const declarations = new WeakMap<monaco.editor.ITextModel, { version: number; symbols: Map<string, { line: number; text: string }> }>()
function symbols(model: monaco.editor.ITextModel) {
  const cached = declarations.get(model)
  if (cached?.version === model.getVersionId()) return cached.symbols
  const result = new Map<string, { line: number; text: string }>()
  for (let line = 1; line <= model.getLineCount(); line++) {
    const text = model.getLineContent(line)
    const match = /^\s*\.(?:model|subckt)\s+(\S+)/i.exec(text)
    if (match) result.set(match[1].toLowerCase(), { line, text })
  }
  declarations.set(model, { version: model.getVersionId(), symbols: result })
  return result
}

monaco.languages.registerHoverProvider(SPICE_LANGUAGE, {
  provideHover(model, position) {
    const line = model.getLineContent(position.lineNumber)
    if (/^\s*\*/.test(line)) return null
    const word = model.getWordAtPosition(position)
    if (!word) return null
    const key = word.word.toLowerCase()
    const declaration = symbols(model).get(key)
    const first = /^\s*(\S+)/.exec(line)
    const description = help[key] ?? (first?.[1].toLowerCase() === key ? devices[key[0]] : undefined)
    if (!description && !declaration) return null
    return {
      range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
      contents: [
        ...(description ? [{ value: description }] : []),
        ...(declaration ? [{ value: `Defined on line ${declaration.line}.` }, { value: '```spice\n' + declaration.text + '\n```' }] : []),
      ],
    }
  },
})
monaco.languages.registerDefinitionProvider(SPICE_LANGUAGE, {
  provideDefinition(model, position) {
    if (/^\s*\*/.test(model.getLineContent(position.lineNumber))) return null
    const word = model.getWordAtPosition(position)
    const declaration = word && symbols(model).get(word.word.toLowerCase())
    return declaration ? { uri: model.uri, range: new monaco.Range(declaration.line, 1, declaration.line, declaration.text.length + 1) } : null
  },
})
