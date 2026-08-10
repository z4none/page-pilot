import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

const DEBUG_PREFIX = "[PAGE-PILOT]";
const DEBUG_STARTED_AT = performance.now();

(async () => {
  try {
    debug("extractor start", { href: location.href, title: document.title });
    const article = await extractArticle();
    const markdown = normalizeMarkdown(article.markdown);
    debug("extractor markdown normalized", {
      title: article.title || document.title,
      markdownLength: markdown.length,
      textLength: article.textLength || 0,
      contentLength: article.contentLength || 0,
    });

    if (markdown.length < 80) {
      throw new Error("提炼出的正文过短");
    }

    await chrome.runtime.sendMessage({
      type: "PAGE_PILOT_EXTRACTION_RESULT",
      payload: {
        ok: true,
        title: article.title || document.title,
        url: location.href,
        markdown,
        excerpt: article.excerpt || "",
        byline: article.byline || "",
      },
    });
    debug("extractor result sent", { ok: true, markdownLength: markdown.length });
  } catch (error) {
    debug("extractor failed", { error: String(error?.message || error) });
    await chrome.runtime.sendMessage({
      type: "PAGE_PILOT_EXTRACTION_RESULT",
      payload: {
        ok: false,
        title: document.title,
        url: location.href,
        error: String(error?.message || error),
      },
    });
  }
})();

async function extractArticle() {
  return extractGenericArticle();
}

function extractGenericArticle() {
  const startedAt = performance.now();
  debug("readability start", {
    nbTopCandidates: 20,
    charThreshold: 80,
    keepClasses: false,
  });
  const documentClone = document.cloneNode(true);
  const reader = new Readability(documentClone, {
    nbTopCandidates: 20,
    charThreshold: 80,
    keepClasses: false,
  });
  const article = reader.parse();

  if (!article?.content || !article.textContent?.trim()) {
    throw new Error("没有找到可提炼的正文区域");
  }

  const turndown = createTurndown();
  const markdown = turndown.turndown(article.content);
  debug("readability complete", {
    elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
    title: article.title || document.title,
    textLength: article.textContent.length,
    contentLength: article.content.length,
    markdownLength: markdown.length,
  });

  return {
    title: article.title || document.title,
    markdown,
    excerpt: article.excerpt || "",
    byline: article.byline || "",
    textLength: article.textContent.length,
    contentLength: article.content.length,
  };
}

function createTurndown() {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });

  turndown.remove(["script", "style", "noscript", "svg", "iframe"]);
  return turndown;
}

function sanitizeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function debug(message, extra) {
  const meta = {
    t: Number((performance.now() - DEBUG_STARTED_AT).toFixed(1)),
    at: new Date().toISOString(),
  };
  if (extra !== undefined) {
    console.log(`${DEBUG_PREFIX} ${message} ${toJson({ ...meta, ...extra })}`);
    return;
  }

  console.log(`${DEBUG_PREFIX} ${message} ${toJson(meta)}`);
}

function toJson(value) {
  try {
    const json = JSON.stringify(truncateForLog(value));
    if (json.length <= 1200) return json;
    return JSON.stringify({
      __truncated: true,
      preview: json.slice(0, 1200),
    });
  } catch (error) {
    return JSON.stringify({ error: String(error?.message || error) });
  }
}

function truncateForLog(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === "string") return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  if (typeof value !== "object") return value;
  if (depth > 2) return Array.isArray(value) ? "[Array]" : "[Object]";

  if (Array.isArray(value)) {
    return value.slice(0, 15).map((item) => truncateForLog(item, depth + 1));
  }

  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 20)) {
    result[key] = truncateForLog(item, depth + 1);
  }
  return result;
}

function normalizeMarkdown(markdown) {
  return markdown
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}
