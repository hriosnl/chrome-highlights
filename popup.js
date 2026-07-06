const activeSwatch = document.getElementById("active-swatch");
const swatchRow = document.getElementById("swatch-row");
const copyAllBtn = document.getElementById("copy-all");
const highlightList = document.getElementById("highlight-list");
const emptyState = document.getElementById("empty-state");
const libraryLink = document.getElementById("library-link");
const migrationBanner = document.getElementById("migration-banner");
const migrationText = document.getElementById("migration-text");
const migrateBtn = document.getElementById("migrate-btn");

let currentColorIndex = 0;
let currentTab = null;
let outdatedHighlightIds = new Set();

function sendMessage(msg) {
  return new Promise((resolve) => {
    try {
      if (!chrome?.runtime?.id) {
        resolve({});
        return;
      }
      chrome.runtime.sendMessage(msg, (res) => {
        void chrome.runtime.lastError;
        resolve(res || {});
      });
    } catch {
      resolve({});
    }
  });
}

function sendTabMessage(msg) {
  return new Promise((resolve) => {
    if (!currentTab?.id) {
      resolve({});
      return;
    }
    chrome.tabs.sendMessage(currentTab.id, msg, (res) => {
      void chrome.runtime.lastError;
      resolve(res || {});
    });
  });
}

function hideMigrationBanner() {
  migrationBanner.hidden = true;
}

function showMigrationBanner(count) {
  migrationText.textContent =
    `${count} highlight${count === 1 ? "" : "s"} on this page use an older format. ` +
    "Update for better wrapping and scroll-to-highlight.";
  migrateBtn.hidden = false;
  migrateBtn.disabled = false;
  migrateBtn.textContent = "Update all";
  migrationBanner.hidden = false;
}

async function fetchMigrationStatus() {
  if (!currentTab?.id) {
    outdatedHighlightIds = new Set();
    return { ok: false, outdated: 0, outdatedIds: [] };
  }
  const status = await sendTabMessage({ type: "GET_MIGRATION_STATUS" });
  outdatedHighlightIds = new Set(status.outdatedIds || []);
  return status;
}

async function refreshMigrationBanner() {
  const status = await fetchMigrationStatus();
  if (!status.ok || !status.outdated) {
    hideMigrationBanner();
    return;
  }
  showMigrationBanner(status.outdated);
}

function createColorDot(colorIndex) {
  const idx = colorIndex ?? 0;
  const dot = document.createElement("span");
  dot.className = "color-dot";
  dot.setAttribute("aria-hidden", "true");
  const pair = getColorPair(idx, false);
  dot.style.backgroundColor = pair.bg;
  dot.title = HIGHLIGHT_COLORS[idx]?.name || "";
  return dot;
}

function renderSwatches(colorIndex) {
  currentColorIndex = colorIndex;
  const pair = getColorPair(colorIndex, false);
  activeSwatch.style.backgroundColor = pair.bg;
  activeSwatch.style.color = pair.text;

  swatchRow.innerHTML = "";
  HIGHLIGHT_COLORS.forEach((c, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `swatch${i === colorIndex ? " selected" : ""}`;
    btn.title = c.name;
    const p = getColorPair(i, false);
    btn.style.backgroundColor = p.bg;
    btn.addEventListener("click", async () => {
      await sendMessage({
        type: "SAVE_SETTINGS",
        settings: { defaultColorIndex: i },
      });
      renderSwatches(i);
    });
    swatchRow.appendChild(btn);
  });
}

function renderList(highlights) {
  highlightList.innerHTML = "";

  if (!highlights.length) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  for (const h of highlights) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `highlight-item${outdatedHighlightIds.has(h.id) ? " highlight-item-outdated" : ""}`;
    btn.dataset.id = h.id;

    const content = document.createElement("div");
    content.className = "highlight-item-content";

    const textEl = document.createElement("div");
    textEl.className = "highlight-text";
    textEl.textContent = h.text;
    content.appendChild(textEl);

    if (h.note) {
      const noteEl = document.createElement("div");
      noteEl.className = "highlight-note";
      noteEl.textContent = h.note;
      content.appendChild(noteEl);
    }

    btn.appendChild(createColorDot(h.colorIndex));
    btn.appendChild(content);

    btn.addEventListener("click", async () => {
      if (!currentTab?.id) return;
      chrome.tabs.sendMessage(currentTab.id, { type: "SCROLL_TO", id: h.id }, () => {
        void chrome.runtime.lastError;
        window.close();
      });
    });

    li.appendChild(btn);
    highlightList.appendChild(li);
  }
}

copyAllBtn.addEventListener("click", async () => {
  const res = await sendMessage({
    type: "GET_PAGE_HIGHLIGHTS",
    url: currentTab?.url,
  });
  const highlights = res.highlights || [];
  if (!highlights.length) return;

  const text = highlights
    .map((h) => {
      if (h.note) return `${h.text}\n  → ${h.note}`;
      return h.text;
    })
    .join("\n\n");

  await navigator.clipboard.writeText(text);
  const original = copyAllBtn.innerHTML;
  copyAllBtn.textContent = "Copied!";
  setTimeout(() => {
    copyAllBtn.innerHTML = original;
  }, 1200);
});

libraryLink.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
});

migrateBtn.addEventListener("click", async () => {
  migrateBtn.disabled = true;
  migrateBtn.textContent = "Updating…";

  const res = await sendTabMessage({ type: "MIGRATE_PAGE_HIGHLIGHTS" });
  if (!res.ok) {
    migrationText.textContent = "Couldn't update highlights. Try reloading the page.";
    migrateBtn.textContent = "Update all";
    migrateBtn.disabled = false;
    return;
  }

  const pageRes = await sendMessage({
    type: "GET_PAGE_HIGHLIGHTS",
    url: currentTab?.url,
  });
  renderList(pageRes.highlights || []);
  await refreshMigrationBanner();

  if (res.failed > 0) {
    migrationText.textContent =
      `Updated ${res.updated}. ${res.failed} not found — scroll the page and try again.`;
    migrateBtn.textContent = "Retry";
    migrateBtn.disabled = false;
    return;
  }

  migrationText.textContent =
    `Updated ${res.updated} highlight${res.updated === 1 ? "" : "s"}.`;
  migrateBtn.hidden = true;
  setTimeout(hideMigrationBanner, 2200);
});

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  if (!tab?.url || tab.url.startsWith("chrome")) {
    emptyState.hidden = false;
    emptyState.textContent = "Highlights aren't available on this page.";
    return;
  }

  const settingsRes = await sendMessage({ type: "GET_SETTINGS" });
  renderSwatches(settingsRes.settings?.defaultColorIndex ?? 0);

  await refreshMigrationBanner();

  const res = await sendMessage({
    type: "GET_PAGE_HIGHLIGHTS",
    url: tab.url,
  });
  renderList(res.highlights || []);
}

init();