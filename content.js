const HL_CLASS = "hl-mark";
const TOOLTIP_ID = "hl-tooltip-root";
const SETTINGS_KEY = "highlights_settings";
const PENDING_SCROLL_KEY = "pending_scroll";
const CURRENT_ANCHOR_VERSION = 2;

let tooltipEl = null;
let activeMark = null;
let activeHlId = null;
let lastPointer = { x: 0, y: 0 };
let defaultColorIndex = 0;
let pageTheme = "light";
let restorePending = false;
let hideTooltipTimer = null;

function uuid() {
  return crypto.randomUUID();
}

function isContextValid() {
  try {
    return Boolean(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

function sendMessage(msg) {
  return new Promise((resolve) => {
    if (!isContextValid()) {
      resolve({});
      return;
    }
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) {
          resolve({});
          return;
        }
        resolve(res || {});
      });
    } catch {
      resolve({});
    }
  });
}

// --- Theme ---

function parseRgb(color) {
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3] };
}

function luminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function detectPageTheme() {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const root = document.documentElement;
  const body = document.body;
  const bg =
    getComputedStyle(body).backgroundColor !== "rgba(0, 0, 0, 0)"
      ? getComputedStyle(body).backgroundColor
      : getComputedStyle(root).backgroundColor;
  const rgb = parseRgb(bg);
  if (rgb) {
    const lum = luminance(rgb.r, rgb.g, rgb.b);
    if (lum < 0.35) return "dark";
    if (lum > 0.65) return "light";
  }
  return prefersDark ? "dark" : "light";
}

function applyMarkStyle(mark, colorIndex) {
  const isDark = pageTheme === "dark";
  const pair = getColorPair(colorIndex, isDark);
  mark.style.backgroundColor = pair.bg;
  mark.style.color = pair.text;
  mark.dataset.hlColor = String(colorIndex);
  if (mark.classList.contains("hl-has-note")) {
    mark.style.setProperty("--hl-badge", pair.text);
  }
}

function applyNoteBadge(mark, note) {
  const val = (note || "").trim();
  const has = val.length > 0;
  mark.classList.toggle("hl-has-note", has);
  mark.dataset.hlNote = val;
  if (has) {
    const idx = parseInt(mark.dataset.hlColor || "0", 10);
    const pair = getColorPair(idx, pageTheme === "dark");
    mark.style.setProperty("--hl-badge", pair.text);
  }
}

function syncNotePreview(previewEl, note, editorOpen) {
  if (!previewEl) return;
  const val = (note || "").trim();
  if (!val || editorOpen) {
    previewEl.classList.remove("hl-visible");
    previewEl.textContent = "";
    return;
  }
  previewEl.textContent = val;
  previewEl.classList.add("hl-visible");
}

function refreshAllMarkStyles() {
  pageTheme = detectPageTheme();
  document.querySelectorAll(`.${HL_CLASS}`).forEach((mark) => {
    const idx = parseInt(mark.dataset.hlColor || "0", 10);
    applyMarkStyle(mark, idx);
    if (mark.classList.contains("hl-has-note")) {
      const pair = getColorPair(idx, pageTheme === "dark");
      mark.style.setProperty("--hl-badge", pair.text);
    }
  });
  if (tooltipEl && activeHlId) {
    tooltipEl.classList.toggle("hl-theme-dark", pageTheme === "dark");
    tooltipEl.classList.toggle("hl-theme-light", pageTheme === "light");
    positionTooltip(activeHlId, lastPointer);
  }
}

// --- Text nodes ---

