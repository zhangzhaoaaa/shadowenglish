import type { PlasmoCSConfig } from "plasmo";
declare const chrome: any;

export const config: PlasmoCSConfig = {
  matches: ["*://*.youtube.com/*"],
  all_frames: true,
  run_at: "document_end"
};

let video: HTMLVideoElement | null = null;
let captions: Array<{ startSeconds: number; durationSeconds: number; endSeconds: number; text: string }> = [];
let currentLanguage = "en";
let currentTabId: number | null = null;
let loopActive = false;
let periodStart = 0;
let periodEnd = 0;
let playOnceActive = false;
let loopCheckTimer: number | null = null;
const STOP_SNAP = 0.02; // keep cursor inside the target segment
let finiteLoopCount = 1;

const findVideo = () => document.querySelector("video.html5-main-video") as HTMLVideoElement || document.querySelector("video") as HTMLVideoElement;
const getCurrentVideoId = () => new URLSearchParams(window.location.search).get("v") ?? null;

const injectCaptionsScript = () => {
  const s = document.createElement("script");
  s.setAttribute("src", chrome.runtime.getURL("src/public/pageWorld.sec.js"));
  s.onload = () => { s.remove(); };
  (document.head || document.documentElement).appendChild(s);
};

try {
  if (chrome.runtime?.id) {
    chrome.runtime.sendMessage({ type: "spl-get-tab-id" }, (res: any) => {
      if (res && typeof res.tabId === "number") currentTabId = res.tabId;
    });
  }
} catch {}

const stopLoopTimer = () => {
  if (loopCheckTimer !== null) {
    clearInterval(loopCheckTimer);
    loopCheckTimer = null;
  }
};

const ensureLoopTimer = () => {
  if (loopCheckTimer !== null) return;
  loopCheckTimer = window.setInterval(() => {
    if (!video) return;
    const now = video.currentTime;
    const endGuard = playOnceActive ? Math.max(periodEnd - 0.08, periodStart) : periodEnd;
    if (loopActive && now >= endGuard) {
      if (playOnceActive) {
        const snapTime = Math.max(periodStart, periodEnd - STOP_SNAP);
        video.pause();
        video.currentTime = snapTime;
        loopActive = false;
        playOnceActive = false;
        stopLoopTimer();
      } else if (finiteLoopCount > 1) {
        finiteLoopCount -= 1;
        video.currentTime = periodStart;
      } else if (finiteLoopCount === 1) {
        const snapTime = Math.max(periodStart, periodEnd - STOP_SNAP);
        video.pause();
        video.currentTime = snapTime;
        loopActive = false;
        stopLoopTimer();
      } else {
        video.currentTime = periodStart;
      }
    }
  }, 30);
};

const handleProgress = () => {
  if (!chrome.runtime?.id) {
    if (video) {
      video.ontimeupdate = null;
      video.onplay = null;
      video.onpause = null;
    }
    return;
  }
  if (!video) return;
  const currentSpeed = video.playbackRate;
  let currentTime = video.currentTime;
  // Pause a bit before the declared end to avoid leaking the next word
  const endGuard = playOnceActive ? Math.max(periodEnd - 0.08, periodStart) : periodEnd;
  if (loopActive && currentTime >= endGuard) {
    if (playOnceActive) {
      const snapTime = Math.max(periodStart, periodEnd - STOP_SNAP);
      video.pause();
      video.currentTime = snapTime;
      currentTime = snapTime;
      loopActive = false;
      playOnceActive = false;
      stopLoopTimer();
    } else if (finiteLoopCount > 1) {
      finiteLoopCount -= 1;
      video.currentTime = periodStart;
    } else if (finiteLoopCount === 1) {
      const snapTime = Math.max(periodStart, periodEnd - STOP_SNAP);
      video.pause();
      video.currentTime = snapTime;
      currentTime = snapTime;
      loopActive = false;
      stopLoopTimer();
    } else {
      video.currentTime = periodStart;
    }
  }
  const currentSegmentIndex = captions.findIndex(c => currentTime >= c.startSeconds && currentTime < c.endSeconds);
  const payload: any = {
    type: "spl-state-updated",
    state: { currentTime, isReady: true, speed: currentSpeed, currentSegmentIndex, videoId: new URLSearchParams(window.location.search).get("v"), isPlaying: !video.paused },
    currentLanguage
  };
  if (currentTabId != null) payload.tabId = currentTabId;
  chrome.runtime.sendMessage(payload).catch(() => {});
};


