import type { Capture, OperatingPoint } from './simulation-types.ts'
import { sampleRecording } from './recording.ts'

export interface PlaybackSnapshot {
  seconds: number
  playing: boolean
  speed: number
  loop: boolean
  point?: OperatingPoint
}

interface AnimationClock {
  now: () => number
  request: (callback: (time: number) => void) => number
  cancel: (id: number) => void
}

/** Only recording consumers subscribe; animation never rerenders the workbench. */
export class RecordingPlayback {
  private listeners = new Set<() => void>()
  private frame: number | null = null
  private anchorTime = 0
  private anchorSeconds = 0
  private lastPaint = 0
  private snapshot: PlaybackSnapshot
  readonly start: number
  readonly end: number
  readonly capture: Capture | null
  private clock: AnimationClock

  constructor(capture: Capture | null, clock: AnimationClock = {
    now: () => performance.now(),
    request: callback => requestAnimationFrame(callback),
    cancel: id => cancelAnimationFrame(id),
  }) {
    this.capture = capture
    this.clock = clock
    this.start = capture?.time[0] ?? 0
    this.end = capture?.time.at(-1) ?? 0
    this.snapshot = { seconds: this.start, playing: false, speed: 1, loop: true, point: capture ? sampleRecording(capture, this.start) : undefined }
  }

  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  private publish(patch: Partial<PlaybackSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    if (patch.seconds !== undefined) this.snapshot.point = this.capture ? sampleRecording(this.capture, patch.seconds) : undefined
    this.listeners.forEach(listener => listener())
  }

  seek = (seconds: number) => {
    if (!Number.isFinite(seconds)) return
    this.pause()
    this.publish({ seconds: Math.max(this.start, Math.min(this.end, seconds)) })
  }

  play = () => {
    if (!this.capture?.recording || this.end <= this.start || this.snapshot.playing) return
    const seconds = this.snapshot.seconds >= this.end ? this.start : this.snapshot.seconds
    this.anchorSeconds = seconds
    this.anchorTime = this.clock.now()
    this.lastPaint = -Infinity
    this.publish({ playing: true, seconds })
    this.frame = this.clock.request(this.tick)
  }

  pause = () => {
    if (this.frame !== null) this.clock.cancel(this.frame)
    this.frame = null
    if (this.snapshot.playing) this.publish({ playing: false })
  }

  setLoop = (loop: boolean) => {
    this.anchorSeconds = this.snapshot.seconds
    this.anchorTime = this.clock.now()
    this.publish({ loop })
  }
  setSpeed = (speed: number) => {
    if (!Number.isFinite(speed) || speed < 0.001 || speed > 10) return
    this.anchorSeconds = this.snapshot.seconds
    this.anchorTime = this.clock.now()
    this.publish({ speed })
  }

  private tick = (now: number) => {
    this.frame = null
    if (!this.snapshot.playing) return
    const elapsed = Math.max(0, now - this.anchorTime) / 1000 * this.snapshot.speed
    let seconds = this.anchorSeconds + elapsed
    if (seconds >= this.end) {
      if (this.snapshot.loop) seconds = this.start + (seconds - this.start) % (this.end - this.start)
      else { this.publish({ playing: false, seconds: this.end }); return }
    }
    // 30 visual updates/s; sample values always come from absolute elapsed time.
    if (now - this.lastPaint >= 1000 / 30) { this.lastPaint = now; this.publish({ seconds }) }
    this.frame = this.clock.request(this.tick)
  }

  dispose = () => { this.pause(); this.listeners.clear() }
}