function getTextNodes(root = document.body) {
  const nodes = [];
  if (!root) return nodes;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      if (
        p.closest(
          `.${HL_CLASS}, #${TOOLTIP_ID}, script, style, noscript, textarea, input`,
        )
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  return nodes;
}

function getContextAround(text, index, len = 40) {
  const prefix = text.slice(Math.max(0, index - len), index);
  const suffix = text.slice(index, index + len);
  return { prefix, suffix };
}

function getOccurrenceIndexFromRange(range, searchText) {
  const pre = range.cloneRange();
  pre.selectNodeContents(document.body);
  pre.setEnd(range.startContainer, range.startOffset);
  const textBefore = pre.toString();
  let count = 0;
  let idx = 0;
  while ((idx = textBefore.indexOf(searchText, idx)) !== -1) {
    count++;
    idx += searchText.length || 1;
  }
  return count;
}

function buildTextSegments(nodes) {
  const segments = [];
  let offset = 0;
  for (const node of nodes) {
    const text = node.textContent;
    segments.push({ node, start: offset, end: offset + text.length });
    offset += text.length;
  }
  return { segments, fullText: nodes.map((n) => n.textContent).join("") };
}

function offsetToRange(globalStart, globalEnd, segments) {
  const range = document.createRange();
  let startSet = false;

  for (const seg of segments) {
    if (!startSet && globalStart < seg.end) {
      range.setStart(seg.node, globalStart - seg.start);
      startSet = true;
    }
    if (startSet && globalEnd <= seg.end) {
      range.setEnd(seg.node, globalEnd - seg.start);
      return range;
    }
  }
  return null;
}

function findTextOccurrenceRange(searchText, occurrenceIndex, prefixHint) {
  const nodes = getTextNodes();
  const { segments, fullText } = buildTextSegments(nodes);
  let occurrence = 0;
  let searchStart = 0;

  while (true) {
    const idx = fullText.indexOf(searchText, searchStart);
    if (idx === -1) break;

    if (prefixHint) {
      const ctx = getContextAround(fullText, idx);
      const savedTail = prefixHint.slice(-24);
      const foundTail = ctx.prefix.slice(-24);
      if (savedTail && foundTail && savedTail !== foundTail) {
        searchStart = idx + 1;
        continue;
      }
    }

    if (occurrence === occurrenceIndex) {
      return offsetToRange(idx, idx + searchText.length, segments);
    }
    occurrence++;
    searchStart = idx + 1;
  }
  return null;
}

function getMarksById(id) {
  return [...document.querySelectorAll(`.${HL_CLASS}[data-hl-id="${id}"]`)];
}

function getPrimaryMark(id) {
  return getMarksById(id)[0] || null;
}

function wrapTextNodeRange(node, start, end, id, colorIndex) {
  const text = node.textContent;
  const before = text.slice(0, start);
  const middle = text.slice(start, end);
  const after = text.slice(end);
  const mark = document.createElement("mark");
  mark.className = HL_CLASS;
  mark.dataset.hlId = id;
  mark.textContent = middle;
  applyMarkStyle(mark, colorIndex);

  const parent = node.parentNode;
  if (before) parent.insertBefore(document.createTextNode(before), node);
  parent.insertBefore(mark, node);
  if (after) parent.insertBefore(document.createTextNode(after), node);
  parent.removeChild(node);
  return mark;
}

function createMarkElement(id, colorIndex) {
  const mark = document.createElement("mark");
  mark.className = HL_CLASS;
  mark.dataset.hlId = id;
  applyMarkStyle(mark, colorIndex);
  return mark;
}

function rangeInsideHighlight(range) {
  for (const mark of document.querySelectorAll(`.${HL_CLASS}`)) {
    if (range.intersectsNode(mark)) return true;
  }
  return false;
}

function applyNoteToHighlight(id, note) {
  for (const m of getMarksById(id)) applyNoteBadge(m, note);
}

function applyColorToHighlight(id, colorIndex) {
  const isDark = pageTheme === "dark";
  for (const m of getMarksById(id)) {
    applyMarkStyle(m, colorIndex);
    if (m.classList.contains("hl-has-note")) {
      const pair = getColorPair(colorIndex, isDark);
      m.style.setProperty("--hl-badge", pair.text);
    }
  }
}

function wrapRange(range, id, colorIndex) {
  if (range.collapsed) return null;
  const text = range.toString();
  if (!text.trim()) return null;
  if (rangeInsideHighlight(range)) return null;

  try {
    const mark = createMarkElement(id, colorIndex);
    const contents = range.extractContents();
    mark.appendChild(contents);
    range.insertNode(mark);
    return mark;
  } catch {
    const nodes = getTextNodes(range.commonAncestorContainer);
    const marks = [];
    for (const node of nodes) {
      if (!range.intersectsNode(node)) continue;
      let start = 0;
      let end = node.textContent.length;
      if (node === range.startContainer) start = range.startOffset;
      if (node === range.endContainer) end = range.endOffset;
      if (start < end) {
        marks.push(wrapTextNodeRange(node, start, end, id, colorIndex));
      }
    }
    return marks[0] || null;
  }
}

function unwrapHighlight(id) {
  for (const mark of getMarksById(id)) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  }
}

