import { test } from "node:test";
import assert from "node:assert/strict";
import { upsertMessages } from "../src/core/dedupe";
import { CanonicalMessage } from "../src/types/schema";

function msg(id: string, text: string, sourceJob: string): CanonicalMessage {
  return {
    id,
    conversation_id: "c1",
    provider: "chatgpt",
    role: "assistant",
    text,
    source_job_id: sourceJob
  };
}

test("upsertMessages marks unchanged vs updated correctly", () => {
  const existing = [msg("m1", "hello", "job_1")];
  const incomingSame = [msg("m1", "hello", "job_2")];
  const incomingUpdated = [msg("m1", "hello world", "job_3")];

  const sameResult = upsertMessages(existing, incomingSame, "job_2");
  assert.equal(sameResult.stats.unchanged, 1);
  assert.equal(sameResult.stats.updated, 0);

  const updatedResult = upsertMessages(existing, incomingUpdated, "job_3");
  assert.equal(updatedResult.stats.updated, 1);
  assert.equal(updatedResult.rows[0].text, "hello world");
});