const requestCaptions = () => {
  window.postMessage({ type: "SPL_REQUEST_CAPTIONS" }, "*");
  setTimeout(() => window.postMessage({ type: "SPL_REQUEST_CAPTIONS" }, "*"), 800);
  setTimeout(() => window.postMessage({ type: "SPL_REQUEST_CAPTIONS" }, "*"), 1800);
};

const initVideo = () => {
  video = findVideo();
  if (video) {
    video.ontimeupdate = handleProgress;
    video.onplay = handleProgress;
    video.onpause = handleProgress;
  } else {
    setTimeout(initVideo, 1000);
  }
};

window.addEventListener("message", (event) => {
  if (!chrome.runtime?.id) return;
  if (event.source !== window) return;
  if (event.data && event.data.type === "SPL_CAPTIONS_FOUND") {
    const payload = event.data.payload || {};
    const incomingVideoId = payload.videoId ?? null;
    const currentVideoId = getCurrentVideoId();
    if (incomingVideoId && currentVideoId && incomingVideoId !== currentVideoId) {
      console.log('[SPL] cs: ignore captions for old video', incomingVideoId, 'current', currentVideoId);
      return;
    }
    console.log('[SPL] cs: captions received', payload?.segments?.length ?? 0, payload?.language, 'vid', incomingVideoId);
    captions = payload.segments;
    currentLanguage = payload.language;
    const msg: any = { type: "spl-segments-updated", segments: captions };
    if (currentTabId != null) msg.tabId = currentTabId;
    msg.videoId = incomingVideoId ?? currentVideoId;
    console.log('[SPL] cs: forwarding segments to sidepanel', captions.length);
    chrome.runtime.sendMessage(msg).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg: any, sender: any, sendResponse: any) => {
  if (!video) video = findVideo();
  if (currentTabId == null && sender && sender.tab && typeof sender.tab.id === "number") currentTabId = sender.tab.id;
  switch (msg.type) {
    case "spl-play":
      if (msg.fromTime !== undefined && video) video.currentTime = msg.fromTime;
      loopActive = false;
      playOnceActive = false;
      stopLoopTimer();
      finiteLoopCount = 1;
      video?.play();
      break;
    case "spl-pause":
      if (video) {
        video.pause();
      }
      loopActive = false;
      playOnceActive = false;
      stopLoopTimer();
      finiteLoopCount = 1;
      break;
    case "spl-set-speed":
      if (video) video.playbackRate = msg.speed;
      break;
    case "spl-go-to-time":
      if (video) video.currentTime = msg.time;
      break;
    case "spl-play-period":
      if (video && typeof msg.start === "number" && typeof msg.end === "number") {
        periodStart = Math.max(0, msg.start);
        periodEnd = Math.max(periodStart, msg.end);
        const hasRepeat = typeof msg.repeatCount === "number" && msg.repeatCount > 1;
        if (hasRepeat) {
          finiteLoopCount = msg.repeatCount;
          loopActive = true;
          playOnceActive = false;
        } else {
          finiteLoopCount = msg.loop ? 0 : 1;
          loopActive = true;
          playOnceActive = !msg.loop;
        }
        video.currentTime = periodStart;
        video.play();
        ensureLoopTimer();
      }
      break;
    case "spl-play-segment":
      if (video && typeof msg.start === "number" && typeof msg.end === "number") {
        periodStart = Math.max(0, msg.start);
        periodEnd = Math.max(periodStart, msg.end);
        const hasRepeat = typeof msg.repeatCount === "number" && msg.repeatCount > 1;
        if (hasRepeat) {
          finiteLoopCount = msg.repeatCount;
          loopActive = true;
          playOnceActive = false;
        } else {
          finiteLoopCount = 1;
          loopActive = true;
          playOnceActive = true;
        }
        video.currentTime = periodStart;
        video.play();
        ensureLoopTimer();
      }
      break;
    case "spl-get-initial-state":
      requestCaptions();
      sendResponse({ currentTime: video ? video.currentTime : 0, isReady: !!video, speed: video ? video.playbackRate : 1, segments: captions, videoId: new URLSearchParams(window.location.search).get("v"), currentLanguage });
      break;
  }
});

injectCaptionsScript();
initVideo();

let lastUrl = location.href;
new MutationObserver(() => {
  if (!chrome.runtime?.id) return;
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    captions = [];
    currentLanguage = "en";
    initVideo();
    requestCaptions();
    chrome.runtime.sendMessage({ type: "spl-segments-updated", segments: [], videoId: new URLSearchParams(window.location.search).get("v"), tabId: currentTabId ?? undefined }).catch(() => {});
  }
}).observe(document, { subtree: true, childList: true });
