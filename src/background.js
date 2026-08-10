const MENU_ID = "page-pilot-summarize-page";
const STORAGE_KEYS = {
  payload: "lastPromptPayload",
  status: "panelStatus",
  settings: "settings",
};

const DEFAULT_SETTINGS = {
  skipConfirmation: true,
  maxPromptLength: 12000,
  summaryPrompt: "",
  summaryPromptCustomized: false,
};

const DEFAULT_SUMMARY_PROMPTS = {
  zh: [
    "请基于我上传的页面附件，总结主要内容，提炼关键要点，并指出值得继续追问的问题。",
    "输出请使用中文。",
  ].join("\n"),
  en: [
    "Please summarize the page attachment I uploaded, extract the key points, and suggest useful follow-up questions.",
    "Respond in English.",
  ].join("\n"),
};

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "总结页面",
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
  await setStatus("extracting", "正在提炼页面正文...");

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
    const payload = await buildFallbackPayload(tab, result?.error || "正文提炼失败");
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
    [STORAGE_KEYS.status]: {
      state: "ready",
      message: payload.mode === "markdown" ? "正文已提炼，等待确认。" : "正文提炼失败，已切换为 URL 方案。",
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
  const prompt = [
    "请总结上面链接中的页面内容，提炼关键要点，并指出值得继续追问的问题。",
    `页面标题：${title}`,
    `页面 URL：${url}`,
  ].join("\n");

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
  const language = chrome.i18n?.getUILanguage?.() || navigator.language || "";
  return String(language).toLowerCase().startsWith("zh")
    ? DEFAULT_SUMMARY_PROMPTS.zh
    : DEFAULT_SUMMARY_PROMPTS.en;
}

function buildAttachmentContent(result) {
  const title = result.title || "Untitled page";
  const url = result.url || "";
  const markdown = result.markdown || "";
  return [
    `页面标题：${title}`,
    `页面 URL：${url}`,
    "",
    markdown,
  ].join("\n").trim();
}

function limitPrompt(prompt, maxLength) {
  if (!maxLength || prompt.length <= maxLength) return prompt;
  const suffix = "\n\n[内容过长，已自动截断。]";
  return prompt.slice(0, Math.max(0, maxLength - suffix.length)).trimEnd() + suffix;
}

function sanitizeFileName(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}
