import { useEffect, useMemo, useRef, useState } from "react";
import "./style.css";
import { Play } from "lucide-react";

type Segment = { startSeconds: number; durationSeconds: number; endSeconds: number; text: string };

// Group segments by sentence - exactly like competitor's gi() function
// Rule: Split when segment contains punctuation AND buffer has >= 5 segments
const TERMINATORS = [".", "!", "?", ";"];
const TERMINATOR_REGEX = new RegExp(`[${TERMINATORS.join("")}]`);

function groupSegments(segments: Segment[], maxChunkLength?: number): Segment[][] {
  const result: Segment[][] = [];
  
  // Check if any segment has punctuation
  const hasPunctuation = segments.some(s => TERMINATOR_REGEX.test(s.text));
  
  if (hasPunctuation) {
    // Group by punctuation (competitor logic: punctuation + >= 5 segments)
    let buffer: Segment[] = [];
    for (const seg of segments) {
      buffer.push(seg);
      if (TERMINATOR_REGEX.test(seg.text) && buffer.length >= 5) {
        result.push([...buffer]);
        buffer = [];
      }
    }
    // Flush remaining
    if (buffer.length > 0) {
      result.push(buffer);
    }
  } else if (maxChunkLength !== undefined) {
    // No punctuation - group by duration
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
    if (buffer.length > 0) {
      result.push(buffer);
    }
  } else {
    // No grouping - all in one
    if (segments.length > 0) {
      result.push([...segments]);
    }
  }
  
  return result;
}

export default function SidePanel() {
  const [tabId, setTabId] = useState<number | null>(null);
  const [rawSegments, setRawSegments] = useState<Segment[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Group segments like competitor (memoized)
  const groupedSegments = useMemo(() => {
    // Pass a fallback maxChunkLength (e.g. 10 seconds) in case punctuation is missing
    // This prevents the "one giant block" issue for ASR captions
    return groupSegments(rawSegments, 10);
  }, [rawSegments]);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "spl-get-tab-id" }, (res) => {
      if (res && typeof res.tabId === "number") setTabId(res.tabId);
      const msg: any = { type: "spl-get-initial-state" };
      if (res && typeof res.tabId === "number") msg.tabId = res.tabId;
      chrome.runtime.sendMessage(msg, (state) => {
        if (state && state.segments) setRawSegments(state.segments);
        if (state && typeof state.currentTime === "number") setCurrentTime(state.currentTime);
        if (state && typeof state.isReady === "boolean") setIsReady(state.isReady);
      });
    });
    const onMessage = (v: any) => {
      const tid = tabId;
      if (v.tabId !== undefined && tid !== null && v.tabId !== tid) return;
      if (v.type === "spl-segments-updated") setRawSegments(v.segments);
      if (v.type === "spl-state-updated") {
        if (typeof v.currentTime === "number") setCurrentTime(v.currentTime);
        if (typeof v.isReady === "boolean") setIsReady(v.isReady);
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [tabId]);

  const playSegment = (seg: Segment) => {
    if (tabId === null) return;
    chrome.tabs.sendMessage(tabId, { type: "spl-play", time: seg.startSeconds });
  };

  const playGroup = (group: Segment[]) => {
    if (tabId === null || group.length === 0) return;
    chrome.tabs.sendMessage(tabId, { type: "spl-play", time: group[0].startSeconds });
  };

  // Helper to check if a segment is active
  const isSegmentActive = (seg: Segment) => {
    return currentTime >= seg.startSeconds && currentTime < seg.endSeconds;
  };

  // Helper to check if any segment in group is active
  const isGroupActive = (group: Segment[]) => {
    return group.some(isSegmentActive);
  };

  // Auto-scroll
  useEffect(() => {
    if (!autoScroll || !listRef.current) return;
    const activeEl = listRef.current.querySelector('[data-active="true"]');
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentTime, autoScroll]);

  if (!isReady && rawSegments.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No segments available
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header - Exact Replica */}
      <header className="p-4 flex-shrink-0">
        <h1 className="text-xl font-bold text-foreground">Speak Practice Loop</h1>
        <div className="flex flex-row gap-2 justify-between items-center mt-2">
          <div className="text-sm text-muted-foreground">1. Listen to the text</div>
          <div className="text-sm text-muted-foreground">2. Repeat out loud</div>
          <div className="text-sm text-muted-foreground">3. Feedback</div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 overflow-hidden p-6 pt-0 rounded-lg shadow border-t border-border bg-card flex flex-col">
        <article 
          ref={listRef}
          className="prose prose-lg dark:prose-invert text-foreground space-y-3 p-4 flex-1 min-h-0 overflow-y-auto max-w-none scroll-smooth snap-y snap-proximity"
        >
          {groupedSegments.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              No segments available
            </div>
          ) : (
            groupedSegments.map((group, groupIndex) => {
              const groupActive = isGroupActive(group);
              return (
                <div 
                  key={groupIndex} 
                  className={`flex flex-col justify-between p-2 rounded-lg border-2 transition-all ${
                    groupActive 
                      ? 'snap-start border-blue-500 bg-card' 
                      : 'border-transparent hover:bg-muted/50'
                  }`}
                  data-active={groupActive}
                  data-idx={groupIndex}
                >
                  <div className="flex flex-row items-start gap-2">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        playGroup(group);
                      }}
                      className="flex items-center justify-center w-7 h-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors mt-1"
                    >
                      <Play className="size-4" />
                    </button>
                    <p className="text-foreground leading-relaxed">
                      {group.map((seg, segIndex) => {
                        const active = isSegmentActive(seg);
                        return (
                          <span key={segIndex}>
                            <span 
                              className={`cursor-pointer text-foreground ${active ? 'underline decoration-blue-500 decoration-2 underline-offset-2' : ''}`}
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
        
        {/* Footer Controls - Simplified Replica */}
        <div className="p-4 border-t border-border bg-background mt-auto">
          <div className="flex items-center justify-end gap-2 mb-4">
             <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
              <input 
                type="checkbox" 
                checked={autoScroll} 
                onChange={e => setAutoScroll(e.target.checked)}
                className="rounded border-primary"
              />
              Auto-scroll
            </label>
          </div>
          <div className="rounded-lg border bg-card p-6 text-center">
             <p className="text-muted-foreground text-sm">Select text above to start practicing</p>
          </div>
        </div>
      </div>
    </div>
  );
}
