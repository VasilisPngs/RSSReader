import { parseFeed } from "./feed.js";
import { decodeBody } from "../public/app/decode.js";
import { notifySubscribers } from "./push.js";

const USER_AGENT = "RSSReader/1.0 (Cloudflare Workers; personal reader)";
const ACCEPT = "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5";

export const MAX_FEEDS_PER_TICK = 3;
const PARSE_BUDGET_CHARS = 600000;
const MAX_BODY_BYTES = 1500000;
const MAX_ITEMS = 40;
const INSERT_PARAMS = 90;

const MIN_INTERVAL = 600;
const MAX_INTERVAL = 10800;
const ERROR_BASE_INTERVAL = 900;
const MAX_ERROR_INTERVAL = 21600;

export const RETENTION_DAYS = 45;

function siteIcon(source) {
  try {
    const origin = new URL(source).origin;
    return origin.startsWith("https://") ? `${origin}/favicon.ico` : null;
  } catch {
    return null;
  }
}

export function articleMessage(notice) {
  const first = notice.items[0] || {};
  const icon = siteIcon(notice.feed.site_url || notice.feed.feed_url);
  const single = notice.count === 1;
  return {
    title: (single ? first.title : notice.feed.title) || "RSSReader",
    body: (single
      ? [notice.feed.title, first.summary].filter(Boolean).join(" · ")
      : notice.items.map((item) => item.title).filter(Boolean).join(" · ")
    ).slice(0, 180),
    icon,
    image: first.image_url || null,
    path: single && first.id ? `/article/${first.id}` : `/feed/${notice.feed.id}`,
    tag: `feed-${notice.feed.id}`,
    timestamp: Date.now()
  };
}

function nextInterval(current, outcome) {
  const base = current || 1200;
  if (outcome === "new") return Math.max(MIN_INTERVAL, Math.round(base / 2));
  if (outcome === "unchanged") return Math.min(MAX_INTERVAL, Math.round(base * 1.5));
  return Math.min(MAX_INTERVAL, Math.round(base * 1.25));
}

function retryAfterSeconds(response) {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, MAX_ERROR_INTERVAL);
  const date = Date.parse(raw);
  if (!Number.isFinite(date)) return response.status === 429 ? 3600 : null;
  return Math.min(Math.max(Math.round((date - Date.now()) / 1000), 60), MAX_ERROR_INTERVAL);
}

async function fetchFeed(feed) {
  const headers = { "user-agent": USER_AGENT, accept: ACCEPT };
  if (feed.etag) headers["if-none-match"] = feed.etag;
  if (feed.last_modified) headers["if-modified-since"] = feed.last_modified;
  const response = await fetch(feed.feed_url, { headers, redirect: "follow" });
  if (response.status === 304) return { status: 304 };
  if (!response.ok) {
    return { status: response.status, error: `HTTP ${response.status}`, retryAfter: retryAfterSeconds(response) };
  }
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) {
    return { status: response.status, error: "feed too large" };
  }
  const buffer = await response.arrayBuffer();
  const body = decodeBody(buffer.byteLength > MAX_BODY_BYTES ? buffer.slice(0, MAX_BODY_BYTES) : buffer, response.headers.get("content-type"));
  return {
    status: response.status,
    body: body.length > MAX_BODY_BYTES ? body.slice(0, MAX_BODY_BYTES) : body,
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified")
  };
}

function articleStatements(rows, rev) {
  const columns = ["id", "feed_id", "guid", "url", "title", "author", "summary", "content", "image_url", "published_at", "fetched_at"];
  const perStatement = Math.max(1, Math.floor(INSERT_PARAMS / columns.length));
  const statements = [];
  for (let index = 0; index < rows.length; index += perStatement) {
    const chunk = rows.slice(index, index + perStatement);
    const placeholders = chunk.map(() => `(${columns.map(() => "?").join(", ")}, ${rev})`).join(", ");
    const params = [];
    for (const row of chunk) for (const column of columns) params.push(row[column]);
    statements.push({
      sql: `INSERT INTO articles (${columns.join(", ")}, rev) VALUES ${placeholders} ON CONFLICT(feed_id, guid) DO UPDATE SET image_url = excluded.image_url, rev = excluded.rev WHERE articles.image_url IS NULL AND excluded.image_url IS NOT NULL`,
      params
    });
  }
  return statements;
}

const NOTICE_LIMIT = 4;

