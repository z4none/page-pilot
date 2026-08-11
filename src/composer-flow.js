export async function runComposerFlow({
  message,
  waitForInput,
  attachAttachment,
  fillPrompt,
  verifyPrompt,
  verifyAttachmentForSubmit,
  submitPrompt,
}) {
  const input = await waitForInput();
  let attachmentResult = null;

  if (message.attachment?.content) {
    attachmentResult = await attachAttachment(message.attachment, input);
    if (!attachmentResult?.ready) {
      throw new Error("AI 网页附件未就绪，已停止发送");
    }
  }

  const beforeValue = readComposerValue(input);
  fillPrompt(input, message.prompt);
  const filled = await verifyPrompt(input, message.prompt);
  if (!filled) {
    throw new Error("AI 网页输入框未实际显示待发送内容");
  }

  if (message.autoSend) {
    if (attachmentResult && verifyAttachmentForSubmit) {
      const stillReady = await verifyAttachmentForSubmit(attachmentResult, input);
      if (!stillReady) {
        throw new Error("AI 网页附件在提交前仍未稳定，已停止发送");
      }
    }

    const submitResult = await submitPrompt({
      input,
      prompt: message.prompt,
      beforeValue,
      attachmentResult,
    });
    const submitted = typeof submitResult === "object"
      ? Boolean(submitResult?.submitted)
      : Boolean(submitResult);
    if (!submitted) {
      throw new Error("AI 网页未确认提交，输入框内容仍在");
    }
    if (attachmentResult && submitResult?.attachmentConsumed === false) {
      throw new Error("提示词已提交，但附件仍留在输入区");
    }
  }

  return { input, attachmentResult };
}

export function createStabilityTracker(settleMs) {
  let stableKey = "";
  let stableSince = 0;

  return {
    observe(observation, now = Date.now()) {
      if (!observation?.ready || observation.blocked) {
        stableKey = "";
        stableSince = 0;
        return false;
      }

      if (stableKey !== observation.key) {
        stableKey = observation.key;
        stableSince = now;
        return false;
      }

      return now - stableSince >= settleMs;
    },
  };
}

function readComposerValue(input) {
  if (!input) return "";
  if (input.matches?.("textarea") || input.matches?.("input")) {
    return input.value || "";
  }
  return input.innerText || input.textContent || "";
}
