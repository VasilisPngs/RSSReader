const ROUTES = [
  { pattern: /^\/$/, name: "articles", params: () => ({ scope: "unread" }) },
  { pattern: /^\/all$/, name: "articles", params: () => ({ scope: "all" }) },
  { pattern: /^\/starred$/, name: "articles", params: () => ({ scope: "starred" }) },
  { pattern: /^\/feed\/([\w-]+)$/, name: "articles", params: (match) => ({ scope: "feed", id: match[1] }) },
  { pattern: /^\/folder\/([\w-]+)$/, name: "articles", params: (match) => ({ scope: "folder", id: match[1] }) },
  { pattern: /^\/article\/([\w-]+)$/, name: "article", params: (match) => ({ id: match[1] }) },
  { pattern: /^\/feeds$/, name: "feeds", params: () => ({}) },
  { pattern: /^\/settings$/, name: "settings", params: () => ({}) }
];

let renderer = null;

export function currentRoute() {
  const path = location.pathname;
  for (const route of ROUTES) {
    const match = path.match(route.pattern);
    if (match) return { name: route.name, params: route.params(match), path };
  }
  return { name: "articles", params: { scope: "unread" }, path: "/" };
}

export function navigate(path, replace = false) {
  if (path === location.pathname) {
    if (renderer) renderer();
    return;
  }
  if (replace) history.replaceState({}, "", path);
  else history.pushState({}, "", path);
  if (renderer) renderer();
}

export function back(fallback = "/") {
  if (history.length > 1) history.back();
  else navigate(fallback, true);
}

export function startRouter(fn) {
  renderer = fn;
  addEventListener("popstate", () => renderer());
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-link]");
    if (!link) return;
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const href = link.getAttribute("href");
    if (!href || !href.startsWith("/")) return;
    event.preventDefault();
    navigate(href);
  });
  renderer();
}
