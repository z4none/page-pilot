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

const elements = {
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
    skipConfirmation: elements.skipConfirmation.checked,
    maxPromptLength: Number(elements.maxPromptLength.value) || DEFAULT_SETTINGS.maxPromptLength,
    summaryPrompt,
    summaryPromptCustomized: summaryPromptCustomizedDraft,
  };

  await chrome.storage.sync.set({ settings });
  elements.status.textContent = "设置已保存。";
}

async function resetSession() {
  await chrome.storage.session.remove("activeKimiChatUrl");
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
