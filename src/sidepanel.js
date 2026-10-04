import { resolveRequestProviderId } from "./provider-request.js";
import { applyI18n, t } from "./i18n.js";

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
  autoSendPayloadKey: "autoSendPayloadKey",
  status: "panelStatus",
  settings: "settings",
  kimiChatUrl: "activeKimiChatUrl",
  deepseekChatUrl: "activeDeepSeekChatUrl",
  geminiChatUrl: "activeGeminiChatUrl",
};

const state = {
  payload: null,
  settings: {
    provider: "kimi",
    maxPromptLength: 12000,
    summaryPrompt: "",
    summaryPromptCustomized: false,
  },
  settingsPromptCustomizedDraft: false,
  pendingPrompt: null,
  pendingAttachment: null,
  pendingRequestId: null,
  pendingProviderId: null,
  activeRequestProviderId: null,
  activeRequestId: null,
  pendingAutoSend: false,
  pendingStartedAt: 0,
  sendPending: false,
  autoSentPayloadKey: null,
  sendScheduled: false,
  providerReady: false,
  lastFrameReadinessProbeAt: 0,
  providerFrameRequested: false,
  providerChatUrls: {
    kimi: "",
    deepseek: "",
    gemini: "",
  },
};

const elements = {
  status: document.querySelector("#status"),
  settingsButton: document.querySelector("#settings-button"),
  contentButton: document.querySelector("#content-button"),
  resetSessionButton: document.querySelector("#reset-session-button"),
  providerStatus: document.querySelector("#status"),
  providerFrame: document.querySelector("#provider-frame"),
  contentModal: document.querySelector("#content-modal"),
  contentCancelIcon: document.querySelector("#content-cancel-icon"),
  contentMeta: document.querySelector("#content-meta"),
  contentViewer: document.querySelector("#content-viewer"),
  settingsModal: document.querySelector("#settings-modal"),
  modalProvider: document.querySelector("#modal-provider"),
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
  applyI18n();
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);

  const session = await chrome.storage.session.get([
    STORAGE_KEYS.payload,
    STORAGE_KEYS.autoSendPayloadKey,
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
    preloadProviderFrame();
  }

  if (session.lastPromptPayload) {
    renderPayload(session.lastPromptPayload);
    await maybeAutoSend(session.lastPromptPayload, {
      source: "session-recovery",
      claimedPayloadKey: session.autoSendPayloadKey || "",
    });
  }
  preloadProviderFrame();

  elements.contentButton.addEventListener("click", openContentModal);
  elements.contentCancelIcon.addEventListener("click", closeContentModal);
  elements.settingsButton.addEventListener("click", openSettingsModal);
  elements.settingsSave.addEventListener("click", saveSettingsFromModal);
  elements.settingsCancel.addEventListener("click", closeSettingsModal);
  elements.settingsCancelIcon.addEventListener("click", closeSettingsModal);
  elements.settingsModal.addEventListener("click", handleSettingsOverlayClick);
  elements.contentModal.addEventListener("click", handleContentOverlayClick);
  elements.modalSummaryPrompt.addEventListener("input", () => {
    state.settingsPromptCustomizedDraft = true;
  });
  elements.modalResetPrompt.addEventListener("click", resetPromptToLocalizedDefault);
  elements.modalResetSession.addEventListener("click", resetProviderChatSession);
  elements.resetSessionButton.addEventListener("click", resetSession);
  elements.providerFrame.addEventListener("load", () => {
    debug("iframe load", { src: elements.providerFrame.src });
    if (elements.providerFrame.src === "about:blank") return;
    requestFrameReadiness("iframe-load", true);
    if (state.sendPending && !state.sendScheduled) {
      scheduleSendRetry();
    }
  });

  if (!session.panelStatus?.state && !session.lastPromptPayload) {
    enterIdleState();
  }
}

