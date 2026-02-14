import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { parseGemini } from "../src/providers/gemini";

test("parseGemini reads conversations and maps model role to assistant", async () => {
  const extractedRoot = path.join(process.cwd(), "test", "fixtures", "gemini");
  const result = await parseGemini(extractedRoot, "raw/gemini/2026/02/job_test/extracted", "job_test");

  assert.equal(result.provider, "gemini");
  assert.equal(result.conversations.length, 1);
  assert.equal(result.messages.length, 2);
  assert.equal(result.attachments.length, 0);

  const assistantMessage = result.messages.find((row) => row.provider_message_id === "gm_msg_2");
  assert.ok(assistantMessage);
  assert.equal(assistantMessage.provider, "gemini");
  assert.equal(assistantMessage.role, "assistant");
  assert.equal(assistantMessage.model, "gemini-2.0-flash");
  assert.equal(assistantMessage.text, "hi from model");
});
