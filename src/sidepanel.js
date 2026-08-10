const SOURCE = "page-pilot";
const DEBUG_PREFIX = "[PAGE-PILOT]";
const DEBUG_STARTED_AT = performance.now();
const PROVIDERS = {
  kimi: {
    id: "kimi",
    label: "Kimi",
    homeUrl: "https://www.kimi.com/",
    chatStorageKey: "activeKimiChatUrl",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    homeUrl: "https://chat.deepseek.com/",
    chatStorageKey: "activeDeepSeekChatUrl",
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    homeUrl: "https://gemini.google.com/app",
    chatStorageKey: "activeGeminiChatUrl",
  },
};
const STORAGE_KEYS = {
  payload: "lastPromptPayload",
  status: "panelStatus",
  settings: "settings",
  kimiChatUrl: "activeKimiChatUrl",
  deepseekChatUrl: "activeDeepSeekChatUrl",
  geminiChatUrl: "activeGeminiChatUrl",
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

const state = {
  payload: null,
  settings: {
    provider: "kimi",
    skipConfirmation: true,
    maxPromptLength: 12000,
    summaryPrompt: "",
    summaryPromptCustomized: false,
  },
  settingsPromptCustomizedDraft: false,
  panelMode: "idle",
  pendingPrompt: null,
  pendingAttachment: null,
  pendingRequestId: null,
  pendingAutoSend: false,
  pendingStartedAt: 0,
  sendPending: false,
  autoSentPayloadKey: null,
  sendScheduled: false,
  deepseekReady: false,
  kimiFrameRequested: false,
  providerChatUrls: {
    kimi: "",
    deepseek: "",
    gemini: "",
  },
};

const elements = {
  loadingPanel: document.querySelector("#loading-panel"),
  loadingTitle: document.querySelector("#loading-title"),
  loadingDetail: document.querySelector("#loading-detail"),
  reviewPanel: document.querySelector("#review-panel"),
  kimiPanel: document.querySelector("#kimi-panel"),
  status: document.querySelector("#status"),
  markdownPreview: document.querySelector("#markdown-preview"),
  attachmentMeta: document.querySelector("#attachment-meta"),
  attachmentPreview: document.querySelector("#attachment-preview"),
  promptEditor: document.querySelector("#prompt-editor"),
  sendButton: document.querySelector("#send-button"),
  settingsButton: document.querySelector("#settings-button"),
  resetSessionButton: document.querySelector("#reset-session-button"),
  kimiStatus: document.querySelector("#status"),
  deepseekFrame: document.querySelector("#deepseek-frame"),
  settingsModal: document.querySelector("#settings-modal"),
  modalProvider: document.querySelector("#modal-provider"),
  modalSkipConfirmation: document.querySelector("#modal-skip-confirmation"),
  modalMaxPromptLength: document.querySelector("#modal-max-prompt-length"),
  modalSummaryPrompt: document.querySelector("#modal-summary-prompt"),
  modalResetPrompt: document.querySelector("#modal-reset-prompt"),
  modalResetSession: document.querySelector("#modal-reset-session"),
  settingsSave: document.querySelector("#settings-save"),
  settingsCancel: document.querySelector("#settings-cancel"),
  settingsCancelIcon: document.querySelector("#settings-cancel-icon"),
  settingsModalStatus: document.querySelector("#settings-modal-status"),
};

init();

async function init() {
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);

  const session = await chrome.storage.session.get([
    STORAGE_KEYS.payload,
    STORAGE_KEYS.status,
    STORAGE_KEYS.kimiChatUrl,
    STORAGE_KEYS.deepseekChatUrl,
    STORAGE_KEYS.geminiChatUrl,
  ]);
  const sync = await chrome.storage.sync.get(STORAGE_KEYS.settings);

  state.settings = {
    ...state.settings,
    ...(sync.settings || {}),
  };
  state.settings.provider = normalizeProviderId(state.settings.provider);
  state.providerChatUrls.kimi = normalizeProviderChatUrl("kimi", session.activeKimiChatUrl || "");
  state.providerChatUrls.deepseek = normalizeProviderChatUrl("deepseek", session.activeDeepSeekChatUrl || "");
  state.providerChatUrls.gemini = normalizeProviderChatUrl("gemini", session.activeGeminiChatUrl || "");

  if (session.panelStatus) {
    setStatus(session.panelStatus.message);
    if (session.panelStatus.state === "extracting") {
      enterExtractingState(session.panelStatus.message);
      preloadKimiFrame();
    }
  }

  if (session.lastPromptPayload) {
    renderPayload(session.lastPromptPayload);
  }

  elements.sendButton.addEventListener("click", handleReviewSendClick);
  elements.settingsButton.addEventListener("click", openSettingsModal);
  elements.settingsSave.addEventListener("click", saveSettingsFromModal);
  elements.settingsCancel.addEventListener("click", closeSettingsModal);
  elements.settingsCancelIcon.addEventListener("click", closeSettingsModal);
  elements.settingsModal.addEventListener("click", handleSettingsOverlayClick);
  elements.modalSummaryPrompt.addEventListener("input", () => {
    state.settingsPromptCustomizedDraft = true;
  });
  elements.modalResetPrompt.addEventListener("click", resetPromptToLocalizedDefault);
  elements.modalResetSession.addEventListener("click", resetKimiChatSession);
  elements.resetSessionButton.addEventListener("click", resetSession);
  elements.deepseekFrame.addEventListener("load", () => {
    debug("iframe load", { src: elements.deepseekFrame.src });
    if (elements.deepseekFrame.src === "about:blank") return;
    if (state.sendPending && !state.sendScheduled) {
      scheduleSendRetry();
    }
  });

  if (!session.panelStatus?.state && !session.lastPromptPayload) {
    enterIdleState();
  } else if (session.lastPromptPayload && session.panelStatus?.state !== "extracting") {
    enterReviewState();
  }
}

