import { create } from "zustand"
import type { EvaluatedToken, Segment } from "../types"

type AppState = {
  tabId: number | null
  rawSegments: Segment[]
  currentTime: number
  isReady: boolean
  autoScroll: boolean
  playbackRate: number
  selectedGroupIndex: number | null
  theme: "default" | "vibrant-forest" | "warm-orange" | "serene-violet" | "cool-mint" | "dark-night"
  language: string | null
  targetLanguage: string
  isRecording: boolean
  isPlaying: boolean
  interimTranscript: string
  finalTranscript: string
  recordingUrl: string | null
  evaluatedTokens: EvaluatedToken[]
  selectedPracticeWords: string[]
  setTabId: (tabId: number | null) => void
  setRawSegments: (segments: Segment[]) => void
  setCurrentTime: (time: number) => void
  setIsReady: (ready: boolean) => void
  setAutoScroll: (value: boolean) => void
  setPlaybackRate: (rate: number) => void
  setSelectedGroupIndex: (idx: number | null) => void
  setTheme: (value: AppState["theme"]) => void
  setLanguage: (lang: string | null) => void
  setTargetLanguage: (lang: string) => void
  setIsPlaying: (playing: boolean) => void
  setRecordingState: (
    payload:
      | Partial<Pick<AppState, "isRecording" | "interimTranscript" | "finalTranscript" | "recordingUrl">>
      | ((state: AppState) => Partial<Pick<AppState, "isRecording" | "interimTranscript" | "finalTranscript" | "recordingUrl">>)
  ) => void
  resetRecording: () => void
  setEvaluatedTokens: (tokens: EvaluatedToken[]) => void
  setSelectedPracticeWords: (words: string[]) => void
}

export const useAppStore = create<AppState>((set) => ({
  tabId: null,
  rawSegments: [],
  currentTime: 0,
  isReady: false,
  autoScroll: true,
  playbackRate: 1,
  selectedGroupIndex: null,
  theme: "default",
  language: null,
  targetLanguage: "zh-CN",
  isRecording: false,
  isPlaying: false,
  interimTranscript: "",
  finalTranscript: "",
  recordingUrl: null,
  evaluatedTokens: [],
  selectedPracticeWords: [],
  setTabId: (tabId) => set({ tabId }),
  setRawSegments: (rawSegments) => set({ rawSegments }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setIsReady: (isReady) => set({ isReady }),
  setAutoScroll: (autoScroll) => set({ autoScroll }),
  setPlaybackRate: (playbackRate) => set({ playbackRate }),
  setSelectedGroupIndex: (selectedGroupIndex) => set({ selectedGroupIndex }),
  setTheme: (theme) => set({ theme }),
  setLanguage: (language) => set({ language }),
  setTargetLanguage: (targetLanguage) => set({ targetLanguage }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setRecordingState: (payload) =>
    set((state) => {
      const partial = typeof payload === "function" ? payload(state) : payload
      return { ...partial }
    }),
  resetRecording: () =>
    set((state) => ({
      ...state,
      isRecording: false,
      interimTranscript: "",
      finalTranscript: "",
      recordingUrl: null
    })),
  setEvaluatedTokens: (evaluatedTokens) => set({ evaluatedTokens }),
  setSelectedPracticeWords: (selectedPracticeWords) => set({ selectedPracticeWords })
}))
