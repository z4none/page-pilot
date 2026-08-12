import { t } from "./i18n.js";

const MENU_ID = "page-pilot-summarize-page";
const STORAGE_KEYS = {
  payload: "lastPromptPayload",
  autoSendPayloadKey: "autoSendPayloadKey",
  status: "panelStatus",
  settings: "settings",
};

const DEFAULT_SETTINGS = {
  provider: "kimi",
  maxPromptLength: 12000,
  summaryPrompt: "",
  summaryPromptCustomized: false,
};

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: t("menuSummarize"),
      contexts: ["page"],
    });
  });

  const { settings } = await chrome.storage.sync.get(STORAGE_KEYS.settings);
  if (!settings) {
    await chrome.storage.sync.set({ [STORAGE_KEYS.settings]: DEFAULT_SETTINGS });
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.windowId) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id || !tab.windowId) return;

  await chrome.sidePanel.open({ windowId: tab.windowId });
  await setStatus("extracting", t("statusExtracting"));

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["source-extractor.js"],
    });
  } catch (error) {
    const payload = await buildFallbackPayload(tab, String(error?.message || error));
    await publishPayload(payload);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PAGE_PILOT_EXTRACTION_RESULT") {
    handleExtractionResult(message.payload, sender.tab).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "PAGE_PILOT_EXTRACTION_DEBUG") {
    chrome.runtime.sendMessage(message).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "PAGE_PILOT_OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "PAGE_PILOT_DEEPSEEK_STATUS") {
    chrome.runtime.sendMessage(message).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

async function handleExtractionResult(result, tab) {
  if (!result?.ok) {
    const payload = await buildFallbackPayload(tab, result?.error || t("noArticle"));
    await publishPayload(payload);
    return;
  }

  const { settings } = await chrome.storage.sync.get(STORAGE_KEYS.settings);
  const promptPayload = buildMarkdownPayload(result, {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
  });

  await publishPayload(promptPayload);
}

async function publishPayload(payload) {
  await chrome.storage.session.set({
    [STORAGE_KEYS.payload]: payload,
    [STORAGE_KEYS.autoSendPayloadKey]: "",
    [STORAGE_KEYS.status]: {
      state: "ready",
      message: payload.mode === "markdown" ? t("statusExtracted") : t("statusFallback"),
    },
  });

  chrome.runtime.sendMessage({
    type: "PAGE_PILOT_PAYLOAD_READY",
    payload,
  }).catch(() => {});
}

async function setStatus(state, message) {
  const status = { state, message };
  await chrome.storage.session.set({ [STORAGE_KEYS.status]: status });
  chrome.runtime.sendMessage({
    type: "PAGE_PILOT_STATUS",
    status,
  }).catch(() => {});
}

async function buildFallbackPayload(tab, reason) {
  const title = tab?.title || "Untitled page";
  const url = tab?.url || "";
  const prompt = t("urlSummaryPrompt", [title, url]);

  return {
    mode: "url",
    title,
    url,
    markdown: "",
    prompt,
    attachment: null,
    error: reason,
    createdAt: new Date().toISOString(),
  };
}

function buildMarkdownPayload(result, settings) {
  const title = result.title || "Untitled page";
  const markdown = result.markdown || "";
  const attachmentContent = buildAttachmentContent(result);
  const promptTemplate = resolveSummaryPrompt(settings);
  const prompt = limitPrompt(promptTemplate, settings.maxPromptLength);

  return {
    mode: "markdown",
    title,
    url: result.url,
    markdown,
    prompt,
    attachment: {
      name: `${sanitizeFileName(title) || "page-summary"}.txt`,
      mimeType: "text/plain",
      content: attachmentContent,
      size: attachmentContent.length,
    },
    truncated: prompt.length < promptTemplate.length,
    createdAt: new Date().toISOString(),
  };
}

function resolveSummaryPrompt(settings) {
  const customPrompt = String(settings?.summaryPrompt || "").trim();
  if (settings?.summaryPromptCustomized && customPrompt) {
    return customPrompt;
  }

  return getLocalizedDefaultSummaryPrompt();
}

function getLocalizedDefaultSummaryPrompt() {
  return t("summaryPrompt");
}

function buildAttachmentContent(result) {
  const title = result.title || "Untitled page";
  const url = result.url || "";
  const markdown = result.markdown || "";
  return [
    t("pageTitle", title),
    t("pageUrl", url),
    "",
    markdown,
  ].join("\n").trim();
}

function limitPrompt(prompt, maxLength) {
  if (!maxLength || prompt.length <= maxLength) return prompt;
  const suffix = `\n\n${t("contentTruncated")}`;
  return prompt.slice(0, Math.max(0, maxLength - suffix.length)).trimEnd() + suffix;
}

function sanitizeFileName(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}