function openContentModal() {
  const payload = state.payload;
  if (!payload) return;
  const attachment = payload.attachment;
  elements.contentMeta.textContent = attachment
    ? `${attachment.name} · ${(attachment.size / 1024).toFixed(1)} KB`
    : payload.url || t("noAttachment");
  elements.contentViewer.textContent = attachment?.content || payload.markdown || payload.url || t("noContent");
  elements.contentModal.classList.remove("hidden");
  elements.contentCancelIcon.focus();
  debug("openContentModal", {
    mode: payload.mode,
    contentLength: elements.contentViewer.textContent.length,
    attachmentName: attachment?.name || "",
  });
}

function closeContentModal() {
  elements.contentModal.classList.add("hidden");
}

function handleContentOverlayClick(event) {
  if (event.target === elements.contentModal) {
    closeContentModal();
  }
}

function handleRuntimeMessage(message) {
  if (message?.type === "PAGE_PILOT_EXTRACTION_DEBUG") {
    debug(`extractor ${message.message || "diagnostic"}`, message.detail || {});
  }

  if (message?.type === "PAGE_PILOT_STATUS") {
    setStatus(message.status.message);
    preloadProviderFrame();
  }

  if (message?.type === "PAGE_PILOT_PROVIDER_LOCATION") {
    rememberProviderChatUrl(message.href || "");
  }

  if (message?.type === "PAGE_PILOT_PAYLOAD_READY") {
    debug("payload ready", {
      mode: message.payload?.mode,
      promptLength: message.payload?.prompt?.length || 0,
      markdownLength: message.payload?.markdown?.length || 0,
      attachmentName: message.payload?.attachment?.name || "",
      attachmentSize: message.payload?.attachment?.size || 0,
    });
    renderPayload(message.payload);
    void maybeAutoSend(message.payload, { source: "runtime-message" });
  }

  if (message?.type === "PAGE_PILOT_PROVIDER_SEND_RESULT") {
    const expectedRequestId = state.pendingRequestId || state.activeRequestId;
    if (!expectedRequestId || message.requestId !== expectedRequestId) {
      debug("stale provider result ignored", {
        expectedRequestId,
        resultRequestId: message.requestId || "",
        href: message.href || message.chatUrl || "",
      });
      return;
    }

    const expectedProviderId = state.pendingProviderId || state.activeRequestProviderId;
    const resultProvider = getProviderIdFromUrl(message.href || message.chatUrl || "");
    if (expectedProviderId && resultProvider && resultProvider !== expectedProviderId) {
      debug("stale provider result ignored", {
        expectedProvider: expectedProviderId,
        resultProvider,
        href: message.href || message.chatUrl || "",
      });
      return;
    }

    const provider = getRequestProvider();
    rememberProviderChatUrl(message.href || message.chatUrl || "");
    if (message.ok) {
      const successMessage = t("sent", provider.label);
      elements.providerStatus.textContent = successMessage;
      setStatus(successMessage);
    } else {
      const errorMessage = t("sendFailed", message.error || `No ${provider.label} input found`);
      elements.providerStatus.textContent = errorMessage;
      setStatus(errorMessage);
      enterProviderState(errorMessage);
    }
    state.activeRequestProviderId = null;
    state.activeRequestId = null;
  }

  if (message?.type === "PAGE_PILOT_PROVIDER_READY") {
    const readyProvider = getProviderIdFromUrl(message.href || message.chatUrl || "");
    if (!state.sendPending || !state.pendingRequestId || message.requestId !== state.pendingRequestId) {
      debug("stale provider ready ignored", {
        pendingRequestId: state.pendingRequestId || "",
        readyRequestId: message.requestId || "",
        href: message.href || message.chatUrl || "",
      });
      return;
    }
    if (readyProvider && readyProvider !== state.pendingProviderId) {
      debug("stale provider ready ignored", {
        pendingProvider: state.pendingProviderId,
        readyProvider,
        href: message.href || message.chatUrl || "",
      });
      return;
    }
    const provider = getRequestProvider();
    rememberProviderChatUrl(message.href || message.chatUrl || "");
    debug("provider ready", {
      requestId: message.requestId,
      reason: message.reason || "initial",
      href: message.href || message.chatUrl || "",
      provider: provider.id,
      activeChatUrl: getRequestProviderChatUrl(),
    });
    state.providerReady = true;
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
  state.pendingAttachment = payload?.attachment || null;
  elements.contentButton.disabled = !Boolean(payload?.attachment?.content || payload?.markdown || payload?.url);
}

function setStatus(message) {
  elements.status.textContent = message;
}

function openSettingsModal() {
  elements.modalProvider.value = getCurrentProvider().id;
  elements.modalMaxPromptLength.value = String(state.settings.maxPromptLength || 12000);
  elements.modalSummaryPrompt.value = resolveSummaryPrompt(state.settings);
  state.settingsPromptCustomizedDraft = Boolean(state.settings.summaryPromptCustomized && String(state.settings.summaryPrompt || "").trim());
  elements.settingsModalStatus.textContent = "";
  elements.settingsModal.classList.remove("hidden");
  elements.modalProvider.focus();
  debug("openSettingsModal", {
    provider: getCurrentProvider().id,
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
    debug("provider change queued", {
      currentFrameProvider: previousProvider,
      nextProvider: settings.provider,
      appliesOn: "next-summary",
      requestInProgress: Boolean(state.sendPending || state.activeRequestProviderId),
    });
  }
  elements.settingsModalStatus.textContent = t("settingsSaved");
  setStatus(t("settingsSaved"));
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
  elements.settingsModalStatus.textContent = t("promptRestored");
  debug("resetPromptToLocalizedDefault", {
    language: getCurrentLanguage(),
  });
}

async function resetProviderChatSession() {
  const provider = getCurrentProvider();
  state.providerChatUrls[provider.id] = "";
  state.providerFrameRequested = false;
  state.providerReady = false;
  await chrome.storage.session.remove(provider.chatStorageKey);
  elements.providerFrame.src = "about:blank";
  elements.settingsModalStatus.textContent = t("sessionReset", provider.label);
  setStatus(t("sessionReset", provider.label));
  debug("resetProviderChatSession", { provider: provider.id });
}

async function sendToProvider(options = {}) {
  const requestProvider = getCurrentProvider();
  const autoSend = Boolean(options.autoSend);
  const promptOverride = options.promptOverride;
  const overridePrompt = String(promptOverride ?? "");
  const prompt = String(promptOverride ?? state.payload?.prompt ?? "").trim();
  const attachment = getCurrentAttachment();
  if (!prompt) {
    setStatus(t("noPrompt"));
    debug("sendToProvider aborted", {
      hasOverride: Boolean(promptOverride),
      overrideLength: overridePrompt.length,
      payloadPromptLength: state.payload?.prompt?.length || 0,
    });
    return;
  }

  if (state.sendPending && state.pendingPrompt === prompt) {
    debug("sendToProvider ignored duplicate", { promptLength: prompt.length });
    return;
  }

  debug("sendToProvider", {
    provider: requestProvider.id,
    autoSend,
    hasOverride: Boolean(promptOverride),
    overrideLength: overridePrompt.length,
    payloadPromptLength: state.payload?.prompt?.length || 0,
    promptLength: prompt.length,
    source: promptOverride ? "payload" : "storedPayload",
    attachmentName: attachment?.name || "",
    attachmentSize: attachment?.size || 0,
    attachmentContentLength: attachment?.content?.length || 0,
  });
  state.pendingPrompt = prompt;
  state.pendingAttachment = attachment;
  state.pendingRequestId = createRequestId();
  state.pendingProviderId = requestProvider.id;
  state.activeRequestProviderId = null;
  state.activeRequestId = null;
  state.pendingAutoSend = autoSend;
  state.pendingStartedAt = Date.now();
  state.sendPending = true;
  state.providerReady = false;

  enterProviderState(autoSend ? t("uploading", requestProvider.label) : t("filling", requestProvider.label));
  await chrome.storage.session.set({
    [STORAGE_KEYS.payload]: {
      ...state.payload,
      prompt,
      attachment,
    },
  });

  requestFrameReadiness("send-start", true);
  flushPendingPrompt();
}

async function maybeAutoSend(payload, { source = "unknown", claimedPayloadKey = "" } = {}) {
  const key = getPayloadKey(payload);
  const alreadyClaimed = state.autoSentPayloadKey === key || claimedPayloadKey === key;
  if (alreadyClaimed) {
    debug("auto-send skipped", {
      source,
      reason: "payload-already-claimed",
      key,
      stateKey: state.autoSentPayloadKey,
      claimedPayloadKey,
    });
    return false;
  }

  state.autoSentPayloadKey = key;
  await chrome.storage.session.set({ [STORAGE_KEYS.autoSendPayloadKey]: key });
  debug("auto-send armed", {
    source,
    key,
    promptLength: payload?.prompt?.length || 0,
    markdownLength: payload?.markdown?.length || 0,
  });
  void sendToProvider({
    autoSend: true,
    promptOverride: payload?.prompt || "",
  });
  return true;
}

function enterIdleState() {
  setStatus(t("statusWaiting"));
  preloadProviderFrame();
}

function enterProviderState(message = t("preparing", getCurrentProvider().label)) {
  elements.providerStatus.textContent = message;
  setStatus(message);
  preloadProviderFrame();
  debug("enterProviderState", { message });
}

function preloadProviderFrame() {
  const provider = getRequestProvider();
  const targetUrl = getRequestProviderChatUrl() || provider.homeUrl;
  if (state.providerFrameRequested && elements.providerFrame.src === targetUrl) {
    requestFrameReadiness("reuse-requested-frame", true);
    return;
  }
  if (elements.providerFrame.src === targetUrl) {
    state.providerFrameRequested = true;
    requestFrameReadiness("reuse-frame", true);
    return;
  }

  state.providerFrameRequested = true;
  debug("preloadProviderFrame", {
    provider: provider.id,
    targetUrl,
    hasChatUrl: Boolean(getCurrentProviderChatUrl()),
  });
  elements.providerFrame.title = provider.label;
  elements.providerFrame.src = targetUrl;
}

function requestFrameReadiness(reason, force = false) {
  if (!state.sendPending || !elements.providerFrame.contentWindow) return;

  const now = Date.now();
  if (!force && now - state.lastFrameReadinessProbeAt < 500) return;
  state.lastFrameReadinessProbeAt = now;

  const provider = getRequestProvider();
  const requestId = state.pendingRequestId;
  elements.providerFrame.contentWindow.postMessage({
    source: SOURCE,
    type: "PAGE_PILOT_PING",
    requestId,
    provider: provider.id,
  }, "*");
  debug("frame readiness probe", {
    reason,
    provider: provider.id,
    requestId,
    frameSrc: elements.providerFrame.src,
  });
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

function sendCurrentPrompt() {
  const prompt = state.pendingPrompt;
  const attachment = getCurrentAttachment();
  const provider = getRequestProvider();
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
    hasFrameWindow: Boolean(elements.providerFrame.contentWindow),
    providerReady: state.providerReady,
    requestId: state.pendingRequestId,
    autoSend: state.pendingAutoSend,
    pendingAgeMs: state.pendingStartedAt ? Date.now() - state.pendingStartedAt : 0,
    attachmentName: messageAttachment?.name || "",
    attachmentSize: messageAttachment?.size || 0,
    attachmentContentLength: messageAttachment?.content?.length || 0,
  });

  if (!state.providerReady) {
    elements.providerStatus.textContent = t("waitingReady", getCurrentProvider().label);
    return;
  }

  elements.providerStatus.textContent = state.pendingAutoSend
    ? t("uploading", getCurrentProvider().label)
    : t("filling", getCurrentProvider().label);
  const requestId = state.pendingRequestId || createRequestId();
  state.sendPending = false;
  state.providerReady = false;
  state.activeRequestProviderId = state.pendingProviderId;
  state.activeRequestId = requestId;

  elements.providerFrame.contentWindow?.postMessage({
    source: SOURCE,
    type: "SEND_PROMPT",
    requestId,
    prompt: messagePrompt,
    autoSend: state.pendingAutoSend,
    attachment: messageAttachment,
  }, "*");

  state.pendingPrompt = null;
  state.pendingRequestId = null;
  state.pendingProviderId = null;
  state.pendingStartedAt = 0;
  elements.providerStatus.textContent = state.pendingAutoSend
    ? t("uploading", provider.label)
    : t("filling", provider.label);
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
    providerReady: state.providerReady,
    pendingAgeMs: state.pendingStartedAt ? Date.now() - state.pendingStartedAt : 0,
  });
  setTimeout(() => {
    state.sendScheduled = false;
    flushPendingPrompt();
  }, 500);
}

