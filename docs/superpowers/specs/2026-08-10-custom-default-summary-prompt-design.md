# Custom Default Summary Prompt Design

Date: 2026-08-10

## Goal

Let users edit the default summary prompt used by Page Pilot.

The extension should provide built-in Chinese and English defaults and choose the initial default based on the browser UI language.

## User Experience

The side-panel settings modal gains a `默认提示词` multiline editor.

Users can:

- edit the prompt
- save it as their default
- reset it back to the built-in default for the current browser language

The prompt shown in the review step and sent to Kimi should use the saved default prompt.

## Default Prompt Selection

When the user has not customized the prompt:

- browser language starting with `zh` uses the Chinese default
- all other languages use the English default

Once the user saves a custom prompt, that custom prompt is used regardless of browser language.

## Built-In Defaults

Chinese:

```text
请基于我上传的页面附件，总结主要内容，提炼关键要点，并指出值得继续追问的问题。
输出请使用中文。
```

English:

```text
Please summarize the page attachment I uploaded, extract the key points, and suggest useful follow-up questions.
Respond in English.
```

## Settings Model

Add these fields to `settings`:

- `summaryPrompt`
- `summaryPromptCustomized`

Rules:

- if `summaryPromptCustomized` is true and `summaryPrompt` is non-empty, use `summaryPrompt`
- otherwise use the built-in prompt selected by browser language

## Implementation Boundaries

### Background

Use the resolved summary prompt when building markdown payloads.

The URL fallback prompt can remain specialized because it does not use attachments.

### Side panel

Add the prompt editor and reset button to the settings modal.

Saving updates `chrome.storage.sync`.

### Options page

Keep the options page aligned with the same settings fields.

## Acceptance Criteria

- Settings modal includes a default prompt textarea.
- Built-in default is Chinese for `zh*` UI languages and English otherwise.
- Saving a custom prompt changes the next generated summary prompt.
- Resetting restores the current-language built-in default.
- Options page uses the same prompt setting.
- The extension builds successfully.
