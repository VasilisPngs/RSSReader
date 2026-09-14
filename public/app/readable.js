const DROP_SELECTOR =
  "script,style,noscript,svg,form,button,select,textarea,input,nav,aside,footer,header,ins,template,dialog,label,link,meta,object,embed,noembed";

const JUNK =
  /(share|social|related|recommend|read-?more|more-?from|comment|disqus|newsletter|subscribe|sign-?up|promo|advert|sponsor|banner|breadcrumb|pagination|tag-?list|author-?box|sidebar|widget|cookie|consent|paywall|toolbar|popup|modal|overlay|lightbox|outbrain|taboola|byline|skip-?link)/i;

const EMBED = /(twitter-tweet|instagram-media|tiktok-embed|fb-post|reddit-embed|bluesky-embed)/i;

const WIDGET_ATTRIBUTES = ["x-data", "x-show", "x-init", "wire:id", "wire:model", "onclick", "v-if", "v-for", "data-controller"];

const PLACEHOLDER = /^data:image\/(gif|png|svg\+xml);/i;

const BLOCKS = new Set([
  "P",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "FIGURE",
  "IMG",
  "PICTURE",
  "VIDEO",
  "AUDIO",
  "IFRAME",
  "BLOCKQUOTE",
  "PRE",
  "TABLE",
  "UL",
  "OL",
  "DL",
  "HR"
]);

const URL_ATTRIBUTES = ["src", "href", "poster"];

function marker(node) {
  return `${node.className && typeof node.className === "string" ? node.className : ""} ${node.id || ""}`;
}

function hasWidgetAttribute(node) {
  for (const name of WIDGET_ATTRIBUTES) if (node.hasAttribute(name)) return true;
  for (const attribute of node.attributes) {
    if (attribute.name.startsWith("x-on:") || attribute.name.startsWith("@") || attribute.name.startsWith("wire:")) return true;
  }
  return false;
}

function carriesArticle(node) {
  return node.querySelectorAll("p").length >= 2 && node.textContent.trim().length >= 400;
}

function isJunk(node) {
  const value = marker(node);
  if (EMBED.test(value)) return false;
  if (JUNK.test(value)) return true;
  return hasWidgetAttribute(node) && !carriesArticle(node);
}

function isCardGroup(node) {
  const links = node.querySelectorAll("a").length;
  return links >= 2 && linkDensity(node) > 0.5;
}

function isDecorative(node) {
  if (node.tagName !== "IMG") return false;
  const src = node.getAttribute("src") || "";
  if (!node.getAttribute("srcset") && PLACEHOLDER.test(src) && src.length < 400) return true;
  const width = Number(node.getAttribute("width") || 0);
  const height = Number(node.getAttribute("height") || 0);
  return (width > 0 && width <= 64) || (height > 0 && height <= 64);
}

function linkDensity(node) {
  const text = node.textContent.trim().length;
  if (text === 0) return 1;
  let links = 0;
  for (const anchor of node.querySelectorAll("a")) links += anchor.textContent.trim().length;
  return links / text;
}

function candidates(doc) {
  const found = [];
  const explicit = doc.querySelectorAll('[itemprop="articleBody"], article, main');
  for (const node of explicit) found.push(node);
  for (const node of doc.querySelectorAll("div, section, td")) {
    let paragraphs = 0;
    for (const child of node.children) if (child.tagName === "P") paragraphs += 1;
    if (paragraphs >= 2) found.push(node);
  }
  return found;
}

function score(node) {
  const text = node.textContent.replace(/\s+/g, " ").trim();
  if (text.length < 240) return 0;
  if (node.querySelectorAll("p").length < 2) return 0;
  const density = linkDensity(node);
  if (density > 0.5) return 0;
  return text.length * (1 - density);
}

function depthOf(node) {
  let depth = 0;
  let cursor = node;
  while (cursor.parentElement) {
    depth += 1;
    cursor = cursor.parentElement;
  }
  return depth;
}

function pickContainer(doc) {
  let best = null;
  let bestScore = 0;
  for (const node of candidates(doc)) {
    const value = score(node);
    if (value === 0) continue;
    if (value > bestScore * 1.05 || (value > bestScore * 0.95 && best && depthOf(node) > depthOf(best))) {
      if (value > bestScore) bestScore = value;
      best = node;
    }
  }
  return best;
}

function absolutize(node, baseUrl) {
  const resolve = (value) => {
    try {
      return new URL(value, baseUrl).toString();
    } catch {
      return value;
    }
  };
  const fix = (element) => {
    for (const name of URL_ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (value && !/^(https?:|data:|mailto:|tel:|#)/i.test(value.trim())) element.setAttribute(name, resolve(value.trim()));
    }
    const lazy = element.getAttribute("data-src") || element.getAttribute("data-lazy-src");
    if (lazy && !element.getAttribute("src")) element.setAttribute("src", resolve(lazy.trim()));
    const srcset = element.getAttribute("srcset") || element.getAttribute("data-srcset");
    if (srcset) {
      element.setAttribute(
        "srcset",
        srcset
          .split(",")
          .map((part) => {
            const [url, ...rest] = part.trim().split(/\s+/);
            if (!url) return "";
            return [/^(https?:|data:)/i.test(url) ? url : resolve(url), ...rest].join(" ");
          })
          .filter(Boolean)
          .join(", ")
      );
    }
  };
  if (node.hasAttribute) fix(node);
  for (const element of node.querySelectorAll("[src], [href], [poster], [srcset], [data-src], [data-srcset], [data-lazy-src]")) fix(element);
}

function keeps(node) {
  if (!BLOCKS.has(node.tagName)) return false;
  if (isJunk(node)) return false;
  if (node.closest("a")) return false;
  if (isDecorative(node)) return false;
  if ((node.tagName === "UL" || node.tagName === "OL" || node.tagName === "P") && linkDensity(node) > 0.5) return false;
  if (node.tagName === "IMG" || node.tagName === "IFRAME" || node.tagName === "VIDEO" || node.tagName === "AUDIO" || node.tagName === "HR") return true;
  if (node.querySelector("img, picture, video, audio, iframe")) return true;
  return node.textContent.trim().length > 0;
}

function collect(container, output) {
  for (const node of container.children) {
    if (isJunk(node)) continue;
    if (keeps(node)) {
      output.append(node.cloneNode(true));
      continue;
    }
    if (!BLOCKS.has(node.tagName) && !carriesArticle(node) && isCardGroup(node)) continue;
    collect(node, output);
  }
}

function trim(output) {
  for (const image of output.querySelectorAll("img")) if (isDecorative(image)) image.remove();
  for (const node of output.querySelectorAll("p, div, span")) {
    if (node.children.length === 0 && node.textContent.trim().length === 0) node.remove();
  }
  let last = output.lastElementChild;
  while (last && (/^H[1-6]$/.test(last.tagName) || last.textContent.trim().length === 0)) {
    last.remove();
    last = output.lastElementChild;
  }
}

export function extractReadable(html, baseUrl) {
  if (!html) return "";
  let doc;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return "";
  }
  for (const node of doc.querySelectorAll(DROP_SELECTOR)) node.remove();
  const container = pickContainer(doc);
  if (!container) return "";
  const output = doc.createElement("div");
  collect(container, output);
  trim(output);
  if (output.childElementCount === 0) return "";
  absolutize(output, baseUrl);
  const text = output.textContent.replace(/\s+/g, " ").trim();
  if (text.length < 200) return "";
  return output.innerHTML;
}
