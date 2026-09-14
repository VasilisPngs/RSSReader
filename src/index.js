import { handleSync, json } from "./sync.js";
import { pollFeeds, selectDueFeeds, runScheduled, articleMessage, MAX_FEEDS_PER_TICK } from "./poller.js";
import { parseFeed, discoverFeedUrl, looksLikeFeed } from "./feed.js";
import { loadKeys, notifySubscribers } from "./push.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);
const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "metadata.google.internal"]);
const DISCOVER_TIMEOUT = 10000;

async function behindAccess(request, url, ctx) {
  if (LOCAL_HOSTS.has(url.hostname)) return true;
  if (request.headers.has("cf-access-jwt-assertion")) return true;
  try {
    const identity = ctx && ctx.access ? await ctx.access.getIdentity() : null;
    if (identity && identity.email) return true;
  } catch {}
  return false;
}

function safeUrl(input) {
  let parsed;
  try {
    parsed = new URL(input.trim().startsWith("http") ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (BLOCKED_HOSTS.has(parsed.hostname)) return null;
  return parsed;
}

async function loadDocument(target) {
  const response = await fetch(target.toString(), {
    headers: {
      "user-agent": "RSSReader/1.0 (Cloudflare Workers; personal reader)",
      accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(DISCOVER_TIMEOUT)
  });
  if (!response.ok) return { error: `HTTP ${response.status}` };
  const body = await response.text();
  return { body: body.slice(0, 1000000), finalUrl: response.url || target.toString() };
}

async function handleDiscover(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const target = safeUrl(String(payload.url || ""));
  if (!target) return json({ error: "invalid_url" }, 400);

  let document = await loadDocument(target);
  if (document.error) return json({ error: "unreachable", detail: document.error }, 502);

  if (!looksLikeFeed(document.body)) {
    const discovered = discoverFeedUrl(document.body, document.finalUrl);
    if (!discovered) return json({ error: "no_feed_found" }, 404);
    const candidate = safeUrl(discovered);
    if (!candidate) return json({ error: "invalid_url" }, 400);
    document = await loadDocument(candidate);
    if (document.error || !looksLikeFeed(document.body)) return json({ error: "no_feed_found" }, 404);
  }

  const feed = parseFeed(document.body, { limit: 1 });
  return json({
    feed_url: document.finalUrl,
    title: feed.title || new URL(document.finalUrl).hostname,
    site_url: feed.siteUrl,
    items: feed.items.length
  });
}

async function handleRefresh(request, env) {
  let payload = {};
  try {
    payload = await request.json();
  } catch {}
  const now = Date.now();

  if (payload.feed_id) {
    const result = await env.DB.prepare(
      `SELECT f.id, f.feed_url, f.title, f.site_url, f.notify, s.etag, s.last_modified, s.interval_seconds, s.error_count
       FROM feeds f LEFT JOIN feed_state s ON s.feed_id = f.id
       WHERE f.id = ?1 AND f.deleted_at IS NULL`
    )
      .bind(payload.feed_id)
      .all();
    const outcome = await pollFeeds(env, result.results || [], now, { subject: pushSubject(request) });
    return json(outcome);
  }

  await env.DB.prepare("UPDATE feed_state SET next_fetch_at = 0").run();
  const feeds = await selectDueFeeds(env, now, MAX_FEEDS_PER_TICK);
  const outcome = await pollFeeds(env, feeds, now, { subject: pushSubject(request) });
  return json(outcome);
}

async function handlePushKey(request, env) {
  const keys = await loadKeys(env);
  return json({ publicKey: keys.publicKey });
}

async function handlePushSubscribe(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const endpoint = typeof payload.endpoint === "string" ? payload.endpoint : "";
  const p256dh = payload.keys && typeof payload.keys.p256dh === "string" ? payload.keys.p256dh : "";
  const auth = payload.keys && typeof payload.keys.auth === "string" ? payload.keys.auth : "";
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) return json({ error: "invalid_subscription" }, 400);
  const subject = pushSubject(request);
  await loadKeys(env);
  await env.DB.prepare("UPDATE push_keys SET subject = ?1 WHERE id = 1").bind(subject).run();
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at, last_seen_at) VALUES (?1, ?2, ?3, ?4, ?4)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, last_seen_at = excluded.last_seen_at`
  )
    .bind(endpoint, p256dh, auth, Date.now())
    .run();
  return json({ ok: true });
}

async function handlePushUnsubscribe(request, env) {
  let payload = {};
  try {
    payload = await request.json();
  } catch {}
  if (typeof payload.endpoint === "string") {
    await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?1").bind(payload.endpoint).run();
  }
  return json({ ok: true });
}

async function handlePushTest(request, env) {
  const latest = await env.DB.prepare(
    "SELECT a.id, a.title, a.summary, a.image_url, f.id AS feed_id, f.title AS feed_title, f.site_url, f.feed_url FROM articles a JOIN feeds f ON f.id = a.feed_id WHERE f.deleted_at IS NULL ORDER BY a.published_at DESC LIMIT 1"
  ).first();
  const message = latest
    ? articleMessage({
        feed: { id: latest.feed_id, title: latest.feed_title, site_url: latest.site_url, feed_url: latest.feed_url },
        items: [{ id: latest.id, title: latest.title, summary: latest.summary, image_url: latest.image_url }],
        count: 1
      })
    : { title: "RSSReader", body: "Test notification", path: "/", tag: "rssreader-test", timestamp: Date.now() };
  const sent = await notifySubscribers(env, [message], pushSubject(request));
  return json({ sent });
}

function pushSubject(request) {
  const email = request.headers.get("cf-access-authenticated-user-email");
  return email ? `mailto:${email}` : `https://${new URL(request.url).hostname}`;
}

const PAGE_TIMEOUT = 15000;
const MAX_PAGE_BYTES = 3000000;
const MAX_READABLE_CHARS = 200000;
const BROWSER_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const USER_AGENT = "Mozilla/5.0 (compatible; RSSReader/1.0; personal reader)";

function charsetOf(contentType) {
  const match = /charset\s*=\s*"?([\w-]+)/i.exec(contentType || "");
  return match ? match[1] : "utf-8";
}

async function handlePage(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const row = await env.DB.prepare("SELECT url FROM articles WHERE id = ?1").bind(String(payload.id || "")).first();
  if (!row || !row.url) return json({ error: "unknown_article" }, 404);
  const target = safeUrl(row.url);
  if (!target) return json({ error: "invalid_url" }, 400);

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      headers: { "user-agent": USER_AGENT, accept: BROWSER_ACCEPT, "accept-language": "el,en;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(PAGE_TIMEOUT)
    });
  } catch (error) {
    return json({ error: "unreachable", detail: String(error && error.message).slice(0, 120) }, 502);
  }
  if (!upstream.ok) return json({ error: "unreachable", detail: `HTTP ${upstream.status}` }, 502);
  if (Number(upstream.headers.get("content-length") || 0) > MAX_PAGE_BYTES) return json({ error: "too_large" }, 413);

  return new Response(upstream.body, {
    headers: {
      "content-type": `text/plain; charset=${charsetOf(upstream.headers.get("content-type"))}`,
      "cache-control": "no-store",
      "x-final-url": upstream.url || target.toString()
    }
  });
}

