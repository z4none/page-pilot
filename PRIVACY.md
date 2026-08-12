# Privacy Policy for Page Pilot

**Last updated: August 12, 2026**

Page Pilot is an open-source Chrome extension that extracts the main content of a page you choose and sends it to an AI web chat that you select in the extension. This policy explains what the extension processes, where it is stored, and when it leaves your browser.

## Summary

- Page Pilot does not operate a backend service, model proxy, analytics service, or advertising service.
- Page Pilot does not collect API keys, passwords, payment information, or account credentials.
- Page content is processed only after you explicitly choose **Summarize page with Page Pilot** from the page context menu.
- When you request a summary, the extracted page title, URL, and body are sent to the AI provider you selected in the extension. That provider's own privacy policy and account terms apply.

## Information Processed

When you start a summary, Page Pilot may process the following information from the active page:

- The page title and URL.
- The main page content extracted from the page.
- A text attachment created from that information.
- The summary prompt, including any prompt you customize in settings.

The extension also processes the selected AI provider and the provider chat URL used to continue your current conversation.

## How Information Is Used and Shared

Page Pilot uses the extracted content solely to prepare and submit the summary request you initiate. The extension runs the selected provider's web interface in the Chrome side panel and pastes the attachment and prompt into that interface.

The extension does **not** send this information to a Page Pilot server or to the developer. It does not sell, rent, share, or use page content for advertising, profiling, or training its own models.

Your summary request is sent through the selected provider's website, currently Kimi, DeepSeek, or Gemini. The provider may receive the attachment, prompt, account information, and related technical information according to its own policies. Review the applicable provider policy before submitting sensitive content.

## Local Storage

Page Pilot uses Chrome storage as follows:

- `chrome.storage.session` stores the current extracted payload, pending send state, and the active chat URL for each provider. Session data is cleared when the browser session ends, and the extension also provides a session reset control.
- `chrome.storage.sync` stores extension settings, including the selected provider, maximum prompt length, and an optional customized summary prompt. Chrome may synchronize this data across browsers signed into the same Chrome profile, subject to Chrome Sync settings.

Page Pilot does not intentionally store the extracted page attachment in sync storage.

## Permissions

Page Pilot requests permissions only to provide its features:

- `activeTab`, `scripting`, and host access to extract content from the page you explicitly ask it to summarize.
- `contextMenus` to provide the page-summary command.
- `sidePanel` to show the selected AI web chat.
- `storage` to retain settings, pending session data, and provider chat URLs.
- `tabs` to open the side panel for the current browser window.
- `declarativeNetRequest` to enable supported provider pages to render in the side-panel iframe.

The extension's provider automation scripts run only on the configured Kimi, DeepSeek, and Gemini domains. Page extraction is initiated only after your context-menu action.

## Third-Party AI Providers

Page Pilot relies on third-party AI websites and does not control their data handling, authentication, retention, or security practices. You must be signed in to a provider yourself when required. Do not use Page Pilot to submit information that you are not authorized to share with that provider.

## Security Notes

To embed supported provider pages, Page Pilot uses Chrome's declarative network request rules to remove framing-related response headers for DeepSeek and Gemini only. This changes how those provider pages are displayed inside the extension; it does not grant Page Pilot access to your passwords or bypass provider authentication, access controls, or payment restrictions.

As with any browser extension that reads a page and sends content to a third party, review the source code and use care with sensitive, private, or regulated information.

## Changes to This Policy

We may update this policy when the extension's data practices change. The latest version is published in this repository.

## Contact

For privacy questions or requests, open an issue in the [Page Pilot GitHub repository](https://github.com/z4none/page-pilot/issues).
