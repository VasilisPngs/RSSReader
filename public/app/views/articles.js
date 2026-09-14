import { el, clear, formatTimestamp, plural, hostnameOf, siteIcon, toast, confirmSheet } from "../dom.js";
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
import { t } from "../i18n.js";

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
    return feed ? feed.title : t("feedFallback");
  }
  if (params.scope === "folder") {
    const folder = folderById(params.id);
    return folder ? folder.name : t("folderFallback");
  }
  if (params.scope === "starred") return t("scopeStarred");
  if (params.scope === "all") return t("scopeAllArticles");
  return t("scopeUnread");
}

function articleRow(article, params) {
  const state = stateOf(article.id);
  const feed = feedById(article.feed_id);
  const thumb = article.image_url
    ? el("img", {
        class: "entry-thumb",
        src: article.image_url,
        alt: "",
        loading: "lazy",
        referrerPolicy: "no-referrer",
        decoding: "async"
      })
    : null;
  if (thumb) thumb.addEventListener("error", () => thumb.remove(), { once: true });

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
      thumb,
      el("div", { class: "entry-text" }, [
        el("div", { class: "entry-meta" }, [
          siteIcon(feed ? feed.site_url || feed.feed_url : article.url, feed ? feed.title : ""),
          el("span", { class: "entry-feed", text: feed ? feed.title : hostnameOf(article.url) }),
          el("span", { text: formatTimestamp(article.published_at) })
        ]),
        el("h3", { class: "entry-title", text: article.title || "(untitled)" }),
        article.summary ? el("p", { class: "entry-summary", text: article.summary }) : null
      ])
    ]),
    el("div", { class: "entry-actions" }, [
      el("button", {
        class: "icon-button",
        type: "button",
        "aria-pressed": state.is_starred ? "true" : "false",
        "aria-label": t("ariaStar"),
        text: state.is_starred ? "★" : "☆",
        onclick: () => toggleStar(article.id)
      }),
      el("button", {
        class: "icon-button",
        type: "button",
        "aria-label": state.is_read ? t("ariaMarkUnread") : t("ariaMarkRead"),
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
              ? plural(starredCount(), "starredArticle")
              : `${plural(articles.length, "article")} · ${t("unreadTotal", { count: unreadTotal() })}`
        })
      ]),
      el("button", {
        class: "btn small",
        type: "button",
        text: t("refresh"),
        onclick: async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          button.textContent = "…";
          try {
            const outcome = await refreshFeeds(params.scope === "feed" ? params.id : null);
            await requestSync();
            toast(outcome.inserted > 0 ? plural(outcome.inserted, "newArticle") : t("noNewArticles"));
          } catch (error) {
            toast(error.code === "auth" ? t("signInRequired") : t("refreshFailed"));
          } finally {
            button.disabled = false;
            button.textContent = t("refresh");
          }
        }
      })
    ])
  );

  container.append(
    el("div", { class: "chips" }, [
      chip(t("scopeUnread"), "/", params.scope === "unread"),
      chip(t("scopeAll"), "/all", params.scope === "all"),
      chip(t("scopeStarred"), "/starred", params.scope === "starred"),
      params.scope === "feed" || params.scope === "folder" ? chip(title, location.pathname, true) : null
    ])
  );

  container.append(
    el("input", {
      type: "search",
      id: "article-search",
      placeholder: t("searchArticles"),
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
        text: articles.length > visibleCount ? t("markListedRead") : t("markAllRead"),
        onclick: async () => {
          const confirmed =
            articles.length < 20 ||
            (await confirmSheet(t("markAsRead"), t("markConfirm", { count: plural(articles.length, "article") }), t("markAsRead")));
          if (!confirmed) return;
          const count = await markAllRead(articles);
          toast(t("markedRead", { count: plural(count, "article") }));
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
        el("p", { text: t("noFeedsYet") }),
        el("a", { class: "btn primary", href: "/feeds", "data-link": "", text: t("addFirstFeed") })
      ])
    );
    return;
  }
  if (articles.length === 0) {
    list.append(el("div", { class: "empty", text: searchQuery ? t("noSearchMatch") : t("allCaughtUp") }));
    return;
  }
  for (const article of articles.slice(0, visibleCount)) list.append(articleRow(article, params));
  if (articles.length > visibleCount) {
    list.append(
      el("button", {
        class: "btn block",
        type: "button",
        text: t("showMore", { count: articles.length - visibleCount }),
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