function handleReviewSendClick() {
  const attachment = getCurrentAttachment();
  debug("review send clicked", {
    promptLength: elements.promptEditor.value?.length || 0,
    attachmentName: attachment?.name || "",
    attachmentSize: attachment?.size || 0,
    attachmentContentLength: attachment?.content?.length || 0,
  });
  sendToProvider({ autoSend: true });
}

function handleRuntimeMessage(message) {
  if (message?.type === "PAGE_PILOT_STATUS") {
    setStatus(message.status.message);
    if (message.status.state === "extracting") {
      enterExtractingState(message.status.message);
      preloadKimiFrame();
    }
  }

  if (message?.type === "PAGE_PILOT_KIMI_LOCATION") {
    rememberProviderChatUrl(message.href || "");
  }

  if (message?.type === "PAGE_PILOT_PAYLOAD_READY") {
    debug("payload ready", {
      mode: message.payload?.mode,
      promptLength: message.payload?.prompt?.length || 0,
      markdownLength: message.payload?.markdown?.length || 0,
      attachmentName: message.payload?.attachment?.name || "",
      attachmentSize: message.payload?.attachment?.size || 0,
      skipConfirmation: state.settings.skipConfirmation,
    });
    renderPayload(message.payload);
    if (!maybeAutoSend(message.payload)) {
      enterReviewState();
    }
  }

  if (message?.type === "PAGE_PILOT_DEEPSEEK_SEND_RESULT" || message?.type === "DEEPSEEK_SEND_RESULT") {
    rememberProviderChatUrl(message.href || message.chatUrl || "");
    if (message.ok) {
      const successMessage = `已发送，接下来由 ${getCurrentProvider().label} 处理。`;
      elements.kimiStatus.textContent = successMessage;
      setStatus(successMessage);
    } else {
      const errorMessage = `发送失败：${message.error || `未找到 ${getCurrentProvider().label} 输入框`}`;
      elements.kimiStatus.textContent = errorMessage;
      setStatus(errorMessage);
      enterKimiState(errorMessage);
    }
  }

  if (message?.type === "PAGE_PILOT_DEEPSEEK_READY" || message?.type === "DEEPSEEK_READY") {
    rememberProviderChatUrl(message.href || message.chatUrl || "");
    debug("deepseek ready", {
      requestId: message.requestId,
      href: message.href || message.chatUrl || "",
      provider: getCurrentProvider().id,
      activeChatUrl: getCurrentProviderChatUrl(),
    });
    state.deepseekReady = true;
    flushPendingPrompt();
  }
}

