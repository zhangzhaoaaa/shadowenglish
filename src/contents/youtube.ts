import type { PlasmoCSConfig } from "plasmo";

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

const findVideo = () => document.querySelector("video.html5-main-video") as HTMLVideoElement || document.querySelector("video") as HTMLVideoElement;

const injectCaptionsScript = () => {
  const s = document.createElement("script");
  s.setAttribute("src", chrome.runtime.getURL("src/public/pageWorld.js"));
  s.onload = () => { s.remove(); };
  (document.head || document.documentElement).appendChild(s);
};

try {
  chrome.runtime.sendMessage({ type: "spl-get-tab-id" }, (res) => {
    if (res && typeof res.tabId === "number") currentTabId = res.tabId;
  });
} catch {}

const initVideo = () => {
  video = findVideo();
  if (video) {
    video.ontimeupdate = () => {
      const currentSpeed = video!.playbackRate;
      const currentTime = video!.currentTime;
      if (loopActive && currentTime >= periodEnd) {
        if (playOnceActive) {
          video!.pause();
          loopActive = false;
          playOnceActive = false;
        } else {
          video!.currentTime = periodStart;
        }
      }
      const currentSegmentIndex = captions.findIndex(c => currentTime >= c.startSeconds && currentTime < c.endSeconds);
      const payload: any = {
        type: "spl-state-updated",
        state: { currentTime, isReady: true, speed: currentSpeed, currentSegmentIndex, videoId: new URLSearchParams(window.location.search).get("v") },
        currentLanguage
      };
      if (currentTabId != null) payload.tabId = currentTabId;
      chrome.runtime.sendMessage(payload).catch(() => {});
    };
  } else {
    setTimeout(initVideo, 1000);
  }
};

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data && event.data.type === "SPL_CAPTIONS_FOUND") {
    console.log('[SPL] cs: captions received', event.data.payload?.segments?.length ?? 0, event.data.payload?.language);
    captions = event.data.payload.segments;
    currentLanguage = event.data.payload.language;
    const msg: any = { type: "spl-segments-updated", segments: captions };
    if (currentTabId != null) msg.tabId = currentTabId;
    console.log('[SPL] cs: forwarding segments to sidepanel', captions.length);
    chrome.runtime.sendMessage(msg);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!video) video = findVideo();
  if (currentTabId == null && sender && sender.tab && typeof sender.tab.id === "number") currentTabId = sender.tab.id;
  switch (msg.type) {
    case "spl-play":
      if (msg.fromTime !== undefined && video) video.currentTime = msg.fromTime;
      video?.play();
      break;
    case "spl-pause":
      video?.pause();
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
        loopActive = !!msg.loop;
        playOnceActive = !msg.loop;
        video.currentTime = periodStart;
        video.play();
      }
      break;
    case "spl-play-segment":
      if (video && typeof msg.start === "number" && typeof msg.end === "number") {
        periodStart = Math.max(0, msg.start);
        periodEnd = Math.max(periodStart, msg.end);
        loopActive = true;
        playOnceActive = true;
        video.currentTime = periodStart;
        video.play();
      }
      break;
    case "spl-get-initial-state":
      window.postMessage({ type: "SPL_REQUEST_CAPTIONS" }, "*");
      sendResponse({ currentTime: video ? video.currentTime : 0, isReady: !!video, speed: video ? video.playbackRate : 1, segments: captions, videoId: new URLSearchParams(window.location.search).get("v"), currentLanguage });
      break;
  }
});

injectCaptionsScript();
initVideo();

let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    initVideo();
  }
}).observe(document, { subtree: true, childList: true });
