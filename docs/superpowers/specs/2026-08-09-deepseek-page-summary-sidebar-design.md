# DeepSeek Page Summary Sidebar Design

Date: 2026-08-09

## Goal

Build a Chrome extension that lets a user right-click any page, extract the page's main content as Markdown, show a review step in a browser side panel, and then open a DeepSeek web chat session, paste the generated prompt, and send it.

The first release targets DeepSeek only. Other chat providers can be added later.

## User Flow

1. User opens a webpage.
2. User right-clicks and chooses `Summarize page`.
3. The extension extracts readable page content with a main-content parser.
4. The extension converts the result to Markdown.
5. The extension builds a prompt from a fixed template.
6. The side panel shows a preview of:
   - extracted content
   - the final prompt to be sent
7. The user confirms or edits the prompt.
8. The extension opens or reuses the DeepSeek side-panel session.
9. The extension pastes the prompt into DeepSeek and sends it.
10. If extraction fails, the extension falls back to a URL-based prompt template.

## Core Decisions

- Trigger: context menu only.
- Main path: Readability-style extraction to Markdown.
- Fallback: URL + prompt when extraction fails.
- Provider: DeepSeek first.
- Session strategy: one global DeepSeek conversation.
- Session recovery: if the conversation becomes invalid, start a new one automatically.
- Review step: shown in the same browser side panel before sending.
- Send behavior: automatic after user confirmation.
- Prompt preview: editable prompt only; extracted body stays read-only.
- Storage: `chrome.storage.session` for temporary prompt payloads and session state.
- Settings: minimal settings page, including confirmation toggle and session reset.

## Proposed Architecture

### 1. Content extraction layer

Runs on the source page.

Responsibilities:

- Capture the current page URL and title.
- Extract the page's main readable content.
- Convert the result to Markdown.
- Fall back to a URL-only payload when extraction fails.

Recommended libraries:

- Mozilla Readability for main-content detection.
- Turndown for HTML-to-Markdown conversion.

### 2. Background orchestration layer

Runs in the extension service worker.

Responsibilities:

- Register the context menu item.
- Receive the right-click action.
- Open the side panel.
- Store the generated payload in session storage.
- Route the payload to the review panel.
- Coordinate opening and reusing the DeepSeek iframe session.

### 3. Review side panel

The extension's own Chrome side panel.

Responsibilities:

- Show extraction status.
- Show extracted content preview.
- Show the final prompt.
- Allow editing the prompt only.
- Offer a confirm/send action.
- Show errors when the flow cannot continue.

### 4. DeepSeek web chat host

Loaded inside the extension side panel as an iframe.

Responsibilities:

- Host the official DeepSeek web chat UI.
- Receive a prompt from the extension.
- Expose an input field that can be filled programmatically.
- Send the prompt only after the extension decides to do so.

## Prompt Templates

### Successful extraction

When Markdown extraction succeeds, the prompt should use this structure:

```text
Page title: {title}

Instruction: Please summarize the main content below, extract the key points, and list possible follow-up questions.

Content:
{markdown}
```

The URL is not included in the main body for this path, so the model is less likely to re-fetch the page.

### Extraction fallback

When extraction fails, use a URL-based template:

```text
Page title: {title}
Page URL: {url}

Instruction: Please summarize the page from the link above.
```

This keeps the fallback simple and explicit.

## Data Flow

### Success path

1. Right-click action is received.
2. Source page content is extracted.
3. Markdown is generated.
4. A preview payload is stored in `chrome.storage.session`.
5. The side panel renders the preview.
6. User confirms.
7. The panel opens or reuses the DeepSeek conversation.
8. The prompt is injected into the chat input.
9. The send action is triggered.

### Failure path

1. Extraction or conversion fails.
2. The fallback template is built from title + URL.
3. The same preview flow is shown.
4. User confirms.
5. The extension sends the fallback prompt to DeepSeek.

### Session failure path

1. The extension tries to reuse the global DeepSeek session.
2. If the iframe cannot load the session or no input field is found, the extension treats the session as invalid.
3. The extension opens a fresh DeepSeek session.
4. If the new session still cannot accept input, the extension stops and shows a failure message.

## State Model

Use a single global session state:

- `activeDeepSeekSession`
- `lastPromptPayload`
- `lastSourceUrl`
- `lastSourceTitle`
- `lastExtractionMode` (`markdown` or `url`)
- `lastError`

Persist only temporary state in `chrome.storage.session`.
Do not keep long-term chat history in the extension.

## Review Side Panel UI

The side panel should stay compact and functional.

Recommended sections:

- Header with current mode and status.
- Extraction result preview.
- Prompt preview editor.
- Primary action button: `Send to DeepSeek`.
- Secondary actions:
  - `Retry extraction`
  - `Reset session`
  - `Open settings`

The preview area should be editable only for the final prompt. The extracted body remains read-only.

## Settings

Keep settings small and practical:

- `Skip confirmation step`
- `Reset DeepSeek session`
- `Maximum prompt length`

Default maximum prompt length: 12,000 characters.

When a prompt is too long:

- truncate it automatically
- preserve the most relevant extracted sections first

## DeepSeek Integration Notes

The extension should use the browser side panel plus an iframe that hosts the official DeepSeek web chat UI.

The injection strategy should:

- wait for the chat input to exist
- fill the input using DOM-safe input events
- click send only after the confirmation step or after the skip-confirmation setting is enabled

If the iframe cannot load DeepSeek or no input field is found, the extension must show a clear error and stop. Switching prompt templates will not fix a missing input field.

## Handling Special Pages

For pages that are hard to parse or not worth extracting, such as:

- PDF pages
- image pages
- Chrome internal pages
- extension pages

fall back directly to the URL template.

## Non-Goals For v1

- Direct calls to private DeepSeek web chat network APIs.
- Multi-provider routing.
- Selected-text workflows.
- Long-term conversation history storage.
- Fully autonomous background summarization.
- Automatic login handling.

## Acceptance Criteria

The first version is acceptable when:

- The user can right-click a normal webpage and choose `Summarize page`.
- The extension extracts Markdown for most standard article pages.
- The side panel shows the extracted content and prompt before sending.
- The user can edit the prompt before sending.
- DeepSeek opens in the side panel and receives the prompt.
- The prompt is sent automatically after confirmation.
- If extraction fails, the extension falls back to the URL template.
- If the DeepSeek session is invalid, the extension opens a new one.

## Open Implementation Questions

- Exact DeepSeek selectors for the input and send button.
- Whether DeepSeek loads reliably inside the side-panel iframe.
- Whether the side panel should open automatically on confirm or reuse an existing panel instance.
- Whether the send step should be retried with a backoff window before failing.
- Whether to record a compact event log for troubleshooting.