function renderPayload(payload) {
  state.payload = payload;
  debug("renderPayload", {
    mode: payload?.mode,
    promptLength: payload?.prompt?.length || 0,
    markdownLength: payload?.markdown?.length || 0,
    attachmentName: payload?.attachment?.name || "",
    attachmentSize: payload?.attachment?.size || 0,
    truncated: Boolean(payload?.truncated),
  });
  elements.markdownPreview.textContent = payload.markdown || `将使用 URL 方案：\n${payload.url || ""}`;
  state.pendingAttachment = payload?.attachment || null;
  renderAttachment(payload?.attachment || null);
  elements.promptEditor.value = payload.prompt || "";
  elements.sendButton.disabled = !payload.prompt;
}

function renderAttachment(attachment) {
  if (!attachment) {
    elements.attachmentMeta.textContent = "未生成附件";
    elements.attachmentPreview.textContent = "当前流程不会附加正文文件。";
    return;
  }

  elements.attachmentMeta.textContent = `${attachment.name} · ${(attachment.size / 1024).toFixed(1)} KB · ${attachment.mimeType}`;
  elements.attachmentPreview.textContent = attachment.content || "";
}

function setStatus(message) {
  elements.status.textContent = message;
}

function openSettingsModal() {
  elements.modalProvider.value = getCurrentProvider().id;
  elements.modalSkipConfirmation.checked = Boolean(state.settings.skipConfirmation);
  elements.modalMaxPromptLength.value = String(state.settings.maxPromptLength || 12000);
  elements.modalSummaryPrompt.value = resolveSummaryPrompt(state.settings);
  state.settingsPromptCustomizedDraft = Boolean(state.settings.summaryPromptCustomized && String(state.settings.summaryPrompt || "").trim());
  elements.settingsModalStatus.textContent = "";
  elements.settingsModal.classList.remove("hidden");
  elements.modalSkipConfirmation.focus();
  debug("openSettingsModal", {
    provider: getCurrentProvider().id,
    skipConfirmation: state.settings.skipConfirmation,
    maxPromptLength: state.settings.maxPromptLength,
    summaryPromptCustomized: state.settings.summaryPromptCustomized,
  });
}

function closeSettingsModal() {
  elements.settingsModal.classList.add("hidden");
  elements.settingsModalStatus.textContent = "";
  debug("closeSettingsModal");
}

function handleSettingsOverlayClick(event) {
  if (event.target === elements.settingsModal) {
    closeSettingsModal();
  }
}

async function saveSettingsFromModal() {
  const summaryPrompt = String(elements.modalSummaryPrompt.value || "").trim() || getLocalizedDefaultSummaryPrompt();
  const previousProvider = getCurrentProvider().id;
  const settings = {
    provider: normalizeProviderId(elements.modalProvider.value),
    skipConfirmation: elements.modalSkipConfirmation.checked,
    maxPromptLength: Number(elements.modalMaxPromptLength.value) || state.settings.maxPromptLength || 12000,
    summaryPrompt,
    summaryPromptCustomized: state.settingsPromptCustomizedDraft,
  };

  state.settings = {
    ...state.settings,
    ...settings,
  };

  await chrome.storage.sync.set({ [STORAGE_KEYS.settings]: state.settings });
  if (settings.provider !== previousProvider) {
    state.kimiFrameRequested = false;
    state.deepseekReady = false;
    elements.deepseekFrame.src = "about:blank";
    preloadKimiFrame();
  }
  elements.settingsModalStatus.textContent = "设置已保存。";
  setStatus("设置已保存。");
  debug("saveSettingsFromModal", state.settings);
  setTimeout(() => {
    if (!elements.settingsModal.classList.contains("hidden")) {
      closeSettingsModal();
    }
  }, 450);
}

function resetPromptToLocalizedDefault() {
  elements.modalSummaryPrompt.value = getLocalizedDefaultSummaryPrompt();
  state.settingsPromptCustomizedDraft = false;
  elements.settingsModalStatus.textContent = "已恢复默认提示词，保存后生效。";
  debug("resetPromptToLocalizedDefault", {
    language: getCurrentLanguage(),
  });
}

