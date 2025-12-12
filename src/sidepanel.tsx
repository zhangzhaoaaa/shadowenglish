// 清理旧内容，重新写入完整实现
import { useEffect, useMemo, useRef } from "react";
import "./style.css";
import { Play, Settings } from "lucide-react";
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

  let spokenIndex = 0;

  return targetTokens.map((tok) => {
    const norm = normalizeToken(tok);
    if (!norm) return { text: tok, status: "correct" };

    while (spokenIndex < spokenNorm.length && !spokenNorm[spokenIndex]) {
      spokenIndex += 1;
    }

    let status: "correct" | "partial" | "wrong" = "wrong";
    if (spokenIndex < spokenNorm.length) {
      const sim = tokenSimilarity(norm, spokenNorm[spokenIndex]);
      if (sim >= 0.85) status = "correct";
      else if (sim >= 0.6) status = "partial";
      else status = "wrong";
      spokenIndex += 1;
    }

    return { text: tok, status };
  });
}

export default function SidePanel() {
  const {
    tabId,
    rawSegments,
    currentTime,
    isReady,
    autoScroll,
    playbackRate,
    selectedGroupIndex,
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
    setSelectedGroupIndex,
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

  const groupedSegments = useMemo(() => groupSegments(rawSegments, 10), [rawSegments]);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "spl-get-tab-id" }, (res) => {
      if (res && typeof res.tabId === "number") setTabId(res.tabId);
      const msg: any = { type: "spl-get-initial-state" };
      if (res && typeof res.tabId === "number") msg.tabId = res.tabId;
      chrome.runtime.sendMessage(msg, (state) => {
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

  const isSegmentActive = (seg: Segment) => currentTime >= seg.startSeconds && currentTime < seg.endSeconds;
  const isGroupActive = (group: Segment[]) => group.some(isSegmentActive);

  const activeGroupIndex = useMemo(() => {
    for (let i = 0; i < groupedSegments.length; i++) {
      if (isGroupActive(groupedSegments[i])) return i;
    }
    return null;
  }, [groupedSegments, currentTime]);

  const practiceGroupIndex = selectedGroupIndex;
  const practiceGroup = (practiceGroupIndex !== null) ? (groupedSegments[practiceGroupIndex] ?? []) : [];
  const practiceText = joinGroupText(practiceGroup);
  const practiceWords = selectedPracticeWords.length > 0 ? selectedPracticeWords : tokenize(practiceText);
  const practiceTextForEval = practiceWords.join(" ");
  const hasPractice = practiceWords.length > 0;

  const computePracticeRange = () => {
    if (practiceGroup.length === 0) return null;
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
    const payload = { type: "spl-play-segment", start: range.start, end: range.end };
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
        return;
      }

      const selectedParts = text
        .split(/\s+/)
        .map((t) => t.replace(/[^A-Za-z']/g, "").toLowerCase())
        .filter((t) => t.length > 0);

      if (selectedParts.length === 0) {
        resetRecording();
        setEvaluatedTokens([]);
        setSelectedPracticeWords([]);
        return;
      }

      const anchorIdx = findGroupIndex(sel.anchorNode);
      const focusIdx = findGroupIndex(sel.focusNode);
      const targetIdx = focusIdx ?? anchorIdx ?? practiceGroupIndex;
      if (targetIdx !== null) setSelectedGroupIndex(targetIdx);

      const targetGroup = targetIdx !== null ? groupedSegments[targetIdx] : practiceGroup;
      const baseWords = tokenize(joinGroupText(targetGroup ?? practiceGroup));
      const chosen = baseWords.filter((w) => {
        const norm = normalizeToken(w);
        return norm && selectedParts.some((p) => norm.includes(p));
      });

      resetRecording();
      setEvaluatedTokens([]);
      setSelectedPracticeWords(chosen);
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
  }, [currentTime, autoScroll]);

  useEffect(() => {
    if (!practiceTextForEval || !finalTranscript) {
      setEvaluatedTokens([]);
      return;
    }
    setEvaluatedTokens(evaluateSentence(practiceTextForEval, finalTranscript));
  }, [practiceTextForEval, finalTranscript, setEvaluatedTokens]);

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
      stopRecordingInternal();
      // 简易权限提示
      const msg = err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError"
        ? "麦克风权限被拒绝，请在浏览器地址栏右侧开启麦克风权限后重试"
        : "无法访问麦克风，请检查权限或设备后重试";
      alert(msg);
    }
  };

  if (!isReady && rawSegments.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">No segments available</div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <header className="px-6 pt-6 pb-4 flex-shrink-0">
        <h1 className="text-xl font-bold text-foreground">Shadow Language Practice</h1>
        <div className="flex flex-row gap-2 justify-between items-center mt-2">
          <div className="text-sm text-muted-foreground">1. Listen</div>
          <div className="text-sm text-muted-foreground">2. Repeat</div>
          <div className="text-sm text-muted-foreground">3. Feedback</div>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col gap-4 px-6 pb-6 overflow-hidden">
        {/* Upper half: transcript list */}
        <div className="flex-none basis-[45%] min-h-0 overflow-hidden rounded-lg shadow border border-border bg-card flex flex-col p-6">
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
                          return (
                            <span key={segIndex}>
                              <span
                                className={`cursor-pointer text-foreground ${
                                  active ? "underline decoration-blue-500 decoration-2 underline-offset-2" : ""
                                }`}
                                data-segment-start-seconds={seg.startSeconds}
                                data-segment-end-seconds={seg.endSeconds}
                                onClick={() => playSegment(seg)}
                              >
                                {seg.text}
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

        {/* Lower half: controls and practice */}
        <div className="flex-1 min-h-0 overflow-y-auto rounded-lg shadow border border-border bg-card flex flex-col p-6 space-y-4">
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
                    {/* Placeholder for future settings */}
                    <div className="pt-2 border-t border-border">
                      <p className="text-[10px] text-muted-foreground text-center">
                        More settings coming soon...
                      </p>
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
                className={`px-3 py-1 rounded-md border text-sm flex items-center gap-1 ${
                  playbackRate === 1 ? "bg-primary text-primary-foreground" : "bg-background text-foreground"
                }`}
                disabled={!hasPractice}
              >
                <span>1x</span>
              </button>
              <button
                onClick={() => setSpeed(0.5)}
                className={`px-3 py-1 rounded-md border text-sm flex items-center gap-1 ${
                  playbackRate === 0.5 ? "bg-primary text-primary-foreground" : "bg-background text-foreground"
                }`}
                disabled={!hasPractice}
              >
                <span>0.5x</span>
              </button>
            </div>
            <button
              onClick={handleSpeakClick}
              className={`flex-1 max-w-xs h-10 rounded-md text-sm font-medium flex items-center justify-center transition-colors ${
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
                onClick={() => {
                  if (!audioRef.current || !recordingUrl) return;
                  audioRef.current.currentTime = 0;
                  audioRef.current.play();
                }}
                className={`inline-flex items-center gap-2 px-3 py-1 rounded-md border text-sm transition-colors ${
                  recordingUrl ? "hover:bg-muted" : "opacity-60 cursor-not-allowed"
                }`}
              >
                <Play className="w-4 h-4" />
                <span>My Recording</span>
              </button>
              <audio ref={audioRef} src={recordingUrl ?? undefined} className="hidden" />
            </div>
            <div className="text-xs text-muted-foreground min-h-[20px]">
              {isRecording ? `录音中... ${interimTranscript}` : recordingUrl ? "可回放最近录音" : "暂无录音"}
            </div>
          </div>

          <div className="w-full flex-shrink-0 rounded-lg border bg-card p-4 min-h-[180px] flex flex-col gap-3 overflow-hidden text-lg">
            <div>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-foreground leading-relaxed">
                    {practiceWords.length ? practiceWords.join(" ") : "Select text above to start practicing"}
                  </p>
                </div>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">录音识别</p>
              <p className="text-sm text-muted-foreground leading-relaxed min-h-[20px]">
                {finalTranscript || interimTranscript || "Speak 开始录音与识别"}
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              {evaluatedTokens.length === 0 ? (
                <span className="text-muted-foreground text-sm">Speak to see feedback</span>
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
  );
}
