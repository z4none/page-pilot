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
      throw new Error(t("attachmentNotReady"));
    }
  }

  const beforeValue = readComposerValue(input);
  fillPrompt(input, message.prompt);
  const filled = await verifyPrompt(input, message.prompt);
  if (!filled) {
    throw new Error(t("inputNotFilled"));
  }

  if (message.autoSend) {
    if (attachmentResult && verifyAttachmentForSubmit) {
      const stillReady = await verifyAttachmentForSubmit(attachmentResult, input);
      if (!stillReady) {
        throw new Error(t("attachmentUnstable"));
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
      throw new Error(t("submitNotConfirmed"));
    }
    if (attachmentResult && submitResult?.attachmentConsumed === false) {
      throw new Error(t("attachmentNotConsumed"));
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
import { t } from "./i18n.js";