function getScrollContainerForNode(node) {
  let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  while (el && el !== document.documentElement) {
    const style = getComputedStyle(el);
    const scrollable =
      el.scrollHeight > el.clientHeight + 2 &&
      (style.overflowY === "auto" || style.overflowY === "scroll");
    if (scrollable) return el;
    el = el.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

function getScrollRatioForRange(range) {
  const container = getScrollContainerForNode(range.startContainer);
  const maxScroll = container.scrollHeight - container.clientHeight;
  if (maxScroll <= 0) return 0;
  const rect = range.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const offsetTop = rect.top - containerRect.top + container.scrollTop;
  return Math.max(0, Math.min(1, offsetTop / container.scrollHeight));
}

function buildAnchorForText(text, occurrenceIndex) {
  const nodes = getTextNodes();
  const fullText = nodes.map((n) => n.textContent).join("");
  let pos = 0;
  let occ = 0;
  while ((pos = fullText.indexOf(text, pos)) !== -1) {
    if (occ === occurrenceIndex) break;
    occ++;
    pos += text.length || 1;
  }
  const ctx = getContextAround(fullText, Math.max(0, pos));
  return { occurrenceIndex, prefix: ctx.prefix, suffix: ctx.suffix };
}

function highlightNeedsMigration(h) {
  const version = h.anchorVersion ?? 1;
  const missingScroll = h.anchor?.scrollRatio == null;
  const outdatedStorage = version < CURRENT_ANCHOR_VERSION || missingScroll;
  const splitDom = isSplitInDom(h.id);
  return outdatedStorage || splitDom;
}

function isSplitInDom(id) {
  return getMarksById(id).length > 1;
}

async function getMigrationStatus() {
  const res = await sendMessage({
    type: "GET_PAGE_HIGHLIGHTS",
    url: location.href,
  });
  const highlights = res.highlights || [];
  let outdated = 0;
  let split = 0;
  let missingScroll = 0;

  for (const h of highlights) {
    if (!highlightNeedsMigration(h)) continue;
    outdated++;
    if (isSplitInDom(h.id)) split++;
    if (h.anchor?.scrollRatio == null) missingScroll++;
  }

  return { ok: true, outdated, split, missingScroll, total: highlights.length };
}

async function migrateOneHighlight(h) {
  if (getMarksById(h.id).length) {
    unwrapHighlight(h.id);
  }

  const occurrenceIndex = h.anchor?.occurrenceIndex ?? 0;
  const range = findTextOccurrenceRange(h.text, occurrenceIndex, h.anchor?.prefix);
  if (!range) return { ok: false, reason: "not_found" };

  const scrollRatio = getScrollRatioForRange(range);
  const mark = wrapRange(range, h.id, h.colorIndex);
  if (!mark) return { ok: false, reason: "wrap_failed" };

  applyNoteToHighlight(h.id, h.note || "");

  const anchor = buildAnchorForText(h.text, occurrenceIndex);
  anchor.scrollRatio = scrollRatio;

  const updated = {
    ...h,
    anchorVersion: CURRENT_ANCHOR_VERSION,
    anchor,
  };
  await sendMessage({ type: "UPDATE_HIGHLIGHT", highlight: updated });
  return { ok: true };
}

async function migratePageHighlights() {
  closeTooltip();

  const res = await sendMessage({
    type: "GET_PAGE_HIGHLIGHTS",
    url: location.href,
  });
  const highlights = res.highlights || [];
  let updated = 0;
  let failed = 0;
  let skipped = 0;

  for (const h of highlights) {
    if (!highlightNeedsMigration(h)) {
      skipped++;
      continue;
    }
    const result = await migrateOneHighlight(h);
    if (result.ok) updated++;
    else failed++;
  }

  return { ok: true, updated, failed, skipped, total: highlights.length };
}

// --- Highlight CRUD ---

async function loadSettings() {
  const res = await sendMessage({ type: "GET_SETTINGS" });
  defaultColorIndex = res.settings?.defaultColorIndex ?? 0;
}

async function highlightSelection() {
  await loadSettings();

  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;

  const range = sel.getRangeAt(0).cloneRange();
  const text = range.toString().trim();
  if (!text) return;

  const id = uuid();
  const colorIndex = defaultColorIndex;
  const occurrenceIndex = getOccurrenceIndexFromRange(range, text);
  const scrollRatio = getScrollRatioForRange(range);
  const mark = wrapRange(range, id, colorIndex);
  if (!mark) return;

  sel.removeAllRanges();
  const fullText = getTextNodes()
    .map((n) => n.textContent)
    .join("");
  let pos = 0;
  let occ = 0;
  while ((pos = fullText.indexOf(text, pos)) !== -1) {
    if (occ === occurrenceIndex) break;
    occ++;
    pos += text.length || 1;
  }
  const ctx = getContextAround(fullText, Math.max(0, pos));

  const highlight = {
    id,
    text,
    colorIndex,
    note: "",
    anchorVersion: CURRENT_ANCHOR_VERSION,
    anchor: { occurrenceIndex, prefix: ctx.prefix, suffix: ctx.suffix, scrollRatio },
    createdAt: Date.now(),
  };

  await sendMessage({ type: "SAVE_HIGHLIGHT", highlight });
}

async function restoreHighlights() {
  if (restorePending) return;
  restorePending = true;
  pageTheme = detectPageTheme();

  const res = await sendMessage({
    type: "GET_PAGE_HIGHLIGHTS",
    url: location.href,
  });
  const highlights = res.highlights || [];

  for (const h of highlights) {
    const existing = document.querySelector(`[data-hl-id="${h.id}"]`);
    if (existing) {
      applyNoteToHighlight(h.id, h.note || "");
      continue;
    }

    const range = findTextOccurrenceRange(
      h.text,
      h.anchor?.occurrenceIndex ?? 0,
      h.anchor?.prefix,
    );
    if (!range) continue;

    const mark = wrapRange(range, h.id, h.colorIndex);
    if (!mark) continue;
    applyNoteToHighlight(h.id, h.note || "");
  }

  restorePending = false;
}

let restoreTimer = null;
function scheduleRestore() {
  clearTimeout(restoreTimer);
  restoreTimer = setTimeout(restoreHighlights, 600);
}

async function updateHighlightData(id, patch) {
  const res = await sendMessage({
    type: "GET_PAGE_HIGHLIGHTS",
    url: location.href,
  });
  const list = res.highlights || [];
  const item = list.find((h) => h.id === id);
  if (!item) return;
  const updated = { ...item, ...patch };
  await sendMessage({ type: "UPDATE_HIGHLIGHT", highlight: updated });
  return updated;
}

async function deleteHighlightData(id) {
  await sendMessage({ type: "DELETE_HIGHLIGHT", id, url: location.href });
}

function scrollToHighlight(id) {
  const mark = document.querySelector(`[data-hl-id="${id}"]`);
  if (!mark) return false;
  mark.scrollIntoView({ behavior: "smooth", block: "center" });
  mark.classList.add("hl-flash");
  setTimeout(() => mark.classList.remove("hl-flash"), 1600);
  return true;
}

async function scrollToHighlightWithRestore(id) {
  if (scrollToHighlight(id)) return true;

  await restoreHighlights();
  if (scrollToHighlight(id)) return true;

  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 200));
    await restoreHighlights();
    if (scrollToHighlight(id)) return true;
  }
  return false;
}

