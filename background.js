importScripts("shared/url.js", "shared/colors.js", "shared/storage.js", "shared/import.js");

const MENU_ID = "highlights-add";
const PENDING_SCROLL_KEY = "pending_scroll";

function safeTabMessage(tabId, msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
      } else {
        resolve(response);
      }
    });
  });
}

async function setPendingScroll(url, id) {
  await chrome.storage.session.set({
    [PENDING_SCROLL_KEY]: { url: normalizeUrl(url), id },
  });
}

async function findTabForUrl(url) {
  const target = normalizeUrl(url);
  const tabs = await chrome.tabs.query({});
  return tabs.find((t) => t.url && normalizeUrl(t.url) === target) || null;
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

async function scrollInTab(tabId, highlightId) {
  for (let i = 0; i < 25; i++) {
    const res = await safeTabMessage(tabId, {
      type: "SCROLL_TO",
      id: highlightId,
    });
    if (res?.scrolled) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function navigateToHighlight(url, highlightId) {
  await setPendingScroll(url, highlightId);

  const existing = await findTabForUrl(url);

  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    const tab = await chrome.tabs.get(existing.id);
    if (tab.status !== "complete") {
      await waitForTabComplete(existing.id);
    }
    await scrollInTab(existing.id, highlightId);
    return { ok: true };
  }

  const tab = await chrome.tabs.create({ url, active: true });
  await waitForTabComplete(tab.id);
  await new Promise((r) => setTimeout(r, 300));
  await scrollInTab(tab.id, highlightId);
  return { ok: true };
}

chrome.runtime.onInstalled.addListener(() => {
  migrateUrlKeys();
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Highlight",
    contexts: ["selection"],
  });
});

chrome.runtime.onStartup.addListener(() => {
  migrateUrlKeys();
});

migrateUrlKeys();

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && tab?.id) {
    safeTabMessage(tab.id, { type: "HIGHLIGHT_SELECTION" });
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "highlight-selection" && tab?.id) {
    safeTabMessage(tab.id, { type: "HIGHLIGHT_SELECTION" });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));
  return true;
});

async function handleMessage(msg, sender) {
  const tabUrl = sender.tab?.url || msg.url;

  switch (msg.type) {
    case "GET_PAGE_HIGHLIGHTS": {
      const url = msg.url || tabUrl;
      return { highlights: await getPageHighlights(url) };
    }
    case "SAVE_HIGHLIGHT": {
      const highlight = await upsertHighlight(tabUrl, msg.highlight);
      return { highlight };
    }
    case "UPDATE_HIGHLIGHT": {
      const highlight = await upsertHighlight(msg.url || tabUrl, msg.highlight);
      return { highlight };
    }
    case "DELETE_HIGHLIGHT": {
      await deleteHighlight(msg.url || tabUrl, msg.id);
      return { ok: true };
    }
    case "GET_ALL_FLAT": {
      return { highlights: await getFlatHighlights() };
    }
    case "GET_SETTINGS": {
      return { settings: await getSettings() };
    }
    case "SAVE_SETTINGS": {
      const settings = await saveSettings(msg.settings);
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id) {
          safeTabMessage(tab.id, { type: "SETTINGS_UPDATED", settings });
        }
      }
      return { settings };
    }
    case "DELETE_FROM_LIBRARY": {
      await deleteHighlight(msg.url, msg.id);
      return { ok: true };
    }
    case "IMPORT_HIGHLIGHTS": {
      const imported = convertImportData(msg.data);
      const result = await mergeImportedHighlights(imported);
      return { ok: true, ...result };
    }
    case "SCROLL_TO_HIGHLIGHT": {
      return navigateToHighlight(msg.url, msg.id);
    }
    case "FOCUS_HIGHLIGHT": {
      if (sender.tab?.id) {
        await safeTabMessage(sender.tab.id, {
          type: "SCROLL_TO",
          id: msg.id,
        });
      }
      return { ok: true };
    }
    default:
      return { error: "Unknown message type" };
  }
}