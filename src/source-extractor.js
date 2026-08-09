import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

(async () => {
  try {
    const article = await extractArticle();
    const markdown = normalizeMarkdown(article.markdown);

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
  } catch (error) {
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
  if (isRedditThreadUrl(location.href)) {
    try {
      return await extractRedditThread();
    } catch {
      // Fall back to the generic extractor if Reddit JSON parsing fails.
    }
  }

  return extractGenericArticle();
}

function extractGenericArticle() {
  const documentClone = document.cloneNode(true);
  const reader = new Readability(documentClone, {
    keepClasses: false,
  });
  const article = reader.parse();

  if (!article?.content || !article.textContent?.trim()) {
    throw new Error("没有找到可提炼的正文区域");
  }

  const turndown = createTurndown();
  const markdown = turndown.turndown(article.content);

  return {
    title: article.title || document.title,
    markdown,
    excerpt: article.excerpt || "",
    byline: article.byline || "",
  };
}

async function extractRedditThread() {
  const pageUrl = new URL(location.href);
  const apiUrl = new URL(pageUrl.href);
  apiUrl.pathname = apiUrl.pathname.replace(/\/?$/, ".json");
  apiUrl.searchParams.set("raw_json", "1");
  apiUrl.searchParams.set("limit", "500");
  apiUrl.searchParams.set("depth", "20");
  apiUrl.searchParams.set("sort", "top");

  const response = await fetch(apiUrl.toString(), {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Reddit JSON 拉取失败：${response.status}`);
  }

  const data = await response.json();
  const post = data?.[0]?.data?.children?.[0]?.data;
  const comments = data?.[1]?.data?.children || [];

  if (!post) {
    throw new Error("没有找到 Reddit 帖子内容");
  }

  const lines = [];
  lines.push(`# ${sanitizeText(post.title || document.title)}`);
  lines.push("");

  if (post.selftext_html) {
    const turndown = createTurndown();
    lines.push(normalizeMarkdown(turndown.turndown(decodeHtml(post.selftext_html))));
    lines.push("");
  } else if (post.selftext) {
    lines.push(sanitizeText(post.selftext));
    lines.push("");
  }

  if (post.url && post.is_self === false) {
    lines.push(`来源链接：${post.url}`);
    lines.push("");
  }

  const commentLines = [];
  collectRedditComments(comments, commentLines, 0);

  if (commentLines.length) {
    lines.push("## Comments");
    lines.push("");
    lines.push(...commentLines);
  }

  return {
    title: post.title || document.title,
    markdown: lines.join("\n").trim(),
    excerpt: post.selftext?.slice(0, 280) || "",
    byline: post.author ? `u/${post.author}` : "",
  };
}

function collectRedditComments(nodes, output, depth) {
  for (const node of nodes) {
    if (node?.kind === "t1" && node.data) {
      const author = node.data.author ? `u/${node.data.author}` : "u/[deleted]";
      const score = typeof node.data.score === "number" ? `${node.data.score} points` : "score hidden";
      const body = sanitizeText(node.data.body || "");
      const indent = "  ".repeat(depth);
      const quotedBody = body.split("\n").map((line) => `${indent}  > ${line || ""}`).join("\n");

      output.push(`${indent}- ${author} (${score})`);
      output.push(quotedBody);
      output.push("");

      const replies = node.data.replies?.data?.children || [];
      if (replies.length) {
        collectRedditComments(replies, output, depth + 1);
      }
      continue;
    }

    if (node?.kind === "more" && Array.isArray(node.data?.children) && node.data.children.length) {
      const indent = "  ".repeat(depth);
      output.push(`${indent}- [还有 ${node.data.children.length} 条评论未展开]`);
      output.push("");
    }
  }
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

function isRedditThreadUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith("reddit.com") && parsed.pathname.includes("/comments/");
  } catch {
    return false;
  }
}

function decodeHtml(value) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = String(value || "");
  return textarea.value;
}

function sanitizeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function normalizeMarkdown(markdown) {
  return markdown
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}
