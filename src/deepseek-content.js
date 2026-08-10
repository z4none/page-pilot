(() => {
  const SOURCE = "page-pilot";
  const DEBUG_PREFIX = "[PAGE-PILOT]";
  const DEBUG_STARTED_AT = performance.now();
  const handledRequests = new Set();
  let readyNotified = false;

  debug("content script loaded", {
    href: location.href,
    top: window.self === window.top,
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.source !== SOURCE) return;

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

  watchKimiLocation();
  announceReady();

  function findChatInput() {
    const candidates = deepQueryAll([
      ".chat-input-editor",
      'div[role="textbox"][contenteditable="true"]',
      '[contenteditable="true"]',
      "textarea",
    ]);

    return candidates.find((element) => isVisibleEditable(element)) || null;
  }

  function findSendButton() {
    const candidates = [
      'button[type="submit"]',
      'button[aria-label*="send" i]',
      'button[aria-label*="发送" i]',
      ".send-button-container",
      '[role="button"].ds-button--primary.ds-button--circle',
      '[role="button"].ds-button--primary.ds-button--icon-relative-m',
      '[role="button"][aria-label*="send" i]',
      '[role="button"][aria-label*="发送" i]',
    ];

    for (const selector of candidates) {
      const element = deepQueryOne(selector);
      if (isClickable(element)) return element;
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
      candidates: deepQueryAll(["button", "[role='button']"])
        .filter((element) => isVisibleEditable(element))
        .slice(0, 12)
        .map((element) => ({
          tag: element.tagName,
          className: String(element.className || ""),
          ariaLabel: element.getAttribute("aria-label") || "",
          text: String(element.textContent || "").trim().slice(0, 80),
          clickable: isClickable(element),
        })),
    };
  }

  function findFileInput() {
    const inputs = deepQueryAll(['input[type="file"]']);
    return inputs.find((input) => !input.disabled) || null;
  }

  function findUploadTrigger() {
    const selectors = [
      'button[aria-label*="upload" i]',
      'button[aria-label*="上传" i]',
      'button[title*="upload" i]',
      'button[title*="上传" i]',
      'button[aria-label*="附件" i]',
      'button[aria-label*="文件" i]',
      '[role="button"][aria-label*="upload" i]',
      '[role="button"][aria-label*="上传" i]',
      '[role="button"][aria-label*="附件" i]',
      '[role="button"][aria-label*="文件" i]',
    ];

    for (const selector of selectors) {
      const element = deepQueryOne(selector);
      if (isClickable(element)) return element;
    }

    const buttons = deepQueryAll(["button", "[role='button']", "label"]);
    return buttons.find((button) => {
      const text = `${button.textContent || ""} ${button.getAttribute("aria-label") || ""} ${button.getAttribute("title") || ""}`;
      return /upload|上传|附件|文件|attach|\+|add file|choose file/i.test(text) && isClickable(button);
    }) || null;
  }

  function isClickable(element) {
    if (!element) return false;
    if (element.disabled) return false;
    if (element.getAttribute("aria-disabled") === "true") return false;
    if (element.classList?.contains("disabled")) return false;
    if (element.className && String(element.className).includes("--disabled")) return false;
    return isVisibleEditable(element);
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
      if (message.attachment?.content) {
        await attachAttachment(message.attachment);
      }

      const input = await waitForElement(findChatInput, 30000);
      debug("input found", {
        tag: input.tagName,
        className: input.className,
        role: input.getAttribute("role"),
        contentEditable: input.getAttribute("contenteditable"),
        textLength: readInputValue(input).length,
      });
      const beforeValue = readInputValue(input);
      debug("fill path selected", {
        tag: input.tagName,
        isTextarea: input.matches("textarea"),
        isContentEditable: input.isContentEditable,
        beforeLength: beforeValue.length,
      });
      fillInput(input, message.prompt);
      debug("input filled", {
        promptLength: message.prompt?.length || 0,
        afterLength: readInputValue(input).length,
        repeatedPromptCount: countOccurrences(readInputValue(input), message.prompt),
      });
      const filled = await waitForFilledInput(input, message.prompt, 1500);
      debug("filled input verified", {
        filled,
        currentLength: readInputValue(input).length,
        currentPreview: readInputValue(input).slice(0, 120),
        repeatedPromptCount: countOccurrences(readInputValue(input), message.prompt),
      });
      if (!filled) {
        throw new Error("AI 网页输入框未实际显示待发送内容");
      }

      if (message.autoSend) {
        await sleep(1000);
        const sendButton = await waitForElement(findSendButton, 15000, describeSendButtonCandidates);
        debug("send button found", {
          tag: sendButton.tagName,
          className: sendButton.className,
          text: sendButton.textContent,
          clickable: isClickable(sendButton),
        });
        const submitted = await trySubmit(input, sendButton, message.prompt, beforeValue);
        if (!submitted) {
          throw new Error("AI 网页未确认提交，输入框内容仍在");
        }
      }

      return { ok: true };
    } catch (error) {
      debug("handleSendPrompt failed", { error: String(error?.message || error) });
      return {
        ok: false,
        error: String(error?.message || error),
      };
    }
  }

  async function attachAttachment(attachment) {
    const file = new File([attachment.content || ""], attachment.name || "page-summary.md", {
      type: attachment.mimeType || "text/markdown",
    });
    const startedAt = performance.now();
    const fastTimeoutMs = 1500;
    const inputTimeoutMs = 3000;

    debug("attachAttachment start", {
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      fastTimeoutMs,
      inputTimeoutMs,
    });

    let fileInput = findFileInput();
    debug("attachment file input search", {
      found: Boolean(fileInput),
      fileInputCount: deepQueryAll(['input[type="file"]']).length,
    });
    const pasteTarget = findDropTarget() || document.body;
    const pasted = dispatchFilePaste(pasteTarget, file);
    debug("attachment paste attempted", {
      targetTag: pasteTarget.tagName,
      targetClass: String(pasteTarget.className || ""),
      pasted,
      fileName: file.name,
      fileSize: file.size,
      timeoutMs: fastTimeoutMs,
    });
    if (pasted) {
      const visible = await waitForAttachmentIndicator(file.name, fastTimeoutMs);
      debug("attachment paste verified", {
        fileName: file.name,
        visible,
        elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
      });
      if (visible) {
        debug("attachAttachment complete", {
          method: "paste",
          elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
        });
        return;
      }
    }

    const dropTarget = findDropTarget();
    if (!fileInput && dropTarget) {
      const dropped = dispatchFileDrop(dropTarget, file);
      debug("attachment drop attempted", {
        targetTag: dropTarget.tagName,
        targetClass: String(dropTarget.className || ""),
        dropped,
        fileName: file.name,
        fileSize: file.size,
        timeoutMs: fastTimeoutMs,
      });
      if (dropped) {
        const visible = await waitForAttachmentIndicator(file.name, fastTimeoutMs);
        debug("attachment drop verified", {
          fileName: file.name,
          visible,
          elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
        });
        if (visible) {
          debug("attachAttachment complete", {
            method: "drop",
            elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
          });
          return;
        }
      }
    }

    if (!fileInput) {
      const trigger = findUploadTrigger();
      debug("attachment trigger search", {
        found: Boolean(trigger),
        triggerText: trigger?.textContent || "",
        triggerAria: trigger?.getAttribute("aria-label") || "",
      });
      if (trigger) {
        debug("upload trigger clicked", {
          tag: trigger.tagName,
          text: trigger.textContent,
          ariaLabel: trigger.getAttribute("aria-label"),
        });
        clickLikeUser(trigger);
        await sleep(500);
        fileInput = findFileInput();
      }
    }

    if (!fileInput) {
      debug("attachment entry not found", {
        selectors: ["input[type=file]", "upload trigger", "drop target"],
        pasted,
      });
      if (pasted) {
        debug("attachAttachment complete", {
          method: "pasteUnverified",
          reason: "file paste dispatched but no visible attachment indicator or upload input was found",
          elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
        });
        return;
      }
      throw new Error("AI 网页未找到文件上传入口");
    }

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    try {
      fileInput.files = dataTransfer.files;
    } catch {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files");
      descriptor?.set?.call(fileInput, dataTransfer.files);
    }

    fileInput.dispatchEvent(new Event("input", { bubbles: true }));
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));

    debug("attachment injected", {
      inputType: fileInput.type,
      inputName: fileInput.name,
      fileName: file.name,
      fileSize: file.size,
      timeoutMs: inputTimeoutMs,
    });

    const visible = await waitForAttachmentIndicator(file.name, inputTimeoutMs);
    debug("attachment input verified", {
      fileName: file.name,
      visible,
      elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
    });
    if (!visible) {
      throw new Error("AI 网页未显示已上传附件");
    }
    debug("attachAttachment complete", {
      method: "fileInput",
      elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
    });
  }

  async function waitForAttachmentIndicator(fileName, timeoutMs) {
    const startedAt = Date.now();
    const target = normalizeText(fileName);
    debug("attachment indicator wait start", {
      fileName,
      timeoutMs,
    });

    return new Promise((resolve) => {
      const tick = () => {
        const nodes = deepQueryAll(["*"]);
        const visible = nodes.some((node) => {
          if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
          if (!isVisibleEditable(node) && node !== document.body && node !== document.documentElement) return false;
          const text = normalizeText(node.textContent || "");
          return text && (text.includes(target) || text.includes(target.slice(0, Math.min(24, target.length))));
        });

        if (visible) {
          resolve(true);
          return;
        }

        if (Date.now() - startedAt > timeoutMs) {
          debug("attachment indicator timeout", {
            fileName,
            timeoutMs,
            waitedMs: Date.now() - startedAt,
          });
          resolve(false);
          return;
        }

        setTimeout(tick, 250);
      };
      tick();
    });
  }

  function findDropTarget() {
    const targets = [
      document.body,
      document.documentElement,
      findChatInput(),
    ].filter(Boolean);

    return targets.find((element) => isVisibleEditable(element) || element === document.body || element === document.documentElement) || null;
  }

  function dispatchFileDrop(target, file) {
    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      const events = [
        new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer }),
        new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }),
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }),
      ];

      for (const event of events) {
        target.dispatchEvent(event);
      }

      return true;
    } catch (error) {
      debug("file drop failed", String(error?.message || error));
      return false;
    }
  }

  function dispatchFilePaste(target, file) {
    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      });

      target.dispatchEvent(event);
      return !event.defaultPrevented;
    } catch (error) {
      debug("file paste failed", String(error?.message || error));
      return false;
    }
  }

  async function trySubmit(input, sendButton, prompt, beforeValue) {
    if (!isClickable(sendButton)) {
      debug("send button still disabled", {
        className: sendButton.className,
        text: sendButton.textContent,
        disabled: sendButton.disabled,
        ariaDisabled: sendButton.getAttribute("aria-disabled"),
      });
      return false;
    }

    const attempts = [
      () => clickLikeUser(sendButton),
      () => pressEnter(input),
      () => clickLikeUser(sendButton),
    ];

    for (let index = 0; index < attempts.length; index += 1) {
      attempts[index]();
      debug("submit attempt", { attempt: index + 1 });
      if (await waitForSubmissionEffect(input, sendButton, prompt, beforeValue, 2500)) {
        debug("submission confirmed", { attempt: index + 1 });
        return true;
      }
    }

    return false;
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

  function announceReady() {
    if (readyNotified) return;
    readyNotified = true;
    chrome.runtime.sendMessage({
      source: SOURCE,
      type: "PAGE_PILOT_DEEPSEEK_READY",
      href: location.href,
    }).catch(() => {});
    debug("ready announced");
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
