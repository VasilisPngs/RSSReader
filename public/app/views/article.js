import { el, formatTimestamp, hostnameOf, toast } from "../dom.js";
import { articleById, feedById, stateOf, setRead, toggleStar, loadFullArticle } from "../store.js";
import { sanitizeHtml } from "../sanitize.js";
import { navigate, back } from "../router.js";
import { queue } from "./articles.js";
import { t } from "../i18n.js";

export function siblings(articleId) {
  const { ids } = queue();
  const index = ids.indexOf(articleId);
  if (index === -1) return { previous: null, next: null };
  return {
    previous: index > 0 ? ids[index - 1] : null,
    next: index < ids.length - 1 ? ids[index + 1] : null
  };
}

const SUMMARY_LIMIT = 1200;

function needsFullText(article) {
  const content = article.content || "";
  if (!content) return true;
  const text = content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.length <= SUMMARY_LIMIT && text.length <= (article.summary || "").length + 40;
}

export function renderArticle(container, params) {
  const article = articleById(params.id);
  if (!article) {
    container.append(
      el("div", { class: "empty" }, [
        el("p", { text: t("articleNotFound") }),
        el("a", { class: "btn", href: "/", "data-link": "", text: t("backToList") })
      ])
    );
    return;
  }

  const state = stateOf(article.id);
  if (!state.is_read) setRead(article.id, true);
  const feed = feedById(article.feed_id);
  const { previous, next } = siblings(article.id);

  container.append(
    el("div", { class: "row between reader-bar" }, [
      el("button", { class: "btn small ghost", type: "button", text: t("back"), onclick: () => back(queue().origin) }),
      el("div", { class: "row" }, [
        el("button", {
          class: "btn small",
          type: "button",
          "aria-pressed": state.is_starred ? "true" : "false",
          text: state.is_starred ? t("starOn") : t("starOff"),
          onclick: () => toggleStar(article.id)
        }),
        el("button", {
          class: "btn small",
          type: "button",
          text: t("markUnread"),
          onclick: () => {
            setRead(article.id, false);
            toast(t("markedUnread"));
          }
        })
      ])
    ])
  );

  container.append(
    el("header", { class: "reader-head" }, [
      el("h1", { class: "reader-title", text: article.title || "(untitled)" }),
      el("div", { class: "tiny" }, [
        [feed ? feed.title : hostnameOf(article.url), article.author, formatTimestamp(article.published_at, true)]
          .filter(Boolean)
          .join(" · ")
      ]),
      article.url
        ? el("a", {
            class: "btn small",
            href: article.url,
            target: "_blank",
            rel: "noopener noreferrer",
            text: t("openOn", { host: hostnameOf(article.url) })
          })
        : null
    ])
  );

  const body = el("div", { class: "reader-body" });
  body.append(sanitizeHtml(article.content || article.summary || ""));
  container.append(body);

  if (article.url && needsFullText(article)) {
    const notice = el("div", { class: "muted tiny", text: t("loadingFullText") });
    container.insertBefore(notice, body);
    loadFullArticle(article.id)
      .then((content) => {
        if (content) return;
        notice.textContent = t("fullTextUnavailable");
      })
      .catch(() => {
        notice.textContent = t("fullTextFailed");
      });
  }

  container.append(
    el("div", { class: "row between reader-nav" }, [
      el("button", {
        class: "btn small",
        type: "button",
        text: t("previous"),
        disabled: !previous,
        onclick: () => previous && navigate(`/article/${previous}`)
      }),
      el("button", {
        class: "btn small",
        type: "button",
        text: t("next"),
        disabled: !next,
        onclick: () => next && navigate(`/article/${next}`)
      })
    ])
  );
}
