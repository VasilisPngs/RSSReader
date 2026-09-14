import { el, clear, formatTimestamp, plural, openSheet, confirmSheet, toast } from "../dom.js";
import {
  feedsSorted,
  foldersSorted,
  feedStateOf,
  unreadCount,
  createFeed,
  updateFeed,
  deleteFeed,
  createFolder,
  updateFolder,
  deleteFolder,
  discoverFeed,
  refreshFeeds,
  knownFeedUrl,
  importOpml,
  buildOpml
} from "../store.js";
import { requestSync } from "../sync.js";
import { t } from "../i18n.js";

function openAddFeed() {
  let url = "";
  let discovered = null;
  const status = el("div", { class: "tiny" });
  const result = el("div", { class: "list" });

  const runDiscover = async (close) => {
    if (!url.trim()) return;
    status.textContent = t("lookingForFeed");
    clear(result);
    try {
      discovered = await discoverFeed(url);
      status.textContent = "";
      if (knownFeedUrl(discovered.feed_url)) {
        status.textContent = t("feedAlreadyAdded");
        return;
      }
      result.append(
        el("div", { class: "list-item" }, [
          el("span", { class: "grow" }, [
            el("div", { text: discovered.title }),
            el("div", { class: "tiny", text: `${discovered.feed_url} · ${plural(discovered.items, "item")}` })
          ]),
          el("button", {
            class: "btn small primary",
            type: "button",
            text: t("add"),
            onclick: async (event) => {
              const button = event.currentTarget;
              button.disabled = true;
              button.textContent = "…";
              const feed = await createFeed(discovered);
              try {
                await requestSync();
                await refreshFeeds(feed.id);
                await requestSync();
              } catch {}
              close();
              toast(t("feedAdded", { title: discovered.title }));
            }
          })
        ])
      );
    } catch (error) {
      status.textContent =
        error.message === "no_feed_found"
          ? t("noFeedFound")
          : error.message === "unreachable"
            ? t("unreachable")
            : t("discoveryFailed");
    }
  };

  openSheet((close) => [
    el("h2", { text: t("addFeed") }),
    el("input", {
      type: "url",
      placeholder: t("feedUrlPlaceholder"),
      oninput: (event) => {
        url = event.target.value;
      },
      onkeydown: (event) => {
        if (event.key === "Enter") runDiscover(close);
      }
    }),
    el("button", { class: "btn primary block", type: "button", text: t("findFeed"), onclick: () => runDiscover(close) }),
    status,
    result
  ]);
}

function openFeedMenu(feed) {
  const state = feedStateOf(feed.id);
  openSheet((close) => [
    el("h2", { text: feed.title }),
    el("div", { class: "tiny", text: feed.feed_url }),
    state && state.last_error ? el("div", { class: "banner", text: t("lastError", { message: state.last_error }) }) : null,
    el("input", {
      type: "text",
      value: feed.title,
      onchange: (event) => updateFeed(feed.id, { title: event.target.value.trim() || feed.title })
    }),
    el(
      "select",
      { onchange: (event) => updateFeed(feed.id, { folder_id: event.target.value || null }) },
      [
        el("option", { value: "", text: t("noFolder"), selected: !feed.folder_id }),
        ...foldersSorted().map((folder) =>
          el("option", { value: folder.id, text: folder.name, selected: folder.id === feed.folder_id })
        )
      ]
    ),
    el("button", {
      class: "btn block danger",
      type: "button",
      text: t("deleteFeed"),
      onclick: async () => {
        close();
        const confirmed = await confirmSheet(t("deleteFeed"), t("deleteFeedBody", { title: feed.title }), t("delete"));
        if (confirmed) await deleteFeed(feed.id);
      }
    })
  ]);
}

