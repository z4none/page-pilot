const FALLBACK_MESSAGES = {
  attachmentNotReady: "The AI page attachment is not ready. Sending stopped.",
  inputNotFilled: "The AI page input did not show the prompt.",
  attachmentUnstable: "The AI page attachment was not stable before submission. Sending stopped.",
  submitNotConfirmed: "The AI page did not confirm submission; the prompt remains in the input.",
  attachmentNotConsumed: "The prompt was submitted, but the attachment remains in the input.",
  extractionTooShort: "Extracted content is too short",
  noArticle: "No extractable main content was found",
};

export function t(key, substitutions) {
  const message = globalThis.chrome?.i18n?.getMessage?.(key, substitutions);
  return message || FALLBACK_MESSAGES[key] || key;
}

export function applyI18n(root = document) {
  document.documentElement.lang = String(globalThis.chrome?.i18n?.getUILanguage?.() || "en");
  root.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-title]").forEach((element) => {
    const value = t(element.dataset.i18nTitle);
    element.title = value;
    element.setAttribute("aria-label", value);
  });
}
