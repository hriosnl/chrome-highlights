// Page identity for highlights: origin + pathname only (no query or hash).
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    return u.href;
  } catch {
    return url.split("#")[0].split("?")[0];
  }
}

if (typeof globalThis !== "undefined") {
  globalThis.normalizeUrl = normalizeUrl;
}