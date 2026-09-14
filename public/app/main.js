import { el, clear } from "./dom.js";
import { initStore, storeEvents, feedsSorted, foldersSorted, unreadCount, unreadTotal, starredCount, setRead, toggleStar, stateOf, refreshFeeds } from "./store.js";
import { startSync, syncEvents, getSyncState, requestSync } from "./sync.js";
import { currentRoute, startRouter, navigate, back } from "./router.js";
import { renderArticles } from "./views/articles.js";
import { renderArticle } from "./views/article.js";
import { renderFeeds } from "./views/feeds.js";
import { renderSettings } from "./views/settings.js";
import { t, applyLanguage, i18nEvents } from "./i18n.js";
import { applyTheme, themeEvents } from "./theme.js";
import { prefsEvents } from "./prefs.js";

const view = document.getElementById("view");
const pill = document.getElementById("sync-pill");
const sidebar = document.getElementById("sidebar");
const tabs = [...document.querySelectorAll(".tab")];

const VIEWS = { articles: renderArticles, article: renderArticle, feeds: renderFeeds, settings: renderSettings };
const TAB_FOR_ROUTE = { articles: "articles", article: "articles", feeds: "feeds", settings: "settings" };
const TAB_LABELS = { articles: "tabArticles", feeds: "tabFeeds", settings: "tabSettings" };

let lastRouteKey = "";
let deferredRender = false;
let banner = null;
let selected = -1;

function isEditing() {
  const active = document.activeElement;
  return Boolean(active) && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
}

function render() {
  if (isEditing() && document.activeElement.type !== "search") {
    deferredRender = true;
    return;
  }
  deferredRender = false;
  const route = currentRoute();
  const key = `${route.name}:${route.params.scope || ""}${route.params.id || ""}`;
  for (const tab of tabs) {
    tab.setAttribute("aria-current", tab.dataset.route === TAB_FOR_ROUTE[route.name] ? "page" : "false");
    const label = tab.querySelector("span");
    if (label) label.textContent = t(TAB_LABELS[tab.dataset.route]);
  }
  clear(view);
  (VIEWS[route.name] || renderArticles)(view, route.params);
  paintSidebar();
  if (key !== lastRouteKey) {
    lastRouteKey = key;
    selected = -1;
    view.classList.remove("enter");
    void view.offsetWidth;
    view.classList.add("enter");
    scrollTo({ top: 0, behavior: "instant" });
  } else {
    applySelection();
  }
}

function sidebarLink(href, label, count, active) {
  return el("a", { class: `side-link${active ? " active" : ""}`, href, "data-link": "" }, [
    el("span", { class: "grow", text: label }),
    count > 0 ? el("span", { class: "badge", text: String(count) }) : null
  ]);
}

function paintSidebar() {
  if (!sidebar) return;
  clear(sidebar);
  const path = location.pathname;
  sidebar.append(
    sidebarLink("/", t("scopeUnread"), unreadTotal(), path === "/"),
    sidebarLink("/all", t("scopeAllArticles"), 0, path === "/all"),
    sidebarLink("/starred", t("scopeStarred"), starredCount(), path === "/starred")
  );
  for (const folder of foldersSorted()) {
    sidebar.append(el("div", { class: "side-heading", text: folder.name }));
    for (const feed of feedsSorted().filter((item) => item.folder_id === folder.id)) {
      sidebar.append(sidebarLink(`/feed/${feed.id}`, feed.title, unreadCount(feed.id), path === `/feed/${feed.id}`));
    }
  }
  const loose = feedsSorted().filter((feed) => !feed.folder_id);
  if (loose.length > 0) {
    sidebar.append(el("div", { class: "side-heading", text: t("tabFeeds") }));
    for (const feed of loose) sidebar.append(sidebarLink(`/feed/${feed.id}`, feed.title, unreadCount(feed.id), path === `/feed/${feed.id}`));
  }
  sidebar.append(el("a", { class: "side-link muted-link", href: "/feeds", "data-link": "", text: t("sidebarManageFeeds") }));
  sidebar.append(el("a", { class: "side-link muted-link", href: "/settings", "data-link": "", text: t("settingsTitle") }));
}

function entries() {
  return [...view.querySelectorAll(".entry")];
}

