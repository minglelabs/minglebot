import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { parseClaude } from "../src/providers/claude";

test("parseClaude merges nested and flat messages and keeps attachments", async () => {
  const extractedRoot = path.join(process.cwd(), "test", "fixtures", "claude", "nested-and-flat");
  const result = await parseClaude(extractedRoot, "raw/claude/2026/02/job_test/extracted", "job_test");

  assert.equal(result.provider, "claude");
  assert.equal(result.conversations.length, 1);
  assert.equal(result.messages.length, 2);
  assert.equal(result.attachments.length, 3);

  const merged = result.messages.find((row) => row.provider_message_id === "msg_2");
  assert.ok(merged);
  assert.equal(merged.provider, "claude");
  assert.equal(merged.role, "assistant");
  assert.equal(merged.text, "hi there from flat");
  assert.equal(merged.attachment_ids?.length, 3);

  const hasBlobAttachment = result.attachments.some((row) => row.storage === "blob" && row.local_relpath === "assets/report.pdf");
  const hasUrlAttachment = result.attachments.some((row) => row.storage === "url" && row.url === "https://example.com/remote.bin");
  assert.equal(hasBlobAttachment, true);
  assert.equal(hasUrlAttachment, true);
});

test("parseClaude creates synthetic conversation for flat-only payload", async () => {
  const extractedRoot = path.join(process.cwd(), "test", "fixtures", "claude", "flat-only");
  const result = await parseClaude(extractedRoot, "raw/claude/2026/02/job_test/extracted", "job_test");

  assert.equal(result.provider, "claude");
  assert.equal(result.conversations.length, 1);
  assert.equal(result.messages.length, 2);
  assert.equal(result.warnings.length, 0);

  const conv = result.conversations[0];
  assert.equal(conv.provider_conversation_id, "thread_99");
});
