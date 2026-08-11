# Page Pilot

[简体中文](README.zh-CN.md)

Page Pilot is an open-source Chrome extension that summarizes the current page in an AI web chat embedded in the browser side panel.

> **No API key required.** It reuses the web session you have already signed in to on Kimi, DeepSeek, or Gemini. No model API account, key, or API billing setup is needed.

## Features

- Summarize the current page from the `Summarize page` context-menu item.
- Extract main content, attach the title, URL, and body as a text file, then send a concise summary request.
- Use Kimi, DeepSeek, or Gemini in the side panel and reuse each provider's current chat session.
- Check the exact extracted attachment from the side-panel toolbar.
- Use a short localized default prompt: 3-5 key points, one to three follow-up questions, and no source-text repetition.
- Localize the extension from Chrome's UI language: English (default), Simplified Chinese, Japanese, and Korean. Other locales fall back to English.
- Fall back to visible text from the semantic main container if Web Components cause HTML-to-Markdown conversion to lose content.

## Use

1. Select an AI provider in the side-panel settings and sign in on its page.
2. Open a page and wait for its content to load.
3. Right-click the page and select `Summarize page`.
4. Page Pilot prepares the attachment and prompt, then sends them to the selected provider.

## Development

```bash
npm install
npm run build
npm run check
```

Load the `dist` directory from `chrome://extensions` with Developer mode enabled. Run `npm run build` and reload the unpacked extension after source changes.

## Security and Privacy

This project does not use a developer-operated model proxy or backend. However, no API key does **not** mean page content stays entirely local: when you request a summary, the page title, URL, and extracted body are sent to the AI provider you selected and are subject to that provider's account and privacy policies.

- Login happens on the provider's own page; Page Pilot does not ask for account passwords or API keys.
- Pending page content is held in `chrome.storage.session`; provider selection and custom prompts use Chrome sync storage.
- Content is read and sent only after you invoke the page context-menu action. Use **View extracted content** before sending when auditing a page.
- `activeTab`, `scripting`, and `<all_urls>` allow extraction from the page you explicitly summarize. Provider content scripts match only Kimi, DeepSeek, and Gemini domains.
- To embed DeepSeek and Gemini, the extension uses a `declarativeNetRequest` rule that removes their framing response headers for those domains only. This is security-sensitive; audit the source and use the development build only when you accept this trade-off.
- Provider web UI changes, sign-in restrictions, content policies, and anti-automation measures can affect compatibility. The extension does not bypass access controls or payment restrictions.
