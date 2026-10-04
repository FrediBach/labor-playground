import { boardConfiguration, resizeBoard, type BoardConfiguration, type CircuitDocument } from '@/lib/circuit'

export function BoardSettings({ document, onChange, onMessage }: {
  document: CircuitDocument
  onChange: (document: CircuitDocument) => void
  onMessage: (message: string) => void
}) {
  const board = boardConfiguration(document)
  function resize(next: BoardConfiguration) {
    try {
      onChange(resizeBoard(document, next))
      onMessage(`Breadboard: ${next.columns} columns × ${next.rows} ${next.rows === 1 ? 'row' : 'rows'}. Rails are isolated every 15 columns and between rows.`)
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Unable to resize the breadboard.')
    }
  }
  return <div className="board-settings" role="group" aria-label="Breadboard size">
    <label>Columns <select aria-label="Breadboard columns" value={board.columns} onChange={event => resize({ ...board, columns: Number(event.target.value) as BoardConfiguration['columns'] })}>
      {[30, 45, 60].map(columns => <option key={columns} value={columns}>{columns}</option>)}
    </select></label>
    <label>Rows <select aria-label="Breadboard rows" value={board.rows} onChange={event => resize({ ...board, rows: Number(event.target.value) as BoardConfiguration['rows'] })}>
      {[1, 2, 3].map(rows => <option key={rows} value={rows}>{rows}</option>)}
    </select></label>
  </div>
}