async function consumePendingScroll() {
  if (!isContextValid()) return;
  let data;
  try {
    data = await chrome.storage.session.get(PENDING_SCROLL_KEY);
  } catch {
    return;
  }
  const pending = data[PENDING_SCROLL_KEY];
  if (!pending || normalizeUrl(location.href) !== pending.url) return;

  try {
    await chrome.storage.session.remove(PENDING_SCROLL_KEY);
  } catch {
    return;
  }
  await scrollToHighlightWithRestore(pending.id);
}

// --- Tooltip ---

const ICONS = {
  copy: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M6.9998 6V3C6.9998 2.44772 7.44752 2 7.9998 2H19.9998C20.5521 2 20.9998 2.44772 20.9998 3V17C20.9998 17.5523 20.5521 18 19.9998 18H16.9998V20.9991C16.9998 21.5519 16.5499 22 15.993 22H4.00666C3.45059 22 3 21.5554 3 20.9991L3.0026 7.00087C3.0027 6.44811 3.45264 6 4.00942 6H6.9998ZM8.9998 6H16.9998V16H18.9998V4H8.9998V6ZM6.9998 11V13H12.9998V11H6.9998ZM6.9998 15V17H12.9998V15H6.9998Z"></path></svg>`,
  note: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M4 1V4H1V6H4V9H6V6H9V4H6V1H4ZM3 20.0066V11H5V19H13V14C13 13.45 13.45 13 14 13L19 12.999V5H11V3H20.0066C20.5552 3 21 3.45576 21 4.00247V15L15 20.996L4.00221 21C3.4487 21 3 20.5551 3 20.0066ZM18.171 14.999L15 15V18.169L18.171 14.999Z"></path></svg>`,
  noteFill: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M4 1V4H1V6H4V9H6V6H9V4H6V1H4ZM11 5C11 8.31371 8.31371 11 5 11C4.29873 11 3.62556 10.8797 3 10.6586V20.0066C3 20.5551 3.44694 21 3.99826 21H14V15C14 14.45 14.45 14 15 14H21V3.9985C21 3.44749 20.5552 3 20.0066 3H10.6586C10.8797 3.62556 11 4.29873 11 5ZM21 16L16 20.997V16H21Z"></path></svg>`,
  palette: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C17.5222 2 22 5.97778 22 10.8889C22 13.9556 19.5111 16.4444 16.4444 16.4444H14.4778C13.5556 16.4444 12.8111 17.1889 12.8111 18.1111C12.8111 18.5333 12.9778 18.9222 13.2333 19.2111C13.5 19.5111 13.6667 19.9 13.6667 20.3333C13.6667 21.2556 12.9 22 12 22C6.47778 22 2 17.5222 2 12C2 6.47778 6.47778 2 12 2ZM7.5 12C8.32843 12 9 11.3284 9 10.5C9 9.67157 8.32843 9 7.5 9C6.67157 9 6 9.67157 6 10.5C6 11.3284 6.67157 12 7.5 12ZM16.5 12C17.3284 12 18 11.3284 18 10.5C18 9.67157 17.3284 9 16.5 9C15.6716 9 15 9.67157 15 10.5C15 11.3284 15.6716 12 16.5 12ZM12 9C12.8284 9 13.5 8.32843 13.5 7.5C13.5 6.67157 12.8284 6 12 6C11.1716 6 10.5 6.67157 10.5 7.5C10.5 8.32843 11.1716 9 12 9Z"></path></svg>`,
  delete: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M17 6H22V8H20V21C20 21.5523 19.5523 22 19 22H5C4.44772 22 4 21.5523 4 21V8H2V6H7V3C7 2.44772 7.44772 2 8 2H16C16.5523 2 17 2.44772 17 3V6ZM9 11V17H11V11H9ZM13 11V17H15V11H13ZM9 4V6H15V4H9Z"></path></svg>`,
};