function applySelection() {
  const list = entries();
  list.forEach((entry, index) => entry.classList.toggle("selected", index === selected));
  if (selected >= 0 && list[selected]) list[selected].scrollIntoView({ block: "nearest" });
}

function moveSelection(delta) {
  const list = entries();
  if (list.length === 0) return;
  selected = Math.max(0, Math.min(list.length - 1, selected + delta));
  applySelection();
}

function selectedId() {
  const list = entries();
  return selected >= 0 && list[selected] ? list[selected].dataset.id : null;
}

function paintPill() {
  const state = getSyncState();
  let status = "idle";
  let label = t("statusSynced");
  if (state.status === "auth") {
    status = "auth";
    label = t("statusSignIn");
  } else if (state.status === "syncing") {
    status = "syncing";
    label = t("statusSyncing");
  } else if (state.status === "offline") {
    status = "offline";
    label = state.pending > 0 ? `${t("statusOffline")} · ${state.pending}` : t("statusOffline");
  } else if (state.status === "error") {
    status = "error";
    label = t("statusRetry");
  } else if (state.pending > 0) {
    status = "pending";
    label = `${t("statusQueued")} · ${state.pending}`;
  }
  pill.dataset.status = status;
  pill.textContent = label;
  paintBanner(state);
}

function paintBanner(state) {
  if (state.status === "auth" && !banner) {
    banner = el("div", { class: "banner" }, [
      el("span", { text: t("sessionExpired") }),
      el("button", { class: "btn small", type: "button", text: t("statusSignIn"), onclick: signIn })
    ]);
    view.before(banner);
  }
  if (state.status !== "auth" && banner) {
    banner.remove();
    banner = null;
  }
}

function signIn() {
  location.href = `/?signin=${Date.now()}`;
}

function watchServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").then((registration) => {
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) offerUpdate(worker);
      });
    });
  });
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

function offerUpdate(worker) {
  document.getElementById("toast-host").append(
    el("div", { class: "toast", style: "pointer-events:auto;display:flex;gap:10px;align-items:center" }, [
      el("span", { text: t("newVersion") }),
      el("button", { class: "btn small primary", type: "button", text: t("reload"), onclick: () => worker.postMessage({ type: "skip_waiting" }) })
    ])
  );
}

document.addEventListener("keydown", (event) => {
  if (isEditing()) {
    if (event.key === "Escape") event.target.blur();
    return;
  }
  const route = currentRoute();
  const key = event.key.toLowerCase();
  if (key === "/") {
    const search = document.getElementById("article-search");
    if (search) {
      event.preventDefault();
      search.focus();
    }
    return;
  }
  if (key === "escape" && route.name === "article") return back("/");
  if (key === "r") {
    event.preventDefault();
    refreshFeeds().then(() => requestSync());
    return;
  }
  if (route.name !== "articles") return;
  if (key === "j" || event.key === "ArrowDown") {
    event.preventDefault();
    moveSelection(1);
  } else if (key === "k" || event.key === "ArrowUp") {
    event.preventDefault();
    moveSelection(-1);
  } else if (key === "enter" || key === "o") {
    const id = selectedId();
    if (id) navigate(`/article/${id}`);
  } else if (key === "m") {
    const id = selectedId();
    if (id) setRead(id, !stateOf(id).is_read);
  } else if (key === "s") {
    const id = selectedId();
    if (id) toggleStar(id);
  }
});

view.addEventListener("focusout", () => {
  setTimeout(() => {
    if (deferredRender && !isEditing()) render();
  }, 0);
});

pill.addEventListener("click", () => {
  if (getSyncState().status === "auth") signIn();
  else requestSync();
});

async function boot() {
  if (new URL(location.href).searchParams.has("signin")) history.replaceState({}, "", location.pathname);
  applyLanguage();
  applyTheme();
  await initStore();
  storeEvents.addEventListener("changed", render);
  i18nEvents.addEventListener("changed", () => {
    render();
    paintPill();
  });
  themeEvents.addEventListener("changed", render);
  prefsEvents.addEventListener("changed", render);
  syncEvents.addEventListener("state", paintPill);
  startRouter(render);
  paintPill();
  await startSync();
  watchServiceWorker();
}

boot();
