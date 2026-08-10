# Provider Attachment Readiness Design

Date: 2026-08-10

## Goal

Prevent Kimi, DeepSeek, and Gemini from sending a prompt without the page-content attachment, and prevent a delayed attachment from leaking into the next conversation.

## Confirmed Failure

The current detector treats a stable attachment-candidate count as upload completion. Gemini can keep the same number of attachment nodes while their class, text, and upload state are still changing. The extension therefore submits too early.

Provider selection is also read from mutable global settings during the request. Changing settings while extraction is running can preload one provider and send through another.

## Request Flow

Each summary request freezes its provider when the request is created:

1. Wait for that provider's composer.
2. Capture the attachment UI baseline.
3. Dispatch exactly one file paste to the composer.
4. Observe new attachment-node signatures, including class, text, labels, and progress state.
5. Require the signatures to remain unchanged for the provider's settling period.
6. Fill the text prompt.
7. For automatic mode, revalidate the attachment immediately before submission.
8. Submit once.
9. Confirm that both the prompt and attachment leave the composer.

The extension must stop with an explicit error if any required confirmation fails. It must not fall back to sending only the prompt.

## Provider Policy

- DeepSeek keeps the currently working input-paste path.
- Gemini uses signature-based stability and a longer settling period because its attachment processing is asynchronous.
- Kimi uses the same input-paste flow, but failures remain visible and diagnostic rather than silently continuing.

Provider-specific DOM selectors may extend evidence collection, but the orchestration and success contract remain shared.

## Diagnostics

JSON logs include:

- frozen request provider;
- attachment baseline;
- paste dispatch result;
- each meaningful attachment-signature transition;
- pre-submit validation;
- post-submit prompt and attachment consumption;
- timeout snapshots with truncated candidate signatures.

## Regression Coverage

Tests must prove:

- changing attachment signatures delay submission;
- an attachment that remains in the composer cannot report success;
- a failed attachment never sends a prompt-only request;
- manual mode prepares content without submitting;
- provider selection is immutable for one request.

## Acceptance Criteria

- DeepSeek continues sending one prompt with one attachment.
- Gemini waits for attachment processing and does not leave the attachment in the next composer.
- Kimi either sends one prompt with one attachment or reports the exact failed stage.
- No provider reports success while the attachment remains in the composer.
