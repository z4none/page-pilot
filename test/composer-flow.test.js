import assert from "node:assert/strict";
import test from "node:test";

import {
  attachmentNodesLeftComposer,
  createStabilityTracker,
  runComposerFlow,
} from "../src/composer-flow.js";

test("does not fill or submit until the attachment is ready", async () => {
  const events = [];
  let releaseAttachment;
  const attachmentReady = new Promise((resolve) => {
    releaseAttachment = resolve;
  });

  const flow = runComposerFlow({
    message: {
      prompt: "summarize",
      autoSend: true,
      attachment: { content: "page body" },
    },
    waitForInput: async () => {
      events.push("input");
      return { id: "composer" };
    },
    attachAttachment: async () => {
      events.push("attach:start");
      await attachmentReady;
      events.push("attach:ready");
      return { ready: true, method: "paste" };
    },
    fillPrompt: () => events.push("fill"),
    verifyPrompt: async () => {
      events.push("verify");
      return true;
    },
    submitPrompt: async () => {
      events.push("submit");
      return true;
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["input", "attach:start"]);

  releaseAttachment();
  await flow;
  assert.deepEqual(events, ["input", "attach:start", "attach:ready", "fill", "verify", "submit"]);
});

test("attachment failure prevents prompt-only submission", async () => {
  const events = [];

  await assert.rejects(
    runComposerFlow({
      message: {
        prompt: "summarize",
        autoSend: true,
        attachment: { content: "page body" },
      },
      waitForInput: async () => ({ id: "composer" }),
      attachAttachment: async () => ({ ready: false, method: "paste" }),
      fillPrompt: () => events.push("fill"),
      verifyPrompt: async () => true,
      submitPrompt: async () => {
        events.push("submit");
        return true;
      },
    }),
    /attachment is not ready/,
  );

  assert.deepEqual(events, []);
});

test("manual mode prepares one attachment and one prompt without submitting", async () => {
  const events = [];

  await runComposerFlow({
    message: {
      prompt: "summarize",
      autoSend: false,
      attachment: { content: "page body" },
    },
    waitForInput: async () => ({ id: "composer" }),
    attachAttachment: async () => {
      events.push("attach");
      return { ready: true, method: "paste" };
    },
    fillPrompt: () => events.push("fill"),
    verifyPrompt: async () => true,
    submitPrompt: async () => {
      events.push("submit");
      return true;
    },
  });

  assert.deepEqual(events, ["attach", "fill"]);
});

test("refreshes a replaced input after attachment upload before filling the prompt", async () => {
  const events = [];
  const initialInput = { id: "before-upload" };
  const activeInput = { id: "after-upload" };

  await runComposerFlow({
    message: {
      prompt: "summarize",
      autoSend: false,
      attachment: { content: "page body" },
    },
    waitForInput: async () => initialInput,
    attachAttachment: async (attachment, input) => {
      events.push(`attach:${input.id}`);
      return { ready: true, method: "paste" };
    },
    refreshInput: async (input) => {
      events.push(`refresh:${input.id}`);
      return activeInput;
    },
    fillPrompt: (input) => events.push(`fill:${input.id}`),
    verifyPrompt: async (input) => {
      events.push(`verify:${input.id}`);
      return true;
    },
    submitPrompt: async () => true,
  });

  assert.deepEqual(events, [
    "attach:before-upload",
    "refresh:before-upload",
    "fill:after-upload",
    "verify:after-upload",
  ]);
});

test("attachment signature changes reset the settling window", () => {
  const tracker = createStabilityTracker(1200);

  assert.equal(tracker.observe({ key: "uploading-0", ready: true, blocked: false }, 0), false);
  assert.equal(tracker.observe({ key: "uploading-35", ready: true, blocked: false }, 1000), false);
  assert.equal(tracker.observe({ key: "uploading-35", ready: true, blocked: false }, 2100), false);
  assert.equal(tracker.observe({ key: "uploading-35", ready: true, blocked: false }, 2200), true);
});

test("submission cannot report success while the attachment remains in the composer", async () => {
  await assert.rejects(
    runComposerFlow({
      message: {
        prompt: "summarize",
        autoSend: true,
        attachment: { content: "page body" },
      },
      waitForInput: async () => ({ id: "composer" }),
      attachAttachment: async () => ({ ready: true, method: "paste" }),
      fillPrompt: () => {},
      verifyPrompt: async () => true,
      submitPrompt: async () => ({
        submitted: true,
        attachmentConsumed: false,
      }),
    }),
    /attachment remains in the input/,
  );
});

test("an attachment sent to chat no longer counts as remaining when its original composer node leaves", () => {
  const originalAttachment = { isConnected: true };
  const sentMessageAttachment = { isConnected: true };
  const composer = {
    contains(node) {
      return node === sentMessageAttachment;
    },
  };

  assert.equal(attachmentNodesLeftComposer([originalAttachment], composer), true);
});

test("an attachment still represented by its original composer node remains unconsumed", () => {
  const attachment = { isConnected: true };
  const composer = { contains: (node) => node === attachment };

  assert.equal(attachmentNodesLeftComposer([attachment], composer), false);
});
