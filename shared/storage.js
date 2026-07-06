const STORAGE_KEY = "highlights_by_url";
const SETTINGS_KEY = "highlights_settings";

function compareHighlightsByPosition(a, b) {
  const ratioA = a.anchor?.scrollRatio;
  const ratioB = b.anchor?.scrollRatio;
  const hasRatioA = typeof ratioA === "number" && !Number.isNaN(ratioA);
  const hasRatioB = typeof ratioB === "number" && !Number.isNaN(ratioB);

  if (hasRatioA && hasRatioB && ratioA !== ratioB) {
    return ratioA - ratioB;
  }
  if (hasRatioA !== hasRatioB) return hasRatioA ? -1 : 1;

  const occA = a.anchor?.occurrenceIndex ?? 0;
  const occB = b.anchor?.occurrenceIndex ?? 0;
  if (occA !== occB) return occA - occB;

  return (a.createdAt ?? 0) - (b.createdAt ?? 0);
}

function sortHighlightsByPosition(highlights) {
  return [...highlights].sort(compareHighlightsByPosition);
}

async function migrateUrlKeys() {
  const all = await getAllHighlights();
  const merged = {};
  let changed = false;

  for (const [key, highlights] of Object.entries(all)) {
    const normalized = normalizeUrl(key);
    if (normalized !== key) changed = true;
    if (!merged[normalized]) merged[normalized] = [];
    const ids = new Set(merged[normalized].map((h) => h.id));
    for (const h of highlights) {
      if (!ids.has(h.id)) {
        merged[normalized].push(h);
        ids.add(h.id);
      } else {
        changed = true;
      }
    }
  }

  if (!changed) return all;

  for (const [key, list] of Object.entries(merged)) {
    merged[key] = sortHighlightsByPosition(list);
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: merged });
  return merged;
}

async function getAllHighlights() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || {};
}

async function getPageHighlights(url) {
  const all = await getAllHighlights();
  return sortHighlightsByPosition(all[normalizeUrl(url)] || []);
}

async function savePageHighlights(url, highlights) {
  const key = normalizeUrl(url);
  const all = await getAllHighlights();
  if (highlights.length === 0) {
    delete all[key];
  } else {
    all[key] = highlights;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: all });
  return all;
}

async function upsertHighlight(url, highlight) {
  const key = normalizeUrl(url);
  const all = await getAllHighlights();
  const list = all[key] || [];
  const idx = list.findIndex((h) => h.id === highlight.id);
  if (idx >= 0) {
    list[idx] = highlight;
  } else {
    list.push(highlight);
  }
  all[key] = sortHighlightsByPosition(list);
  await chrome.storage.local.set({ [STORAGE_KEY]: all });
  return highlight;
}

async function deleteHighlight(url, id) {
  const key = normalizeUrl(url);
  const all = await getAllHighlights();
  const list = (all[key] || []).filter((h) => h.id !== id);
  return savePageHighlights(key, list);
}

async function getSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return data[SETTINGS_KEY] || { defaultColorIndex: 0 };
}

async function saveSettings(settings) {
  const current = await getSettings();
  const merged = { ...current, ...settings };
  await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
  return merged;
}

async function mergeImportedHighlights(importedByUrl) {
  const all = await getAllHighlights();
  let added = 0;
  let skipped = 0;

  for (const [url, incoming] of Object.entries(importedByUrl)) {
    const key = normalizeUrl(url);
    const existing = all[key] || [];
    const ids = new Set(existing.map((h) => h.id));

    for (const h of incoming) {
      if (ids.has(h.id)) {
        skipped++;
        continue;
      }
      existing.push(h);
      ids.add(h.id);
      added++;
    }

    all[key] = sortHighlightsByPosition(existing);
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: all });
  return { added, skipped };
}

async function getFlatHighlights() {
  const all = await getAllHighlights();
  const pages = [];

  for (const [url, highlights] of Object.entries(all)) {
    const sorted = sortHighlightsByPosition(highlights);
    const pageNewest = sorted.reduce(
      (max, h) => Math.max(max, h.createdAt ?? 0),
      0,
    );
    pages.push({ url, pageNewest, highlights: sorted });
  }

  pages.sort((a, b) => b.pageNewest - a.pageNewest);

  const flat = [];
  for (const { url, highlights } of pages) {
    for (const h of highlights) {
      flat.push({ ...h, url });
    }
  }
  return flat;
}

if (typeof globalThis !== "undefined") {
  globalThis.migrateUrlKeys = migrateUrlKeys;
  globalThis.getAllHighlights = getAllHighlights;
  globalThis.getPageHighlights = getPageHighlights;
  globalThis.savePageHighlights = savePageHighlights;
  globalThis.upsertHighlight = upsertHighlight;
  globalThis.deleteHighlight = deleteHighlight;
  globalThis.getSettings = getSettings;
  globalThis.saveSettings = saveSettings;
  globalThis.getFlatHighlights = getFlatHighlights;
  globalThis.mergeImportedHighlights = mergeImportedHighlights;
  globalThis.sortHighlightsByPosition = sortHighlightsByPosition;
}