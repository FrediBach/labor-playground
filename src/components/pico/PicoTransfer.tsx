import { useEffect, useRef, useState } from 'react'
import { browserSerial, sendToPico } from '@/lib/pico/serial'

export function PicoTransfer({ source }: { source: string }) {
  const active = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)
  const [run, setRun] = useState(true)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const supported = !!browserSerial()
  useEffect(() => () => { active.current?.abort() }, [])
  async function send() {
    const serial = browserSerial()
    if (!serial || active.current) return
    const controller = new AbortController()
    active.current = controller
    setBusy(true); setError(''); setStatus('Choose your Pico in the browser’s serial port picker…')
    try {
      await sendToPico(serial, { source, run, signal: controller.signal, progress: setStatus })
      setStatus(run ? 'main.py saved. Pico restarted to run it. USB connection released.' : 'main.py saved. It will run on the next reset. USB connection released.')
    } catch (failure) {
      setStatus('')
      if (failure instanceof DOMException && failure.name === 'NotFoundError') setStatus('No Pico selected.')
      else if (controller.signal.aborted) setStatus('Transfer cancelled. If saving had already completed, main.py may have been replaced.')
      else setError(`${failure instanceof Error ? failure.message : String(failure)} Close Thonny or other serial apps before retrying.`)
    } finally { active.current = null; setBusy(false) }
  }
  return <div className="pico-transfer" aria-label="Physical Pico transfer">
    <div className="pico-toolbar">
      <strong>USB TRANSFER</strong>
      <button onClick={() => void send()} disabled={!supported || busy}>Send to Pico</button>
      <label><input type="checkbox" checked={run} disabled={busy} onChange={event => setRun(event.target.checked)} /> Run after upload</label>
      {busy && <button onClick={() => active.current?.abort()}>Cancel transfer</button>}
    </div>
    <p>Connect your Pico by USB with MicroPython installed, without holding BOOTSEL. Sending stops its current program and replaces <code>main.py</code> on the board. It runs at startup.</p>
    <p>The simulator’s <code>scope</code> module is unavailable on hardware. Remove its imports and logging calls before sending. Serial output below is from simulation.</p>
    {!supported && <p>USB transfer requires desktop Chrome or Edge on HTTPS or localhost. Web Serial is unavailable in this browser or context.</p>}
    <p role="status" aria-live="polite">{status}</p>
    {error && <div className="pico-error" role="alert">{error}</div>}
  </div>
}
