# Minglebot Filesystem Data Format v1

Last updated: 2026-02-13

## 1. Purpose

This spec defines how Minglebot stores data on local filesystem so that:

- users keep ownership of raw exports
- user-owned AI agents can search data with basic shell tools (`find`, `grep`, `rg`, `jq`)
- new providers can be added without breaking existing data
- repeated full-export batch imports do not create duplicate canonical records

## 2. Design principles

1. Local-first and text-first
2. Provider-specific parsing, minimal canonical normalization
3. Raw extracted payloads are immutable; derived indexes are rebuildable
4. Deterministic IDs and stable paths

## 3. Directory layout contract

```text
<MINGLE_DATA_ROOT>/
  _mingle/
    schema-version.json
    catalog.json
  raw/
    <provider>/<yyyy>/<mm>/<job_id>/
      extracted/                  # decompressed provider payload
      source-metadata.json
  provider/
    <provider>/
      conversations.ndjson
      messages.ndjson
      attachments.ndjson
  canonical/
    conversations.ndjson
    messages.ndjson
    attachments.ndjson
  blobs/
    sha256/<aa>/<bb>/<sha256>.<ext>
  indexes/
    by-provider/<provider>/messages.ndjson
    by-date/<yyyy>/<mm>/<dd>/messages.ndjson
  jobs/
    <job_id>.json
  errors/
    <job_id>.ndjson
```

Notes:

- `raw/` keeps decompressed provider payloads and should never be overwritten.
- `provider/` preserves provider-specific fields and structures.
- `canonical/` keeps only minimum common schema for cross-provider usage.
- `indexes/` are derived and can be regenerated from `canonical/`.
- downloaded archives (zip/html export package) are temporary by default and not required in managed dataset.

## 4. Schema version file

`_mingle/schema-version.json`

```json
{
  "schema": "mingle-filesystem",
  "version": "1.0.0",
  "created_at": "2026-02-13T00:00:00Z"
}
```

## 5. Canonical schema (minimum common contract)

### 5.1 `canonical/conversations.ndjson`

Each line is one conversation record.

```json
{
  "id": "mb_chatgpt_cnv_123",
  "provider": "chatgpt",
  "provider_conversation_id": "cnv_123",
  "title": "Travel planning",
  "created_at": "2026-02-10T03:04:05Z",
  "updated_at": "2026-02-10T04:05:06Z",
  "source_job_id": "job_20260210_001",
  "source_path": "raw/chatgpt/2026/02/job_20260210_001/extracted/conversations.json"
}
```

Required fields:

- `id`
- `provider`
- `provider_conversation_id`
- `source_job_id`

### 5.2 `canonical/messages.ndjson`

Each line is one message record.

```json
{
  "id": "mb_chatgpt_msg_456",
  "conversation_id": "mb_chatgpt_cnv_123",
  "provider": "chatgpt",
  "provider_message_id": "msg_456",
  "role": "assistant",
  "text": "Pack layers and check weather shifts by region.",
  "created_at": "2026-02-10T03:15:00Z",
  "attachment_ids": ["mb_chatgpt_att_789"],
  "source_job_id": "job_20260210_001",
  "source_path": "raw/chatgpt/2026/02/job_20260210_001/extracted/messages.json",
  "first_seen_job_id": "job_20260210_001",
  "last_seen_job_id": "job_20260211_002",
  "seen_in_jobs": ["job_20260210_001", "job_20260211_002"]
}
```

Required fields:

- `id`
- `conversation_id`
- `provider`
- `role`
- `text`
- `source_job_id`

### 5.3 `canonical/attachments.ndjson`

Each line is one attachment record.

```json
{
  "id": "mb_chatgpt_att_789",
  "provider": "chatgpt",
  "provider_attachment_id": "att_789",
  "message_id": "mb_chatgpt_msg_456",
  "kind": "image",
  "mime_type": "image/png",
  "size_bytes": 224918,
  "storage": "blob",
  "blob_sha256": "3c4a6b...f9",
  "url": null,
  "status": "embedded",
  "source_job_id": "job_20260210_001"
}
```

