import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { parseChatGPT } from "../src/providers/chatgpt";

test("parseChatGPT reads conversation and messages from conversations.json", async () => {
  const extractedRoot = path.join(process.cwd(), "test", "fixtures", "chatgpt");
  const result = await parseChatGPT(extractedRoot, "raw/chatgpt/2026/02/job_test/extracted", "job_test");

  assert.equal(result.provider, "chatgpt");
  assert.equal(result.conversations.length, 1);
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].provider, "chatgpt");
});
