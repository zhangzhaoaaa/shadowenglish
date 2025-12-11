const SIDE_PANEL_PATH = "sidepanel.html";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const url = tab?.url;
  if (!url) return;
  const origin = new URL(url).origin;
  const allowed = origin === "https://www.youtube.com" || origin.startsWith("chrome-extension://");
  await chrome.sidePanel.setOptions({ tabId, path: SIDE_PANEL_PATH, enabled: allowed });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "spl-get-tab-id") {
    sendResponse({ tabId: sender.tab?.id ?? null });
    return;
  }
  if (message?.type === "spl-open-side-panel") {
    chrome.sidePanel.open({ tabId: sender.tab?.id ?? 0 });
    return;
  }
  if (message?.type === "spl-close-side-panel") {
    const tabId = sender.tab?.id ?? 0;
    (async () => {
      await chrome.sidePanel.setOptions({ tabId, enabled: false });
      await chrome.sidePanel.setOptions({ tabId, path: SIDE_PANEL_PATH, enabled: true });
    })();
    return;
  }
  if (typeof message?.type === "string" && message.type.startsWith("spl-")) {
    const targetTabId = message.tabId;
    const forward = (tid: number) => {
      chrome.tabs.sendMessage(tid, message, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) {
          sendResponse(null);
        } else {
          sendResponse(resp);
        }
      });
    };
    if (typeof targetTabId === "number") {
      forward(targetTabId);
    } else {
      chrome.tabs.query({ active: true, url: "*://*.youtube.com/*" }, (tabs) => {
        if (tabs.length > 0 && typeof tabs[0].id === "number") {
          forward(tabs[0].id);
        } else {
          sendResponse(null);
        }
      });
    }
    return true;
  }
});
