const ALLOWED_ELEMENTS = new Set([
  "A", "ABBR", "B", "BLOCKQUOTE", "BR", "CAPTION", "CITE", "CODE", "DD", "DL", "DT", "EM", "FIGCAPTION",
  "FIGURE", "H1", "H2", "H3", "H4", "H5", "H6", "HR", "I", "IMG", "LI", "MARK", "OL", "P", "PRE", "Q",
  "S", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "U", "UL", "DIV"
]);

const DROPPED_ELEMENTS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON", "SVG", "LINK", "META", "NOSCRIPT"]);

const ALLOWED_ATTRIBUTES = {
  A: ["href", "title"],
  IMG: ["src", "alt", "title"],
  TD: ["colspan", "rowspan"],
  TH: ["colspan", "rowspan"]
};

function safeUrl(value, allowRelative) {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (allowRelative && /^\/\//.test(trimmed)) return `https:${trimmed}`;
  return null;
}

function scrub(node) {
  const children = [...node.childNodes];
  for (const child of children) {
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
    const allowed = ALLOWED_ATTRIBUTES[tag] || [];
    for (const attribute of [...child.attributes]) {
      if (!allowed.includes(attribute.name.toLowerCase())) child.removeAttribute(attribute.name);
    }
    if (tag === "A") {
      const href = safeUrl(child.getAttribute("href"), true);
      if (!href) child.removeAttribute("href");
      else child.setAttribute("href", href);
      child.setAttribute("target", "_blank");
      child.setAttribute("rel", "noopener noreferrer nofollow");
    }
    if (tag === "IMG") {
      const source = safeUrl(child.getAttribute("src"), true);
      if (!source) {
        child.remove();
        continue;
      }
      child.setAttribute("src", source);
      child.setAttribute("loading", "lazy");
      child.setAttribute("referrerpolicy", "no-referrer");
      child.setAttribute("decoding", "async");
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
