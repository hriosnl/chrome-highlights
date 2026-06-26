const STORAGE_KEY = "highlights_by_url";
const SETTINGS_KEY = "highlights_settings";

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

  for (const list of Object.values(merged)) {
    list.sort((a, b) => b.createdAt - a.createdAt);
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
  return all[normalizeUrl(url)] || [];
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
  list.sort((a, b) => b.createdAt - a.createdAt);
  all[key] = list;
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

    existing.sort((a, b) => b.createdAt - a.createdAt);
    all[key] = existing;
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: all });
  return { added, skipped };
}

async function getFlatHighlights() {
  const all = await getAllHighlights();
  const flat = [];
  for (const [url, highlights] of Object.entries(all)) {
    for (const h of highlights) {
      flat.push({ ...h, url });
    }
  }
  flat.sort((a, b) => b.createdAt - a.createdAt);
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
}