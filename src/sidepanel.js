const SOURCE = "page-pilot";
const KIMI_URL = "https://www.kimi.com/";
const DEBUG_PREFIX = "[PAGE-PILOT]";
const DEBUG_STARTED_AT = performance.now();
const STORAGE_KEYS = {
  payload: "lastPromptPayload",
  status: "panelStatus",
  settings: "settings",
};

const state = {
  payload: null,
  settings: {
    skipConfirmation: true,
    maxPromptLength: 12000,
  },
  pendingPrompt: null,
  pendingAttachment: null,
  pendingRequestId: null,
  pendingAutoSend: false,
  sendPending: false,
  autoSentPayloadKey: null,
  sendScheduled: false,
  deepseekReady: false,
};

const elements = {
  reviewView: document.querySelector("#review-view"),
  deepseekView: document.querySelector("#deepseek-view"),
  status: document.querySelector("#status"),
  markdownPreview: document.querySelector("#markdown-preview"),
  attachmentMeta: document.querySelector("#attachment-meta"),
  attachmentPreview: document.querySelector("#attachment-preview"),
  promptEditor: document.querySelector("#prompt-editor"),
  sendButton: document.querySelector("#send-button"),
  settingsButton: document.querySelector("#settings-button"),
  resetSessionButton: document.querySelector("#reset-session-button"),
  backButton: document.querySelector("#back-button"),
  deepseekStatus: document.querySelector("#deepseek-status"),
  deepseekFrame: document.querySelector("#deepseek-frame"),
};

init();

async function init() {
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);

  const session = await chrome.storage.session.get([STORAGE_KEYS.payload, STORAGE_KEYS.status]);
  const sync = await chrome.storage.sync.get(STORAGE_KEYS.settings);

  state.settings = {
    ...state.settings,
    ...(sync.settings || {}),
  };

  if (session.panelStatus) {
    setStatus(session.panelStatus.message);
  }

  if (session.lastPromptPayload) {
    renderPayload(session.lastPromptPayload);
  }

  elements.sendButton.addEventListener("click", handleReviewSendClick);
  elements.settingsButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "PAGE_PILOT_OPEN_OPTIONS" });
  });
  elements.resetSessionButton.addEventListener("click", resetSession);
  elements.backButton.addEventListener("click", showReview);
  elements.deepseekFrame.addEventListener("load", () => {
    debug("iframe load", { src: elements.deepseekFrame.src });
    if (elements.deepseekFrame.src === "about:blank") return;
    if (state.sendPending && !state.sendScheduled) {
      scheduleSendRetry();
    }
  });
}

function handleReviewSendClick() {
  const attachment = getCurrentAttachment();
  debug("review send clicked", {
    promptLength: elements.promptEditor.value?.length || 0,
    attachmentName: attachment?.name || "",
    attachmentSize: attachment?.size || 0,
    attachmentContentLength: attachment?.content?.length || 0,
  });
  sendToKimi({ autoSend: true });
}

