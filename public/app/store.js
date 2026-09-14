import { TABLE_NAMES, readAll, writeRows, getMeta, pruneArticles } from "./db.js";
import { keepDefaultLanguage } from "./lang.js";
import { scheduleSync, syncEvents, apiPost } from "./sync.js";

export const RETENTION_DAYS = 45;

export const storeEvents = new EventTarget();

const cache = {
  folders: new Map(),
  feeds: new Map(),
  feed_state: new Map(),
  articles: new Map(),
  article_state: new Map()
};

let ordered = [];
let unreadByFeed = new Map();
let totalUnread = 0;

export const uid = () => crypto.randomUUID();
export const now = () => Date.now();

function announce() {
  storeEvents.dispatchEvent(new CustomEvent("changed"));
}

async function commit(entries) {
  for (const entry of entries) cache[entry.table].set(entry.row[entry.table === "article_state" ? "article_id" : "id"], entry.row);
  reindex();
  await writeRows(entries);
  announce();
  scheduleSync();
}

function reindex() {
  const live = new Set([...cache.feeds.values()].filter((feed) => !feed.deleted_at).map((feed) => feed.id));
  ordered = keepDefaultLanguage([...cache.articles.values()].filter((article) => live.has(article.feed_id))).sort(
    (a, b) => b.published_at - a.published_at
  );
  unreadByFeed = new Map();
  totalUnread = 0;
  for (const article of ordered) {
    const state = cache.article_state.get(article.id);
    if (state && state.is_read) continue;
    unreadByFeed.set(article.feed_id, (unreadByFeed.get(article.feed_id) || 0) + 1);
    totalUnread += 1;
  }
}

async function hydrate() {
  for (const table of TABLE_NAMES) {
    const rows = await readAll(table);
    const key = table === "article_state" ? "article_id" : table === "feed_state" ? "feed_id" : "id";
    cache[table] = new Map(rows.map((row) => [row[key], row]));
  }
  reindex();
}

export async function initStore() {
  await pruneArticles(Date.now() - RETENTION_DAYS * 86400000);
  await hydrate();
  syncEvents.addEventListener("changed", async () => {
    await hydrate();
    announce();
  });
}

export const feeds = () => [...cache.feeds.values()].filter((feed) => !feed.deleted_at);
export const folders = () => [...cache.folders.values()].filter((folder) => !folder.deleted_at);

export function feedsSorted() {
  return feeds().sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
}