function cancelHideTooltip() {
  clearTimeout(hideTooltipTimer);
}

function scheduleHideTooltip() {
  cancelHideTooltip();
  hideTooltipTimer = setTimeout(closeTooltip, 140);
}

function closeTooltip() {
  cancelHideTooltip();
  if (tooltipEl) {
    if (activeHlId) {
      const notePanel = tooltipEl.querySelector('[data-panel="note"]');
      if (notePanel?.classList.contains("hl-open")) {
        const textarea = notePanel.querySelector("textarea");
        const id = activeHlId;
        const val = textarea?.value.trim() ?? "";
        const prev = activeMark?.dataset.hlNote || "";
        if (val !== prev) {
          applyNoteToHighlight(id, val);
          updateHighlightData(id, { note: val });
        }
      }
    }
    tooltipEl.remove();
    tooltipEl = null;
  }
  activeMark = null;
  activeHlId = null;
}

function getLineRectsForHighlight(id) {
  const rects = [];
  for (const mark of getMarksById(id)) {
    for (const rect of mark.getClientRects()) {
      if (rect.width > 0 && rect.height > 0) rects.push(rect);
    }
  }
  return rects;
}

function pickLineRect(rects, clientX, clientY) {
  if (!rects.length) return null;

  for (const rect of rects) {
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      return rect;
    }
  }

  let best = rects[0];
  let bestDist = Infinity;
  for (const rect of rects) {
    const midY = (rect.top + rect.bottom) / 2;
    const dist = Math.abs(clientY - midY);
    if (dist < bestDist) {
      bestDist = dist;
      best = rect;
    }
  }
  return best;
}