async function resetKimiChatSession() {
  const provider = getCurrentProvider();
  state.providerChatUrls[provider.id] = "";
  state.kimiFrameRequested = false;
  state.deepseekReady = false;
  await chrome.storage.session.remove(provider.chatStorageKey);
  elements.deepseekFrame.src = "about:blank";
  elements.settingsModalStatus.textContent = `${provider.label} 会话已重置。`;
  setStatus(`${provider.label} 会话已重置。`);
  debug("resetProviderChatSession", { provider: provider.id });
}

async function sendToProvider(options = {}) {
  const autoSend = Boolean(options.autoSend);
  const promptOverride = options.promptOverride;
  const editorPrompt = String(elements.promptEditor.value ?? "");
  const overridePrompt = String(promptOverride ?? "");
  const prompt = String(promptOverride ?? elements.promptEditor.value ?? "").trim();
  const attachment = getCurrentAttachment();
  if (!prompt) {
    setStatus("没有可发送的 Prompt。");
    debug("sendToProvider aborted", {
      hasOverride: Boolean(promptOverride),
      overrideLength: overridePrompt.length,
      editorLength: editorPrompt.length,
    });
    return;
  }

  if (state.sendPending && state.pendingPrompt === prompt) {
    debug("sendToProvider ignored duplicate", { promptLength: prompt.length });
    return;
  }

  debug("sendToProvider", {
    provider: getCurrentProvider().id,
    autoSend,
    hasOverride: Boolean(promptOverride),
    overrideLength: overridePrompt.length,
    editorLength: editorPrompt.length,
    promptLength: prompt.length,
    source: promptOverride ? "payload" : "editor",
    attachmentName: attachment?.name || "",
    attachmentSize: attachment?.size || 0,
    attachmentContentLength: attachment?.content?.length || 0,
  });
  state.pendingPrompt = prompt;
  state.pendingAttachment = attachment;
  state.pendingRequestId = createRequestId();
  state.pendingAutoSend = autoSend;
  state.pendingStartedAt = Date.now();
  state.sendPending = true;

  await chrome.storage.session.set({
    [STORAGE_KEYS.payload]: {
      ...state.payload,
      prompt,
      attachment,
    },
  });

  enterKimiState(autoSend ? `正在上传附件并发送到 ${getCurrentProvider().label}...` : `正在填入 ${getCurrentProvider().label} 输入框...`);
  flushPendingPrompt();
}

function maybeAutoSend(payload) {
  if (!state.settings.skipConfirmation) return false;

  const key = getPayloadKey(payload);
  if (state.autoSentPayloadKey === key) return true;

  state.autoSentPayloadKey = key;
  debug("auto-send armed", {
    key,
    promptLength: payload?.prompt?.length || 0,
    markdownLength: payload?.markdown?.length || 0,
  });
  enterKimiState(`正在准备 ${getCurrentProvider().label} 输入框...`);
  sendToProvider({
    autoSend: true,
    promptOverride: payload?.prompt || "",
  });
  return true;
}

function enterIdleState() {
  state.panelMode = "idle";
  syncPanelMode();
  setStatus("等待页面内容");
}

function enterExtractingState(message = "正在提取页面内容...") {
  state.panelMode = "extracting";
  syncPanelMode();
  elements.loadingTitle.textContent = message || "正在提取页面内容...";
  elements.loadingDetail.textContent = `${getCurrentProvider().label} 会在后台准备。`;
  setStatus(message || "正在提取页面内容...");
  preloadKimiFrame();
  debug("enterExtractingState", { message });
}

function enterReviewState() {
  state.panelMode = "review";
  syncPanelMode();
  const modeText = state.payload?.mode === "markdown" ? "正文已提炼，等待确认。" : "已切换为 URL 方案，等待确认。";
  const truncatedText = state.payload?.truncated ? "内容已截断。" : "";
  setStatus(truncatedText ? `${modeText} ${truncatedText}` : modeText);
  debug("enterReviewState", {
    promptLength: state.payload?.prompt?.length || 0,
    attachmentName: state.payload?.attachment?.name || "",
  });
}

