# Page Pilot

Chrome extension prototype for summarizing the current page through Kimi web chat.

## What It Does

- Adds a right-click menu item: `总结页面`.
- Extracts the current page's main content with Readability.
- Converts extracted HTML to Markdown with Turndown.
- Shows extracted content and the final prompt in the Chrome side panel.
- After confirmation, opens Kimi in the side panel, uploads the page body as a text attachment, fills the prompt, and optionally sends it.
- Falls back to a URL-based prompt when content extraction fails.

## Setup

```bash
npm install
npm run build
```

## Load In Chrome

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click `Load unpacked`.
4. Select the `dist` directory.
5. Open a normal webpage.
6. Right-click the page and choose `总结页面`.

## First Validation Targets

- Whether `https://www.kimi.com/` loads inside the side panel iframe.
- Whether the Kimi login session is available there.
- Whether the current input and send-button selectors work.
- Whether Kimi accepts programmatic input events from the injected content script.
- Whether Kimi accepts a file upload injected through the side-panel flow.

If Kimi cannot load in the iframe, the next fallback is opening Kimi in a normal tab and autofilling there.