export function foldersSorted() {
  return folders().sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

export const feedById = (id) => cache.feeds.get(id) || null;
export const folderById = (id) => cache.folders.get(id) || null;
export const articleById = (id) => cache.articles.get(id) || null;
export const feedStateOf = (id) => cache.feed_state.get(id) || null;

export function stateOf(articleId) {
  return cache.article_state.get(articleId) || { article_id: articleId, is_read: 0, is_starred: 0, read_at: null };
}

export const unreadCount = (feedId) => unreadByFeed.get(feedId) || 0;
export const unreadTotal = () => totalUnread;

export function folderUnread(folderId) {
  return feeds()
    .filter((feed) => feed.folder_id === folderId)
    .reduce((total, feed) => total + unreadCount(feed.id), 0);
}

export function starredCount() {
  let count = 0;
  for (const state of cache.article_state.values()) if (state.is_starred) count += 1;
  return count;
}

export function selectArticles(scope, id, query) {
  const needle = query ? query.trim().toLowerCase() : "";
  const folderFeeds = scope === "folder" ? new Set(feeds().filter((feed) => feed.folder_id === id).map((feed) => feed.id)) : null;
  const result = [];
  for (const article of ordered) {
    const state = cache.article_state.get(article.id);
    if (scope === "unread" && state && state.is_read) continue;
    if (scope === "starred" && !(state && state.is_starred)) continue;
    if (scope === "feed" && article.feed_id !== id) continue;
    if (scope === "folder" && !folderFeeds.has(article.feed_id)) continue;
    if (needle) {
      const haystack = `${article.title || ""} ${article.summary || ""}`.toLowerCase();
      if (!haystack.includes(needle)) continue;
    }
    result.push(article);
  }
  return result;
}

export function neighbours(list, articleId) {
  const index = list.findIndex((article) => article.id === articleId);
  return {
    previous: index > 0 ? list[index - 1] : null,
    next: index >= 0 && index < list.length - 1 ? list[index + 1] : null
  };
}

function stateRow(articleId, patch) {
  const current = stateOf(articleId);
  return {
    article_id: articleId,
    is_read: current.is_read,
    is_starred: current.is_starred,
    read_at: current.read_at,
    ...patch,
    updated_at: now()
  };
}

export async function setRead(articleId, isRead) {
  const current = stateOf(articleId);
  if (Boolean(current.is_read) === Boolean(isRead)) return;
  await commit([{ table: "article_state", row: stateRow(articleId, { is_read: isRead ? 1 : 0, read_at: isRead ? now() : null }) }]);
}

export async function toggleStar(articleId) {
  const current = stateOf(articleId);
  await commit([{ table: "article_state", row: stateRow(articleId, { is_starred: current.is_starred ? 0 : 1 }) }]);
}

export async function markAllRead(articles) {
  const entries = articles
    .filter((article) => !stateOf(article.id).is_read)
    .map((article) => ({ table: "article_state", row: stateRow(article.id, { is_read: 1, read_at: now() }) }));
  if (entries.length === 0) return 0;
  await commit(entries);
  return entries.length;
}

export async function createFeed({ title, feed_url, site_url, folder_id }) {
  const row = {
    id: uid(),
    folder_id: folder_id || null,
    title,
    feed_url,
    site_url: site_url || null,
    notify: 0,
    position: feeds().length,
    created_at: now(),
    deleted_at: null
  };
  await commit([{ table: "feeds", row }]);
  return row;
}

export async function updateFeed(id, patch) {
  const current = feedById(id);
  if (!current) return;
  await commit([{ table: "feeds", row: { ...current, ...patch } }]);
}

export async function deleteFeed(id) {
  const current = feedById(id);
  if (!current) return;
  await commit([{ table: "feeds", row: { ...current, deleted_at: now() } }]);
}

export async function toggleFeedNotify(id) {
  const current = feedById(id);
  if (!current) return;
  await commit([{ table: "feeds", row: { ...current, notify: current.notify ? 0 : 1 } }]);
}

export async function createFolder(name) {
  const row = { id: uid(), name, position: folders().length, created_at: now(), deleted_at: null };
  await commit([{ table: "folders", row }]);
  return row;
}

export async function updateFolder(id, patch) {
  const current = folderById(id);
  if (!current) return;
  await commit([{ table: "folders", row: { ...current, ...patch } }]);
}

export async function deleteFolder(id) {
  const current = folderById(id);
  if (!current) return;
  const entries = [{ table: "folders", row: { ...current, deleted_at: now() } }];
  for (const feed of feeds()) {
    if (feed.folder_id === id) entries.push({ table: "feeds", row: { ...feed, folder_id: null } });
  }
  await commit(entries);
}

export function discoverFeed(url) {
  return apiPost("/api/discover", { url });
}

export function refreshFeeds(feedId) {
  return apiPost("/api/refresh", feedId ? { feed_id: feedId } : {}, 30000);
}

export function knownFeedUrl(url) {
  const normalized = url.replace(/\/+$/, "").toLowerCase();
  return feeds().some((feed) => feed.feed_url.replace(/\/+$/, "").toLowerCase() === normalized);
}

export function buildOpml() {
  const escape = (value) =>
    String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const grouped = new Map();
  for (const feed of feedsSorted()) {
    const key = feed.folder_id || "";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(feed);
  }
  const line = (feed) =>
    `      <outline type="rss" text="${escape(feed.title)}" title="${escape(feed.title)}" xmlUrl="${escape(feed.feed_url)}" htmlUrl="${escape(feed.site_url)}"/>`;
  const sections = [];
  for (const [folderId, list] of grouped) {
    if (!folderId) continue;
    const folder = folderById(folderId);
    sections.push(`    <outline text="${escape(folder ? folder.name : "Folder")}">\n${list.map(line).join("\n")}\n    </outline>`);
  }
  for (const feed of grouped.get("") || []) sections.push(line(feed).replace(/^ {6}/, "    "));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>RSSReader export</title></head>\n  <body>\n${sections.join("\n")}\n  </body>\n</opml>\n`;
}

export async function importOpml(text) {
  const parsed = new DOMParser().parseFromString(text, "text/xml");
  const outlines = [...parsed.querySelectorAll("outline[xmlUrl]")];
  const entries = [];
  const folderCache = new Map();
  let position = feeds().length;

  for (const outline of outlines) {
    const url = outline.getAttribute("xmlUrl");
    if (!url || knownFeedUrl(url)) continue;
    const parent = outline.parentElement;
    const folderName = parent && parent.tagName === "outline" ? parent.getAttribute("text") || parent.getAttribute("title") : null;
    let folderId = null;
    if (folderName) {
      if (!folderCache.has(folderName)) {
        const existing = folders().find((folder) => folder.name === folderName);
        if (existing) folderCache.set(folderName, existing.id);
        else {
          const row = { id: uid(), name: folderName, position: folders().length + folderCache.size, created_at: now(), deleted_at: null };
          entries.push({ table: "folders", row });
          folderCache.set(folderName, row.id);
        }
      }
      folderId = folderCache.get(folderName);
    }
    entries.push({
      table: "feeds",
      row: {
        id: uid(),
        folder_id: folderId,
        title: outline.getAttribute("text") || outline.getAttribute("title") || url,
        feed_url: url,
        site_url: outline.getAttribute("htmlUrl") || null,
        position: position++,
        created_at: now(),
        deleted_at: null
      }
    });
  }

  if (entries.length > 0) await commit(entries);
  return entries.filter((entry) => entry.table === "feeds").length;
}

export async function lastSyncedAt() {
  return getMeta("last_synced_at", null);
}
