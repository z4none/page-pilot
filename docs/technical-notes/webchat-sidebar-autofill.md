# Web Chat Sidebar Autofill Technical Note

Date: 2026-08-09

## Purpose

This note records the technical path for a Chrome extension that opens an official web chat site, such as Kimi or DeepSeek, inside a browser side panel and automatically fills a prompt generated from the current page.

The goal is not to call a private web chat API directly. The safer experimental path is to reuse the official web UI session and automate prompt insertion.

## Observed Reference Implementation

The inspected Kimi Sidebar extension uses a real Chrome side panel. Its side panel contains an iframe:

```html
<iframe id="iframe-kimi" src="https://www.kimi.com/" frameborder="0"></iframe>
```

The attached JavaScript confirms the core mechanism:

- Detects whether the script is running inside an iframe with `window.self !== window.top`.
- Detects Kimi domains:
  - `https://kimi.moonshot.cn/`
  - `https://www.kimi.com/`
  - `https://kimi.com/`
- Registers selection and page-summary prompts.
- Receives messages inside the iframe via `window.addEventListener("message", ...)`.
- Locates Kimi's chat input with selectors such as:
  - `.chat-input-editor`
  - `div[role="textbox"][contenteditable="true"]`
  - `[contenteditable="true"]`
- Inserts text with `document.execCommand("insertText", false, text)`.
- Locates the send button with `.send-button-container` and clicks it.

This means the extension is likely using:

```text
Chrome sidePanel
└─ extension sidepanel.html
   └─ iframe loading official Kimi web chat

content script on Kimi frame
└─ receives prompt from parent
   └─ fills chat input
      └─ optionally clicks send
```

## Proposed Architecture

For our extension, the equivalent architecture would be:

```text
User page
└─ content script
   └─ extracts readable page content as Markdown

Service worker
└─ registers context menu / extension action
└─ opens Chrome side panel
└─ routes prompt payload to side panel

Chrome side panel
└─ sidepanel.html
   └─ iframe id="iframe-deepseek"
      src="https://chat.deepseek.com/"

Content script on DeepSeek frame
└─ listens for message
└─ waits for chat input
└─ fills prompt
└─ does not auto-send in the first version
```

## Message Flow

1. User clicks the extension action or a context menu item such as `总结页面`.
2. The extension extracts the current page's main content as structured Markdown.
3. The extension builds an initial prompt, for example:

```text
请总结下面页面的主要内容，并列出关键观点、背景信息和可继续追问的问题。

页面内容：
{markdown}
```

4. The service worker opens the side panel for the current tab.
5. The side panel loads the official web chat page in an iframe.
6. The side panel sends the prompt to the iframe using `postMessage`.
7. A content script running inside the web chat iframe receives the prompt.
8. The content script writes the prompt into the chat input and triggers input events.
9. The user reviews the prompt and manually sends it.

## Required Chrome Extension Capabilities

Expected manifest capabilities:

```json
{
  "manifest_version": 3,
  "permissions": [
    "sidePanel",
    "contextMenus",
    "scripting",
    "activeTab",
    "storage"
  ],
  "host_permissions": [
    "https://chat.deepseek.com/*"
  ],
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "content_scripts": [
    {
      "matches": ["https://chat.deepseek.com/*"],
      "js": ["provider-content.js"],
      "all_frames": true
    }
  ]
}
```

The exact permissions can be reduced after implementation is proven.

## Why a Content Script Is Needed Inside the Iframe

The side panel page cannot directly manipulate the DOM of a cross-origin iframe because of browser same-origin rules.

The workable pattern is:

- The side panel owns the iframe container.
- A content script is injected into the target web chat domain.
- The side panel uses `iframe.contentWindow.postMessage(...)`.
- The content script inside the iframe listens for the message and manipulates the web chat page locally.

This is the key technical trick used by the inspected Kimi extension.

## DeepSeek Feasibility Checks

Before committing to the DeepSeek version, validate these points:

1. `https://chat.deepseek.com/` can load inside a Chrome extension side panel iframe.
2. The user's DeepSeek login session is available inside that iframe.
3. The extension can inject a content script into the DeepSeek iframe.
4. The content script can find DeepSeek's input field reliably.
5. Programmatic text insertion is recognized by DeepSeek's frontend.
6. The send button can be detected, though initial MVP should not auto-click it.
7. DeepSeek does not block the iframe path with `X-Frame-Options`, CSP `frame-ancestors`, or runtime frame-busting logic.

If any of the first three checks fail, the fallback is to open DeepSeek in a normal tab and autofill there.

## Prompt Insertion Strategy

For `textarea` inputs:

```js
const setter = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  "value"
).set;

setter.call(textarea, prompt);
textarea.dispatchEvent(new Event("input", { bubbles: true }));
```

For `contenteditable` inputs:

```js
input.focus();
document.execCommand("selectAll");
document.execCommand("delete");
document.execCommand("insertText", false, prompt);
input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
```

The implementation should use a retry loop or `MutationObserver`, because chat inputs often render after login, routing, hydration, or conversation initialization.

## Page Content Extraction Direction

For our product, the preferred content source is not just the page URL. It should be an Obsidian Web Clipper style extraction:

- Detect the main article/body area.
- Remove navigation, ads, footers, related posts, and repeated UI chrome.
- Preserve semantic structure:
  - headings
  - paragraphs
  - lists
  - blockquotes
  - code blocks
  - tables when reasonable
- Convert the result into structured Markdown.

This gives more predictable results than asking the web chat model to fetch the URL itself.

## MVP Recommendation

The first prototype should:

- Use Chrome's real side panel.
- Load DeepSeek web chat in an iframe.
- Extract current page main content to Markdown.
- Generate a summary prompt.
- Autofill the prompt into DeepSeek.
- Avoid automatic sending.
- Keep one conversation per tab if state is needed later.

Avoid in the first version:

- Calling private web chat network APIs directly.
- Auto-sending messages.
- Maintaining long-term conversation archives.
- Supporting multiple providers before DeepSeek is validated.
- Full selected-text workflows.

## Risks

This approach is experimental and may break when the target web chat site changes.

Main risks:

- The target site blocks iframe embedding.
- The input selectors change.
- The login session is unavailable in the iframe.
- The site introduces bot or automation detection.
- The extension store review may object to unclear behavior if automation is not disclosed.
- The target site's terms may restrict automated access or interaction.

The product should present this as a user-assisted workflow: extract content, prepare prompt, fill the official chat UI, and let the user decide when to send.

## Open Questions for Product Discussion

- Should DeepSeek be the only initial provider?
- Should the summary prompt include the source URL and page title?
- Should the sidebar include any extension-native controls around the iframe?
- Should we support "copy prompt" as a fallback when autofill fails?
- Should the extension store version avoid auto-send entirely?
- Should Markdown extraction happen only after user clicks `总结页面内容`?
- Should prompts be persisted per tab, per URL, or not persisted at all?
