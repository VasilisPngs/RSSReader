import { listOutbox, clearOutbox, applyRemote, getMeta, setMeta, countOutbox } from "./db.js";

const ENDPOINT = "/api/sync";
const PUSH_BATCH = 100;
const REQUEST_TIMEOUT = 20000;
const RETRY_BASE = 4000;
const RETRY_MAX = 120000;
const IDLE_INTERVAL = 60000;

export const syncEvents = new EventTarget();

const state = {
  status: "idle",
  pending: 0,
  lastSyncedAt: null,
  error: null
};

let running = false;
let rerun = false;
let failures = 0;
let retryTimer = null;
let intervalTimer = null;

export function getSyncState() {
  return { ...state };
}

function emit() {
  syncEvents.dispatchEvent(new CustomEvent("state", { detail: getSyncState() }));
}

function setStatus(status, error = null) {
  state.status = status;
  state.error = error;
  emit();
}

async function refreshPending() {
  state.pending = await countOutbox();
  emit();
}

export async function apiPost(path, body, timeout = REQUEST_TIMEOUT) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(timeout)
  });
  if (response.type === "opaqueredirect" || response.status === 401 || response.status === 403) {
    const error = new Error("auth_required");
    error.code = "auth";
    setStatus("auth", error);
    throw error;
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error || `http_${response.status}`);
    error.code = "http";
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function postSync(body) {
  return apiPost(ENDPOINT, body);
}

function scheduleRetry() {
  if (retryTimer) return;
  const delay = Math.min(RETRY_BASE * 2 ** Math.min(failures, 5), RETRY_MAX);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    requestSync();
  }, delay);
}

async function cycle() {
  let guard = 0;
  while (guard < 25) {
    guard += 1;
    const { total, items } = await listOutbox(PUSH_BATCH);
    const cursors = await getMeta("cursors", {});
    const payload = {
      cursors,
      mutations: items.map((item) => ({ table: item.table, row: item.row }))
    };
    const result = await postSync(payload);
    const applied = await applyRemote(result.changes || {});
    await setMeta("cursors", result.cursors || cursors);
    await clearOutbox(items);
    if (applied > 0) syncEvents.dispatchEvent(new CustomEvent("changed"));
    const remaining = total - items.length;
    if (remaining <= 0 && !result.hasMore) return;
  }
}

export async function requestSync() {
  if (running) {
    rerun = true;
    return;
  }
  if (!navigator.onLine) {
    await refreshPending();
    setStatus("offline");
    return;
  }
  running = true;
  setStatus("syncing");
  try {
    await cycle();
    failures = 0;
    state.lastSyncedAt = Date.now();
    await setMeta("last_synced_at", state.lastSyncedAt);
    await refreshPending();
    setStatus("idle");
  } catch (error) {
    failures += 1;
    await refreshPending();
    if (error && error.code === "auth") {
      setStatus("auth", error);
    } else if (!navigator.onLine) {
      setStatus("offline", error);
    } else {
      setStatus("error", error);
      scheduleRetry();
    }
  } finally {
    running = false;
    if (rerun) {
      rerun = false;
      requestSync();
    }
  }
}

let debounceTimer = null;
export function scheduleSync(delay = 1200) {
  refreshPending();
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => requestSync(), delay);
}

export async function startSync() {
  state.lastSyncedAt = await getMeta("last_synced_at", null);
  await refreshPending();
  requestSync();
  addEventListener("online", () => {
    failures = 0;
    clearTimeout(retryTimer);
    retryTimer = null;
    requestSync();
  });
  addEventListener("offline", () => setStatus("offline"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") requestSync();
  });
  clearInterval(intervalTimer);
  intervalTimer = setInterval(() => {
    if (document.visibilityState === "visible") requestSync();
  }, IDLE_INTERVAL);
}
