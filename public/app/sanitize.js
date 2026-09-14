import { resolvedTheme } from "./theme.js";

const ALLOWED_ELEMENTS = new Set([
  "A", "ABBR", "AUDIO", "B", "BLOCKQUOTE", "BR", "CAPTION", "CITE", "CODE", "DD", "DIV", "DL", "DT", "EM",
  "FIGCAPTION", "FIGURE", "H1", "H2", "H3", "H4", "H5", "H6", "HR", "I", "IFRAME", "IMG", "LI", "MARK", "OL",
  "P", "PICTURE", "PRE", "Q", "S", "SMALL", "SOURCE", "SPAN", "STRONG", "SUB", "SUP", "TABLE", "TBODY", "TD",
  "TFOOT", "TH", "THEAD", "TR", "TRACK", "U", "UL", "VIDEO"
]);

const DROPPED_ELEMENTS = new Set(["SCRIPT", "STYLE", "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON", "SVG", "LINK", "META", "NOSCRIPT"]);

const ALLOWED_ATTRIBUTES = {
  A: ["href", "title"],
  IMG: ["src", "srcset", "sizes", "alt", "title", "width", "height"],
  IFRAME: ["src", "title", "width", "height"],
  VIDEO: ["src", "poster", "controls", "autoplay", "loop", "muted", "playsinline", "preload", "width", "height"],
  AUDIO: ["src", "controls", "autoplay", "loop", "preload"],
  SOURCE: ["src", "srcset", "type", "media", "sizes"],
  TRACK: ["src", "kind", "srclang", "label", "default"],
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
  "geo.dailymotion.com",
  "platform.twitter.com",
  "platform.x.com",
  "www.instagram.com",
  "instagram.com",
  "www.facebook.com",
  "web.facebook.com"
]);

const CARD_HOSTS = new Set(["platform.twitter.com", "platform.x.com", "www.instagram.com", "instagram.com", "www.facebook.com", "web.facebook.com"]);
const MEASURE_ORIGINS = new Set(["https://platform.twitter.com", "https://platform.x.com", "https://www.instagram.com", "https://instagram.com"]);
const TWEET_LINK = /^https:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/[^/]+\/status(?:es)?\/(\d+)/i;
const INSTAGRAM_LINK = /^https:\/\/(?:www\.)?instagram\.com\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i;
const FACEBOOK_LINK = /^https:\/\/(?:www\.|web\.|m\.)?facebook\.com\/[^\s"']+$/i;
const LAZY_ATTRIBUTES = ["data-src", "data-lazy-src", "data-original", "data-srcset", "srcset"];

function safeUrl(value, allowProtocolRelative) {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^https:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) return trimmed;
  if (allowProtocolRelative && trimmed.startsWith("//")) return `https:${trimmed}`;
  return null;
}

function safeSrcset(value) {
  if (!value) return null;
  const candidates = [];
  for (const entry of value.split(",")) {
    const parts = entry.trim().split(/\s+/);
    const url = safeUrl(parts[0], true);
    if (url) candidates.push([url, ...parts.slice(1)].join(" "));
  }
  return candidates.length > 0 ? candidates.join(", ") : null;
}

