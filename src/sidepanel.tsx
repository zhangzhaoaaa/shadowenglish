// 清理旧内容，重新写入完整实现
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import "./style.css";
import { Copy, Play, Settings } from "lucide-react";
import confetti from "canvas-confetti";
import { ToastViewport, toast } from "./components/toast";
import { useAppStore } from "./store/useAppStore";
import type { EvaluatedToken, Segment } from "./types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";

const TARGET_LANGUAGES = [
  { code: "ar", label: "Arabic" },
  { code: "bn", label: "Bengali" },
  { code: "zh-CN", label: "Chinese (Simplified)" },
  { code: "zh-TW", label: "Chinese (Traditional)" },
  { code: "cs", label: "Czech" },
  { code: "da", label: "Danish" },
  { code: "nl", label: "Dutch" },
  { code: "en", label: "English" },
  { code: "tl", label: "Filipino" },
  { code: "fi", label: "Finnish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "el", label: "Greek" },
  { code: "hi", label: "Hindi" },
  { code: "hu", label: "Hungarian" },
  { code: "id", label: "Indonesian" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "ms", label: "Malay" },
  { code: "no", label: "Norwegian" },
  { code: "pl", label: "Polish" },
  { code: "pt", label: "Portuguese" },
  { code: "ro", label: "Romanian" },
  { code: "ru", label: "Russian" },
  { code: "es", label: "Spanish" },
  { code: "sv", label: "Swedish" },
  { code: "th", label: "Thai" },
  { code: "tr", label: "Turkish" },
  { code: "uk", label: "Ukrainian" },
  { code: "vi", label: "Vietnamese" },
];

const THEMES = [
  { value: "default", label: "Default" },
  { value: "vibrant-forest", label: "Vibrant Forest" },
  { value: "warm-orange", label: "Warm Sunshine Orange" },
  { value: "serene-violet", label: "Serene Violet" },
  { value: "cool-mint", label: "Cool Mint Green" },
  { value: "dark-night", label: "Dark Night Sky" }
];

// Group segments by punctuation or by duration fallback
const TERMINATORS = [".", "!", "?", ";"];
const TERMINATOR_REGEX = new RegExp(`[${TERMINATORS.join("")}]`);

function groupSegments(segments: Segment[], maxChunkLength?: number): Segment[][] {
  const result: Segment[][] = [];
  const hasPunctuation = segments.some((s) => TERMINATOR_REGEX.test(s.text));

  if (hasPunctuation) {
    let buffer: Segment[] = [];
    for (const seg of segments) {
      buffer.push(seg);
      if (TERMINATOR_REGEX.test(seg.text) && buffer.length >= 5) {
        result.push([...buffer]);
        buffer = [];
      }
    }
    if (buffer.length > 0) result.push(buffer);
  } else if (maxChunkLength !== undefined) {
    let buffer: Segment[] = [];
    let duration = 0;
    for (const seg of segments) {
      buffer.push(seg);
      duration += seg.durationSeconds;
      if (duration >= maxChunkLength) {
        result.push([...buffer]);
        buffer = [];
        duration = 0;
      }
    }
    if (buffer.length > 0) result.push(buffer);
  } else {
    if (segments.length > 0) result.push([...segments]);
  }

  return result;
}

function joinGroupText(group: Segment[]): string {
  return group.map((s) => s.text).join(" ");
}

function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function normalizeToken(token: string): string {
  return token.replace(/[^\w']/g, "").toLowerCase();
}

function arraysShallowEqual<T>(a: T[], b: T[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function tokenSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  const dist = dp[m][n];
  const maxLen = Math.max(m, n) || 1;
  return 1 - dist / maxLen;
}

function evaluateSentence(targetText: string, spokenText: string): EvaluatedToken[] {
  const targetTokens = tokenize(targetText);
  const spokenTokens = tokenize(spokenText);
  const spokenNorm = spokenTokens.map(normalizeToken);
  const windowSize = 3;
  const correctThreshold = 0.8;
  const partialThreshold = 0.5;

  let spokenIndex = 0;

  return targetTokens.map((tok) => {
    const norm = normalizeToken(tok);
    if (!norm) return { text: tok, status: "correct" };

    while (spokenIndex < spokenNorm.length && !spokenNorm[spokenIndex]) {
      spokenIndex += 1;
    }

    let status: "correct" | "partial" | "wrong" = "wrong";
    if (spokenIndex < spokenNorm.length) {
      let bestSim = 0;
      let bestIdx = -1;
      const maxIdx = Math.min(spokenNorm.length, spokenIndex + windowSize);
      for (let i = spokenIndex; i < maxIdx; i++) {
        const candidate = spokenNorm[i];
        if (!candidate) continue;
        const sim = tokenSimilarity(norm, candidate);
        if (sim > bestSim) {
          bestSim = sim;
          bestIdx = i;
          if (bestSim >= correctThreshold) break;
        }
      }
      if (bestIdx !== -1) {
        if (bestSim >= correctThreshold) status = "correct";
        else if (bestSim >= partialThreshold) status = "partial";
        else status = "wrong";
        spokenIndex = bestIdx + 1;
      } else {
        spokenIndex += 1;
      }
    }

    return { text: tok, status };
  });
}

function encodeWavFromAudioBuffer(audioBuffer: AudioBuffer): ArrayBuffer {
  const { numberOfChannels, length, sampleRate } = audioBuffer;
  const bytesPerSample = 2;
  const blockAlign = numberOfChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + length * blockAlign);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + length * blockAlign, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, length * blockAlign, true);

  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < numberOfChannels; ch++) {
    channelData.push(audioBuffer.getChannelData(ch));
  }

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return buffer;
}

async function webmToWavBlob(recordingUrl: string): Promise<Blob> {
  const response = await fetch(recordingUrl);
  const arrayBuffer = await response.arrayBuffer();
  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  const wavBuffer = encodeWavFromAudioBuffer(audioBuffer);
  await audioCtx.close();
  return new Blob([wavBuffer], { type: "audio/wav" });
}

export default function SidePanel() {
  const {
    tabId,
    rawSegments,
    currentTime,
    isReady,
    autoScroll,
    playbackRate,
    repeatCount,
    selectedGroupIndex,
    theme,
    language,
    targetLanguage,
    isRecording,
    isPlaying,
    interimTranscript,
    finalTranscript,
    recordingUrl,
    evaluatedTokens,
    selectedPracticeWords,
    setTabId,
    setRawSegments,
    setCurrentTime,
    setIsReady,
    setAutoScroll,
    setPlaybackRate,
    setRepeatCount,
    setSelectedGroupIndex,
    setTheme,
    setLanguage,
    setTargetLanguage,
    setIsPlaying,
    setRecordingState,
    resetRecording,
    setEvaluatedTokens,
    setSelectedPracticeWords
  } = useAppStore((state) => state);

  const listRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const permissionToastRef = useRef<number | null>(null);
  const splitRef = useRef<HTMLDivElement | null>(null);
  const [topRatio, setTopRatio] = useState(0.55);
  const [isExportingWav, setIsExportingWav] = useState(false);
  const isDraggingRef = useRef(false);
  const lastConfettiKeyRef = useRef<string | null>(null);
  const selectedRangeRef = useRef<{ groupIndex: number; startChar: number; endChar: number } | null>(null);
  const [feedback, setFeedback] = useState<
    | {
        rating: "excellent" | "good" | "keep-practicing";
        label: string;
      }
    | null
  >(null);
  const feedbackTimeoutRef = useRef<number | null>(null);
  const recordingRepeatRemainingRef = useRef<number>(0);
  const [isRecordingPlaying, setIsRecordingPlaying] = useState(false);
  const [displayTime, setDisplayTime] = useState(currentTime);
  const timeSyncRef = useRef<{ time: number; perf: number }>({ time: currentTime, perf: 0 });
  const lastDisplayUpdateRef = useRef(0);

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  useEffect(() => {
    timeSyncRef.current = { time: currentTime, perf: performance.now() };
    setDisplayTime(currentTime);
  }, [currentTime]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (isPlaying) {
        const now = performance.now();
        const base = timeSyncRef.current;
        const speed = playbackRate || 1;
        const t = base.time + ((now - base.perf) / 1000) * speed;
        if (now - lastDisplayUpdateRef.current >= 50) {
          lastDisplayUpdateRef.current = now;
          setDisplayTime(t);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, playbackRate]);

  const handlePointerMove = useCallback((ev: PointerEvent) => {
    if (!isDraggingRef.current) return;
    const host = splitRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const ratio = clamp((ev.clientY - rect.top) / rect.height, 0.15, 0.85);
    setTopRatio(ratio);
    ev.preventDefault();
  }, []);

  const stopDrag = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    window.removeEventListener("pointermove", handlePointerMove, true);
    window.removeEventListener("pointerup", stopDrag, true);
  }, [handlePointerMove]);

  const groupedSegments = useMemo(() => groupSegments(rawSegments, 10), [rawSegments]);

  useEffect(() => {
    const themeClassMap: Record<string, string> = {
      default: "theme-default",
      "vibrant-forest": "theme-forest",
      "warm-orange": "theme-warm-orange",
      "serene-violet": "theme-serene-violet",
      "cool-mint": "theme-cool-mint",
      "dark-night": "theme-dark-night"
    };
    const className = themeClassMap[theme] ?? "theme-default";
    const body = document.body;
    body.classList.remove("theme-forest", "theme-default", "theme-warm-orange", "theme-serene-violet", "theme-cool-mint", "theme-dark-night");
    body.classList.add(className);
    return () => body.classList.remove(className);
  }, [theme]);

  useEffect(() => {
    const body = document.body
    body.classList.add("spl-lock-scroll")
    return () => body.classList.remove("spl-lock-scroll")
  }, [])

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    chrome.storage.local.get(["spl-theme"], (res: any) => {
      const saved = res?.["spl-theme"];
      const allowed = new Set(["default", "vibrant-forest", "warm-orange", "serene-violet", "cool-mint", "dark-night"]);
      if (allowed.has(saved)) setTheme(saved as typeof theme);
    });
  }, [setTheme]);

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current !== null) {
        window.clearTimeout(feedbackTimeoutRef.current);
        feedbackTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    chrome.storage.local.set({ "spl-theme": theme });
  }, [theme]);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    chrome.storage.local.get(["spl-target-language"], (res: any) => {
      const saved = res?.["spl-target-language"];
      const allowed = new Set(TARGET_LANGUAGES.map((t) => t.code));
      if (typeof saved === "string" && allowed.has(saved)) setTargetLanguage(saved);
    });
  }, [setTargetLanguage]);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    chrome.storage.local.set({ "spl-target-language": targetLanguage });
  }, [targetLanguage]);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "spl-get-tab-id" }, (res: any) => {
      if (res && typeof res.tabId === "number") setTabId(res.tabId);
      const msg: any = { type: "spl-get-initial-state" };
      if (res && typeof res.tabId === "number") msg.tabId = res.tabId;
      chrome.runtime.sendMessage(msg, (state: any) => {
        if (state && state.segments) setRawSegments(state.segments);
        if (state && typeof state.currentTime === "number") setCurrentTime(state.currentTime);
        if (state && typeof state.isReady === "boolean") setIsReady(state.isReady);
        if (state && typeof state.speed === "number") setPlaybackRate(state.speed);
        if (state && typeof state.currentLanguage === "string") setLanguage(state.currentLanguage);
      });
    });

    const onMessage = (v: any) => {
      const tid = tabId;
      if (v.tabId !== undefined && tid !== null && v.tabId !== tid) return;
      if (v.type === "spl-segments-updated") setRawSegments(v.segments);
      if (v.type === "spl-state-updated") {
        const incomingState = v.state ?? v;
        if (typeof incomingState.currentTime === "number") setCurrentTime(incomingState.currentTime);
        if (typeof incomingState.isReady === "boolean") setIsReady(incomingState.isReady);
        if (typeof incomingState.speed === "number") setPlaybackRate(incomingState.speed);
        if (typeof incomingState.isPlaying === "boolean") setIsPlaying(incomingState.isPlaying);
        const incomingLang =
          typeof v.currentLanguage === "string"
            ? v.currentLanguage
            : typeof incomingState.currentLanguage === "string"
              ? incomingState.currentLanguage
              : null;
        if (incomingLang) setLanguage(incomingLang);
      }
      if (v.type === "spl-mic-granted") {
        if (!isRecording) handleSpeakClick();
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [tabId]);

  const playSegment = (seg: Segment) => {
    const start = seg.startSeconds;
    const end = seg.endSeconds;
    const payload = { type: "spl-play-segment", start, end };
    if (tabId !== null) chrome.tabs.sendMessage(tabId, { ...payload, tabId });
    else chrome.runtime.sendMessage(payload);
  };

  const playGroup = (group: Segment[]) => {
    if (group.length === 0) return;
    const start = group[0].startSeconds;
    
    if (autoScroll) {
      const payload = { type: "spl-play", fromTime: start };
      if (tabId !== null) chrome.tabs.sendMessage(tabId, { ...payload, tabId });
      else chrome.runtime.sendMessage(payload);
    } else {
      const end = group[group.length - 1].endSeconds;
      const payload = { type: "spl-play-segment", start, end };
      if (tabId !== null) chrome.tabs.sendMessage(tabId, { ...payload, tabId });
      else chrome.runtime.sendMessage(payload);
    }
  };

  const setSpeed = (speed: number) => {
    setPlaybackRate(speed);
    const payload = { type: "spl-set-speed", speed };
    if (tabId !== null) chrome.tabs.sendMessage(tabId, { ...payload, tabId });
    else chrome.runtime.sendMessage(payload);
    if (hasPractice) playPracticeSelection();
  };

  const isSegmentActive = (seg: Segment) => displayTime >= seg.startSeconds && displayTime < seg.endSeconds;
  const isGroupActive = (group: Segment[]) => group.some(isSegmentActive);

  const activeGroupIndex = useMemo(() => {
    for (let i = 0; i < groupedSegments.length; i++) {
      if (isGroupActive(groupedSegments[i])) return i;
    }
    return null;
  }, [groupedSegments, displayTime]);

  const practiceGroupIndex = selectedGroupIndex ?? activeGroupIndex;
  const practiceGroup = (practiceGroupIndex !== null) ? (groupedSegments[practiceGroupIndex] ?? []) : [];
  const practiceText = joinGroupText(practiceGroup);
  const practiceWords = selectedPracticeWords.length > 0 ? selectedPracticeWords : tokenize(practiceText);
  const practiceTextForEval = practiceWords.join(" ");
  const hasPractice = practiceWords.length > 0;

  const activePracticeSegmentIndex = useMemo(() => {
    for (let i = 0; i < practiceGroup.length; i++) {
      if (isSegmentActive(practiceGroup[i])) return i;
    }
    return null;
  }, [practiceGroup, displayTime]);

  const activePracticeWord = useMemo(() => {
    if (activePracticeSegmentIndex === null) return null;
    const seg = practiceGroup[activePracticeSegmentIndex];
    if (!seg) return null;
    const toks = tokenize(seg.text);
    if (toks.length === 0) return null;
    const dur = Math.max(seg.endSeconds - seg.startSeconds, 0.001);
    const progress = clamp((displayTime - seg.startSeconds) / dur, 0, 0.999999);
    const wordIndex = Math.min(toks.length - 1, Math.floor(progress * toks.length));
    return { segmentIndex: activePracticeSegmentIndex, wordIndex };
  }, [activePracticeSegmentIndex, practiceGroup, displayTime]);

  const playRecordingWithRepeat = () => {
    if (!audioRef.current || !recordingUrl) return;
    const safeRepeat = repeatCount > 0 ? Math.min(Math.max(repeatCount, 1), 3) : 1;
    recordingRepeatRemainingRef.current = safeRepeat;
    audioRef.current.playbackRate = playbackRate || 1;
    audioRef.current.currentTime = 0;
    setIsRecordingPlaying(true);
    audioRef.current.play();
  };

  const practiceTokenMap = useMemo(() => {
    const groupTokens: { text: string; segmentIndex: number; wordIndex: number }[] = [];
    for (let i = 0; i < practiceGroup.length; i++) {
      const toks = tokenize(practiceGroup[i].text);
      for (let j = 0; j < toks.length; j++) {
        groupTokens.push({ text: toks[j], segmentIndex: i, wordIndex: j });
      }
    }
    const result: { text: string; segmentIndex: number | null; wordIndex: number | null }[] = [];
    let pointer = 0;
    for (const w of practiceWords) {
      const norm = normalizeToken(w);
      let found: number | null = null;
      let foundWordIndex: number | null = null;
      for (let k = pointer; k < groupTokens.length; k++) {
        if (normalizeToken(groupTokens[k].text) === norm) {
          found = groupTokens[k].segmentIndex;
          foundWordIndex = groupTokens[k].wordIndex;
          pointer = k + 1;
          break;
        }
      }
      result.push({ text: w, segmentIndex: found, wordIndex: foundWordIndex });
    }
    return result;
  }, [practiceGroup, practiceWords]);

  const playFromPracticeWord = (index: number) => {
    const range = computePracticeRange();
    if (!range) return;
    const map = practiceTokenMap[index];
    let start = range.start;
    if (map && map.segmentIndex !== null) {
      const seg = practiceGroup[map.segmentIndex];
      if (seg) {
        if (map.wordIndex !== null) {
          const toks = tokenize(seg.text);
          const n = toks.length;
          const dur = Math.max(seg.endSeconds - seg.startSeconds, 0);
          if (n > 0 && dur > 0) {
            start = seg.startSeconds + dur * clamp(map.wordIndex / n, 0, 0.999999);
          } else {
            start = seg.startSeconds;
          }
        } else {
          start = seg.startSeconds;
        }
      }
    }
    const safeRepeat = repeatCount > 0 ? Math.min(Math.max(repeatCount, 1), 3) : 1;
    const payload = { type: "spl-play-period", start, end: range.end, loop: false, repeatCount: safeRepeat };
    if (tabId !== null) chrome.tabs.sendMessage(tabId, { ...payload, tabId });
    else chrome.runtime.sendMessage(payload);
  };

  const computePracticeRange = () => {
    if (practiceGroup.length === 0) return null;
    const precise = selectedRangeRef.current;
    if (precise && (precise.groupIndex === practiceGroupIndex || practiceGroupIndex === null)) {
      const group = practiceGroupIndex !== null ? groupedSegments[practiceGroupIndex] ?? [] : practiceGroup;
      let cursor = 0;
      let first: Segment | null = null;
      let last: Segment | null = null;
      for (let i = 0; i < group.length; i++) {
        const seg = group[i];
        const segStart = cursor;
        const segEnd = segStart + seg.text.length + (i < group.length - 1 ? 1 : 0);
        const overlap = segEnd > precise.startChar && segStart < precise.endChar;
        if (overlap) {
          if (!first) first = seg;
          last = seg;
        }
        cursor = segEnd;
      }
      if (first && last) return { start: first.startSeconds, end: last.endSeconds };
    }

    const normWords = new Set(practiceWords.map((w) => normalizeToken(w)).filter(Boolean));
    let start: number | null = null;
    let end: number | null = null;
    for (const seg of practiceGroup) {
      const segTokens = tokenize(seg.text).map(normalizeToken);
      const hits = segTokens.some((t) => normWords.has(t));
      if (hits || normWords.size === 0) {
        start = start === null ? seg.startSeconds : Math.min(start, seg.startSeconds);
        end = end === null ? seg.endSeconds : Math.max(end, seg.endSeconds);
      }
    }
    if (start === null || end === null) {
      start = practiceGroup[0].startSeconds;
      end = practiceGroup[practiceGroup.length - 1].endSeconds;
    }
    return { start, end };
  };

  const playPracticeSelection = () => {
    const range = computePracticeRange();
    if (!range) return;
    const safeRepeat = repeatCount > 0 ? Math.min(Math.max(repeatCount, 1), 3) : 1;
    const payload = { type: "spl-play-segment", start: range.start, end: range.end, repeatCount: safeRepeat };
    if (tabId !== null) chrome.tabs.sendMessage(tabId, { ...payload, tabId });
    else chrome.runtime.sendMessage(payload);
  };

  useEffect(() => {
    const listEl = listRef.current;
    if (!listEl) return;

    const findGroupIndex = (node: Node | null): number | null => {
      let cur: Node | null = node;
      while (cur && cur !== listEl) {
        if (cur instanceof HTMLElement) {
          const idxAttr = cur.getAttribute("data-idx");
          if (idxAttr !== null) return Number(idxAttr);
        }
        cur = cur.parentNode;
      }
      return null;
    };

    const handleSelection = () => {
      const sel = window.getSelection();
      if (!sel) return;
      const text = sel.toString();
      if (!text.trim()) {
        resetRecording();
        setEvaluatedTokens([]);
        setSelectedPracticeWords([]);
        selectedRangeRef.current = null;
        return;
      }

      const anchorIdx = findGroupIndex(sel.anchorNode);
      const focusIdx = findGroupIndex(sel.focusNode);
      const targetIdx = focusIdx ?? anchorIdx ?? practiceGroupIndex;
      if (targetIdx !== null) setSelectedGroupIndex(targetIdx);

      const groupEl = targetIdx !== null ? (listEl.querySelector(`[data-idx="${targetIdx}"]`) as HTMLElement | null) : null;
      const range = sel.rangeCount ? sel.getRangeAt(0) : null;
      if (!groupEl || !range) {
        const parts = text
          .split(/\s+/)
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
        resetRecording();
        setEvaluatedTokens([]);
        setSelectedPracticeWords(parts);
        selectedRangeRef.current = null;
        return;
      }

      const walker = document.createTreeWalker(groupEl, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      const starts: number[] = [];
      let full = "";
      while (walker.nextNode()) {
        const tn = walker.currentNode as Text;
        nodes.push(tn);
        starts.push(full.length);
        full += tn.nodeValue || "";
      }

      const startNode = range.startContainer as Text;
      const endNode = range.endContainer as Text;
      const startIndex = nodes.indexOf(startNode);
      const endIndex = nodes.indexOf(endNode);
      const startChar = (startIndex >= 0 ? starts[startIndex] : 0) + range.startOffset;
      const endChar = (endIndex >= 0 ? starts[endIndex] : full.length) + range.endOffset;
      const a = Math.max(0, Math.min(startChar, endChar));
      const b = Math.max(0, Math.max(startChar, endChar));

      const tokens = tokenize(full);
      const positions: { start: number; end: number; text: string }[] = [];
      let pos = 0;
      for (const tok of tokens) {
        const s = full.indexOf(tok, pos);
        const e = s >= 0 ? s + tok.length : pos;
        positions.push({ start: s >= 0 ? s : pos, end: e, text: tok });
        pos = e;
      }
      const chosen = positions
        .filter((p) => p.end > a && p.start < b)
        .map((p) => p.text);

      resetRecording();
      setEvaluatedTokens([]);
      setSelectedPracticeWords(chosen);
      selectedRangeRef.current = targetIdx !== null ? { groupIndex: targetIdx, startChar: a, endChar: b } : null;
    };

    listEl.addEventListener("mouseup", handleSelection);
    listEl.addEventListener("keyup", handleSelection);
    return () => {
      listEl.removeEventListener("mouseup", handleSelection);
      listEl.removeEventListener("keyup", handleSelection);
    };
  }, [groupedSegments, practiceGroup, practiceGroupIndex, resetRecording, setEvaluatedTokens, setSelectedGroupIndex, setSelectedPracticeWords]);

  useEffect(() => {
    if (!autoScroll || !listRef.current) return;
    const activeEl = listRef.current.querySelector('[data-active="true"]');
    if (activeEl) activeEl.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [displayTime, autoScroll]);

  useEffect(() => {
    if (!practiceTextForEval || !finalTranscript) {
      setEvaluatedTokens([]);
      return;
    }
    setEvaluatedTokens(evaluateSentence(practiceTextForEval, finalTranscript));
  }, [practiceTextForEval, finalTranscript, setEvaluatedTokens]);

  useEffect(() => {
    const key = `${practiceTextForEval}__${finalTranscript}`;
    const tokens = evaluatedTokens.filter((t) => normalizeToken(t.text));
    if (tokens.length === 0) {
      lastConfettiKeyRef.current = null;
      if (feedbackTimeoutRef.current !== null) {
        window.clearTimeout(feedbackTimeoutRef.current);
        feedbackTimeoutRef.current = null;
      }
      setFeedback(null);
      return;
    }

    let scoreSum = 0;
    for (const t of tokens) {
      if (t.status === "correct") scoreSum += 1;
      else if (t.status === "partial") scoreSum += 0.7;
    }
    const accuracy = scoreSum / tokens.length;
    const allNonWrong = tokens.every((t) => t.status === "correct" || t.status === "partial");
    let rating: "excellent" | "good" | "keep-practicing";
    if (allNonWrong && accuracy >= 0.9) rating = "excellent";
    else if (accuracy >= 0.6) rating = "good";
    else rating = "keep-practicing";

    const label = rating === "excellent" ? "Excellent" : rating === "good" ? "Good" : "Keep practicing";
    setFeedback({ rating, label });

    if (feedbackTimeoutRef.current !== null) {
      window.clearTimeout(feedbackTimeoutRef.current);
    }
    feedbackTimeoutRef.current = window.setTimeout(() => {
      setFeedback(null);
      feedbackTimeoutRef.current = null;
    }, 2000);

    const count = 200;
    const defaults = { origin: { y: 0.7 } };
    const fire = (particleRatio: number, opts: Record<string, number>) => {
      confetti({ ...defaults, ...opts, particleCount: Math.floor(count * particleRatio) });
    };

    const launch = () => {
      fire(0.25, { spread: 26, startVelocity: 55 });
      fire(0.2, { spread: 60 });
      fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
      fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
      fire(0.1, { spread: 120, startVelocity: 45 });
    };

    if (rating === "excellent" || rating === "good") {
      const confettiKey = `${key}__${rating}`;
      if (lastConfettiKeyRef.current === confettiKey) return;
      lastConfettiKeyRef.current = confettiKey;

      launch();
      if (rating === "excellent") {
        window.setTimeout(launch, 350);
        window.setTimeout(launch, 700);
      }
    } else {
      lastConfettiKeyRef.current = null;
    }
  }, [evaluatedTokens, finalTranscript, practiceTextForEval]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !recordingUrl) return;
    audio.playbackRate = playbackRate || 1;
    const handleEnded = () => {
      if (recordingRepeatRemainingRef.current > 1) {
        recordingRepeatRemainingRef.current -= 1;
        audio.currentTime = 0;
        audio.play();
      } else {
        recordingRepeatRemainingRef.current = 0;
        setIsRecordingPlaying(false);
      }
    };
    audio.addEventListener("ended", handleEnded);
    return () => {
      audio.removeEventListener("ended", handleEnded);
    };
  }, [recordingUrl, playbackRate]);

  useEffect(() => {
    if (!recordingUrl) {
      setIsRecordingPlaying(false);
    }
  }, [recordingUrl]);

  const handleTranslate = () => {
    if (!hasPractice) return;
    const text = practiceWords.join(" ");
    
    // Use user selected target language
    const targetLang = targetLanguage || "zh-CN";

    const url = `https://translate.google.com/?sl=auto&tl=${targetLang}&text=${encodeURIComponent(text)}&op=translate`;
    const width = 1000;
    const height = 800;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;
    window.open(url, "google_translate", `width=${width},height=${height},left=${left},top=${top}`);
  };

  const stopRecordingInternal = () => {
    setRecordingState({ isRecording: false });
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
    }
  };

  const handleSpeakClick = async () => {
    if (isRecording) {
      stopRecordingInternal();
      return;
    }

    resetRecording();
    setEvaluatedTokens([]);

    const SpeechRecognition: any =
      (typeof window !== "undefined" && (window as any).SpeechRecognition) ||
      (typeof window !== "undefined" && (window as any).webkitSpeechRecognition) ||
      null;

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.lang = "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event: any) => {
        let interim = "";
        let final = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const text = res[0].transcript as string;
          if (res.isFinal) final += text + " ";
          else interim += text + " ";
        }
        setRecordingState((prev) => ({
          ...prev,
          interimTranscript: interim.trim(),
          finalTranscript: (prev.finalTranscript + " " + final).trim()
        }));
      };
      recognition.onerror = () => {
        stopRecordingInternal();
      };
      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch {}
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        if (chunks.length === 0) return;
        const blob = new Blob(chunks, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        setRecordingState({ recordingUrl: url });
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingState({ isRecording: true });
    } catch (err: any) {
      console.error("getUserMedia failed", err);
      if (typeof err?.name === "string" && err.name === "NotAllowedError") {
        try {
          const url = chrome.runtime?.getURL?.("tabs/tutorial.html?grantMic=1");
          if (url && chrome.tabs?.create) {
            chrome.tabs.create({ url });
            toast.error("Please grant microphone permission in the new tab");
          }
        } catch {}
      }
      stopRecordingInternal();
      toast.error("Microphone access failed");
    }
  };

  const handleCopyPractice = async () => {
    if (!hasPractice) return;
    const text = practiceWords.join(" ").trim();
    if (!text) return;
    try {
      if (document.hasFocus()) {
        await navigator.clipboard.writeText(text);
        toast.success("Copy successful", { duration: 1800});
        return;
      }
      throw new Error("document-not-focused");
    } catch (err) {
      // Fallback: textarea + execCommand in case clipboard API requires focus
      try {
        const el = document.createElement("textarea");
        el.value = text;
        el.setAttribute("readonly", "");
        el.style.position = "absolute";
        el.style.left = "-9999px";
        document.body.appendChild(el);
        el.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(el);
        if (ok) {
          toast.success("Copy successful", { duration: 1800 });
          return;
        }
      } catch (fallbackErr) {
        console.error("copy practice fallback failed", fallbackErr);
      }
      console.error("copy practice failed", err);
      toast.error("Copy failed, please click the sidebar first or copy manually", { duration: 2400 });
    }
  };

  const handleExportWav = async () => {
    if (!recordingUrl || isExportingWav) return;
    setIsExportingWav(true);
    try {
      const wavBlob = await webmToWavBlob(recordingUrl);
      const downloadUrl = URL.createObjectURL(wavBlob);
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `recording-${ts}.wav`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(downloadUrl);
      toast.success("WAV exported", { duration: 1800 });
    } catch (err) {
      console.error("export wav failed", err);
      toast.error("Export failed, please try again", { duration: 2400 });
    } finally {
      setIsExportingWav(false);
    }
  };

  const onHandlePointerDown = useCallback(
    (ev: ReactPointerEvent<HTMLDivElement>) => {
      const host = splitRef.current;
      if (!host) return;
      isDraggingRef.current = true;
      window.addEventListener("pointermove", handlePointerMove, { capture: true, passive: false });
      window.addEventListener("pointerup", stopDrag, { capture: true });
      ev.preventDefault();
    },
    [handlePointerMove, stopDrag]
  );

  useEffect(() => stopDrag, [stopDrag]);

  if (!isReady || groupedSegments.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">No segments available.Try refreshing the page.</div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <ToastViewport />
      {feedback && (
        <div className="spl-feedback-overlay">
          <div className="spl-feedback-inner">{feedback.label}</div>
        </div>
      )}
      <header className="px-6 pt-6 pb-4 flex-shrink-0">
        <h1 className="text-xl font-bold text-foreground">Shadowing Practice Loop</h1>
        <div className="flex flex-row gap-2 justify-between items-center mt-2">
          <div className="text-sm text-muted-foreground">1. Listen</div>
          <div className="text-sm text-muted-foreground">2. Repeat</div>
          <div className="text-sm text-muted-foreground">3. Feedback</div>
        </div>
      </header>

      <div ref={splitRef} className="flex-1 min-h-0 flex flex-col px-6 pb-6 overflow-hidden">
        <div
          className="flex flex-col min-h-0"
          style={{ flexBasis: `${topRatio * 100}%`, minHeight: "15%" }}
        >
          {/* Upper half: transcript list */}
          <div className="h-full min-h-0 overflow-hidden rounded-lg shadow border border-border bg-card flex flex-col p-6">
            <article
              ref={listRef}
              className="prose prose-lg dark:prose-invert text-foreground space-y-3 flex-1 min-h-0 overflow-y-auto overflow-x-hidden max-w-none scroll-smooth snap-y snap-proximity text-lg"
            >
              {groupedSegments.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">No segments available</div>
              ) : (
                groupedSegments.map((group, groupIndex) => {
                  const groupActive = isGroupActive(group);
                  return (
                    <div
                      key={groupIndex}
                      className={`flex flex-col justify-between p-2 rounded-lg border-2 transition-all ${
                        groupActive ? "snap-start border-blue-500 bg-card" : "border-transparent hover:bg-muted/50"
                      }`}
                      data-active={groupActive}
                      data-idx={groupIndex}
                      onClick={() => setSelectedGroupIndex(groupIndex)}
                    >
                      <div className="flex flex-row items-start gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            playGroup(group);
                            setSelectedGroupIndex(groupIndex);
                            setSelectedPracticeWords([]);
                            resetRecording();
                            setEvaluatedTokens([]);
                          }}
                          className="flex items-center justify-center w-7 h-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors mt-1"
                          aria-label="Play line"
                        >
                          <Play className="size-4" />
                        </button>
                        <p className="text-foreground leading-relaxed">
                          {group.map((seg, segIndex) => {
                            const active = isSegmentActive(seg);
                            const toks = active ? tokenize(seg.text) : [];
                            const dur = Math.max(seg.endSeconds - seg.startSeconds, 0.001);
                            const progress = active ? clamp((displayTime - seg.startSeconds) / dur, 0, 0.999999) : 0;
                            const wordIndex = active && toks.length > 0 ? Math.min(toks.length - 1, Math.floor(progress * toks.length)) : -1;
                            return (
                              <span key={segIndex}>
                                <span
                                  className="cursor-pointer text-foreground"
                                  data-segment-start-seconds={seg.startSeconds}
                                  data-segment-end-seconds={seg.endSeconds}
                                  onClick={() => playSegment(seg)}
                                >
                                  {active && toks.length > 1
                                    ? toks.map((t, i) => (
                                        <span
                                          key={i}
                                          className={
                                            i === wordIndex
                                              ? "underline decoration-blue-500 decoration-2 underline-offset-2"
                                              : ""
                                          }
                                        >
                                          {t}
                                          {i < toks.length - 1 ? " " : ""}
                                        </span>
                                      ))
                                    : (
                                        <span
                                          className={
                                            active
                                              ? "underline decoration-blue-500 decoration-2 underline-offset-2"
                                              : ""
                                          }
                                        >
                                          {seg.text}
                                        </span>
                                      )}
                                </span>
                                {segIndex < group.length - 1 && <span> </span>}
                              </span>
                            );
                          })}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </article>
          </div>
        </div>

        <div
          className="relative z-50 flex h-4 w-full items-center justify-center bg-transparent hover:bg-muted/50 transition-colors cursor-row-resize shrink-0 focus:outline-none"
          onPointerDown={onHandlePointerDown}
        >
          <div className="h-1 w-12 rounded-full bg-border" />
        </div>

        <div
          className="flex flex-col min-h-0"
          style={{ flexBasis: `${(1 - topRatio) * 100}%`, minHeight: "15%" }}
        >
          {/* Lower half: controls and practice */}
          <div className="h-full min-h-0 overflow-y-auto rounded-lg shadow border border-border bg-card flex flex-col p-6 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded border-primary"
              />
              Auto-scroll
            </label>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Popover>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-2 px-3 py-1 rounded-full border border-border hover:bg-muted transition-colors h-8 text-xs">
                    <Settings className="w-3.5 h-3.5" />
                    <span className="font-medium">
                      {TARGET_LANGUAGES.find((t) => t.code === targetLanguage)?.code.substring(0, 2).toUpperCase() ?? "EN"}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-4" align="end">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm leading-none">Settings</h4>
                      <p className="text-xs text-muted-foreground">
                        Customize your learning experience
                      </p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium">My Language</label>
                      <Select value={targetLanguage} onValueChange={setTargetLanguage}>
                        <SelectTrigger className="w-full h-8 text-xs">
                          <SelectValue placeholder="Select language" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[200px]">
                          {TARGET_LANGUAGES.map((lang) => (
                            <SelectItem key={lang.code} value={lang.code} className="text-xs">
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground w-5 text-left text-[10px]">
                                  {lang.code.substring(0, 2).toUpperCase()}
                                </span>
                                <span>{lang.label}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Theme</label>
                      <Select value={theme} onValueChange={setTheme}>
                        <SelectTrigger className="w-full h-8 text-xs">
                          <SelectValue placeholder="Select theme" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[200px]">
                          {THEMES.map((item) => (
                            <SelectItem key={item.value} value={item.value} className="text-xs">
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <button
                onClick={handleTranslate}
                className="px-3 py-1 rounded-md border border-border hover:bg-muted transition-colors h-8 text-xs"
                disabled={!hasPractice}
              >
                Translate
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSpeed(1)}
                className={`px-3 py-1 rounded-md border text-sm flex items-center gap-1 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:opacity-60 disabled:cursor-not-allowed ${
                  playbackRate === 1 ? "bg-primary text-primary-foreground" : "bg-background text-foreground"
                }`}
                disabled={!hasPractice}
              >
                <span>1x</span>
              </button>
              <button
                onClick={() => setSpeed(0.5)}
                className={`px-3 py-1 rounded-md border text-sm flex items-center gap-1 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:opacity-60 disabled:cursor-not-allowed ${
                  playbackRate === 0.5 ? "bg-primary text-primary-foreground" : "bg-background text-foreground"
                }`}
                disabled={!hasPractice}
              >
                <span>0.5x</span>
              </button>
              <Select
                value={String(repeatCount > 0 ? Math.min(Math.max(repeatCount, 1), 3) : 1)}
                onValueChange={(value) => {
                  const num = Number(value);
                  if (!Number.isFinite(num)) return;
                  const clamped = num > 0 ? Math.min(Math.max(num, 1), 3) : 1;
                  setRepeatCount(clamped);
                }}
              >
                <SelectTrigger className="w-[90px] h-8 text-xs">
                  <SelectValue placeholder="Repeat" />
                </SelectTrigger>
                <SelectContent className="text-xs">
                  <SelectItem value="1">Repeat 1x</SelectItem>
                  <SelectItem value="2">Repeat 2x</SelectItem>
                  <SelectItem value="3">Repeat 3x</SelectItem>
                </SelectContent>
              </Select>
              <button
                onClick={() => {
                  playPracticeSelection();
                  playRecordingWithRepeat();
                }}
                className={`px-3 py-1 rounded-md border text-sm flex items-center gap-1 disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:opacity-60 disabled:cursor-not-allowed ${
                  recordingUrl ? "bg-background text-foreground hover:bg-muted" : "opacity-60 cursor-not-allowed"
                }`}
                disabled={!recordingUrl}
              >
                <Play className="w-3 h-3" />
                <span>Play Both</span>
              </button>
            </div>
              <button
                onClick={handleSpeakClick}
                className={`flex-1 max-w-xs h-10 rounded-md text-sm font-medium flex items-center justify-center transition-colors disabled:bg-muted disabled:text-muted-foreground disabled:border-border disabled:opacity-60 disabled:cursor-not-allowed ${
                  isRecording ? "bg-red-600 text-white" : "bg-primary text-primary-foreground hover:bg-primary/90"
                }`}
                disabled={!hasPractice}
              >
                {isRecording ? "Stop" : "Speak"}
              </button>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <button
                disabled={!recordingUrl}
                onClick={playRecordingWithRepeat}
                className={`inline-flex items-center gap-2 px-3 py-1 rounded-md border text-sm transition-colors ${
                  recordingUrl
                    ? isRecordingPlaying
                      ? "bg-red-600 text-white border-red-600 animate-pulse"
                      : "hover:bg-muted"
                    : "opacity-60 cursor-not-allowed"
                }`}
              >
                {isRecordingPlaying ? (
                  <>
                    <span className="relative flex items-center justify-center">
                      <span className="absolute inline-flex w-4 h-4 rounded-full bg-red-400 opacity-75 animate-ping" />
                      <span className="relative w-2 h-2 rounded-full bg-white" />
                    </span>
                    <span>My Recording</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    <span>My Recording</span>
                  </>
                )}
              </button>
              <button
                disabled={!recordingUrl || isExportingWav}
                onClick={handleExportWav}
                className={`inline-flex items-center gap-2 px-3 py-1 rounded-md border text-sm transition-colors ${
                  recordingUrl && !isExportingWav ? "hover:bg-muted" : "opacity-60 cursor-not-allowed"
                }`}
              >
                <span>{isExportingWav ? "Exporting..." : "Export WAV"}</span>
              </button>
              <audio ref={audioRef} src={recordingUrl ?? undefined} className="hidden" />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground min-h-[20px]">
              <button
                type="button"
                onClick={handleCopyPractice}
                disabled={!hasPractice}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs transition-colors ${
                  hasPractice ? "hover:bg-muted" : "opacity-60 cursor-not-allowed"
                }`}
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </button>
              <span>
                {isRecording ? "Recording..." : recordingUrl ? "Playback recent recording" : "No recording available"}
              </span>
            </div>
          </div>

          <div className="w-full flex-shrink-0 rounded-lg border bg-card p-4 min-h-[180px] flex flex-col gap-3 overflow-hidden text-lg">
            <div>
              <div className="flex items-center justify-between gap-2">
                <div>
                  {practiceWords.length ? (
                    <div className="flex flex-wrap gap-1">
                      {practiceTokenMap.map((tok, idx) => {
                        const isActive =
                          activePracticeWord !== null &&
                          tok.segmentIndex !== null &&
                          tok.wordIndex !== null &&
                          tok.segmentIndex === activePracticeWord.segmentIndex &&
                          tok.wordIndex === activePracticeWord.wordIndex;
                        return (
                          <span
                            key={idx}
                            data-practice-token-index={idx}
                            data-active={isActive ? "true" : "false"}
                            className={`inline-block px-1 rounded-md cursor-pointer transition-all border ${
                              isActive ? "border-primary" : "border-transparent"
                            } hover:shadow-sm hover:bg-muted`}
                            onClick={() => playFromPracticeWord(idx)}
                          >
                            {tok.text}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-xs">Select text above to start practicing</p>
                  )}
                </div>
              </div>
            </div>
            <div>
              {/* <p className="text-sm text-muted-foreground">Speech recognition</p> */}
              <p className="text-xs text-muted-foreground leading-relaxed min-h-[20px]">
                {finalTranscript || interimTranscript || "Speak to start recording and recognition"}
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              {evaluatedTokens.length === 0 ? (
                <span className="text-muted-foreground text-xs">Speak to see feedback</span>
              ) : (
                evaluatedTokens.map((tok, idx) => {
                  const color =
                    tok.status === "correct"
                      ? "bg-emerald-600"
                      : tok.status === "partial"
                        ? "bg-amber-500"
                        : "bg-red-600";
                  return (
                    <span key={idx} className={`px-1.5 py-0.5 rounded-md text-sm ${color} text-white`}>
                      {tok.text}
                    </span>
                  );
                })
              )}
            </div>
            {isRecording && (
              <p className="text-xs text-muted-foreground">Listening... {interimTranscript}</p>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
