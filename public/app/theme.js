const STORAGE_KEY = "rssreader.theme";
const MODES = ["system", "light", "dark", "black"];
const COLORS = { light: "#f4f5f8", dark: "#0c0d10", black: "#000000" };

export const themeEvents = new EventTarget();

const query = matchMedia("(prefers-color-scheme: light)");

function detect() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (MODES.includes(stored)) return stored;
  } catch {}
  return "system";
}

let current = detect();

export const themeMode = () => current;
export const themeModes = () => [...MODES];
export const resolvedTheme = () => (current === "system" ? (query.matches ? "light" : "dark") : current);

export function applyTheme() {
  const root = document.documentElement;
  if (current === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = current;
  for (const stale of document.head.querySelectorAll('meta[name="theme-color"][media]')) stale.remove();
  let meta = document.head.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
  }
  meta.content = COLORS[resolvedTheme()];
}

export function setTheme(next) {
  if (!MODES.includes(next) || next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {}
  applyTheme();
  themeEvents.dispatchEvent(new CustomEvent("changed"));
}

query.addEventListener("change", () => {
  if (current === "system") applyTheme();
});