function positionTooltip(hlId, pointer = lastPointer) {
  if (!tooltipEl) return;
  const rects = getLineRectsForHighlight(hlId);
  const rect =
    pickLineRect(rects, pointer.x, pointer.y) || rects[0] || null;
  if (!rect) return;

  const tip = tooltipEl;
  const tipRect = tip.getBoundingClientRect();
  let top = rect.top + window.scrollY - tipRect.height - 8;
  let left = rect.left + window.scrollX + rect.width / 2 - tipRect.width / 2;

  const below = top < window.scrollY + 8;
  if (below) {
    top = rect.bottom + window.scrollY + 8;
  }
  tip.classList.toggle("hl-below", below);
  left = Math.max(
    8,
    Math.min(left, window.scrollX + window.innerWidth - tipRect.width - 8),
  );
  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
}

function openTooltip(mark, pointer) {
  const id = mark.dataset.hlId;
  if (pointer) lastPointer = pointer;

  if (activeHlId === id && tooltipEl) {
    positionTooltip(id, lastPointer);
    return;
  }

  closeTooltip();
  activeHlId = id;
  activeMark = getPrimaryMark(id) || mark;
  mark = activeMark;
  const colorIndex = parseInt(mark.dataset.hlColor || "0", 10);
  const note = mark.dataset.hlNote || "";

  tooltipEl = document.createElement("div");
  tooltipEl.id = TOOLTIP_ID;
  tooltipEl.className = `hl-tooltip hl-theme-${pageTheme}`;

  const swatches = HIGHLIGHT_COLORS.map((c, i) => {
    const pair = getColorPair(i, pageTheme === "dark");
    return `<button class="hl-color-swatch${i === colorIndex ? " hl-selected" : ""}" data-color="${i}" style="background:${pair.bg}" title="${c.name}"></button>`;
  }).join("");

  tooltipEl.innerHTML = `
    <div class="hl-tooltip-inner">
      <div class="hl-tooltip-actions">
        <button class="hl-tooltip-btn" data-action="copy" title="Copy">${ICONS.copy}</button>
        <button class="hl-tooltip-btn${note ? " hl-active" : ""}" data-action="note" title="Add note">${note ? ICONS.noteFill : ICONS.note}</button>
        <button class="hl-tooltip-btn" data-action="color" title="Change color">${ICONS.palette}</button>
        <button class="hl-tooltip-btn" data-action="delete" title="Delete">${ICONS.delete}</button>
      </div>
      <div class="hl-tooltip-note-preview" data-panel="note-preview"></div>
      <div class="hl-tooltip-note" data-panel="note">
        <textarea placeholder="Add a note…"></textarea>
        <div class="hl-tooltip-note-footer">
          <button class="hl-tooltip-save" data-action="save-note">Save</button>
        </div>
      </div>
      <div class="hl-color-picker" data-panel="color">${swatches}</div>
    </div>
  `;

  document.body.appendChild(tooltipEl);
  positionTooltip(id, lastPointer);

  const notePreview = tooltipEl.querySelector('[data-panel="note-preview"]');
  const notePanel = tooltipEl.querySelector('[data-panel="note"]');
  const colorPanel = tooltipEl.querySelector('[data-panel="color"]');
  const textarea = notePanel.querySelector("textarea");
  textarea.value = note;
  syncNotePreview(notePreview, note, false);

  sendMessage({
    type: "GET_PAGE_HIGHLIGHTS",
    url: location.href,
  }).then((res) => {
    const item = (res.highlights || []).find((h) => h.id === id);
    if (!item || !tooltipEl || activeHlId !== id) return;
    if (item.note) {
      applyNoteToHighlight(id, item.note);
      textarea.value = item.note;
      syncNotePreview(notePreview, item.note, notePanel.classList.contains("hl-open"));
      const noteBtn = tooltipEl.querySelector('[data-action="note"]');
      if (noteBtn) {
        noteBtn.classList.add("hl-active");
        noteBtn.innerHTML = ICONS.noteFill;
      }
      positionTooltip(id, lastPointer);
    }
  });

  tooltipEl.addEventListener("mouseenter", cancelHideTooltip);
  tooltipEl.addEventListener("mouseleave", (e) => {
    const toMark = e.relatedTarget?.closest?.(`.${HL_CLASS}`);
    if (toMark?.dataset.hlId === id) return;
    scheduleHideTooltip();
  });

  tooltipEl.addEventListener("click", async (e) => {
    e.stopPropagation();
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === "copy") {
      await navigator.clipboard.writeText(mark.textContent);
      btn.classList.add("hl-copied");
      setTimeout(() => btn.classList.remove("hl-copied"), 700);
    }

    if (action === "note") {
      const open = notePanel.classList.toggle("hl-open");
      colorPanel.classList.remove("hl-open");
      syncNotePreview(notePreview, textarea.value, open);
      if (open) {
        cancelHideTooltip();
        textarea.focus();
      }
      positionTooltip(id, lastPointer);
    }

    if (action === "color") {
      colorPanel.classList.toggle("hl-open");
      notePanel.classList.remove("hl-open");
      syncNotePreview(notePreview, textarea.value, false);
      cancelHideTooltip();
      positionTooltip(id, lastPointer);
    }

    if (action === "save-note") {
      const val = textarea.value.trim();
      await updateHighlightData(id, { note: val });
      applyNoteToHighlight(id, val);
      const noteBtn = tooltipEl.querySelector('[data-action="note"]');
      noteBtn.classList.toggle("hl-active", !!val);
      noteBtn.innerHTML = val ? ICONS.noteFill : ICONS.note;
      notePanel.classList.remove("hl-open");
      syncNotePreview(notePreview, val, false);
      positionTooltip(id, lastPointer);
    }

    if (action === "delete") {
      unwrapHighlight(id);
      await deleteHighlightData(id);
      closeTooltip();
    }
  });

  colorPanel.addEventListener("click", async (e) => {
    const sw = e.target.closest(".hl-color-swatch");
    if (!sw) return;
    const idx = parseInt(sw.dataset.color, 10);
    applyColorToHighlight(id, idx);
    await updateHighlightData(id, { colorIndex: idx });
    colorPanel.querySelectorAll(".hl-color-swatch").forEach((s) => {
      s.classList.toggle("hl-selected", s === sw);
    });
  });

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      tooltipEl.querySelector('[data-action="save-note"]').click();
    }
  });
}

