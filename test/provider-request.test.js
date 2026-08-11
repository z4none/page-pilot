import assert from "node:assert/strict";
import test from "node:test";

import { resolveRequestProviderId } from "../src/provider-request.js";

test("a pending request keeps its provider when settings change", () => {
  assert.equal(resolveRequestProviderId("kimi", "gemini"), "kimi");
  assert.equal(resolveRequestProviderId("", "deepseek"), "deepseek");
});
