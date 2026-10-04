import assert from "node:assert/strict";
import test from "node:test";

import {
  isActuallyEditableInput,
  waitForStableProviderInput,
} from "../src/provider-readiness.js";

test("rejects a visible Kimi editor shell while it is contenteditable=false", () => {
  assert.equal(isActuallyEditableInput({
    getAttribute: (name) => name === "contenteditable" ? "false" : null,
    matches: () => true,
  }), false);

  assert.equal(isActuallyEditableInput({
    getAttribute: (name) => name === "contenteditable" ? "true" : null,
    matches: () => true,
  }), true);
});


test("waits for the document to complete before accepting a provider input", async () => {
  let now = 0;
  let readyState = "interactive";
  const input = { isConnected: true };

  const result = await waitForStableProviderInput({
    getReadyState: () => readyState,
    findInput: () => input,
    isUsableInput: () => true,
    now: () => now,
    sleep: async () => {
      now += 100;
      readyState = "complete";
    },
    documentReadyTimeoutMs: 500,
    inputTimeoutMs: 500,
    settleMs: 200,
  });

  assert.equal(result, input);
  assert.equal(now, 300);
});

test("restarts the settling window when Gemini replaces its provisional input", async () => {
  let now = 0;
  const provisional = { isConnected: true };
  const stable = { isConnected: true };

  const result = await waitForStableProviderInput({
    getReadyState: () => "complete",
    findInput: () => (now < 100 ? provisional : stable),
    isUsableInput: () => true,
    now: () => now,
    sleep: async () => {
      now += 100;
    },
    documentReadyTimeoutMs: 100,
    inputTimeoutMs: 1500,
    settleMs: 800,
  });

  assert.equal(result, stable);
  assert.equal(now, 900);
});
