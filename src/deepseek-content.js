import { createStabilityTracker, runComposerFlow } from "./composer-flow.js";

(() => {
  const SOURCE = "page-pilot";
  const DEBUG_PREFIX = "[PAGE-PILOT]";
  const DEBUG_STARTED_AT = performance.now();
  const handledRequests = new Set();
  const IS_PRIMARY_FRAME = window.parent === window.top;
  let readyNotified = false;

  debug("content script loaded", {
    href: location.href,
    top: window.self === window.top,
    primary: IS_PRIMARY_FRAME,
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.source !== SOURCE) return;

    if (message.type === "PAGE_PILOT_PING") {
      if (!IS_PRIMARY_FRAME) return;
      debug("readiness ping received", {
        requestId: message.requestId,
        provider: message.provider || "",
      });
      announceReady({
        requestId: message.requestId,
        reason: "ping",
      });
      return;
    }

    if (message.type !== "SEND_PROMPT") return;
    debug("message received", {
      requestId: message.requestId,
      promptLength: message.prompt?.length || 0,
      autoSend: Boolean(message.autoSend),
      promptPreview: String(message.prompt || "").slice(0, 80),
      attachmentName: message.attachment?.name || "",
      attachmentSize: message.attachment?.size || 0,
    });
    handleSendPrompt(message).then((result) => {
      debug("send result", result);
      chrome.runtime.sendMessage({
        source: SOURCE,
        type: "PAGE_PILOT_DEEPSEEK_SEND_RESULT",
        ...result,
        requestId: message.requestId,
        href: location.href,
      }).catch(() => {});
    });
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.source !== SOURCE || message.type !== "SEND_PROMPT") return false;
    debug("runtime message received", {
      requestId: message.requestId,
      promptLength: message.prompt?.length || 0,
      autoSend: Boolean(message.autoSend),
      promptPreview: String(message.prompt || "").slice(0, 80),
      attachmentName: message.attachment?.name || "",
      attachmentSize: message.attachment?.size || 0,
    });
    handleSendPrompt(message).then((result) => sendResponse(result));
    return true;
  });

  if (IS_PRIMARY_FRAME) {
    watchKimiLocation();
    announceReady();
  } else {
    debug("secondary frame ignored", { href: location.href });
  }

  function findChatInput() {
    const selectors = isGeminiPage()
      ? [
        ".ql-editor.textarea.new-input-ui",
        ".ql-editor[contenteditable='true']",
        "[role='textbox'].ql-editor",
        "rich-textarea [contenteditable='true']",
        "[data-placeholder][contenteditable='true']",
      ]
      : [
      ".chat-input-editor",
      "rich-textarea textarea",
      "rich-textarea [contenteditable='true']",
      "[data-placeholder][contenteditable='true']",
      'div[role="textbox"][contenteditable="true"]',
      '[contenteditable="true"]',
      "textarea",
      ];
    const candidates = deepQueryAll(selectors);

    return candidates.find((element) => isUsableChatInput(element)) || null;
  }

  function isUsableChatInput(element) {
    if (!isVisibleEditable(element)) return false;
    if (isGeminiPage() && element.matches?.("textarea.gds-body-l")) return false;
    return true;
  }

  function findSendButton() {
    const candidates = [
      'gem-icon-button.send-button',
      'gem-icon-button[aria-label*="send" i]',
      'gem-icon-button[aria-label*="发送" i]',
      'button[type="submit"]',
      'button[aria-label*="send" i]',
      'button[aria-label*="发送" i]',
      ".send-button-container",
      '[role="button"].ds-button--primary.ds-button--circle',
      '[role="button"].ds-button--primary.ds-button--icon-relative-m',
      'button[aria-label*="send" i]',
      'button[aria-label*="发送" i]',
      'button[data-test-id*="send" i]',
      'button mat-icon[data-mat-icon-name*="send" i]',
      '[role="button"] mat-icon[data-mat-icon-name*="send" i]',
      '[role="button"][aria-label*="send" i]',
      '[role="button"][aria-label*="发送" i]',
    ];

    for (const selector of candidates) {
      const element = deepQueryOne(selector);
      const clickable = closestClickable(element);
      if (isClickable(clickable)) return clickable;
    }

    const buttons = deepQueryAll(["button", "[role='button']"]);
    return buttons.find((button) => {
      const text = `${button.textContent || ""} ${button.getAttribute("aria-label") || ""}`;
      return /send|发送|提交/i.test(text) && isClickable(button);
    });
  }

  function describeSendButtonCandidates() {
    return {
      href: location.href,
      candidates: deepQueryAll(["button", "[role='button']", "gem-icon-button"])
        .filter((element) => isVisibleEditable(element))
        .slice(0, 12)
        .map((element) => ({
          tag: element.tagName,
          className: String(element.className || ""),
          ariaLabel: element.getAttribute("aria-label") || "",
          text: String(element.textContent || "").trim().slice(0, 80),
          ariaDisabled: element.getAttribute("aria-disabled") || "",
          disabled: Boolean(element.disabled),
          clickable: isClickable(element),
        })),
    };
  }

  function isClickable(element) {
    if (!element) return false;
    if (element.disabled) return false;
    if (element.getAttribute("aria-disabled") === "true") return false;
    if (element.classList?.contains("disabled")) return false;
    if (element.className && String(element.className).includes("--disabled")) return false;
    return isVisibleEditable(element);
  }

  function closestClickable(element) {
    if (!element) return null;
    if (element.matches?.("button, [role='button']")) return element;
    return element.closest?.("button, [role='button']") || element;
  }

  function isVisibleEditable(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    if (!style || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (rect.bottom < 0 || rect.right < 0) return false;
    if (rect.top > window.innerHeight || rect.left > window.innerWidth) return false;
    return true;
  }

  function deepQueryOne(selector) {
    return deepQueryAll([selector])[0] || null;
  }

  function deepQueryAll(selectors) {
    const results = [];
    const seen = new Set();
    const roots = [document];

    while (roots.length) {
      const root = roots.pop();
      if (!root || seen.has(root)) continue;
      seen.add(root);

      for (const selector of selectors) {
        const matches = root.querySelectorAll?.(selector) || [];
        for (const element of matches) {
          results.push(element);
        }
      }

      const walker = document.createTreeWalker(
        root instanceof Document ? root.documentElement : root,
        NodeFilter.SHOW_ELEMENT,
      );
      let current = walker.currentNode;
      while (current) {
        if (current.shadowRoot && !seen.has(current.shadowRoot)) {
          roots.push(current.shadowRoot);
        }
        current = walker.nextNode();
      }

      if (root instanceof ShadowRoot) {
        const host = root.host;
        if (host && host.shadowRoot && !seen.has(host.shadowRoot)) {
          roots.push(host.shadowRoot);
        }
      }
    }

    return results;
  }

  async function waitForElement(finder, timeoutMs, describeTimeout) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        const element = finder();
        if (element) {
          resolve(element);
          return;
        }
        if (Date.now() - startedAt > timeoutMs) {
          if (describeTimeout) {
            debug("waitForElement timeout detail", describeTimeout());
          }
          reject(new Error("AI 网页未找到可用输入框或发送按钮"));
          return;
        }
        setTimeout(tick, 250);
      };
      tick();
    });
  }

  async function handleSendPrompt(message) {
    if (message.requestId && handledRequests.has(message.requestId)) {
      debug("duplicate request ignored", { requestId: message.requestId });
      return { ok: true };
    }
    if (message.requestId) handledRequests.add(message.requestId);

    try {
      const providerStrategy = getProviderStrategy();
      await runComposerFlow({
        message,
        waitForInput: async () => {
          const input = await waitForElement(findChatInput, 30000);
          debug("input found", {
            provider: providerStrategy.provider,
            tag: input.tagName,
            className: input.className,
            role: input.getAttribute("role"),
            contentEditable: input.getAttribute("contenteditable"),
            textLength: readInputValue(input).length,
          });
          return input;
        },
        attachAttachment: (attachment, input) => attachAttachment(attachment, input, providerStrategy),
        fillPrompt: (input, prompt) => {
          debug("fill path selected", {
            provider: providerStrategy.provider,
            tag: input.tagName,
            isTextarea: input.matches("textarea"),
            isContentEditable: input.isContentEditable,
            beforeLength: readInputValue(input).length,
          });
          fillInput(input, prompt);
          debug("input filled", {
            provider: providerStrategy.provider,
            promptLength: prompt?.length || 0,
            afterLength: readInputValue(input).length,
            repeatedPromptCount: countOccurrences(readInputValue(input), prompt),
          });
        },
        verifyPrompt: async (input, prompt) => {
          const filled = await waitForFilledInput(input, prompt, 1500);
          debug("filled input verified", {
            provider: providerStrategy.provider,
            filled,
            currentLength: readInputValue(input).length,
            currentPreview: readInputValue(input).slice(0, 120),
            repeatedPromptCount: countOccurrences(readInputValue(input), prompt),
          });
          return filled;
        },
        verifyAttachmentForSubmit: async (attachmentResult) => {
          if (providerStrategy.attachmentReadiness === "sendButton") {
            const sendButton = await waitForElement(findSendButton, 15000, describeSendButtonCandidates);
            debug("attachment gate via send button", {
              provider: providerStrategy.provider,
              tag: sendButton.tagName,
              className: String(sendButton.className || ""),
              ariaDisabled: sendButton.getAttribute("aria-disabled") || "",
              disabled: Boolean(sendButton.disabled),
              clickable: isClickable(sendButton),
            });
            return true;
          }
          await waitForAttachmentMinimumAge(attachmentResult, providerStrategy);
          const evidence = await waitForAttachmentReady(
            attachmentResult.fileName,
            attachmentResult.baseline,
            providerStrategy,
            "preSubmit",
          );
          return Boolean(evidence);
        },
        submitPrompt: async ({ input, prompt, beforeValue }) => {
          await sleep(providerStrategy.preSubmitDelayMs);
          const sendButton = await waitForElement(findSendButton, 15000, describeSendButtonCandidates);
        debug("send button found", {
          provider: providerStrategy.provider,
          tag: sendButton.tagName,
          className: sendButton.className,
          text: sendButton.textContent,
          ariaDisabled: sendButton.getAttribute("aria-disabled") || "",
          disabled: Boolean(sendButton.disabled),
          clickable: isClickable(sendButton),
          });
          return trySubmit(input, sendButton, prompt, beforeValue, message.attachment, providerStrategy);
        },
      });
      return { ok: true };
    } catch (error) {
      debug("handleSendPrompt failed", { error: String(error?.message || error) });
      return {
        ok: false,
        error: String(error?.message || error),
      };
    }
  }

  async function attachAttachment(attachment, preferredTarget = null, strategy = getProviderStrategy()) {
    const file = new File([attachment.content || ""], attachment.name || "page-summary.md", {
      type: attachment.mimeType || "text/markdown",
    });
    const startedAt = performance.now();
    const target = preferredTarget || findChatInput();
    const baseline = captureAttachmentSnapshot(file.name);

    debug("attachAttachment start", {
      provider: strategy.provider,
      method: strategy.attachmentMethod,
      targetMode: "input",
      targetTag: target?.tagName || "",
      targetClass: String(target?.className || ""),
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      timeoutMs: strategy.attachmentTimeoutMs,
      settleMs: strategy.attachmentSettleMs,
    });
    debug("attachment baseline", {
      provider: strategy.provider,
      ...summarizeAttachmentSnapshot(baseline),
    });

    if (!target) {
      return { ready: false, method: strategy.attachmentMethod, reason: "missingTarget" };
    }

    const dispatchResult = dispatchFilePaste(target, file);
    debug("attachment paste dispatched", {
      provider: strategy.provider,
      targetTag: target.tagName,
      targetClass: String(target.className || ""),
      ...dispatchResult,
      fileName: file.name,
      fileSize: file.size,
    });
    if (!dispatchResult.dispatched) {
      return { ready: false, method: strategy.attachmentMethod, reason: "dispatchFailed" };
    }

    const evidence = await waitForAttachmentReady(file.name, baseline, strategy);
    const result = {
      ready: Boolean(evidence),
      method: strategy.attachmentMethod,
      evidence: evidence?.kind || "",
      fileName: file.name,
      pastedAt: startedAt,
      baseline,
    };
    debug("attachAttachment complete", {
      provider: strategy.provider,
      ...result,
      elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
    });
    return result;
  }

  function getProviderStrategy() {
    if (location.hostname === "gemini.google.com") {
      return {
        provider: "gemini",
        attachmentMethod: "paste",
        attachmentTimeoutMs: 30000,
        attachmentSettleMs: 1200,
        attachmentMinAgeMs: 0,
        attachmentReadiness: "sendButton",
        preSubmitDelayMs: 800,
      };
    }

    if (location.hostname === "chat.deepseek.com") {
      return {
        provider: "deepseek",
        attachmentMethod: "paste",
        attachmentTimeoutMs: 20000,
        attachmentSettleMs: 800,
        attachmentMinAgeMs: 0,
        preSubmitDelayMs: 500,
      };
    }

    return {
      provider: "kimi",
      attachmentMethod: "paste",
      attachmentTimeoutMs: 20000,
      attachmentSettleMs: 800,
      attachmentMinAgeMs: 0,
      preSubmitDelayMs: 500,
    };
  }

  function isGeminiPage() {
    return location.hostname === "gemini.google.com";
  }

  function dispatchFilePaste(target, file) {
    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData: dataTransfer,
      });
      clickAndFocus(target);
      target.focus();
      target.dispatchEvent(event);
      return {
        dispatched: true,
        defaultPrevented: event.defaultPrevented,
        clipboardFileCount: event.clipboardData?.files?.length || 0,
        clipboardItemCount: event.clipboardData?.items?.length || 0,
      };
    } catch (error) {
      debug("file paste failed", { error: String(error?.message || error) });
      return { dispatched: false, error: String(error?.message || error) };
    }
  }

  async function waitForAttachmentReady(fileName, baseline, strategy, phase = "initial") {
    const startedAt = Date.now();
    const tracker = createStabilityTracker(strategy.attachmentSettleMs);
    let lastLoggedKey = "";

    while (Date.now() - startedAt <= strategy.attachmentTimeoutMs) {
      const current = captureAttachmentSnapshot(fileName);
      const evidence = diffAttachmentSnapshots(baseline, current);
      const evidenceKey = JSON.stringify({
        ready: evidence.ready,
        blocked: evidence.progressDelta > 0,
        candidateSignatures: evidence.candidateSignatures,
        fileInputDelta: evidence.fileInputDelta,
      });
      const stable = tracker.observe({
        key: evidenceKey,
        ready: evidence.ready,
        blocked: evidence.progressDelta > 0,
      }, Date.now());

      if (evidence.ready && evidence.progressDelta <= 0) {
        if (evidenceKey !== lastLoggedKey) {
          lastLoggedKey = evidenceKey;
          debug("attachment evidence observed", {
            provider: strategy.provider,
            phase,
            waitedMs: Date.now() - startedAt,
            settleMs: strategy.attachmentSettleMs,
            ...evidence,
          });
        }
        if (stable) {
          debug("attachment ready", {
            provider: strategy.provider,
            phase,
            waitedMs: Date.now() - startedAt,
            ...evidence,
          });
          return evidence;
        }
      }

      await sleep(250);
    }

    const finalSnapshot = captureAttachmentSnapshot(fileName);
    debug("attachment ready timeout", {
      provider: strategy.provider,
      phase,
      fileName,
      timeoutMs: strategy.attachmentTimeoutMs,
      baseline: summarizeAttachmentSnapshot(baseline),
      final: summarizeAttachmentSnapshot(finalSnapshot),
      delta: diffAttachmentSnapshots(baseline, finalSnapshot),
    });
    return null;
  }

  async function waitForAttachmentMinimumAge(attachmentResult, strategy) {
    const remainingMs = Math.max(
      0,
      strategy.attachmentMinAgeMs - (performance.now() - attachmentResult.pastedAt),
    );
    if (!remainingMs) return;
    debug("attachment minimum age wait", {
      provider: strategy.provider,
      remainingMs: Number(remainingMs.toFixed(1)),
      minimumAgeMs: strategy.attachmentMinAgeMs,
    });
    await sleep(remainingMs);
  }

  function captureAttachmentSnapshot(fileName, root = document) {
    const normalizedName = normalizeText(fileName).toLowerCase();
    const normalizedStem = normalizedName.replace(/\.[^.]+$/, "");
    const filenameNeedles = [
      normalizedName,
      normalizedStem,
      "pasted-text",
      "pasted text",
      "粘贴的文本",
    ]
      .filter((value) => value.length >= 4);
    const semanticSelectors = [
      "[class*='attachment' i]",
      "[class*='file-card' i]",
      "[class*='file-chip' i]",
      "[class*='file-item' i]",
      "[class*='file-preview' i]",
      "[data-testid*='attachment' i]",
      "[data-testid*='file' i]",
      "[data-test-id*='attachment' i]",
      "[data-test-id*='file' i]",
      "[aria-label*='attachment' i]",
      "[aria-label*='附件' i]",
    ];
    const pageText = normalizeText(root.innerText || root.body?.innerText || "").toLowerCase();
    const filenameVisible = filenameNeedles.some((needle) => pageText.includes(needle));
    const query = (selectors) => root === document ? deepQueryAll(selectors) : Array.from(root.querySelectorAll?.(selectors.join(",")) || []);
    const filenameNodes = (filenameVisible ? query(["*"]) : []).filter((node) => {
      if (!isVisibleEditable(node)) return false;
      const text = normalizeText(node.textContent || "").toLowerCase();
      if (!text || text.length > Math.max(240, normalizedName.length + 160)) return false;
      return filenameNeedles.some((needle) => text.includes(needle));
    });
    const semanticNodes = query(semanticSelectors)
      .filter(isVisibleEditable)
      .filter((node) => !node.matches?.("button, [role='button'], label, input"));
    const candidateCounts = countSignatures([...filenameNodes, ...semanticNodes]);
    const fileInputFiles = query(['input[type="file"]'])
      .flatMap((input) => Array.from(input.files || []))
      .map((file) => `${file.name}|${file.size}|${file.type}`);
    const progressCounts = countSignatures(query([
      "progress",
      "[role='progressbar']",
      "[aria-busy='true']",
      "[class*='uploading' i]",
      "[class*='upload-progress' i]",
    ]).filter(isVisibleEditable));

    return {
      candidateCounts,
      fileInputFiles,
      progressCounts,
      candidatePreview: [...candidateCounts.keys()].slice(0, 8),
    };
  }

  function countSignatures(nodes) {
    const counts = new Map();
    for (const node of nodes) {
      const signature = describeAttachmentNode(node);
      counts.set(signature, (counts.get(signature) || 0) + 1);
    }
    return counts;
  }

  function describeAttachmentNode(node) {
    return [
      node.tagName || "",
      String(node.className || "").slice(0, 120),
      node.getAttribute?.("aria-label") || "",
      node.getAttribute?.("title") || "",
      normalizeText(node.textContent || "").slice(0, 160),
    ].join("|");
  }

  function diffAttachmentSnapshots(before, after) {
    const candidateDelta = positiveCountDelta(before.candidateCounts, after.candidateCounts);
    const progressDelta = positiveCountDelta(before.progressCounts, after.progressCounts);
    const fileInputDelta = Math.max(0, after.fileInputFiles.length - before.fileInputFiles.length);
    const candidateSignatures = [...after.candidateCounts.keys()]
      .filter((signature) => (after.candidateCounts.get(signature) || 0) > (before.candidateCounts.get(signature) || 0))
      .slice(0, 8);
    const ready = candidateDelta > 0 || fileInputDelta > 0;
    return {
      ready,
      kind: fileInputDelta > 0 ? "fileInput" : candidateDelta > 0 ? "visibleIndicator" : "",
      candidateDelta,
      candidateSignatures,
      fileInputDelta,
      progressDelta,
    };
  }

  function positiveCountDelta(before, after) {
    let delta = 0;
    for (const [signature, count] of after.entries()) {
      delta += Math.max(0, count - (before.get(signature) || 0));
    }
    return delta;
  }

  function summarizeAttachmentSnapshot(snapshot) {
    return {
      candidateCount: [...snapshot.candidateCounts.values()].reduce((sum, count) => sum + count, 0),
      fileInputFileCount: snapshot.fileInputFiles.length,
      progressCount: [...snapshot.progressCounts.values()].reduce((sum, count) => sum + count, 0),
      candidatePreview: snapshot.candidatePreview,
    };
  }

  async function trySubmit(input, sendButton, prompt, beforeValue, attachment, strategy) {
    if (!isClickable(sendButton)) {
      debug("send button still disabled", {
        className: sendButton.className,
        text: sendButton.textContent,
        disabled: sendButton.disabled,
        ariaDisabled: sendButton.getAttribute("aria-disabled"),
      });
      return { submitted: false, attachmentConsumed: false };
    }

    const composerRoot = findComposerRoot(input, sendButton);
    const attachmentBefore = attachment?.content
      ? captureAttachmentSnapshot(attachment.name, composerRoot)
      : null;
    debug("submission baseline", {
      provider: strategy.provider,
      composerRoot: describeComposerRoot(composerRoot),
      attachment: attachmentBefore ? summarizeAttachmentSnapshot(attachmentBefore) : null,
    });

    const attempts = [
      () => clickLikeUser(sendButton),
      () => pressEnter(input),
      () => clickLikeUser(sendButton),
    ];

    for (let index = 0; index < attempts.length; index += 1) {
      attempts[index]();
      debug("submit attempt", { attempt: index + 1 });
      if (await waitForSubmissionEffect(input, sendButton, prompt, beforeValue, 2500)) {
        const attachmentConsumed = attachmentBefore
          ? await waitForAttachmentConsumed(attachment.name, attachmentBefore, composerRoot, 5000)
          : true;
        debug("submission confirmed", {
          provider: strategy.provider,
          attempt: index + 1,
          attachmentConsumed,
        });
        return { submitted: true, attachmentConsumed };
      }
    }

    return { submitted: false, attachmentConsumed: false };
  }

  function findComposerRoot(input, sendButton) {
    let current = input;
    while (current && current !== document.body) {
      if (current.contains?.(sendButton)) return current;
      current = current.parentElement;
    }
    return input.closest?.("form") || input.parentElement || document.body;
  }

  function describeComposerRoot(root) {
    return {
      tag: root?.tagName || "",
      className: String(root?.className || "").slice(0, 160),
      childCount: root?.childElementCount || 0,
    };
  }

  async function waitForAttachmentConsumed(fileName, before, root, timeoutMs) {
    const startedAt = Date.now();
    const beforeCount = totalAttachmentCandidateCount(before);
    while (Date.now() - startedAt <= timeoutMs) {
      const current = captureAttachmentSnapshot(fileName, root);
      const currentCount = totalAttachmentCandidateCount(current);
      if (currentCount < beforeCount || (!root.isConnected && currentCount === 0)) {
        debug("attachment consumed", {
          fileName,
          waitedMs: Date.now() - startedAt,
          beforeCount,
          currentCount,
        });
        return true;
      }
      await sleep(150);
    }

    const final = captureAttachmentSnapshot(fileName, root);
    debug("attachment consumption timeout", {
      fileName,
      timeoutMs,
      before: summarizeAttachmentSnapshot(before),
      final: summarizeAttachmentSnapshot(final),
      composerRoot: describeComposerRoot(root),
    });
    return false;
  }

  function totalAttachmentCandidateCount(snapshot) {
    return [...snapshot.candidateCounts.values()].reduce((sum, count) => sum + count, 0)
      + snapshot.fileInputFiles.length;
  }

  async function waitForFilledInput(input, prompt, timeoutMs) {
    const startedAt = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        if (hasPromptPreview(readInputValue(input), prompt)) {
          resolve(true);
          return;
        }
        if (Date.now() - startedAt > timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  function clickLikeUser(element) {
    if (!element) return;
    if (!isClickable(element)) {
      debug("skip click on disabled element", {
        tag: element.tagName,
        className: element.className,
        text: element.textContent,
      });
      return;
    }
    const options = { bubbles: true, cancelable: true, view: window, button: 0 };
    element.dispatchEvent(new MouseEvent("pointerdown", options));
    element.dispatchEvent(new MouseEvent("mousedown", options));
    element.dispatchEvent(new MouseEvent("mouseup", options));
    element.dispatchEvent(new MouseEvent("click", options));
  }

  function pressEnter(input) {
    if (!input) return;
    const options = {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      code: "Enter",
      which: 13,
      keyCode: 13,
    };
    input.dispatchEvent(new KeyboardEvent("keydown", options));
    input.dispatchEvent(new KeyboardEvent("keypress", options));
    input.dispatchEvent(new KeyboardEvent("keyup", options));
  }

  async function waitForSubmissionEffect(input, sendButton, prompt, beforeValue, timeoutMs) {
    const startedAt = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        const currentValue = readInputValue(input);
        const normalizedCurrent = normalizeText(currentValue);
        const normalizedPrompt = normalizeText(prompt);
        const normalizedBefore = normalizeText(beforeValue);
        const sendDisabled = !isClickable(sendButton);
        const inputCleared = !normalizedCurrent || normalizedCurrent === normalizedBefore || normalizedCurrent === "";
        const inputChangedAway = normalizedCurrent && normalizedCurrent !== normalizedPrompt && normalizedCurrent !== normalizedBefore;
        if (sendDisabled || inputCleared || inputChangedAway) {
          resolve(true);
          return;
        }
        if (Date.now() - startedAt > timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(tick, 150);
      };
      tick();
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function watchKimiLocation() {
    let lastHref = "";
    const report = () => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      chrome.runtime.sendMessage({
        source: SOURCE,
        type: "PAGE_PILOT_KIMI_LOCATION",
        href: location.href,
      }).catch(() => {});
      debug("location reported", { href: location.href });
    };

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    history.pushState = function pushState(...args) {
      const result = originalPushState.apply(this, args);
      setTimeout(report, 0);
      return result;
    };
    history.replaceState = function replaceState(...args) {
      const result = originalReplaceState.apply(this, args);
      setTimeout(report, 0);
      return result;
    };

    window.addEventListener("popstate", report);
    setInterval(report, 2000);
    report();
  }

  function announceReady({ requestId = null, reason = "initial" } = {}) {
    if (readyNotified && !requestId) return;
    readyNotified = true;
    chrome.runtime.sendMessage({
      source: SOURCE,
      type: "PAGE_PILOT_DEEPSEEK_READY",
      href: location.href,
      requestId,
      reason,
    }).catch(() => {});
    debug("ready announced", { requestId, reason });
  }

  function fillInput(input, value) {
    const beforeValue = readInputValue(input);
    debug("fillInput start", {
      tag: input.tagName,
      valueLength: value.length,
      beforeLength: beforeValue.length,
      beforeRepeatedPromptCount: countOccurrences(beforeValue, value),
    });
    clickAndFocus(input);
    input.focus();

    if (input.matches("textarea")) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
      if (descriptor?.set) {
        descriptor.set.call(input, value);
      } else {
        input.value = value;
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    clearEditableInput(input);
    setEditableSelection(input);
    const pasted = dispatchTextPaste(input, value);
    if (!pasted || !hasPromptPreview(readInputValue(input), value)) {
      setLexicalContent(input, value);
      setEditableSelection(input);
      dispatchSyntheticInput(input, "", "insertReplacementText");
    }
    debug("fillInput complete", {
      afterLength: readInputValue(input).length,
      repeatedPromptCount: countOccurrences(readInputValue(input), value),
      pasteAttempted: pasted,
    });
  }

  function clickAndFocus(input) {
    const rect = input.getBoundingClientRect();
    const x = rect.left + Math.min(rect.width - 4, Math.max(4, rect.width / 2));
    const y = rect.top + Math.min(rect.height - 4, Math.max(4, rect.height / 2));
    input.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y }));
    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
    input.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
    input.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
  }

  function setEditableSelection(input) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function dispatchSyntheticInput(input, value, inputType) {
    input.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType,
      data: value,
    }));
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      composed: true,
      inputType,
      data: value,
    }));
  }

  function dispatchTextPaste(input, value) {
    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", value);
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData: dataTransfer,
      });
      input.dispatchEvent(event);
      debug("text paste attempted", {
        defaultPrevented: event.defaultPrevented,
        valueLength: value.length,
        afterLength: readInputValue(input).length,
      });
      return true;
    } catch (error) {
      debug("text paste failed", String(error?.message || error));
      return false;
    }
  }

  function clearEditableInput(input) {
    input.textContent = "";
    input.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: "deleteContentBackward",
      data: null,
    }));
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      composed: true,
      inputType: "deleteContentBackward",
      data: null,
    }));
  }

  function setLexicalContent(input, value) {
    const paragraphs = String(value || "")
      .split(/\n+/)
      .map((line) => escapeHtml(line) || "<br>")
      .map((line) => `<p><span data-lexical-text=\"true\">${line}</span></p>`)
      .join("");
    input.innerHTML = paragraphs || '<p><br></p>';
    debug("lexical content assigned", {
      childCount: input.childElementCount,
    });
  }

  function readInputValue(input) {
    if (!input) return "";
    if (input.matches?.("textarea") || input.matches?.("input")) {
      return input.value || "";
    }
    return input.innerText || input.textContent || "";
  }

  function normalizeText(value) {
    return String(value || "").replace(/\u00a0/g, " ").trim();
  }

  function hasPromptPreview(value, prompt) {
    const currentValue = normalizeText(value);
    const targetValue = normalizeText(prompt);
    return Boolean(currentValue && targetValue && currentValue.includes(targetValue.slice(0, Math.min(30, targetValue.length))));
  }

  function countOccurrences(value, needle) {
    const text = normalizeText(value);
    const target = normalizeText(needle);
    if (!text || !target) return 0;

    let count = 0;
    let index = 0;
    while (index < text.length) {
      const foundAt = text.indexOf(target, index);
      if (foundAt === -1) break;
      count += 1;
      index = foundAt + target.length;
    }
    return count;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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

})();
