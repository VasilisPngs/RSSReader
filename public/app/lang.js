const LANGUAGE_SEGMENT = /^[a-z]{2}(?:-[a-z]{2})?$/i;

export function pathLanguage(url) {
  if (!url) return null;
  try {
    const [first] = new URL(url).pathname.split("/").filter(Boolean);
    return first && LANGUAGE_SEGMENT.test(first) ? first.slice(0, 2).toLowerCase() : null;
  } catch {
    return null;
  }
}

export function keepFeedLanguage(items, feedLanguage) {
  if (items.length === 0) return items;
  const languages = items.map((item) => pathLanguage(item.url));
  const translated = languages.some((value) => value !== null);
  if (!translated) return items;
  if (languages.includes(null)) return items.filter((item, index) => languages[index] === null);
  const base = (feedLanguage || "").slice(0, 2).toLowerCase();
  if (!base || !languages.includes(base)) return items;
  return items.filter((item, index) => languages[index] === base);
}

export function keepDefaultLanguage(articles) {
  const languages = articles.map((article) => pathLanguage(article.url));
  const untranslated = new Set();
  for (let index = 0; index < articles.length; index += 1) {
    if (languages[index] === null) untranslated.add(articles[index].feed_id);
  }
  if (untranslated.size === 0) return articles;
  return articles.filter((article, index) => languages[index] === null || !untranslated.has(article.feed_id));
}
