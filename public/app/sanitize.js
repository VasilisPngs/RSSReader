const ALLOWED_ELEMENTS = new Set([
  "A", "ABBR", "AUDIO", "B", "BLOCKQUOTE", "BR", "CAPTION", "CITE", "CODE", "DD", "DIV", "DL", "DT", "EM",
  "FIGCAPTION", "FIGURE", "H1", "H2", "H3", "H4", "H5", "H6", "HR", "I", "IFRAME", "IMG", "LI", "MARK", "OL",
  "P", "PICTURE", "PRE", "Q", "S", "SMALL", "SOURCE", "SPAN", "STRONG", "SUB", "SUP", "TABLE", "TBODY", "TD",
  "TFOOT", "TH", "THEAD", "TR", "U", "UL", "VIDEO"
]);

const DROPPED_ELEMENTS = new Set(["SCRIPT", "STYLE", "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON", "SVG", "LINK", "META", "NOSCRIPT"]);

const ALLOWED_ATTRIBUTES = {
  A: ["href", "title"],
  IMG: ["src", "alt", "title"],
  VIDEO: ["src", "poster", "width", "height"],
  AUDIO: ["src"],
  SOURCE: ["src", "type"],
  IFRAME: ["src", "title", "width", "height"],
  TD: ["colspan", "rowspan"],
  TH: ["colspan", "rowspan"]
};

const EMBED_HOSTS = new Set([
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
  "player.vimeo.com",
  "w.soundcloud.com",
  "open.spotify.com",
  "www.dailymotion.com",
  "geo.dailymotion.com"
]);

const LAZY_ATTRIBUTES = ["data-src", "data-lazy-src", "data-original", "data-srcset", "srcset"];

function safeUrl(value, allowProtocolRelative) {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^https:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) return trimmed;
  if (allowProtocolRelative && trimmed.startsWith("//")) return `https:${trimmed}`;
  return null;
}

function firstFromSrcset(value) {
  if (!value) return null;
  const candidate = value.split(",")[0];
  return candidate ? candidate.trim().split(/\s+/)[0] : null;
}

function resolveMediaSource(node) {
  const direct = safeUrl(node.getAttribute("src"), true);
  if (direct) return direct;
  for (const name of LAZY_ATTRIBUTES) {
    const raw = node.getAttribute(name);
    if (!raw) continue;
    const value = name.includes("srcset") ? firstFromSrcset(raw) : raw;
    const resolved = safeUrl(value, true);
    if (resolved) return resolved;
  }
  return null;
}

function stripAttributes(node, allowed) {
  for (const attribute of [...node.attributes]) {
    if (!allowed.includes(attribute.name.toLowerCase())) node.removeAttribute(attribute.name);
  }
}

function scrub(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType !== Node.ELEMENT_NODE) {
      child.remove();
      continue;
    }
    const tag = child.tagName;
    if (DROPPED_ELEMENTS.has(tag)) {
      child.remove();
      continue;
    }
    if (!ALLOWED_ELEMENTS.has(tag)) {
      scrub(child);
      child.replaceWith(...child.childNodes);
      continue;
    }

    if (tag === "IMG" || tag === "VIDEO" || tag === "AUDIO" || tag === "SOURCE") {
      const source = resolveMediaSource(child);
      const poster = tag === "VIDEO" ? safeUrl(child.getAttribute("poster"), true) : null;
      if (!source && !(tag === "VIDEO" && child.querySelector("source"))) {
        child.remove();
        continue;
      }
      stripAttributes(child, ALLOWED_ATTRIBUTES[tag]);
      if (source) child.setAttribute("src", source);
      else child.removeAttribute("src");
      if (poster) child.setAttribute("poster", poster);
      if (tag === "IMG") {
        child.setAttribute("loading", "lazy");
        child.setAttribute("referrerpolicy", "no-referrer");
        child.setAttribute("decoding", "async");
      }
      if (tag === "VIDEO" || tag === "AUDIO") {
        child.setAttribute("controls", "");
        child.setAttribute("preload", "none");
      }
      scrub(child);
      continue;
    }

    if (tag === "IFRAME") {
      const source = safeUrl(child.getAttribute("src"), true);
      let host = null;
      try {
        host = source ? new URL(source).hostname : null;
      } catch {}
      if (!host || !EMBED_HOSTS.has(host)) {
        child.remove();
        continue;
      }
      stripAttributes(child, ALLOWED_ATTRIBUTES.IFRAME);
      child.setAttribute("src", source);
      child.setAttribute("loading", "lazy");
      child.setAttribute("referrerpolicy", "no-referrer");
      child.setAttribute("allowfullscreen", "");
      continue;
    }

    stripAttributes(child, ALLOWED_ATTRIBUTES[tag] || []);
    if (tag === "A") {
      const href = safeUrl(child.getAttribute("href"), true);
      if (!href) child.removeAttribute("href");
      else child.setAttribute("href", href);
      child.setAttribute("target", "_blank");
      child.setAttribute("rel", "noopener noreferrer nofollow");
    }
    scrub(child);
  }
}

export function sanitizeHtml(html) {
  const fragment = document.createElement("div");
  if (!html) return fragment;
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  scrub(parsed.body);
  fragment.append(...parsed.body.childNodes);
  return fragment;
}