function handleRuntimeMessage(message) {
  if (message?.type === "PAGE_PILOT_STATUS") {
    setStatus(message.status.message);
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
    maybeAutoSend(message.payload);
  }

  if (message?.type === "PAGE_PILOT_DEEPSEEK_SEND_RESULT" || message?.type === "DEEPSEEK_SEND_RESULT") {
    if (message.ok) {
      elements.deepseekStatus.textContent = "已发送，接下来由 Kimi 处理。";
    } else {
      elements.deepseekStatus.textContent = `发送失败：${message.error || "未找到 Kimi 输入框"}`;
      setStatus(elements.deepseekStatus.textContent);
    }
  }

  if (message?.type === "PAGE_PILOT_DEEPSEEK_READY" || message?.type === "DEEPSEEK_READY") {
    debug("deepseek ready", { requestId: message.requestId });
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

  const modeText = payload.mode === "markdown" ? "正文提炼完成" : "已切换为 URL 方案";
  const truncatedText = payload.truncated ? "，内容已截断" : "";
  setStatus(`${modeText}${truncatedText}。`);
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

async function sendToKimi(options = {}) {
  const autoSend = Boolean(options.autoSend);
  const promptOverride = options.promptOverride;
  const editorPrompt = String(elements.promptEditor.value ?? "");
  const overridePrompt = String(promptOverride ?? "");
  const prompt = String(promptOverride ?? elements.promptEditor.value ?? "").trim();
  const attachment = getCurrentAttachment();
  if (!prompt) {
    setStatus("没有可发送的 Prompt。");
    debug("sendToKimi aborted", {
      hasOverride: Boolean(promptOverride),
      overrideLength: overridePrompt.length,
      editorLength: editorPrompt.length,
    });
    return;
  }

  if (state.sendPending && state.pendingPrompt === prompt) {
    debug("sendToKimi ignored duplicate", { promptLength: prompt.length });
    return;
  }

  debug("sendToKimi", {
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
  state.sendPending = true;
  state.deepseekReady = false;

  await chrome.storage.session.set({
    [STORAGE_KEYS.payload]: {
      ...state.payload,
      prompt,
      attachment,
    },
  });

  showDeepSeek();
  flushPendingPrompt();
}

function maybeAutoSend(payload) {
  if (!state.settings.skipConfirmation) return;

  const key = getPayloadKey(payload);
  if (state.autoSentPayloadKey === key) return;

  state.autoSentPayloadKey = key;
  debug("auto-send armed", {
    key,
    promptLength: payload?.prompt?.length || 0,
    markdownLength: payload?.markdown?.length || 0,
  });
  sendToKimi({
    autoSend: true,
    promptOverride: payload?.prompt || "",
  });
}

function showDeepSeek() {
  elements.reviewView.classList.add("hidden");
  elements.deepseekView.classList.remove("hidden");
  elements.deepseekStatus.textContent = "正在准备 Kimi 输入框...";
  debug("showDeepSeek");

  elements.deepseekFrame.src = "about:blank";
  setTimeout(() => {
    debug("set Kimi src");
    elements.deepseekFrame.src = KIMI_URL;
  }, 0);
}

function showReview() {
  elements.deepseekView.classList.add("hidden");
  elements.reviewView.classList.remove("hidden");
}

function sendCurrentPrompt() {
  const prompt = state.pendingPrompt;
  const attachment = getCurrentAttachment();
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
    promptLength: prompt.length,
    hasFrameWindow: Boolean(elements.deepseekFrame.contentWindow),
    deepseekReady: state.deepseekReady,
    requestId: state.pendingRequestId,
    autoSend: state.pendingAutoSend,
    attachmentName: messageAttachment?.name || "",
    attachmentSize: messageAttachment?.size || 0,
    attachmentContentLength: messageAttachment?.content?.length || 0,
  });

  if (!state.deepseekReady) {
    elements.deepseekStatus.textContent = "正在等待 Kimi 加载完成...";
    return;
  }

  elements.deepseekStatus.textContent = state.pendingAutoSend
    ? "正在上传附件并发送到 Kimi..."
    : "正在填入 Kimi 输入框...";
  state.sendPending = false;
  state.deepseekReady = false;

  elements.deepseekFrame.contentWindow?.postMessage({
    source: SOURCE,
    type: "SEND_PROMPT",
    requestId: state.pendingRequestId || createRequestId(),
    prompt,
    autoSend: state.pendingAutoSend,
    attachment: messageAttachment,
  }, "*");

  state.pendingPrompt = null;
  state.pendingRequestId = null;
  elements.deepseekStatus.textContent = state.pendingAutoSend
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
  debug("schedule send after load");
  setTimeout(() => {
    state.sendScheduled = false;
    flushPendingPrompt();
  }, 500);
}

function flushPendingPrompt() {
  if (!state.sendPending || !state.pendingPrompt) return;
  if (!state.deepseekReady) {
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
  state.autoSentPayloadKey = null;
  state.deepseekReady = false;
  state.pendingAutoSend = false;
  await chrome.storage.session.remove(STORAGE_KEYS.payload);
  elements.deepseekFrame.src = KIMI_URL;
  setStatus("Kimi 会话已重置。");
  debug("resetSession");
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
