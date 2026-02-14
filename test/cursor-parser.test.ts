import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { parseCursor } from "../src/providers/cursor";

test("parseCursor reads markdown export and maps roles", async () => {
  const extractedRoot = path.join(process.cwd(), "test", "fixtures", "cursor");
  const result = await parseCursor(extractedRoot, "raw/cursor/2026/02/job_test/extracted", "job_test");

  assert.equal(result.provider, "cursor");
  assert.equal(result.conversations.length, 1);
  assert.equal(result.messages.length, 4);
  assert.equal(result.attachments.length, 0);
  assert.equal(result.warnings.length, 0);

  assert.equal(result.messages[0].role, "user");
  assert.equal(result.messages[1].role, "assistant");
  assert.equal(result.conversations[0].title, "Cursor Session: Parser Work");
});