// --- Events ---

function getMarkHlId(node) {
  return node?.closest?.(`.${HL_CLASS}`)?.dataset?.hlId ?? null;
}

document.addEventListener("mouseover", (e) => {
  const mark = e.target.closest(`.${HL_CLASS}`);
  const inTooltip = e.target.closest(`#${TOOLTIP_ID}`);

  if (mark) {
    cancelHideTooltip();
    openTooltip(mark, { x: e.clientX, y: e.clientY });
    return;
  }
  if (inTooltip) {
    cancelHideTooltip();
  }
});

document.addEventListener("mousemove", (e) => {
  const mark = e.target.closest(`.${HL_CLASS}`);
  if (!mark) return;
  const id = mark.dataset.hlId;
  if (activeHlId === id && tooltipEl) {
    lastPointer = { x: e.clientX, y: e.clientY };
    positionTooltip(id, lastPointer);
  }
});

document.addEventListener("mouseout", (e) => {
  const fromMark = e.target.closest(`.${HL_CLASS}`);
  const fromTip = e.target.closest(`#${TOOLTIP_ID}`);
  if (!fromMark && !fromTip) return;

  const to = e.relatedTarget;
  const fromId = fromMark?.dataset.hlId;
  const toId = getMarkHlId(to);

  if (toId && fromId && toId === fromId) return;
  if (to?.closest(`#${TOOLTIP_ID}`)) return;
  if (fromTip && toId === activeHlId) return;

  scheduleHideTooltip();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeTooltip();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (!isContextValid()) return;
  if (area !== "local" || !changes[SETTINGS_KEY]) return;
  defaultColorIndex = changes[SETTINGS_KEY].newValue?.defaultColorIndex ?? 0;
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "HIGHLIGHT_SELECTION") {
    highlightSelection().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === "SETTINGS_UPDATED") {
    defaultColorIndex = msg.settings?.defaultColorIndex ?? 0;
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === "SCROLL_TO") {
    scrollToHighlightWithRestore(msg.id).then((scrolled) => {
      sendResponse({ ok: true, scrolled });
    });
    return true;
  }
  if (msg.type === "GET_MIGRATION_STATUS") {
    getMigrationStatus().then(sendResponse);
    return true;
  }
  if (msg.type === "MIGRATE_PAGE_HIGHLIGHTS") {
    migratePageHighlights().then(sendResponse);
    return true;
  }
  return false;
});

const themeObserver = new MutationObserver(() => {
  refreshAllMarkStyles();
});
themeObserver.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["class", "style", "data-theme"],
});

window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", refreshAllMarkStyles);

// --- Init ---

(async function init() {
  if (!isContextValid()) return;

  try {
    await loadSettings();
    if (document.readyState === "loading") {
      await new Promise((r) =>
        document.addEventListener("DOMContentLoaded", r, { once: true }),
      );
    }
    await restoreHighlights();
    await consumePendingScroll();
  } catch {
    return;
  }

  if (document.body) {
    const observer = new MutationObserver(() => {
      if (!isContextValid()) return;
      scheduleRestore();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
