const LEGACY_COLOR_MAP = {
  "rgb(255, 246, 21)": 0,
  inherit: 0,
  "rgb(68, 255, 147)": 1,
  "rgb(255, 31, 31)": 2,
  "rgb(66, 229, 255)": 3,
  "rgb(52, 73, 94)": 4,
};

function legacyColorToIndex(color) {
  return LEGACY_COLOR_MAP[color] ?? 0;
}

function assignOccurrenceIndices(list) {
  const counts = {};
  const sorted = [...list].sort((a, b) => a.createdAt - b.createdAt);
  for (const h of sorted) {
    const key = h.text;
    h.anchor.occurrenceIndex = counts[key] || 0;
    counts[key] = (counts[key] || 0) + 1;
  }
}

function convertImportData(raw) {
  if (raw.highlights_by_url) {
    return raw.highlights_by_url;
  }

  if (Array.isArray(raw)) {
    const byUrl = {};
    for (const item of raw) {
      if (!item.url) continue;
      const url = normalizeUrl(item.url);
      const { url: _url, ...highlight } = item;
      if (!byUrl[url]) byUrl[url] = [];
      byUrl[url].push(highlight);
    }
    return byUrl;
  }

  if (raw.highlights && typeof raw.highlights === "object") {
    const byUrl = {};
    for (const items of Object.values(raw.highlights)) {
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const url = normalizeUrl(item.href || item.url);
        if (!url || !item.string) continue;
        if (!byUrl[url]) byUrl[url] = [];
        byUrl[url].push({
          id: item.uuid || item.id || crypto.randomUUID(),
          text: item.string,
          colorIndex: legacyColorToIndex(item.color),
          note: item.note || "",
          anchor: { occurrenceIndex: 0, prefix: "", suffix: "" },
          createdAt: item.createdAt || Date.now(),
        });
      }
    }
    for (const list of Object.values(byUrl)) {
      assignOccurrenceIndices(list);
    }
    return byUrl;
  }

  throw new Error("Unrecognized import format");
}

if (typeof globalThis !== "undefined") {
  globalThis.convertImportData = convertImportData;
}