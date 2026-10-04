export function isActuallyEditableInput(element) {
  if (!element) return false;
  if (element.disabled || element.readOnly) return false;
  const contentEditable = element.getAttribute?.("contenteditable");
  if (contentEditable === "false") return false;
  if (contentEditable === "true") return true;
  return element.matches?.("textarea, input") || Boolean(element.isContentEditable);
}

export async function waitForStableProviderInput({
  getReadyState,
  findInput,
  isUsableInput,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  documentReadyTimeoutMs = 30000,
  inputTimeoutMs = 30000,
  settleMs = 0,
  pollIntervalMs = 100,
}) {
  const documentStartedAt = now();
  while (getReadyState() !== "complete") {
    if (now() - documentStartedAt >= documentReadyTimeoutMs) {
      throw new Error("AI 网页未完成加载");
    }
    await sleep(pollIntervalMs);
  }

  const inputStartedAt = now();
  let stableInput = null;
  let stableSince = 0;
  while (now() - inputStartedAt <= inputTimeoutMs) {
    const input = findInput();
    const usable = Boolean(input && input.isConnected !== false && isUsableInput(input));
    if (!usable) {
      stableInput = null;
      stableSince = 0;
    } else if (input !== stableInput) {
      stableInput = input;
      stableSince = now();
    } else if (now() - stableSince >= settleMs) {
      return input;
    }
    await sleep(pollIntervalMs);
  }

  throw new Error("AI 网页未找到稳定的输入框");
}