export async function pollFeeds(env, feeds, now, options = {}) {
  if (feeds.length === 0) return { polled: 0, inserted: 0 };

  let budget = PARSE_BUDGET_CHARS;
  let parsed = 0;
  const cutoff = now - RETENTION_DAYS * 86400000;
  const articles = [];
  const states = [];
  const notices = [];

  const responses = await Promise.all(
    feeds.map((feed) => fetchFeed(feed).catch((error) => ({ status: 0, error: String(error && error.message).slice(0, 200) })))
  );

  for (let index = 0; index < feeds.length; index += 1) {
    const feed = feeds[index];
    const result = responses[index];
    const interval = feed.interval_seconds || 1200;

    if (result.status === 304) {
      states.push({
        feed_id: feed.id,
        etag: feed.etag,
        last_modified: feed.last_modified,
        last_fetch_at: now,
        interval_seconds: nextInterval(interval, "unchanged"),
        last_status: 304,
        error_count: 0,
        last_error: null
      });
      continue;
    }

    if (result.error || !result.body) {
      const errors = (feed.error_count || 0) + 1;
      states.push({
        feed_id: feed.id,
        etag: feed.etag,
        last_modified: feed.last_modified,
        last_fetch_at: now,
        interval_seconds: result.retryAfter || Math.min(MAX_ERROR_INTERVAL, ERROR_BASE_INTERVAL * 2 ** Math.min(errors, 5)),
        last_status: result.status || 0,
        error_count: errors,
        last_error: (result.error || "empty response").slice(0, 200)
      });
      continue;
    }

    if (budget <= 0 && parsed > 0) continue;
    budget -= result.body.length;
    parsed += 1;

    let feedArticles = [];
    let parseError = null;
    try {
      const feedData = parseFeed(result.body, { limit: MAX_ITEMS, fetchedAt: now });
      feedArticles = feedData.items;
    } catch (error) {
      parseError = String(error && error.message).slice(0, 200);
    }

    if (parseError) {
      const errors = (feed.error_count || 0) + 1;
      states.push({
        feed_id: feed.id,
        etag: null,
        last_modified: null,
        last_fetch_at: now,
        interval_seconds: Math.min(MAX_ERROR_INTERVAL, ERROR_BASE_INTERVAL * 2 ** Math.min(errors, 5)),
        last_status: result.status,
        error_count: errors,
        last_error: parseError
      });
      continue;
    }

    let added = 0;
    const fresh = [];
    const known = feed.notify
      ? await env.DB.prepare("SELECT guid FROM articles WHERE feed_id = ?1 AND published_at >= ?2").bind(feed.id, cutoff).all()
      : null;
    const seen = known ? new Set((known.results || []).map((row) => row.guid)) : null;
    for (const item of feedArticles) {
      if (item.published_at < cutoff) continue;
      const id = crypto.randomUUID();
      const guid = item.guid.slice(0, 500);
      if (seen && !seen.has(guid)) {
        added += 1;
        if (fresh.length < 3) fresh.push({ id, title: item.title, summary: item.summary, image_url: item.image_url });
      } else if (!seen) {
        added += 1;
      }
      articles.push({
        id,
        feed_id: feed.id,
        guid,
        url: item.url,
        title: item.title.slice(0, 400),
        author: item.author,
        summary: item.summary,
        content: item.content,
        image_url: item.image_url,
        published_at: item.published_at,
        fetched_at: now
      });
    }

    if (added > 0 && feed.notify) notices.push({ feed, items: fresh, count: added });

    states.push({
      feed_id: feed.id,
      etag: result.etag,
      last_modified: result.lastModified,
      last_fetch_at: now,
      interval_seconds: nextInterval(interval, added > 0 ? "new" : "empty"),
      last_status: result.status,
      error_count: 0,
      last_error: null
    });
  }

  const bumped = await env.DB.prepare("UPDATE sync_rev SET value = value + 1 WHERE id = 1 RETURNING value").first();
  const rev = bumped.value;

  const statements = articleStatements(articles, rev).map((statement) =>
    env.DB.prepare(statement.sql).bind(...statement.params)
  );

  for (const state of states) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO feed_state (feed_id, etag, last_modified, last_fetch_at, next_fetch_at, interval_seconds, last_status, error_count, last_error, rev)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(feed_id) DO UPDATE SET etag=excluded.etag, last_modified=excluded.last_modified,
           last_fetch_at=excluded.last_fetch_at, next_fetch_at=excluded.next_fetch_at,
           interval_seconds=excluded.interval_seconds, last_status=excluded.last_status,
           error_count=excluded.error_count, last_error=excluded.last_error, rev=excluded.rev`
      ).bind(
        state.feed_id,
        state.etag,
        state.last_modified,
        state.last_fetch_at,
        now + state.interval_seconds * 1000,
        state.interval_seconds,
        state.last_status,
        state.error_count,
        state.last_error,
        rev
      )
    );
  }

  if (statements.length > 0) await env.DB.batch(statements);

  let notified = 0;
  if (notices.length > 0 && options.notify !== false) {
    const messages = notices.slice(0, NOTICE_LIMIT).map((notice) => articleMessage(notice));
    notified = await notifySubscribers(env, messages, options.subject || "mailto:reader@example.com");
  }

  return { polled: feeds.length, inserted: articles.length, parsed, notified };
}

export async function selectDueFeeds(env, now, limit = MAX_FEEDS_PER_TICK) {
  const result = await env.DB.prepare(
    `SELECT f.id, f.feed_url, f.title, f.site_url, f.notify, s.etag, s.last_modified, s.interval_seconds, s.error_count
     FROM feeds f LEFT JOIN feed_state s ON s.feed_id = f.id
     WHERE f.deleted_at IS NULL AND COALESCE(s.next_fetch_at, 0) <= ?1
     ORDER BY COALESCE(s.next_fetch_at, 0) LIMIT ?2`
  )
    .bind(now, limit)
    .all();
  return result.results || [];
}

export async function pruneArticles(env, now) {
  const cutoff = now - RETENTION_DAYS * 86400000;
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM articles WHERE published_at < ?1 AND id NOT IN (SELECT article_id FROM article_state WHERE is_starred = 1)"
    ).bind(cutoff),
    env.DB.prepare("DELETE FROM article_state WHERE article_id NOT IN (SELECT id FROM articles)")
  ]);
}

export async function runScheduled(env, scheduledTime) {
  const now = scheduledTime || Date.now();
  const feeds = await selectDueFeeds(env, now);
  const outcome = await pollFeeds(env, feeds, now);
  if (new Date(now).getUTCMinutes() === 7) await pruneArticles(env, now);
  return outcome;
}