function enterKimiState(message = `正在准备 ${getCurrentProvider().label} 输入框...`) {
  state.panelMode = "kimi";
  syncPanelMode();
  elements.kimiStatus.textContent = message;
  setStatus(message);
  preloadKimiFrame();
  debug("enterKimiState", { message });
}

function preloadKimiFrame() {
  const provider = getCurrentProvider();
  const targetUrl = getCurrentProviderChatUrl() || provider.homeUrl;
  if (state.kimiFrameRequested && elements.deepseekFrame.src === targetUrl) return;
  if (elements.deepseekFrame.src === targetUrl) {
    state.kimiFrameRequested = true;
    return;
  }

  state.kimiFrameRequested = true;
  debug("preloadKimiFrame", {
    provider: provider.id,
    targetUrl,
    hasChatUrl: Boolean(getCurrentProviderChatUrl()),
  });
  elements.deepseekFrame.title = provider.label;
  elements.deepseekFrame.src = targetUrl;
}

async function rememberProviderChatUrl(value) {
  const normalized = normalizeAnyProviderChatUrl(value);
  if (!normalized.chatUrl) return;
  if (normalized.chatUrl === state.providerChatUrls[normalized.providerId]) return;

  state.providerChatUrls[normalized.providerId] = normalized.chatUrl;
  await chrome.storage.session.set({ [PROVIDERS[normalized.providerId].chatStorageKey]: normalized.chatUrl });
  debug("rememberProviderChatUrl", {
    provider: normalized.providerId,
    chatUrl: normalized.chatUrl,
  });
}

function normalizeAnyProviderChatUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (/^(www\.)?kimi\.com$/.test(url.hostname)) {
      return {
        providerId: "kimi",
        chatUrl: normalizeProviderChatUrl("kimi", value),
      };
    }
    if (url.hostname === "chat.deepseek.com") {
      return {
        providerId: "deepseek",
        chatUrl: normalizeProviderChatUrl("deepseek", value),
      };
    }
    if (url.hostname === "gemini.google.com") {
      return {
        providerId: "gemini",
        chatUrl: normalizeProviderChatUrl("gemini", value),
      };
    }
  } catch {
  }
  return { providerId: "", chatUrl: "" };
}

function normalizeProviderChatUrl(providerId, value) {
  try {
    const url = new URL(String(value || ""));
    if (providerId === "kimi") {
      if (!/^(www\.)?kimi\.com$/.test(url.hostname)) return "";
      if (!url.pathname.startsWith("/chat/")) return "";
      return `${url.origin}${url.pathname}`;
    }
    if (providerId === "deepseek") {
      if (url.hostname !== "chat.deepseek.com") return "";
      if (!url.pathname.startsWith("/a/chat/s/")) return "";
      return `${url.origin}${url.pathname}`;
    }
    if (providerId === "gemini") {
      if (url.hostname !== "gemini.google.com") return "";
      if (!url.pathname.startsWith("/app/")) return "";
      return `${url.origin}${url.pathname}`;
    }
  } catch {
    return "";
  }
  return "";
}

function syncPanelMode() {
  const loadingVisible = state.panelMode === "extracting";
  const reviewVisible = state.panelMode === "review";
  const kimiVisible = state.panelMode === "kimi";

  elements.loadingPanel.classList.toggle("hidden", !loadingVisible);
  elements.reviewPanel.classList.toggle("hidden", !reviewVisible);
  elements.kimiPanel.classList.toggle("hidden", !kimiVisible);
}

