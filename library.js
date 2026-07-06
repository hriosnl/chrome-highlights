const tbody = document.getElementById("tbody");
const statsEl = document.getElementById("stats");
const searchInput = document.getElementById("search");
const noResults = document.getElementById("no-results");
const importFileInput = document.getElementById("import-file");
const importJsonBtn = document.getElementById("import-json");
const createBackupBtn = document.getElementById("create-backup");
const viewBackupsBtn = document.getElementById("view-backups");
const backupOverlay = document.getElementById("backup-overlay");
const backupPanel = document.getElementById("backup-panel");
const closeBackupsBtn = document.getElementById("close-backups");
const backupList = document.getElementById("backup-list");
const backupEmpty = document.getElementById("backup-empty");
const exportJsonBtn = document.getElementById("export-json");
const exportMdBtn = document.getElementById("export-md");

let allHighlights = [];
let query = "";

const DELETE_ICON =
  '<svg viewBox="0 0 24 24"><path d="M17 6v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V6H4V4h5V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1h5v2h-3zM9 4v1h6V4H9zm1 3v9h1V7h-1zm3 0v9h1V7h-1z"/></svg>';

const DOWNLOAD_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M13 10H18L12 16L6 10H11V3H13V10ZM4 19H20V12H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V12H4V19Z"></path></svg>';

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

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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

function displayUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    return u.hostname + path;
  } catch {
    return url;
  }
}

function updateStats(list) {
  const pages = new Set(list.map((h) => h.url)).size;
  statsEl.textContent = `${list.length} highlight${list.length === 1 ? "" : "s"} across ${pages} page${pages === 1 ? "" : "s"}`;
}

function filterList(list, q) {
  if (!q.trim()) return list;
  const lower = q.toLowerCase();
  return list.filter(
    (h) =>
      h.text.toLowerCase().includes(lower) ||
      (h.note || "").toLowerCase().includes(lower) ||
      h.url.toLowerCase().includes(lower)
  );
}

function startNoteEdit(cell, item) {
  if (cell.querySelector(".note-editor")) return;

  const editor = document.createElement("textarea");
  editor.className = "note-editor";
  editor.value = item.note || "";
  editor.placeholder = "Add a note…";

  cell.innerHTML = "";
  cell.appendChild(editor);
  editor.focus();

  const save = async () => {
    const note = editor.value.trim();
    await sendMessage({
      type: "UPDATE_HIGHLIGHT",
      url: item.url,
      highlight: { ...item, note },
    });
    item.note = note;
    renderNoteCell(cell, item);
  };

  editor.addEventListener("blur", save);
  editor.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      editor.blur();
    }
    if (e.key === "Escape") {
      renderNoteCell(cell, item);
    }
  });
}

function renderNoteCell(cell, item) {
  cell.innerHTML = "";
  const display = document.createElement("div");
  display.className = `note-display${item.note ? "" : " empty"}`;
  display.textContent = item.note || "Add note…";
  display.addEventListener("click", () => startNoteEdit(cell, item));
  cell.appendChild(display);
}

