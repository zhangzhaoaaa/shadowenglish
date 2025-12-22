declare const chrome: any;

const SIDE_PANEL_PATH = "sidepanel.html";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.sidePanel.setOptions({ enabled: false });
});

const isAllowedUrl = (url: string) => {
  if (!url) return false;
  if (url.startsWith("file://")) return false; // Explicitly disallow file URLs
  try {
    const u = new URL(url);
    const origin = u.origin;
    return origin.endsWith("youtube.com") || origin === "https://www.youtube.com" || origin === "https://youtu.be";
  } catch {
    return false;
  }
};

const syncSidePanelForTab = async (tabId: number, url?: string) => {
  let targetUrl = url;
  if (!targetUrl) {
    try {
      const t = await chrome.tabs.get(tabId);
      targetUrl = t?.url;
    } catch (e) {
      // console.debug('Failed to get tab info:', e);
      targetUrl = undefined;
    }
  }

  const allowed = !!targetUrl && isAllowedUrl(targetUrl);
  console.log(`[SidePanel] Tab ${tabId} (${targetUrl}) allowed: ${allowed}`);
  
  try {
    if (allowed) {
      await chrome.sidePanel.setOptions({ tabId, path: SIDE_PANEL_PATH, enabled: true });
    } else {
      await chrome.sidePanel.setOptions({ tabId, enabled: false });
    }
  } catch (e) {
    console.error(`[SidePanel] Failed to set options for tab ${tabId}:`, e);
  }
};

chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: { status?: string; url?: string }, tab: { url?: string }) => {
  if (changeInfo.status === "loading" || changeInfo.status === "complete" || changeInfo.url) {
    syncSidePanelForTab(tabId, changeInfo.url ?? tab?.url);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }: { tabId: number }) => {
  syncSidePanelForTab(tabId);
  // Retry once to handle potential race conditions or loading states
  setTimeout(() => syncSidePanelForTab(tabId), 200);
});

chrome.tabs.onReplaced.addListener((addedTabId: number) => {
  syncSidePanelForTab(addedTabId);
});

chrome.tabs.onCreated.addListener((tab: { id?: number; url?: string }) => {
  if (typeof tab.id === "number") syncSidePanelForTab(tab.id, tab.url);
});

chrome.windows.onFocusChanged.addListener(() => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs: Array<{ id?: number; url?: string }>) => {
    const t = tabs[0];
    if (t && typeof t.id === "number") syncSidePanelForTab(t.id, t.url);
  });
});

chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
  if (message?.type === "spl-get-tab-id") {
    sendResponse({ tabId: sender.tab?.id ?? null });
    return;
  }
  if (typeof message?.type === "string" && message.type.startsWith("spl-")) {
    const targetTabId = message.tabId;
    const forward = (tid: number) => {
      chrome.tabs.sendMessage(tid, message, (resp: any) => {
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
      chrome.tabs.query({ active: true, url: "*://*.youtube.com/*" }, (tabs: Array<{ id?: number }>) => {
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
