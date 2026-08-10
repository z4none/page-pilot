const DEFAULT_SETTINGS = {
  skipConfirmation: true,
  maxPromptLength: 12000,
};

const elements = {
  skipConfirmation: document.querySelector("#skip-confirmation"),
  maxPromptLength: document.querySelector("#max-prompt-length"),
  resetSession: document.querySelector("#reset-session"),
  save: document.querySelector("#save"),
  status: document.querySelector("#status"),
};

init();

async function init() {
  const { settings } = await chrome.storage.sync.get("settings");
  const current = {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
  };

  elements.skipConfirmation.checked = current.skipConfirmation;
  elements.maxPromptLength.value = String(current.maxPromptLength);

  elements.save.addEventListener("click", saveSettings);
  elements.resetSession.addEventListener("click", resetSession);
}

async function saveSettings() {
  const settings = {
    skipConfirmation: elements.skipConfirmation.checked,
    maxPromptLength: Number(elements.maxPromptLength.value) || DEFAULT_SETTINGS.maxPromptLength,
  };

  await chrome.storage.sync.set({ settings });
  elements.status.textContent = "设置已保存。";
}

async function resetSession() {
  await chrome.storage.session.remove("activeKimiChatUrl");
  elements.status.textContent = "会话状态已重置。";
}
