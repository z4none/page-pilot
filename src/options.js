const DEFAULT_SETTINGS = {
  provider: "kimi",
  skipConfirmation: true,
  maxPromptLength: 12000,
  summaryPrompt: "",
  summaryPromptCustomized: false,
};

const DEFAULT_SUMMARY_PROMPTS = {
  zh: [
    "请基于我上传的页面附件，用简洁中文总结。只保留最重要的 3-5 个要点，总字数控制在 300 字以内，并列出 1-3 个值得追问的问题。不要复述原文。",
    "输出请使用中文。",
  ].join("\n"),
  en: [
    "Please summarize the uploaded page attachment concisely. Keep only the 3-5 most important points, stay under 300 words, and list 1-3 useful follow-up questions. Do not repeat the source text.",
    "Respond in English.",
  ].join("\n"),
};

const elements = {
  provider: document.querySelector("#provider"),
  skipConfirmation: document.querySelector("#skip-confirmation"),
  maxPromptLength: document.querySelector("#max-prompt-length"),
  summaryPrompt: document.querySelector("#summary-prompt"),
  resetPrompt: document.querySelector("#reset-prompt"),
  resetSession: document.querySelector("#reset-session"),
  save: document.querySelector("#save"),
  status: document.querySelector("#status"),
};

let summaryPromptCustomizedDraft = false;

init();

async function init() {
  const { settings } = await chrome.storage.sync.get("settings");
  const current = {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
  };

  elements.skipConfirmation.checked = current.skipConfirmation;
  elements.provider.value = normalizeProviderId(current.provider);
  elements.maxPromptLength.value = String(current.maxPromptLength);
  elements.summaryPrompt.value = resolveSummaryPrompt(current);
  summaryPromptCustomizedDraft = Boolean(current.summaryPromptCustomized && String(current.summaryPrompt || "").trim());

  elements.save.addEventListener("click", saveSettings);
  elements.summaryPrompt.addEventListener("input", () => {
    summaryPromptCustomizedDraft = true;
  });
  elements.resetPrompt.addEventListener("click", resetPromptToLocalizedDefault);
  elements.resetSession.addEventListener("click", resetSession);
}

async function saveSettings() {
  const summaryPrompt = String(elements.summaryPrompt.value || "").trim() || getLocalizedDefaultSummaryPrompt();
  const settings = {
    provider: normalizeProviderId(elements.provider.value),
    skipConfirmation: elements.skipConfirmation.checked,
    maxPromptLength: Number(elements.maxPromptLength.value) || DEFAULT_SETTINGS.maxPromptLength,
    summaryPrompt,
    summaryPromptCustomized: summaryPromptCustomizedDraft,
  };

  await chrome.storage.sync.set({ settings });
  elements.status.textContent = "设置已保存。";
}

async function resetSession() {
  const provider = normalizeProviderId(elements.provider.value);
  const chatStorageKeys = {
    kimi: "activeKimiChatUrl",
    deepseek: "activeDeepSeekChatUrl",
    gemini: "activeGeminiChatUrl",
  };
  const key = chatStorageKeys[provider] || chatStorageKeys.kimi;
  await chrome.storage.session.remove(key);
  elements.status.textContent = "会话状态已重置。";
}

function resetPromptToLocalizedDefault() {
  elements.summaryPrompt.value = getLocalizedDefaultSummaryPrompt();
  summaryPromptCustomizedDraft = false;
  elements.status.textContent = "已恢复默认提示词，保存后生效。";
}

function resolveSummaryPrompt(settings) {
  const customPrompt = String(settings?.summaryPrompt || "").trim();
  if (settings?.summaryPromptCustomized && customPrompt) {
    return customPrompt;
  }

  return getLocalizedDefaultSummaryPrompt();
}

function getLocalizedDefaultSummaryPrompt() {
  return getCurrentLanguage().startsWith("zh")
    ? DEFAULT_SUMMARY_PROMPTS.zh
    : DEFAULT_SUMMARY_PROMPTS.en;
}

function getCurrentLanguage() {
  return String(chrome.i18n?.getUILanguage?.() || navigator.language || "").toLowerCase();
}

function normalizeProviderId(value) {
  if (value === "deepseek" || value === "gemini") return value;
  return "kimi";
}
