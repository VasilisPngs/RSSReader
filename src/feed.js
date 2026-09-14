const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "-",
  mdash: "—",
  hellip: "…",
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"'
};

const MAX_CONTENT = 48000;
const MAX_SUMMARY = 400;

export function decodeText(input) {
  if (!input) return "";
  let value = input;
  if (value.includes("<![CDATA[")) value = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  if (value.includes("&")) {
    value = value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, code) => {
      if (code.charCodeAt(0) === 35) {
        const point = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
      }
      const named = NAMED_ENTITIES[code];
      return named === undefined ? match : named;
    });
  }
  return value.trim();
}

function unwrapCdata(input) {
  return input.includes("<![CDATA[") ? input.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1") : input;
}

function removeTags(input) {
  return input.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ");
}

export function textOf(input) {
  if (!input) return "";
  return decodeText(removeTags(unwrapCdata(input))).replace(/\s+/g, " ").trim();
}

export function plainText(input) {
  if (!input) return "";
  return removeTags(decodeText(unwrapCdata(input))).replace(/\s+/g, " ").trim();
}

export function stripUnsafe(input) {
  if (!input) return "";
  return input
    .replace(/<(script|style|object|embed)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|object|embed)\b[^>]*\/?>/gi, "");
}

function findTag(source, name, from = 0) {
  const open = `<${name}`;
  let cursor = from;
  while (cursor < source.length) {
    const start = source.indexOf(open, cursor);
    if (start === -1) return null;
    const after = source.charCodeAt(start + open.length);
    if (after !== 62 && after !== 32 && after !== 9 && after !== 10 && after !== 13 && after !== 47) {
      cursor = start + open.length;
      continue;
    }
    const headEnd = source.indexOf(">", start);
    if (headEnd === -1) return null;
    if (source.charCodeAt(headEnd - 1) === 47) {
      return { start, end: headEnd + 1, head: source.slice(start, headEnd), inner: "" };
    }
    const close = source.indexOf(`</${name}`, headEnd);
    if (close === -1) return { start, end: headEnd + 1, head: source.slice(start, headEnd), inner: "" };
    const closeEnd = source.indexOf(">", close);
    return {
      start,
      end: closeEnd === -1 ? close : closeEnd + 1,
      head: source.slice(start, headEnd),
      inner: source.slice(headEnd + 1, close)
    };
  }
  return null;
}

function tagText(source, names) {
  for (const name of names) {
    const tag = findTag(source, name);
    if (tag && tag.inner.trim()) return tag.inner;
  }
  return "";
}

function attribute(head, name) {
  const match = head.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`));
  if (!match) return "";
  return decodeText(match[2] !== undefined ? match[2] : match[3]);
}

function linkOf(block) {
  let cursor = 0;
  let fallback = "";
  while (cursor < block.length) {
    const tag = findTag(block, "link", cursor);
    if (!tag) break;
    cursor = tag.end;
    const inner = tag.inner.trim();
    if (inner && !inner.startsWith("<")) return decodeText(inner);
    const rel = attribute(tag.head, "rel");
    const href = attribute(tag.head, "href");
    if (!href) continue;
    if (rel === "" || rel === "alternate") return href;
    if (!fallback && rel !== "self" && rel !== "hub") fallback = href;
  }
  return fallback;
}

function timestampOf(block, fallback) {
  const raw = textOf(tagText(block, ["published", "pubDate", "updated", "dc:date", "date"]));
  if (raw) {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function collectBlocks(source, name, limit) {
  const blocks = [];
  let cursor = 0;
  while (blocks.length < limit) {
    const tag = findTag(source, name, cursor);
    if (!tag) break;
    blocks.push(tag);
    cursor = tag.end;
  }
  return blocks;
}

export function parseFeed(xml, options = {}) {
  const limit = options.limit || 40;
  const fetchedAt = options.fetchedAt || Date.now();
  const itemName = xml.indexOf("<item") !== -1 ? "item" : "entry";
  const blocks = collectBlocks(xml, itemName, limit);
  const headerEnd = blocks.length > 0 ? blocks[0].start : Math.min(xml.length, 4000);
  const header = xml.slice(0, headerEnd);

  const items = [];
  for (const block of blocks) {
    const body = block.inner;
    const title = textOf(tagText(body, ["title"]));
    const url = linkOf(body);
    const guid = textOf(tagText(body, ["guid", "id"])) || url || title;
    if (!guid) continue;
    const rawSummary = tagText(body, ["description", "summary"]);
    const rawContent = tagText(body, ["content:encoded", "content", "description", "summary"]);
    const content = stripUnsafe(decodeText(rawContent)).slice(0, MAX_CONTENT);
    items.push({
      guid,
      url: url || null,
      title: title || "(untitled)",
      author: textOf(tagText(body, ["dc:creator", "author"])).slice(0, 120) || null,
      summary: plainText(rawSummary || rawContent).slice(0, MAX_SUMMARY) || null,
      content: content || null,
      published_at: timestampOf(body, fetchedAt),
      image_url: imageOf(body, content)
    });
  }

  return {
    title: textOf(tagText(header, ["title"])),
    siteUrl: linkOf(header) || null,
    items
  };
}

const MEDIA_TAGS = /<(media:thumbnail|media:content|enclosure)\b[^>]*>/gi;

export function imageOf(block, html) {
  MEDIA_TAGS.lastIndex = 0;
  let match;
  while ((match = MEDIA_TAGS.exec(block)) !== null) {
    const head = match[0];
    const url = attribute(head, "url");
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const type = attribute(head, "type").toLowerCase();
    const medium = attribute(head, "medium").toLowerCase();
    if (match[1].toLowerCase() === "enclosure" && !type.startsWith("image")) continue;
    if (medium && medium !== "image") continue;
    if (type && !type.startsWith("image")) continue;
    return url;
  }
  if (html) {
    const inline = html.match(/<img\b[^>]*?\bsrc\s*=\s*("([^"]+)"|'([^']+)')/i);
    if (inline) {
      const src = decodeText(inline[2] !== undefined ? inline[2] : inline[3]);
      if (/^https?:\/\//i.test(src)) return src;
    }
  }
  return null;
}

export function discoverFeedUrl(html, baseUrl) {
  const pattern = /<link\b[^>]*>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const head = match[0];
    const rel = attribute(head, "rel").toLowerCase();
    const type = attribute(head, "type").toLowerCase();
    if (!rel.includes("alternate")) continue;
    if (!type.includes("rss") && !type.includes("atom") && !type.includes("xml")) continue;
    const href = attribute(head, "href");
    if (href) return new URL(href, baseUrl).toString();
  }
  return null;
}

export function looksLikeFeed(body) {
  const head = body.slice(0, 1500);
  return head.includes("<rss") || head.includes("<feed") || head.includes("<rdf:RDF") || head.includes("<channel");
}