async function handleReadable(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const id = String(payload.id || "");
  const content = String(payload.content || "").slice(0, MAX_READABLE_CHARS);
  if (!id || !content) return json({ error: "invalid_payload" }, 400);
  const bumped = await env.DB.prepare("UPDATE sync_rev SET value = value + 1 WHERE id = 1 RETURNING value").first();
  const result = await env.DB.prepare("UPDATE articles SET content = ?2, rev = ?3 WHERE id = ?1")
    .bind(id, content, bumped.value)
    .run();
  if (!result.meta || result.meta.changes === 0) return json({ error: "unknown_article" }, 404);
  return json({ ok: true, rev: bumped.value });
}

const ROUTES = {
  "/api/sync": handleSync,
  "/api/page": handlePage,
  "/api/readable": handleReadable,
  "/api/discover": handleDiscover,
  "/api/refresh": handleRefresh,
  "/api/push/key": handlePushKey,
  "/api/push/subscribe": handlePushSubscribe,
  "/api/push/unsubscribe": handlePushUnsubscribe,
  "/api/push/test": handlePushTest
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const route = ROUTES[url.pathname];
    if (!route) return json({ error: "not_found" }, 404);
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    if (!(await behindAccess(request, url, ctx))) return json({ error: "forbidden" }, 403);
    try {
      return await route(request, env);
    } catch (error) {
      return json({ error: "request_failed", detail: String(error && error.message).slice(0, 200) }, 500);
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(env, controller.scheduledTime));
  }
};
