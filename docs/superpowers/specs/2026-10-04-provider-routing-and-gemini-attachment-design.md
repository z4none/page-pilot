# Provider Routing and Gemini Attachment Confirmation Design

Date: 2026-10-04

## Goal

Ensure automatic summaries never submit a prompt without its extracted-page attachment, including while Gemini is still loading. Ensure a summary configured for Gemini cannot be sent to a previously active Kimi iframe.

## Scope

- `src/sidepanel.js`: bind each send to its selected provider before any asynchronous operation; route iframe readiness, delivery, and results to that provider only.
- `src/provider-content.js`: require observable attachment evidence for Gemini before filling or submitting its prompt.
- Unit tests for the request-provider selection and composer flow seams.

No provider authentication, storage schema, or attachment transport changes are included.

## Design

### Request provider ownership

A new send request captures its `requestId` and selected `providerId` before any awaited work or iframe preload. That pending provider is authoritative for the duration of the request and takes precedence over any previous active provider.

The side panel uses this captured provider for the iframe URL, readiness ping, outgoing `SEND_PROMPT`, UI text, and request-result validation. An event from an iframe whose URL identifies another provider is diagnostic-only and cannot mark the request ready, receive its payload, or change its terminal status. Starting a new request clears any prior completed/obsolete active-request routing state so an old Kimi session cannot steer a Gemini request.

### Gemini attachment confirmation

Dispatching the file-paste event is not attachment readiness. Gemini will use the same attachment snapshot/evidence machinery as other providers: after paste, it waits for a new observable attachment indicator or a file-input file record, then waits for the evidence to settle. The send button is only discovered after that attachment gate passes.

If Gemini never provides attachment evidence within its configured timeout, the composer flow fails. It must not fill the prompt or invoke submission. The side panel displays the failure returned from the provider content script. This explicitly prohibits prompt-only fallback.

### Failure behavior

Attachment failures preserve the existing generated payload in session storage and leave the request unsent. The user may retry after the provider page finishes loading, but the extension will not automatically submit the textual prompt alone.

## Gemini initial-load stabilization

Gemini can expose an editable input before its iframe has completed its initial document load. A file-paste event dispatched into that provisional input can be erased by the remaining page initialization.

Before the Gemini composer flow selects an input or dispatches an attachment, it waits up to 30 seconds for the current iframe document to reach `complete`, then requires the selected input to remain connected and usable for 800 ms. Attachment paste happens only after this gate. If the page navigates, replaces the input, or does not stabilize before those limits, the request fails without filling or submitting the prompt.

## Tests

- Provider-selection tests prove a pending Gemini request overrides an older active Kimi request.
- Composer-flow regression test proves an attachment that never becomes ready prevents both prompt filling and submission.
- Gemini readiness tests cover a document that is not complete and an input replaced before its settling interval finishes.
- Existing tests continue to cover delayed attachment readiness and attachment-consumption confirmation.

## Acceptance criteria

1. A Gemini summary with no observable uploaded/pasted attachment fails without filling or submitting the summary prompt.
2. A Gemini summary started while Kimi is the prior active iframe loads/pings Gemini and sends only to Gemini.
3. Readiness or result events from Kimi cannot complete or fail the Gemini request.
4. `npm run check` passes.
