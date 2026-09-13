import { parseFeed } from "./feed.js";

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

function nextInterval(current, outcome) {
  const base = current || 1200;
  if (outcome === "new") return Math.max(MIN_INTERVAL, Math.round(base / 2));
  if (outcome === "unchanged") return Math.min(MAX_INTERVAL, Math.round(base * 1.5));
  return Math.min(MAX_INTERVAL, Math.round(base * 1.25));
}

async function fetchFeed(feed) {
  const headers = { "user-agent": USER_AGENT, accept: ACCEPT };
  if (feed.etag) headers["if-none-match"] = feed.etag;
  if (feed.last_modified) headers["if-modified-since"] = feed.last_modified;
  const response = await fetch(feed.feed_url, { headers, redirect: "follow" });
  if (response.status === 304) return { status: 304 };
  if (!response.ok) {
    return { status: response.status, error: `HTTP ${response.status}` };
  }
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) {
    return { status: response.status, error: "feed too large" };
  }
  const body = await response.text();
  return {
    status: response.status,
    body: body.length > MAX_BODY_BYTES ? body.slice(0, MAX_BODY_BYTES) : body,
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified")
  };
}

function articleStatements(rows, rev) {
  const columns = ["id", "feed_id", "guid", "url", "title", "author", "summary", "content", "published_at", "fetched_at"];
  const perStatement = Math.max(1, Math.floor(INSERT_PARAMS / columns.length));
  const statements = [];
  for (let index = 0; index < rows.length; index += perStatement) {
    const chunk = rows.slice(index, index + perStatement);
    const placeholders = chunk.map(() => `(${columns.map(() => "?").join(", ")}, ${rev})`).join(", ");
    const params = [];
    for (const row of chunk) for (const column of columns) params.push(row[column]);
    statements.push({
      sql: `INSERT INTO articles (${columns.join(", ")}, rev) VALUES ${placeholders} ON CONFLICT(feed_id, guid) DO NOTHING`,
      params
    });
  }
  return statements;
}

export async function pollFeeds(env, feeds, now) {
  if (feeds.length === 0) return { polled: 0, inserted: 0 };

  let budget = PARSE_BUDGET_CHARS;
  let parsed = 0;
  const cutoff = now - RETENTION_DAYS * 86400000;
  const articles = [];
  const states = [];

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
        interval_seconds: Math.min(MAX_ERROR_INTERVAL, ERROR_BASE_INTERVAL * 2 ** Math.min(errors, 5)),
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
    for (const item of feedArticles) {
      if (item.published_at < cutoff) continue;
      added += 1;
      articles.push({
        id: crypto.randomUUID(),
        feed_id: feed.id,
        guid: item.guid.slice(0, 500),
        url: item.url,
        title: item.title.slice(0, 400),
        author: item.author,
        summary: item.summary,
        content: item.content,
        published_at: item.published_at,
        fetched_at: now
      });
    }

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
  return { polled: feeds.length, inserted: articles.length, parsed };
}

export async function selectDueFeeds(env, now, limit = MAX_FEEDS_PER_TICK) {
  const result = await env.DB.prepare(
    `SELECT f.id, f.feed_url, s.etag, s.last_modified, s.interval_seconds, s.error_count
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