function sendCurrentPrompt() {
  const prompt = state.pendingPrompt;
  const attachment = getCurrentAttachment();
  const provider = getCurrentProvider();
  const messagePrompt = prompt;
  const messageAttachment = attachment
    ? {
        name: attachment.name,
        mimeType: attachment.mimeType,
        content: attachment.content,
        size: attachment.size,
      }
    : null;
  if (!prompt || !state.sendPending) return;

  debug("sendCurrentPrompt", {
    provider: provider.id,
    promptLength: messagePrompt.length,
    originalPromptLength: prompt.length,
    inlineAttachment: false,
    hasFrameWindow: Boolean(elements.deepseekFrame.contentWindow),
    deepseekReady: state.deepseekReady,
    requestId: state.pendingRequestId,
    autoSend: state.pendingAutoSend,
    pendingAgeMs: state.pendingStartedAt ? Date.now() - state.pendingStartedAt : 0,
    attachmentName: messageAttachment?.name || "",
    attachmentSize: messageAttachment?.size || 0,
    attachmentContentLength: messageAttachment?.content?.length || 0,
  });

  if (!state.deepseekReady) {
    elements.kimiStatus.textContent = `正在等待 ${getCurrentProvider().label} 加载完成...`;
    return;
  }

  elements.kimiStatus.textContent = state.pendingAutoSend
    ? `正在上传附件并发送到 ${getCurrentProvider().label}...`
    : `正在填入 ${getCurrentProvider().label} 输入框...`;
  state.sendPending = false;
  state.deepseekReady = false;

  elements.deepseekFrame.contentWindow?.postMessage({
    source: SOURCE,
    type: "SEND_PROMPT",
    requestId: state.pendingRequestId || createRequestId(),
    prompt: messagePrompt,
    autoSend: state.pendingAutoSend,
    attachment: messageAttachment,
  }, "*");

  state.pendingPrompt = null;
  state.pendingRequestId = null;
  state.pendingStartedAt = 0;
  elements.kimiStatus.textContent = state.pendingAutoSend
    ? "已触发发送。"
    : "已填入，等待你手动发送。";
  debug("postMessage sent", {
    autoSend: state.pendingAutoSend,
    attachmentName: messageAttachment?.name || "",
    attachmentSize: messageAttachment?.size || 0,
    attachmentContentLength: messageAttachment?.content?.length || 0,
  });
}

function getCurrentAttachment() {
  const attachment = state.pendingAttachment || state.payload?.attachment || null;
  if (!attachment?.content) return null;
  return attachment;
}

function scheduleSendRetry() {
  if (state.sendScheduled) return;

  state.sendScheduled = true;
  debug("schedule send after load", {
    deepseekReady: state.deepseekReady,
    pendingAgeMs: state.pendingStartedAt ? Date.now() - state.pendingStartedAt : 0,
  });
  setTimeout(() => {
    state.sendScheduled = false;
    flushPendingPrompt();
  }, 500);
}

function flushPendingPrompt() {
  if (!state.sendPending || !state.pendingPrompt) return;
  if (!state.deepseekReady) {
    const pendingAgeMs = state.pendingStartedAt ? Date.now() - state.pendingStartedAt : 0;
    if (pendingAgeMs > 10000) {
      const errorMessage = `发送失败：${getCurrentProvider().label} 尚未就绪，请重试。`;
      elements.kimiStatus.textContent = errorMessage;
      setStatus(errorMessage);
      state.sendPending = false;
      debug("send wait timed out", {
        pendingAgeMs,
        frameSrc: elements.deepseekFrame.src,
      });
      return;
    }
    scheduleSendRetry();
    return;
  }
  sendCurrentPrompt();
}

function createRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `pp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function resetSession() {
  state.pendingPrompt = null;
  state.pendingAttachment = null;
  state.pendingRequestId = null;
  state.sendPending = false;
  state.pendingStartedAt = 0;
  state.autoSentPayloadKey = null;
  state.deepseekReady = false;
  state.pendingAutoSend = false;
  state.kimiFrameRequested = false;
  state.providerChatUrls[getCurrentProvider().id] = "";
  state.panelMode = "idle";
  await chrome.storage.session.remove([STORAGE_KEYS.payload, getCurrentProvider().chatStorageKey]);
  elements.deepseekFrame.src = "about:blank";
  syncPanelMode();
  setStatus(`${getCurrentProvider().label} 会话已重置。`);
  debug("resetSession", { provider: getCurrentProvider().id });
}

function getPayloadKey(payload) {
  return [
    payload?.createdAt || "",
    payload?.mode || "",
    payload?.title || "",
    payload?.url || "",
    payload?.prompt || "",
  ].join("|");
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

function getCurrentProvider() {
  return PROVIDERS[normalizeProviderId(state.settings.provider)] || PROVIDERS.kimi;
}

function getCurrentProviderChatUrl() {
  return state.providerChatUrls[getCurrentProvider().id] || "";
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
