import { createContext, useContext, useSyncExternalStore } from 'react'
import { RecordingPlayback } from './recording-playback'

export const RecordingContext = createContext(new RecordingPlayback(null))

export function useRecording() {
  const playback = useContext(RecordingContext)
  const state = useSyncExternalStore(playback.subscribe, playback.getSnapshot, playback.getSnapshot)
  return { playback, ...state }
}
