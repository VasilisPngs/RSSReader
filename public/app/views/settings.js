import { el, formatTimestamp, plural, toast } from "../dom.js";
import { readAll, TABLE_NAMES } from "../db.js";
import { RETENTION_DAYS, feedsSorted, unreadTotal, starredCount, lastSyncedAt } from "../store.js";
import { getSyncState, requestSync } from "../sync.js";

const SHORTCUTS = [
  ["j / ↓", "next article"],
  ["k / ↑", "previous article"],
  ["Enter / o", "open selected"],
  ["m", "toggle read"],
  ["s", "toggle star"],
  ["r", "refresh feeds"],
  ["/", "focus search"],
  ["Esc", "back to list"]
];

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
  toast("Backup exported");
}

export function renderSettings(container) {
  const state = getSyncState();
  const storage = el("div", { class: "tiny", text: "Measuring storage…" });

  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then((estimate) => {
      const used = Math.round((estimate.usage || 0) / 1048576);
      storage.textContent = `${used} MB cached on this device`;
    });
  } else {
    storage.textContent = "Storage estimate unavailable";
  }

  container.append(el("h1", { text: "Settings" }));

  const syncCard = el("div", { class: "card" }, [
    el("h2", { text: "Sync" }),
    el("div", { class: "tiny", text: `Status: ${state.status}${state.pending ? ` · ${plural(state.pending, "change")} queued` : ""}` }),
    el("div", { class: "tiny", id: "last-sync", text: "Last sync: unknown" }),
    storage,
    el("button", { class: "btn block", type: "button", text: "Sync now", onclick: () => requestSync() })
  ]);
  container.append(syncCard);
  lastSyncedAt().then((value) => {
    const node = syncCard.querySelector("#last-sync");
    if (node) node.textContent = value ? `Last sync: ${formatTimestamp(value, true)}` : "Last sync: never";
  });

  container.append(
    el("div", { class: "card" }, [
      el("h2", { text: "Library" }),
      el("div", { class: "tiny", text: `${plural(feedsSorted().length, "feed")} · ${unreadTotal()} unread · ${starredCount()} starred` }),
      el("div", {
        class: "tiny",
        text: `Articles older than ${RETENTION_DAYS} days are removed automatically unless starred.`
      }),
      el("button", { class: "btn block", type: "button", text: "Export backup (JSON)", onclick: exportBackup })
    ])
  );

  container.append(
    el("div", { class: "card" }, [
      el("h2", { text: "Keyboard" }),
      ...SHORTCUTS.map(([keys, description]) =>
        el("div", { class: "row between tiny" }, [el("kbd", { text: keys }), el("span", { text: description })])
      )
    ])
  );

  container.append(
    el("div", { class: "card" }, [
      el("h2", { text: "How fetching works" }),
      el("div", {
        class: "tiny",
        text: "A cron trigger runs every minute and refreshes the few feeds that are due, using ETag and If-Modified-Since so unchanged feeds cost nothing. Feeds that publish often are checked more frequently; quiet or broken ones back off automatically."
      })
    ])
  );
}
