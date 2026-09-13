import { el, clear, formatTimestamp, plural, hostnameOf, toast, confirmSheet } from "../dom.js";
import {
  selectArticles,
  stateOf,
  setRead,
  toggleStar,
  markAllRead,
  feedById,
  folderById,
  unreadTotal,
  starredCount,
  refreshFeeds,
  feeds
} from "../store.js";
import { navigate } from "../router.js";
import { requestSync } from "../sync.js";

const PAGE_SIZE = 40;

let searchQuery = "";
let visibleCount = PAGE_SIZE;
let lastKey = "";
let readingQueue = [];
let queueOrigin = "/";

export function queue() {
  return { ids: readingQueue, origin: queueOrigin };
}

export function currentQuery() {
  return searchQuery;
}

export function listFor(params) {
  return selectArticles(params.scope, params.id, searchQuery);
}

function scopeTitle(params) {
  if (params.scope === "feed") {
    const feed = feedById(params.id);
    return feed ? feed.title : "Feed";
  }
  if (params.scope === "folder") {
    const folder = folderById(params.id);
    return folder ? folder.name : "Folder";
  }
  if (params.scope === "starred") return "Starred";
  if (params.scope === "all") return "All articles";
  return "Unread";
}

function articleRow(article, params) {
  const state = stateOf(article.id);
  const feed = feedById(article.feed_id);
  const row = el("article", { class: `entry${state.is_read ? " read" : ""}`, dataset: { id: article.id } }, [
    el("button", {
      class: "entry-main",
      type: "button",
      onclick: () => {
        readingQueue = listFor(params).map((item) => item.id);
        queueOrigin = location.pathname;
        navigate(`/article/${article.id}`);
      }
    }, [
      el("div", { class: "entry-meta" }, [
        el("span", { class: "entry-feed", text: feed ? feed.title : hostnameOf(article.url) }),
        el("span", { text: formatTimestamp(article.published_at) })
      ]),
      el("h3", { class: "entry-title", text: article.title || "(untitled)" }),
      article.summary ? el("p", { class: "entry-summary", text: article.summary }) : null
    ]),
    el("div", { class: "entry-actions" }, [
      el("button", {
        class: "icon-button",
        type: "button",
        "aria-pressed": state.is_starred ? "true" : "false",
        "aria-label": "star",
        text: state.is_starred ? "★" : "☆",
        onclick: () => toggleStar(article.id)
      }),
      el("button", {
        class: "icon-button",
        type: "button",
        "aria-label": state.is_read ? "mark unread" : "mark read",
        text: state.is_read ? "○" : "●",
        onclick: () => setRead(article.id, !state.is_read)
      })
    ])
  ]);
  return row;
}

export function renderArticles(container, params) {
  const key = `${params.scope}:${params.id || ""}`;
  if (key !== lastKey) {
    lastKey = key;
    visibleCount = PAGE_SIZE;
  }

  const articles = listFor(params);
  const title = scopeTitle(params);

  container.append(
    el("div", { class: "row between" }, [
      el("div", { class: "grow" }, [
        el("h1", { text: title }),
        el("div", {
          class: "tiny",
          text:
            params.scope === "starred"
              ? plural(starredCount(), "starred article")
              : `${plural(articles.length, "article")} · ${unreadTotal()} unread total`
        })
      ]),
      el("button", {
        class: "btn small",
        type: "button",
        text: "Refresh",
        onclick: async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          button.textContent = "…";
          try {
            const outcome = await refreshFeeds(params.scope === "feed" ? params.id : null);
            await requestSync();
            toast(outcome.inserted > 0 ? `${plural(outcome.inserted, "new article")}` : "No new articles");
          } catch (error) {
            toast(error.code === "auth" ? "Sign in required" : "Refresh failed");
          } finally {
            button.disabled = false;
            button.textContent = "Refresh";
          }
        }
      })
    ])
  );

  container.append(
    el("div", { class: "chips" }, [
      chip("Unread", "/", params.scope === "unread"),
      chip("All", "/all", params.scope === "all"),
      chip("Starred", "/starred", params.scope === "starred"),
      params.scope === "feed" || params.scope === "folder" ? chip(title, location.pathname, true) : null
    ])
  );

  container.append(
    el("input", {
      type: "search",
      id: "article-search",
      placeholder: "Search titles and summaries",
      value: searchQuery,
      oninput: (event) => {
        searchQuery = event.target.value;
        visibleCount = PAGE_SIZE;
        repaint(container, params);
      }
    })
  );

  const list = el("div", { class: "entries", id: "entry-list" });
  container.append(list);
  paintList(list, articles, params);

  if (articles.length > 0 && params.scope !== "starred") {
    container.append(
      el("button", {
        class: "btn block",
        type: "button",
        text: `Mark ${articles.length > visibleCount ? "all listed" : "all"} as read`,
        onclick: async () => {
          const confirmed = articles.length < 20 || (await confirmSheet("Mark as read", `Mark ${plural(articles.length, "article")} as read?`, "Mark read"));
          if (!confirmed) return;
          const count = await markAllRead(articles);
          toast(`${plural(count, "article")} marked read`);
        }
      })
    );
  }
}

function chip(label, href, active) {
  return el("a", {
    class: "chip",
    href,
    "data-link": "",
    text: label,
    "aria-pressed": active ? "true" : "false"
  });
}

function paintList(list, articles, params) {
  clear(list);
  if (feeds().length === 0) {
    list.append(
      el("div", { class: "empty" }, [
        el("p", { text: "No feeds yet." }),
        el("a", { class: "btn primary", href: "/feeds", "data-link": "", text: "Add your first feed" })
      ])
    );
    return;
  }
  if (articles.length === 0) {
    list.append(el("div", { class: "empty", text: searchQuery ? "Nothing matches that search." : "Nothing here. You are all caught up." }));
    return;
  }
  for (const article of articles.slice(0, visibleCount)) list.append(articleRow(article, params));
  if (articles.length > visibleCount) {
    list.append(
      el("button", {
        class: "btn block",
        type: "button",
        text: `Show more (${articles.length - visibleCount} left)`,
        onclick: (event) => {
          visibleCount += PAGE_SIZE;
          const container = event.currentTarget.parentElement;
          paintList(container, articles, params);
        }
      })
    );
  }
}

function repaint(container, params) {
  const list = container.querySelector("#entry-list");
  if (list) paintList(list, listFor(params), params);
}