function flushPendingPrompt() {
  if (!state.sendPending || !state.pendingPrompt) return;
  if (!state.providerReady) {
    const pendingAgeMs = state.pendingStartedAt ? Date.now() - state.pendingStartedAt : 0;
    if (pendingAgeMs > 10000) {
      const errorMessage = t("sendFailed", t("notReady", getCurrentProvider().label));
      elements.providerStatus.textContent = errorMessage;
      setStatus(errorMessage);
      state.pendingPrompt = null;
      state.pendingAttachment = null;
      state.pendingRequestId = null;
      state.pendingProviderId = null;
      state.pendingAutoSend = false;
      state.pendingStartedAt = 0;
      state.sendPending = false;
      state.providerReady = false;
      debug("send wait timed out", {
        pendingAgeMs,
        frameSrc: elements.providerFrame.src,
      });
      return;
    }
    requestFrameReadiness("waiting-for-ready");
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
  state.pendingProviderId = null;
  state.activeRequestProviderId = null;
  state.activeRequestId = null;
  state.sendPending = false;
  state.pendingStartedAt = 0;
  state.autoSentPayloadKey = null;
  state.providerReady = false;
  state.pendingAutoSend = false;
  state.providerFrameRequested = false;
  elements.contentButton.disabled = true;
  closeContentModal();
  state.providerChatUrls[getCurrentProvider().id] = "";
  await chrome.storage.session.remove([
    STORAGE_KEYS.payload,
    STORAGE_KEYS.autoSendPayloadKey,
    getCurrentProvider().chatStorageKey,
  ]);
  elements.providerFrame.src = "about:blank";
  setStatus(t("sessionReset", getCurrentProvider().label));
  preloadProviderFrame();
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
  return t("summaryPrompt");
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

function getRequestProvider() {
  const providerId = resolveRequestProviderId(
    state.activeRequestProviderId,
    state.pendingProviderId,
    state.settings.provider,
  );
  return PROVIDERS[normalizeProviderId(providerId)] || PROVIDERS.kimi;
}

function getCurrentProviderChatUrl() {
  return state.providerChatUrls[getCurrentProvider().id] || "";
}

function getRequestProviderChatUrl() {
  return state.providerChatUrls[getRequestProvider().id] || "";
}

function getProviderIdFromUrl(value) {
  try {
    const hostname = new URL(String(value || "")).hostname;
    if (/^(www\.)?kimi\.com$/.test(hostname)) return "kimi";
    if (hostname === "chat.deepseek.com") return "deepseek";
    if (hostname === "gemini.google.com") return "gemini";
  } catch {
  }
  return "";
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
