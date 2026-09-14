import { el, formatTimestamp, plural, toast } from "../dom.js";
import { readAll, TABLE_NAMES } from "../db.js";
import { RETENTION_DAYS, feedsSorted, unreadTotal, starredCount, lastSyncedAt } from "../store.js";
import { getSyncState, requestSync } from "../sync.js";
import { t, language, languages, setLanguage } from "../i18n.js";
import { themeMode, themeModes, setTheme } from "../theme.js";
import { cardImage, cardImages, setCardImage } from "../prefs.js";

async function exportBackup() {
  const data = {};
  for (const table of TABLE_NAMES) data[table] = await readAll(table);
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), data }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = el("a", { href: url, download: `rssreader-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(t("backupExported"));
}

export function renderSettings(container) {
  const state = getSyncState();
  const storage = el("div", { class: "tiny", text: t("measuringStorage") });

  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then((estimate) => {
      const used = Math.round((estimate.usage || 0) / 1048576);
      storage.textContent = t("storageUsed", { size: used });
    });
  } else {
    storage.textContent = t("storageUnavailable");
  }

  container.append(el("h1", { text: t("settingsTitle") }));

  const syncCard = el("div", { class: "card" }, [
    el("h2", { text: t("sync") }),
    el("div", {
      class: "tiny",
      text: `${t("syncStatus", { status: t(`status${state.status[0].toUpperCase()}${state.status.slice(1)}`) })}${
        state.pending ? ` · ${t("queuedChanges", { count: plural(state.pending, "change") })}` : ""
      }`
    }),
    el("div", { class: "tiny", id: "last-sync", text: t("lastSync", { value: t("unknown") }) }),
    storage,
    el("label", { class: "tiny", text: t("theme") }),
    el(
      "select",
      {
        onchange: (event) => {
          const next = event.target.value;
          event.target.blur();
          setTheme(next);
        }
      },
      themeModes().map((mode) =>
        el("option", {
          value: mode,
          text: t(`theme${mode[0].toUpperCase()}${mode.slice(1)}`),
          selected: mode === themeMode()
        })
      )
    ),
    el("label", { class: "tiny", text: t("cardImage") }),
    el(
      "select",
      {
        onchange: (event) => {
          const next = event.target.value;
          event.target.blur();
          setCardImage(next);
        }
      },
      cardImages().map((size) =>
        el("option", {
          value: size,
          text: t(`image${size[0].toUpperCase()}${size.slice(1)}`),
          selected: size === cardImage()
        })
      )
    ),
    el("label", { class: "tiny", text: t("language") }),
    el(
      "select",
      {
        onchange: (event) => {
          const next = event.target.value;
          event.target.blur();
          setLanguage(next);
        }
      },
      languages().map((code) => el("option", { value: code, text: code === "el" ? "Ελληνικά" : "English", selected: code === language() }))
    ),
    el("button", { class: "btn block", type: "button", text: t("syncNow"), onclick: () => requestSync() })
  ]);
  container.append(syncCard);
  lastSyncedAt().then((value) => {
    const node = syncCard.querySelector("#last-sync");
    if (node) node.textContent = t("lastSync", { value: value ? formatTimestamp(value, true) : t("never") });
  });

  container.append(
    el("div", { class: "card" }, [
      el("h2", { text: t("library") }),
      el("div", {
        class: "tiny",
        text: t("librarySummary", { feeds: plural(feedsSorted().length, "feed"), unread: unreadTotal(), starred: starredCount() })
      }),
      el("div", {
        class: "tiny",
        text: t("retentionNote", { days: RETENTION_DAYS })
      }),
      el("button", { class: "btn block", type: "button", text: t("exportBackup"), onclick: exportBackup })
    ])
  );
}