function firstFromSrcset(value) {
  const safe = safeSrcset(value);
  return safe ? safe.split(",")[0].trim().split(/\s+/)[0] : null;
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

function linkIn(node, pattern, attributes) {
  for (const name of attributes) {
    const value = node.getAttribute(name);
    const direct = value ? pattern.exec(value.trim()) : null;
    if (direct) return direct;
  }
  for (const anchor of node.querySelectorAll("a[href]")) {
    const match = pattern.exec(anchor.getAttribute("href").trim());
    if (match) return match;
  }
  return null;
}

function socialEmbed(node) {
  const name = typeof node.className === "string" ? node.className : "";
  if (/twitter-tweet|twitter-video/i.test(name)) {
    const match = linkIn(node, TWEET_LINK, []);
    if (match) return { title: "X", src: `https://platform.twitter.com/embed/Tweet.html?id=${match[1]}&dnt=true&theme=${resolvedTheme()}` };
  }
  if (/instagram-media/i.test(name)) {
    const match = linkIn(node, INSTAGRAM_LINK, ["data-instgrm-permalink"]);
    if (match) {
      const kind = match[1].toLowerCase() === "reels" ? "reel" : match[1].toLowerCase();
      return { title: "Instagram", src: `https://www.instagram.com/${kind}/${match[2]}/embed/` };
    }
  }
  if (/fb-post|fb-video/i.test(name)) {
    const match = linkIn(node, FACEBOOK_LINK, ["data-href"]);
    if (match) {
      const plugin = /fb-video/i.test(name) ? "video" : "post";
      return {
        title: "Facebook",
        src: `https://www.facebook.com/plugins/${plugin}.php?href=${encodeURIComponent(match[0])}&show_text=${plugin === "post"}&width=500`
      };
    }
  }
  return null;
}

function cardFrame(owner, embed) {
  const frame = owner.createElement("iframe");
  frame.className = "social-embed";
  frame.setAttribute("src", embed.src);
  frame.setAttribute("title", embed.title);
  frame.setAttribute("loading", "lazy");
  frame.setAttribute("scrolling", "no");
  frame.setAttribute("allowfullscreen", "");
  return frame;
}

function markLive(node, source) {
  node.setAttribute("src", source);
  node.setAttribute("loading", "lazy");
  node.setAttribute("referrerpolicy", node.tagName === "IFRAME" ? "strict-origin-when-cross-origin" : "no-referrer");
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

    const embed = socialEmbed(child);
    if (embed) {
      child.replaceWith(cardFrame(child.ownerDocument, embed));
      continue;
    }

    if (!ALLOWED_ELEMENTS.has(tag)) {
      scrub(child);
      child.replaceWith(...child.childNodes);
      continue;
    }

    if (tag === "IMG") {
      const source = resolveMediaSource(child);
      if (!source) {
        child.remove();
        continue;
      }
      const responsive = safeSrcset(child.getAttribute("srcset") || child.getAttribute("data-srcset"));
      stripAttributes(child, ALLOWED_ATTRIBUTES.IMG);
      markLive(child, source);
      child.setAttribute("decoding", "async");
      if (responsive) child.setAttribute("srcset", responsive);
      else child.removeAttribute("srcset");
      continue;
    }

    if (tag === "VIDEO" || tag === "AUDIO") {
      const source = resolveMediaSource(child);
      const poster = tag === "VIDEO" ? safeUrl(child.getAttribute("poster"), true) : null;
      const silent = child.hasAttribute("autoplay");
      stripAttributes(child, ALLOWED_ATTRIBUTES[tag]);
      scrub(child);
      if (!source && !child.querySelector("source")) {
        child.remove();
        continue;
      }
      if (source) child.setAttribute("src", source);
      else child.removeAttribute("src");
      if (poster) child.setAttribute("poster", poster);
      else child.removeAttribute("poster");
      if (silent) child.setAttribute("muted", "");
      else child.setAttribute("controls", "");
      if (!child.hasAttribute("preload")) child.setAttribute("preload", "metadata");
      if (tag === "VIDEO") child.setAttribute("playsinline", "");
      continue;
    }

    if (tag === "SOURCE" || tag === "TRACK") {
      const inPicture = child.parentNode && child.parentNode.tagName === "PICTURE";
      const responsive = inPicture ? safeSrcset(child.getAttribute("srcset") || child.getAttribute("data-srcset")) : null;
      const source = responsive ? null : resolveMediaSource(child);
      stripAttributes(child, ALLOWED_ATTRIBUTES[tag]);
      if (!responsive && !source) {
        child.remove();
        continue;
      }
      if (responsive) {
        child.removeAttribute("src");
        child.setAttribute("srcset", responsive);
      } else {
        child.removeAttribute("srcset");
        child.setAttribute("src", source);
      }
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
      markLive(child, source);
      child.setAttribute("allowfullscreen", "");
      if (CARD_HOSTS.has(host)) {
        child.className = "social-embed";
        child.setAttribute("scrolling", "no");
      }
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

function measuredHeight(payload) {
  const tweet = payload && payload["twttr.embed"];
  if (tweet && tweet.method === "twttr.private.resize") {
    const size = tweet.params && tweet.params[0];
    return size && size.height ? size.height : null;
  }
  if (payload && payload.type === "MEASURE" && payload.details && payload.details.height) return payload.details.height;
  return null;
}

addEventListener("message", (event) => {
  if (!MEASURE_ORIGINS.has(event.origin)) return;
  let payload = event.data;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return;
    }
  }
  const height = measuredHeight(payload);
  if (!height) return;
  for (const frame of document.querySelectorAll("iframe.social-embed")) {
    if (frame.contentWindow === event.source) frame.style.height = `${height}px`;
  }
});

export function sanitizeHtml(html) {
  const fragment = document.createElement("div");
  if (!html) return fragment;
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  scrub(parsed.body);
  fragment.append(...parsed.body.childNodes);
  return fragment;
}