function renderTable(list) {
  tbody.innerHTML = "";
  const filtered = filterList(list, query);

  if (!filtered.length) {
    noResults.hidden = list.length > 0 ? false : true;
    if (list.length === 0) {
      noResults.textContent = "No highlights yet. Select text on any page and press ^H.";
      noResults.hidden = false;
    }
    return;
  }
  noResults.hidden = true;

  let lastUrl = null;
  let groupIndex = -1;

  for (const item of filtered) {
    if (item.url !== lastUrl) {
      groupIndex++;
      lastUrl = item.url;
    }

    const tr = document.createElement("tr");
    tr.className = groupIndex % 2 === 0 ? "row-group-even" : "row-group-odd";

    const tdHighlight = document.createElement("td");
    tdHighlight.className = "col-highlight";
    const highlightRow = document.createElement("div");
    highlightRow.className = "highlight-row";
    const hlBtn = document.createElement("button");
    hlBtn.type = "button";
    hlBtn.className = "link-btn";
    hlBtn.textContent = item.text;
    hlBtn.addEventListener("click", () => {
      sendMessage({
        type: "SCROLL_TO_HIGHLIGHT",
        url: item.url,
        id: item.id,
      });
    });
    highlightRow.appendChild(createColorDot(item.colorIndex));
    highlightRow.appendChild(hlBtn);
    tdHighlight.appendChild(highlightRow);

    const tdNote = document.createElement("td");
    tdNote.className = "col-note";
    renderNoteCell(tdNote, item);

    const tdUrl = document.createElement("td");
    tdUrl.className = "col-url";
    const urlLink = document.createElement("a");
    urlLink.className = "url-link";
    urlLink.href = item.url;
    urlLink.target = "_blank";
    urlLink.rel = "noopener";
    urlLink.textContent = displayUrl(item.url);
    tdUrl.appendChild(urlLink);

    const tdDate = document.createElement("td");
    tdDate.className = "col-date";
    tdDate.textContent = formatDate(item.createdAt);

    const tdActions = document.createElement("td");
    tdActions.className = "col-actions";
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "delete-btn";
    delBtn.title = "Delete highlight";
    delBtn.innerHTML = DELETE_ICON;
    delBtn.addEventListener("click", async () => {
      if (!confirm("Delete this highlight?")) return;
      await sendMessage({
        type: "DELETE_FROM_LIBRARY",
        url: item.url,
        id: item.id,
      });
      allHighlights = allHighlights.filter((h) => h.id !== item.id);
      updateStats(allHighlights);
      renderTable(allHighlights);
    });
    tdActions.appendChild(delBtn);

    tr.append(tdHighlight, tdNote, tdUrl, tdDate, tdActions);
    tbody.appendChild(tr);
  }
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

importJsonBtn.addEventListener("click", () => {
  importFileInput.click();
});

importFileInput.addEventListener("change", async () => {
  const file = importFileInput.files?.[0];
  importFileInput.value = "";
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const res = await sendMessage({ type: "IMPORT_HIGHLIGHTS", data });
    if (!res.ok) throw new Error(res.error || "Import failed");

    const added = res.added ?? 0;
    const skipped = res.skipped ?? 0;
    const msg =
      skipped > 0
        ? `Imported ${added} highlights (${skipped} duplicates skipped).`
        : `Imported ${added} highlights.`;
    alert(msg);

    const fresh = await sendMessage({ type: "GET_ALL_FLAT" });
    allHighlights = fresh.highlights || [];
    updateStats(allHighlights);
    renderTable(allHighlights);
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  }
});

function formatBackupFilename(backup) {
  const d = new Date(backup.createdAt);
  const date = d.toISOString().slice(0, 10);
  if (backup.slot === "manual") {
    const time = d.toTimeString().slice(0, 5).replace(":", "");
    return `highlights-backup-${date}-manual-${time}.json`;
  }
  const hour = String(backup.slot ?? d.getHours()).padStart(2, "0");
  return `highlights-backup-${date}-${hour}00.json`;
}

function formatBackupSlot(slot) {
  if (slot === "manual") return "Manual";
  return `${String(slot).padStart(2, "0")}:00`;
}

