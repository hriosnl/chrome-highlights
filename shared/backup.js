const BACKUPS_KEY = "highlights_backups";
const BACKUP_META_KEY = "highlights_backup_meta";
const BACKUP_ALARM = "highlights-backup";
const BACKUP_HOURS = Array.from({ length: 15 }, (_, i) => i + 8);
const BACKUP_WINDOW_MINUTES = 10;
const MAX_BACKUPS = 60;

function getNextBackupWhen() {
  const now = new Date();
  for (const hour of BACKUP_HOURS) {
    const next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    if (next > now) return next.getTime();
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(BACKUP_HOURS[0], 0, 0, 0);
  return tomorrow.getTime();
}

function getCurrentBackupSlot() {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  if (!BACKUP_HOURS.includes(hour) || minute >= BACKUP_WINDOW_MINUTES) {
    return null;
  }
  return hour;
}

async function getBackupMeta() {
  const data = await chrome.storage.local.get(BACKUP_META_KEY);
  return data[BACKUP_META_KEY] || {};
}

async function setBackupMeta(meta) {
  await chrome.storage.local.set({ [BACKUP_META_KEY]: meta });
}

async function getBackups() {
  const data = await chrome.storage.local.get(BACKUPS_KEY);
  return data[BACKUPS_KEY] || [];
}

async function createBackup(slot) {
  const highlights_by_url = await getAllHighlights();
  const settings = await getSettings();

  const backups = await getBackups();
  backups.unshift({
    createdAt: Date.now(),
    slot,
    highlights_by_url,
    settings,
  });

  await chrome.storage.local.set({
    [BACKUPS_KEY]: backups.slice(0, MAX_BACKUPS),
  });

  return backups[0];
}

async function runScheduledBackupIfDue() {
  const slot = getCurrentBackupSlot();
  if (slot === null) return false;

  const today = new Date().toDateString();
  const slotKey = `${today}-${slot}`;
  const meta = await getBackupMeta();
  if (meta.lastSlotKey === slotKey) return false;

  await createBackup(slot);
  await setBackupMeta({ lastSlotKey: slotKey });
  return true;
}

async function getLatestBackup() {
  const backups = await getBackups();
  return backups[0] || null;
}

function summarizeBackup(backup, index) {
  const byUrl = backup.highlights_by_url || {};
  let highlightCount = 0;
  for (const list of Object.values(byUrl)) {
    highlightCount += list.length;
  }
  return {
    index,
    createdAt: backup.createdAt,
    slot: backup.slot,
    highlightCount,
    pageCount: Object.keys(byUrl).length,
  };
}

async function getAllBackupsSummary() {
  const backups = await getBackups();
  return backups.map((backup, index) => summarizeBackup(backup, index));
}

async function getBackupAt(index) {
  const backups = await getBackups();
  return backups[index] || null;
}

async function forceCreateBackup() {
  return createBackup("manual");
}

function scheduleBackupAlarm() {
  chrome.alarms.create(BACKUP_ALARM, { when: getNextBackupWhen() });
}

if (typeof globalThis !== "undefined") {
  globalThis.BACKUP_ALARM = BACKUP_ALARM;
  globalThis.getBackups = getBackups;
  globalThis.getLatestBackup = getLatestBackup;
  globalThis.getAllBackupsSummary = getAllBackupsSummary;
  globalThis.getBackupAt = getBackupAt;
  globalThis.createBackup = createBackup;
  globalThis.forceCreateBackup = forceCreateBackup;
  globalThis.runScheduledBackupIfDue = runScheduledBackupIfDue;
  globalThis.scheduleBackupAlarm = scheduleBackupAlarm;
}