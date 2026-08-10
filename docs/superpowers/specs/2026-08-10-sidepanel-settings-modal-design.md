# Sidepanel Settings Modal Design

Date: 2026-08-10

## Goal

Move the common settings flow into the side panel so users do not leave the current Kimi sidebar context.

The existing options page can remain as a fallback, but the side panel gear button should open an in-panel settings modal.

## User Experience

Clicking the gear button opens a modal over the current sidebar.

The modal includes:

- `跳过确认步骤`
- `最大 Prompt 长度`
- `重置 Kimi 会话`
- `保存`
- `取消`

Closing the modal returns the user to the current sidebar state without reloading the Kimi iframe.

## Behavior

### Save

Saving writes settings to `chrome.storage.sync`.

The side panel state updates immediately so the next summarize action uses the new settings.

### Cancel

Cancel closes the modal and discards unsaved field changes.

### Reset Kimi Session

Reset clears the active stored Kimi chat URL so future summaries can start a fresh Kimi conversation.

It should clear the currently used key:

- `activeKimiChatUrl`

The old `activeKimiSession` key is no longer the primary session key.

## Implementation Boundaries

### Side panel

Owns the modal UI and settings actions.

The gear button should stop opening the options page and instead call an in-panel modal open function.

### Options page

May remain available as a fallback, but should use the same storage keys as the side panel.

### Styling

Use a simple overlay and compact modal sized for the Chrome side panel.

The modal should not obscure state permanently and should not reload the iframe.

## Acceptance Criteria

- Clicking the gear button opens a modal inside the side panel.
- Saving settings updates `chrome.storage.sync`.
- Canceling does not persist changes.
- Reset Kimi session clears `activeKimiChatUrl`.
- Kimi iframe remains loaded while settings are open.
- The extension builds successfully.
