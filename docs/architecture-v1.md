# Minglebot Architecture v1

Last updated: 2026-02-13

## 0. Product Goal (v1)

Minglebot v1 focuses on one thing:

- Centralize user chat data from ChatGPT/Claude/Gemini into a local filesystem
- Make that data easy for user-owned AI agents to explore with basic shell tools (`grep`, `find`, `jq`)
- Use manual batch import as default operation model (stable dedupe for repeated full exports)

## 1. Should Minglebot be a desktop app?

Yes, desktop-first is a strong fit for this project.

Why:

- Local filesystem is the source of truth
- Users can manually perform sensitive login/authorization
- Users can run provider exports manually with clear in-app guidance

Recommended shape:

- Desktop shell (UI): Electron or Tauri
- Local core service: orchestrates import jobs, parsing, mapping, dedupe, persistence
- Local data store: files + metadata index

About OpenClaw:

- OpenClaw is not a classic packaged desktop GUI first.
- It is a self-hosted gateway/CLI + browser Control UI model.
- So "desktop-oriented local operation" is true, but implementation style is different from pure desktop-app products.

## 2. Should each service have separate modules?

Yes. Service-specific adapters are required.

Reason:

- Export capabilities differ across ChatGPT/Claude/Gemini
- UI flows and selectors change independently
- File formats differ after download

Use this split:

- `Provider Adapter` (service-specific)
- `Shared Pipeline` (service-agnostic core for non-semantic processing)

## 3. v1 import flow (manual batch mode)

v1 defaults to manual batch import, not full browser/email automation.

Flow:

1. User exports data from provider manually.
2. User downloads export package manually.
3. User imports package into Minglebot.
4. Minglebot validates, extracts, parses, deduplicates, and updates local dataset.

Why:

- Better reliability in early stage
- Lower auth and maintenance risk

## 4. Package structure: service-first or function-first?

Use hybrid architecture:

- Edge layer: service-first (provider adapters)
- Core layer: function-first (import, unzip, validate, dedupe, persist, index)

Suggested structure:

```text
src/
  app/
    desktop/                # Electron/Tauri entry, windows, IPC
    import-ui/              # provider guides + package upload
  core/
    orchestrator/           # job state machine
    import/                 # package intake + verification
    artifacts/              # checksum + unzip + temp handling
    dedupe/                 # upsert and conflict resolution
    canonical/              # canonical schema writer
    storage/                # local layout + manifests + indexes
  providers/
    chatgpt/
      browser-export.ts
      parser.ts
      mapper.ts
    claude/
      browser-export.ts
      parser.ts
      mapper.ts
    gemini/
      collector.ts
      parser.ts
      mapper.ts
  shared/
    browser/
    logging/
    types/
```

This gives:

- Fast provider onboarding (new folder in `providers/`)
- Stable shared core for every provider

## 5. Who owns post-import processing?

One orchestrated pipeline should own the lifecycle, with provider-specific parsing stages.

Pipeline:

1. Acquire artifact (zip/html/json/link export)
2. Verify artifact in temp workspace
3. Extract/decompress into `raw/.../extracted/`
4. Provider parser -> provider records
5. Provider mapper -> minimal canonical schema
6. Dedupe/upsert into final datasets (`provider/`, `canonical/`)
7. Build search-friendly indexes/manifests (`indexes/`)

Default retention policy:

- Download packages are deleted after successful extraction.
- Managed local dataset keeps decompressed raw payloads, not package files.

Recommendation:

- Shared pipeline engine: single program
- Parser/mapper plugins: provider-specific (semantic mapping is not shared)

This balances:

- Consistency (single lifecycle)
- Extensibility (provider plugin growth)

Related format spec: [`docs/filesystem-format-v1.md`](./filesystem-format-v1.md)

## 6. Capability matrix (v1 assumptions)

As of 2026-02-13:

- ChatGPT: official account-level export exists (email download link)
- Claude: official account-level export exists (email download link)
- Gemini: official docs emphasize response-level export/share/activity; full chat bulk export is not clearly documented

Implementation implication:

- v1 reliable path: ChatGPT + Claude first
- Gemini in v1.5+: collector strategy via officially available paths

## 7. Data layout for agent usability

Design principle: "human-readable first, grep-able always"

```text
data/
  raw/
    <provider>/<yyyy-mm-dd>/extracted/<provider files>
  provider/
    <provider>/*.ndjson
  canonical/
    conversations.ndjson
    messages.ndjson
    attachments.ndjson
  indexes/
    manifest.json
    by-provider/
    by-date/
```

Conventions:

- UTF-8 text formats (JSON/NDJSON/Markdown)
- deterministic filenames
- stable IDs for conversations/messages

## 8. Import job state machine

Use deterministic import states:

- `PACKAGE_SELECTED`
- `PACKAGE_VALIDATED`
- `EXTRACTED_TO_RAW`
- `PARSED_PROVIDER_RECORDS`
- `MAPPED_CANONICAL_RECORDS`
- `DEDUPED_UPSERTED`
- `NORMALIZED`
- `FAILED`

## 9. v1 milestone plan

1. Core orchestrator + local data layout
2. Manual import UI (provider guides + package upload)
3. ChatGPT adapter end-to-end
4. Claude adapter end-to-end
5. Raw extracted storage + provider mapping + canonical dedupe/upsert + indexing
6. Gemini strategy implementation (based on officially stable path)

## 10. Images and attachments policy

Email export payloads can differ by provider and over time.

So v1 should treat media with a defensive strategy:

1. If binary files are present in export artifact, store under `blobs/` and reference from `canonical/attachments.ndjson`
2. If only URLs/references exist, keep a metadata record and optional fetch job
3. Keep message text usable even when media fetch fails
4. Mark every media item with `status = embedded | linked | missing`

This prevents pipeline failure when image handling differs between providers.
