# Single-Shell Kimi Sidebar Design

Date: 2026-08-10

## Goal

Make the extension feel like one continuous sidebar instead of two separate pages.

When the user starts a summarize action:

1. Open the side panel.
2. Start extracting page content.
3. Load the Kimi iframe in the background, but keep it hidden during extraction.
4. When extraction finishes:
   - in manual mode, show the extracted content, prompt, and a single `总结` action
   - in auto mode, show Kimi and continue with paste + send

## User Experience

### Extraction state

The sidebar shows one shell only:

- top toolbar
- centered loading state
- no split between review page and chat page

The user sees a spinner and a short status such as `正在提取页面内容...`.

### Manual mode

After extraction succeeds, the sidebar reveals:

- extracted content preview
- generated prompt
- attachment summary
- a primary `总结` button

Clicking `总结` transitions into Kimi and sends the payload.

### Auto mode

After extraction succeeds, the sidebar transitions directly to the Kimi view:

- iframe becomes visible
- attachment is pasted or injected
- prompt is filled
- send is triggered

## Core Behavior

### One shell

The sidebar uses a single page structure with state-driven sections:

- `extracting`
- `review`
- `kimi`
- `error`

The shell never unmounts. Only the active section changes.

### Kimi preloading

Kimi should begin loading as soon as the summarize request starts.

Rules:

- iframe may be created early
- iframe stays hidden during extraction
- iframe becomes visible only when Kimi needs to be used

### Prompt and attachment handling

The payload stays split into two parts:

- attachment: page title + extracted正文
- prompt: the task instruction

Manual mode shows both parts before sending.
Auto mode sends both parts immediately after extraction.

## Data Flow

1. User triggers summarize from the context menu.
2. Background opens the side panel.
3. Background starts extraction and stores a payload shell in session storage.
4. Side panel enters `extracting`.
5. The Kimi iframe starts loading in the background.
6. On extraction success:
   - build attachment content
   - build prompt
   - if manual, enter `review`
   - if auto, enter `kimi` and send
7. On extraction failure:
   - fall back to the URL-based prompt path
   - keep the same single-shell flow

## Error Handling

If extraction fails:

- show a URL fallback summary
- keep the shell in `review`
- let manual mode continue with a visible button
- let auto mode send the fallback prompt

If Kimi fails to load:

- keep the shell in `error`
- show a short failure status
- do not pretend the send succeeded

If prompt injection fails:

- keep the current shell visible
- surface the failure in the status line
- preserve the payload so the user can retry

## Implementation Boundaries

### Background

Responsible for:

- starting extraction
- storing the payload
- telling the side panel which state to show

### Side panel

Responsible for:

- rendering the single shell
- switching between states
- showing the review content
- opening Kimi only when needed
- routing auto/manual send behavior

### Kimi iframe controller

Responsible for:

- loading the iframe
- waiting for readiness
- injecting attachment and prompt
- triggering send

## Acceptance Criteria

- The sidebar no longer feels like two unrelated pages.
- Extraction always begins in a loading state.
- Kimi can be preloaded without being shown immediately.
- Manual mode shows extracted content and prompt before sending.
- Auto mode jumps directly from extraction to Kimi send.
- Failure states remain visible and retryable.

## Non-Goals

- Changing the extraction algorithm itself.
- Adding selected-text workflows.
- Integrating additional chat providers.
- Designing a new login flow.

## Open Questions

- Should Kimi preload on every summarize action, or only when extraction begins successfully?
- Should the manual review state keep the iframe alive in the background, or create it only when the user clicks `总结`?
- Should the loading state include the page title and source URL, or stay minimal?
