import { locale, t, tn } from "./i18n.js";

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false || child === "") continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function svg(tag, props = {}, children = []) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined) continue;
    node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
  return node;
}

const formatters = new Map();

function formatter(kind) {
  const key = `${locale()}:${kind}`;
  if (!formatters.has(key)) {
    const options = {
      time: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
      day: { day: "numeric", month: "short" },
      full: { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
    };
    formatters.set(
      key,
      kind === "relative"
        ? new Intl.RelativeTimeFormat(locale(), { numeric: "auto" })
        : new Intl.DateTimeFormat(locale(), options[kind])
    );
  }
  return formatters.get(key);
}

export function formatTimestamp(value, long = false) {
  if (!value) return "";
  const date = new Date(value);
  if (long) return formatter("full").format(date);
  const elapsed = Date.now() - value;
  if (elapsed < 60000) return formatter("relative").format(0, "minute");
  if (elapsed < 3600000) return formatter("relative").format(-Math.round(elapsed / 60000), "minute");
  if (elapsed < 86400000) return formatter("time").format(date);
  if (elapsed < 604800000) return formatter("relative").format(-Math.round(elapsed / 86400000), "day");
  return formatter("day").format(date);
}

export function plural(count, key) {
  return tn(count, key);
}

export function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function siteIconUrl(source) {
  try {
    return `${new URL(source).origin}/favicon.ico`;
  } catch {
    return null;
  }
}

export function siteIcon(source, label) {
  const initial = (label || "?").trim().charAt(0).toUpperCase() || "?";
  const fallback = () => el("span", { class: "site-icon fallback", text: initial });
  const url = siteIconUrl(source);
  if (!url) return fallback();
  const img = el("img", { class: "site-icon", src: url, alt: "", loading: "lazy", referrerPolicy: "no-referrer", decoding: "async" });
  img.addEventListener("error", () => img.replaceWith(fallback()), { once: true });
  return img;
}

export function toast(message) {
  const host = document.getElementById("toast-host");
  const node = el("div", { class: "toast", text: message });
  host.append(node);
  setTimeout(() => {
    node.style.opacity = "0";
    node.style.transition = "opacity .25s ease";
    setTimeout(() => node.remove(), 260);
  }, 2200);
}

export function openSheet(build, onClose) {
  const host = document.getElementById("sheet-host");
  const sheet = el("div", { class: "sheet" });
  const backdrop = el("div", { class: "sheet-backdrop" }, sheet);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.style.opacity = "0";
    backdrop.style.transition = "opacity .2s ease";
    setTimeout(() => backdrop.remove(), 200);
    document.removeEventListener("keydown", onKey);
    if (onClose) onClose();
  };
  const onKey = (event) => {
    if (event.key === "Escape") close();
  };
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey);
  append(sheet, build(close));
  host.append(backdrop);
  const focusable = sheet.querySelector("input, select, textarea, button");
  if (focusable && !matchMedia("(pointer: coarse)").matches) focusable.focus();
  return close;
}

export function confirmSheet(title, message, confirmLabel) {
  return new Promise((resolve) => {
    let answer = false;
    openSheet(
      (close) => [
        el("h2", { text: title }),
        el("p", { class: "muted", text: message }),
        el("div", { class: "row" }, [
          el("button", { class: "btn grow", type: "button", text: t("cancel"), onclick: close }),
          el("button", {
            class: "btn primary grow",
            type: "button",
            text: confirmLabel || t("delete"),
            onclick: () => {
              answer = true;
              close();
            }
          })
        ])
      ],
      () => resolve(answer)
    );
  });
}