Required fields:

- `id`
- `provider`
- `message_id`
- `storage` (`blob | url | missing`)
- `status` (`embedded | linked | missing`)
- `source_job_id`

## 6. Provider schema policy

`provider/<provider>/*.ndjson` is intentionally provider-specific.

Rules:

1. Keep as much provider-native detail as possible.
2. Do not force every provider field into canonical schema.
3. Map only stable cross-provider fields into `canonical/`.

This avoids brittle "fake common model" problems.

## 7. ID and dedupe rules

ID strategy:

- Prefer deterministic IDs from `provider + provider_*_id`.
- If provider IDs are missing, use deterministic hash from stable source fields.

Dedupe strategy:

1. Primary key: `provider + provider_*_id`
2. Fallback key: content hash + timestamp bucket

Upsert behavior for repeated full exports:

1. If record key already exists, update existing record (do not append duplicate).
2. Keep immutable identifiers unchanged.
3. Update mutable fields only when source value is newer or non-empty.
4. Track provenance with optional fields:
   - `first_seen_job_id`
   - `last_seen_job_id`
   - `seen_in_jobs` (array)
5. Rebuild `indexes/` from deduped datasets after each successful job.

Conflict policy:

- Prefer provider-supplied IDs and timestamps over inferred values.
- If timestamp is missing, keep existing canonical record and append conflict event in `errors/<job_id>.ndjson`.

## 8. Time, encoding, and text rules

- All timestamps are UTC ISO-8601 (`YYYY-MM-DDTHH:mm:ss.sssZ`)
- All text files are UTF-8
- NDJSON line delimiter is `\n`
- `text` field should be plain searchable text (markdown allowed, HTML stripped)

## 9. Agent-usable access patterns

Examples:

```bash
# 1) find all canonical files
find "$MINGLE_DATA_ROOT/canonical" -type f

# 2) keyword search across all messages
rg -n "invoice|tax|contract" "$MINGLE_DATA_ROOT/canonical/messages.ndjson"

# 3) inspect only Claude messages
jq -c 'select(.provider=="claude")' "$MINGLE_DATA_ROOT/canonical/messages.ndjson" | head

# 4) count missing attachments
jq -r 'select(.status=="missing") | .id' "$MINGLE_DATA_ROOT/canonical/attachments.ndjson" | wc -l
```

## 10. Job lifecycle metadata

`jobs/<job_id>.json` records ingestion lifecycle.

```json
{
  "job_id": "job_20260210_001",
  "provider": "chatgpt",
  "status": "NORMALIZED",
  "started_at": "2026-02-10T03:00:00Z",
  "ended_at": "2026-02-10T03:08:00Z",
  "raw_root_path": "raw/chatgpt/2026/02/job_20260210_001/extracted",
  "download_artifact_retained": false,
  "canonical_records": {
    "conversations": 18,
    "messages": 1532,
    "attachments": 294
  }
}
```

Allowed status values:

- `PACKAGE_SELECTED`
- `PACKAGE_VALIDATED`
- `EXTRACTED_TO_RAW`
- `PARSED_PROVIDER_RECORDS`
- `MAPPED_CANONICAL_RECORDS`
- `DEDUPED_UPSERTED`
- `NORMALIZED`
- `FAILED`

## 11. Download artifact retention policy

Default policy:

- Download package is kept in temp workspace only for verification/extraction.
- After successful extraction into `raw/.../extracted/`, package is deleted.

Optional policy:

- A provider/job level setting may retain package for debugging or forensics.
- If retained, the retained path must be written to `jobs/<job_id>.json`.

## 12. Compatibility policy

v1 compatibility promise:

- Existing `canonical/*.ndjson` required fields stay backward compatible.
- New fields can be added without breaking old readers.
- Breaking changes require version bump in `_mingle/schema-version.json`.
