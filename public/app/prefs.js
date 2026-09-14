const STORAGE_KEY = "rssreader.card_image";
const SIZES = ["small", "large", "none"];

export const prefsEvents = new EventTarget();

function detect() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (SIZES.includes(stored)) return stored;
  } catch {}
  return "small";
}

let current = detect();

export const cardImage = () => current;
export const cardImages = () => [...SIZES];

export function setCardImage(next) {
  if (!SIZES.includes(next) || next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {}
  prefsEvents.dispatchEvent(new CustomEvent("changed"));
}
