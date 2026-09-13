import { handleSync, json } from "./sync.js";
import { pollFeeds, selectDueFeeds, runScheduled, MAX_FEEDS_PER_TICK } from "./poller.js";
import { parseFeed, discoverFeedUrl, looksLikeFeed } from "./feed.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);
const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "metadata.google.internal"]);
const DISCOVER_TIMEOUT = 10000;

function behindAccess(request, url) {
  if (LOCAL_HOSTS.has(url.hostname)) return true;
  return request.headers.has("cf-access-jwt-assertion");
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
      `SELECT f.id, f.feed_url, s.etag, s.last_modified, s.interval_seconds, s.error_count
       FROM feeds f LEFT JOIN feed_state s ON s.feed_id = f.id
       WHERE f.id = ?1 AND f.deleted_at IS NULL`
    )
      .bind(payload.feed_id)
      .all();
    const outcome = await pollFeeds(env, result.results || [], now);
    return json(outcome);
  }

  await env.DB.prepare("UPDATE feed_state SET next_fetch_at = 0").run();
  const feeds = await selectDueFeeds(env, now, MAX_FEEDS_PER_TICK);
  const outcome = await pollFeeds(env, feeds, now);
  return json(outcome);
}

const ROUTES = {
  "/api/sync": handleSync,
  "/api/discover": handleDiscover,
  "/api/refresh": handleRefresh
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const route = ROUTES[url.pathname];
    if (!route) return json({ error: "not_found" }, 404);
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    if (!behindAccess(request, url)) return json({ error: "forbidden" }, 403);
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
