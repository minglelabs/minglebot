# Minglebot Architecture v1

Last updated: 2026-02-13

## 0. Product Goal (v1)

Minglebot v1 focuses on one thing:

- Centralize user chat data from ChatGPT/Claude/Gemini into a local filesystem
- Make that data easy for user-owned AI agents to explore with basic shell tools (`grep`, `find`, `jq`)

## 1. Should Minglebot be a desktop app?

Yes, desktop-first is a strong fit for this project.

Why:

- Local filesystem is the source of truth
- Users can manually perform sensitive login/authorization
- Browser automation can run with clear user visibility

Recommended shape:

- Desktop shell (UI): Electron or Tauri
- Local core service: orchestrates jobs, browser-use, parsing, normalization
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
- `Shared Pipeline` (service-agnostic core)

## 3. Are these 4 browser-use steps needed?

Your 4 steps are directionally correct, with one adjustment.

Proposed flow:

1. Open provider login page and wait for user login.
2. Detect authenticated state, then navigate to export trigger and request export.
3. Handle email retrieval path.
4. Download export artifact and hand off to ingest pipeline.

Important adjustment:

- Step 3/4 should not be browser-only by default.
- Prefer API/IMAP connectors for mailbox retrieval when available.
- Keep browser mailbox flow as fallback.

Why:

- Mail web UI automation is brittle.
- API/IMAP is more stable and easier to test.

## 4. Package structure: service-first or function-first?

Use hybrid architecture:

- Edge layer: service-first (provider adapters)
- Core layer: function-first (download, unzip, normalize, index)

Suggested structure:

```text
src/
  app/
    desktop/                # Electron/Tauri entry, windows, IPC
  core/
    orchestrator/           # job state machine
    auth-wait/              # login/session detection helpers
    inbox/                  # email fetch abstraction (imap/api/browser fallback)
    artifacts/              # download, checksum, unzip
    normalize/              # common schema mapping
    storage/                # local layout + manifests + index
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

## 5. Who owns post-download processing?

One orchestrated pipeline should own the lifecycle, with provider-specific parsing stages.

Pipeline:

1. Acquire artifact (zip/html/json/link export)
2. Verify + archive raw artifact (`raw/`)
3. Extract/decompress
4. Provider parser -> canonical intermediate
5. Normalize to common schema
6. Write final dataset (`normalized/`)
7. Build search-friendly indexes/manifests (`index/`)

Recommendation:

- Shared pipeline engine: single program
- Parser/mapper plugins: provider-specific

This balances:

- Consistency (single lifecycle)
- Extensibility (provider plugin growth)

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
    <provider>/<yyyy-mm-dd>/<artifact files>
  normalized/
    chats.ndjson
    messages.ndjson
    attachments/
  index/
    manifest.json
    by-provider/
    by-date/
```

Conventions:

- UTF-8 text formats (JSON/NDJSON/Markdown)
- deterministic filenames
- stable IDs for conversations/messages

## 8. Login detection strategy

Use deterministic checks instead of timing assumptions:

- cookie/session presence
- URL pattern + authenticated-only selector
- explicit timeout + user prompt

State machine:

- `WAITING_FOR_LOGIN`
- `LOGIN_CONFIRMED`
- `EXPORT_REQUESTED`
- `MAIL_READY`
- `ARTIFACT_DOWNLOADED`
- `NORMALIZED`

## 9. v1 milestone plan

1. Core orchestrator + local data layout
2. ChatGPT adapter end-to-end
3. Claude adapter end-to-end
4. Mail inbox connector (API/IMAP first, browser fallback)
5. Normalization + grep-friendly indexing
6. Gemini strategy implementation (based on officially stable path)

## 10. Images and attachments policy

Email export payloads can differ by provider and over time.

So v1 should treat media with a defensive strategy:

1. If binary files are present in export artifact, store under `normalized/attachments/`
2. If only URLs/references exist, keep a metadata record and optional fetch job
3. Keep message text usable even when media fetch fails
4. Mark every media item with `status = embedded | linked | missing`

This prevents pipeline failure when image handling differs between providers.
