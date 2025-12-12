const SIDE_PANEL_PATH = "sidepanel.html";

chrome.runtime.onInstalled.addListener(async () => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.sidePanel.setOptions({ enabled: false }); // Disable side panel globally by default

  // Inject content script into existing YouTube tabs
  const manifest = chrome.runtime.getManifest();
  const contentScripts = manifest.content_scripts;

  if (contentScripts) {
    for (const cs of contentScripts) {
      // Find tabs that match the content script patterns
      const tabs = await chrome.tabs.query({ url: cs.matches });
      for (const tab of tabs) {
        if (tab.id && cs.js && cs.js.length > 0) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: cs.js,
            });
            console.log(`[Background] Injected content scripts into tab ${tab.id}`);
          } catch (err) {
            console.error(`[Background] Failed to inject content scripts into tab ${tab.id}:`, err);
          }
        }
      }
    }
  }
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
      try {
        // Only attempt to open if we think it might work (e.g. user interaction context), 
        // but we can't easily know that here. 
        // We rely on the user clicking the action button mostly, 
        // but this helps if the panel was already open or in some contexts.
        await chrome.sidePanel.open({ tabId });
      } catch (e) {
        // Expected error when not triggered by user gesture
        // console.debug('Failed to open side panel:', e);
      }
    } else {
      await chrome.sidePanel.setOptions({ tabId, enabled: false });
    }
  } catch (e) {
    console.error(`[SidePanel] Failed to set options for tab ${tabId}:`, e);
  }
};

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" || changeInfo.status === "complete" || changeInfo.url) {
    syncSidePanelForTab(tabId, changeInfo.url ?? tab?.url);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  syncSidePanelForTab(tabId);
  // Retry once to handle potential race conditions or loading states
  setTimeout(() => syncSidePanelForTab(tabId), 200);
});

chrome.tabs.onReplaced.addListener((addedTabId) => {
  syncSidePanelForTab(addedTabId);
});

chrome.tabs.onCreated.addListener((tab) => {
  if (typeof tab.id === "number") syncSidePanelForTab(tab.id, tab.url);
});

chrome.windows.onFocusChanged.addListener(() => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const t = tabs[0];
    if (t && typeof t.id === "number") syncSidePanelForTab(t.id, t.url);
  });
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