function formatBackupDateTime(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function downloadBackupFile(backup) {
  const payload = {
    highlights_by_url: backup.highlights_by_url,
    settings: backup.settings,
    backupCreatedAt: backup.createdAt,
    backupSlot: backup.slot,
  };

  downloadFile(
    formatBackupFilename(backup),
    JSON.stringify(payload, null, 2),
    "application/json",
  );
}

function setBackupsPanelOpen(open) {
  backupPanel.classList.toggle("open", open);
  backupOverlay.classList.toggle("open", open);
  backupOverlay.hidden = !open;
  document.body.style.overflow = open ? "hidden" : "";

  if (open) {
    backupPanel.removeAttribute("aria-hidden");
    backupPanel.removeAttribute("inert");
  } else {
    backupPanel.setAttribute("aria-hidden", "true");
    backupPanel.setAttribute("inert", "");
  }
}

async function renderBackupsList() {
  const res = await sendMessage({ type: "GET_ALL_BACKUPS" });
  const backups = res.backups || [];

  backupList.innerHTML = "";
  backupEmpty.hidden = backups.length > 0;

  for (const item of backups) {
    const li = document.createElement("li");
    li.className = "backup-item";

    const info = document.createElement("div");
    info.className = "backup-item-info";

    const date = document.createElement("div");
    date.className = "backup-item-date";
    date.textContent = formatBackupDateTime(item.createdAt);

    const meta = document.createElement("div");
    meta.className = "backup-item-meta";
    meta.innerHTML =
      `<span class="backup-item-slot">${formatBackupSlot(item.slot)}</span>` +
      `${item.highlightCount} highlight${item.highlightCount === 1 ? "" : "s"} · ` +
      `${item.pageCount} page${item.pageCount === 1 ? "" : "s"}`;

    info.append(date, meta);

    const dlBtn = document.createElement("button");
    dlBtn.type = "button";
    dlBtn.className = "icon-btn";
    dlBtn.title = "Download backup";
    dlBtn.innerHTML = DOWNLOAD_ICON;
    dlBtn.addEventListener("click", async () => {
      dlBtn.disabled = true;
      try {
        const full = await sendMessage({ type: "GET_BACKUP_AT", index: item.index });
        if (!full.ok || !full.backup) throw new Error(full.error || "Backup not found");
        downloadBackupFile(full.backup);
      } catch (err) {
        alert(`Download failed: ${err.message}`);
      } finally {
        dlBtn.disabled = false;
      }
    });

    li.append(info, dlBtn);
    backupList.appendChild(li);
  }
}

async function openBackupsPanel() {
  await renderBackupsList();
  setBackupsPanelOpen(true);
}

function closeBackupsPanel() {
  if (backupPanel.contains(document.activeElement)) {
    viewBackupsBtn.focus();
  }
  setBackupsPanelOpen(false);
}

createBackupBtn.addEventListener("click", async () => {
  createBackupBtn.disabled = true;
  try {
    const res = await sendMessage({ type: "CREATE_BACKUP" });
    if (!res.ok) throw new Error(res.error || "Backup failed");
    const when = new Date(res.backup.createdAt).toLocaleString();
    alert(`Backup created (${when}).`);
    if (backupPanel.classList.contains("open")) {
      await renderBackupsList();
    }
  } catch (err) {
    alert(`Backup failed: ${err.message}`);
  } finally {
    createBackupBtn.disabled = false;
  }
});

viewBackupsBtn.addEventListener("click", () => {
  openBackupsPanel();
});

closeBackupsBtn.addEventListener("click", closeBackupsPanel);
backupOverlay.addEventListener("click", closeBackupsPanel);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && backupPanel.classList.contains("open")) {
    closeBackupsPanel();
  }
});

exportJsonBtn.addEventListener("click", () => {
  downloadFile(
    `highlights-${Date.now()}.json`,
    JSON.stringify(allHighlights, null, 2),
    "application/json"
  );
});

exportMdBtn.addEventListener("click", () => {
  const byUrl = {};
  for (const h of allHighlights) {
    if (!byUrl[h.url]) byUrl[h.url] = [];
    byUrl[h.url].push(h);
  }

  let md = "# Highlights Export\n\n";
  for (const [url, items] of Object.entries(byUrl)) {
    md += `## ${url}\n\n`;
    for (const h of items) {
      md += `- **${h.text}**`;
      if (h.note) md += ` — _${h.note}_`;
      md += ` (${formatDate(h.createdAt)})\n`;
    }
    md += "\n";
  }

  downloadFile(`highlights-${Date.now()}.md`, md, "text/markdown");
});

searchInput.addEventListener("input", (e) => {
  query = e.target.value;
  renderTable(allHighlights);
});

async function init() {
  const res = await sendMessage({ type: "GET_ALL_FLAT" });
  allHighlights = res.highlights || [];
  updateStats(allHighlights);
  renderTable(allHighlights);
}

init();