function feedRow(feed) {
  const state = feedStateOf(feed.id);
  const unread = unreadCount(feed.id);
  const broken = state && state.error_count > 0;
  return el("div", { class: "list-item" }, [
    el("a", { class: "grow", href: `/feed/${feed.id}`, "data-link": "", style: "text-decoration:none;color:inherit" }, [
      el("div", { text: feed.title }),
      el("div", {
        class: "tiny",
        text: state && state.last_fetch_at ? t("checkedAt", { time: formatTimestamp(state.last_fetch_at) }) : t("notFetchedYet")
      })
    ]),
    broken ? el("span", { class: "badge danger", text: t("feedError") }) : null,
    unread > 0 ? el("span", { class: "badge", text: String(unread) }) : null,
    el("button", { class: "icon-button", type: "button", text: "···", "aria-label": t("ariaFeedOptions"), onclick: () => openFeedMenu(feed) })
  ]);
}

async function handleImport(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const text = await file.text();
  const added = await importOpml(text);
  toast(added > 0 ? t("feedsImported", { count: plural(added, "feed") }) : t("noNewFeedsInFile"));
}

function exportOpml() {
  const blob = new Blob([buildOpml()], { type: "text/xml" });
  const url = URL.createObjectURL(blob);
  const anchor = el("a", { href: url, download: "rssreader-subscriptions.opml" });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function renderFeeds(container) {
  const all = feedsSorted();

  container.append(
    el("div", { class: "row between" }, [
      el("div", { class: "grow" }, [
        el("h1", { text: t("feedsTitle") }),
        el("div", { class: "tiny", text: plural(all.length, "subscription") })
      ]),
      el("button", { class: "btn small primary", type: "button", text: t("addShort"), onclick: openAddFeed })
    ])
  );

  if (all.length === 0) {
    container.append(el("div", { class: "empty", text: t("noSubscriptions") }));
  }

  for (const folder of foldersSorted()) {
    const inFolder = all.filter((feed) => feed.folder_id === folder.id);
    container.append(
      el("div", { class: "row between", style: "margin-top:6px" }, [
        el("h2", { text: folder.name }),
        el("button", {
          class: "icon-button",
          type: "button",
          text: "···",
          "aria-label": t("ariaFolderOptions"),
          onclick: () =>
            openSheet((close) => [
              el("h2", { text: folder.name }),
              el("input", {
                type: "text",
                value: folder.name,
                onchange: (event) => updateFolder(folder.id, { name: event.target.value.trim() || folder.name })
              }),
              el("button", {
                class: "btn block danger",
                type: "button",
                text: t("deleteFolder"),
                onclick: async () => {
                  close();
                  const confirmed = await confirmSheet(t("deleteFolder"), t("deleteFolderBody"), t("delete"));
                  if (confirmed) await deleteFolder(folder.id);
                }
              })
            ])
        })
      ])
    );
    const list = el("div", { class: "list" });
    if (inFolder.length === 0) list.append(el("div", { class: "empty", text: t("emptyFolder") }));
    for (const feed of inFolder) list.append(feedRow(feed));
    container.append(list);
  }

  const loose = all.filter((feed) => !feed.folder_id);
  if (loose.length > 0) {
    if (foldersSorted().length > 0) container.append(el("h2", { text: t("ungrouped"), style: "margin-top:6px" }));
    const list = el("div", { class: "list" });
    for (const feed of loose) list.append(feedRow(feed));
    container.append(list);
  }

  const fileInput = el("input", { type: "file", accept: ".opml,.xml,text/xml", style: "display:none", onchange: handleImport });
  container.append(
    el("div", { class: "card" }, [
      el("h2", { text: t("organise") }),
      el("button", {
        class: "btn block",
        type: "button",
        text: t("newFolder"),
        onclick: () => {
          let name = "";
          openSheet((close) => [
            el("h2", { text: t("newFolder") }),
            el("input", { type: "text", placeholder: t("folderNamePlaceholder"), oninput: (event) => (name = event.target.value) }),
            el("button", {
              class: "btn primary block",
              type: "button",
              text: t("create"),
              onclick: async () => {
                if (!name.trim()) return toast(t("nameRequired"));
                await createFolder(name.trim());
                close();
              }
            })
          ]);
        }
      }),
      el("div", { class: "row" }, [
        el("button", { class: "btn grow", type: "button", text: t("importOpml"), onclick: () => fileInput.click() }),
        el("button", { class: "btn grow", type: "button", text: t("exportOpml"), onclick: exportOpml })
      ]),
      fileInput
    ])
  );
}
