# MingleBot

<p align="center">
  <img src="./assets/minglebot-banner-warm.svg" alt="MingleBot banner" width="100%">
</p>

<p align="center">
  <strong>Centralize personal data on your local filesystem, then make it usable by AI agents.</strong>
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-Primary-blue">
  <img alt="Local First" src="https://img.shields.io/badge/Architecture-Local--First-2ea44f">
  <img alt="Automation" src="https://img.shields.io/badge/Focus-Browser%20Automation-orange">
</p>

<p align="center">
  <em>Browser-use + TypeScript automation for personal data aggregation and practical tool-calling workflows.</em>
</p>

## Mission

MingleBot is an open-source project to build a single, structured local data hub for personal AI workflows.

Phase 1 is clear and concrete:

- Collect chat data from ChatGPT, Claude, Gemini, and Cursor exports
- Normalize and organize it into one local filesystem location
- Make it directly usable by personal agent systems

Initial emphasis:

- Ensure personal data is explorable by user-owned AI agents through basic bash primitives (`grep`, `find`, etc.).
- Keep storage layout and file formats simple enough for fast terminal-level retrieval and chaining.

After this foundation, the scope expands toward broader personal data domains.

## v1 Operating Mode (Manual Batch Import)

MingleBot v1 intentionally uses a manual batch model:

1. User exports full data from provider (ChatGPT/Claude/Gemini/Cursor).
2. User downloads export package.
3. User imports package into MingleBot.
4. MingleBot validates, extracts, deduplicates, and updates local dataset.

Why this mode first:

- More stable than brittle browser/email automation
- Lower auth/security surface
- Faster to ship reliable value

## v1 Objectives (Concrete)

v1 is successful when the following are true:

1. Users can import export packages from ChatGPT, Claude, Gemini, and Cursor through a local desktop UI flow.
2. Repeated full-export imports are deduped/upserted correctly (no uncontrolled canonical duplication).
3. `canonical/messages.ndjson` and related datasets remain stable and agent-searchable (`rg`, `jq`, `find`).
4. Import runs provide transparent status and result counters (`new`, `updated`, `unchanged`, `failed`).
5. All processing runs locally by default with clear data-root visibility.
6. Users can immediately run copy-ready shell snippets after import to explore their data.

v1 explicitly excludes:

- mandatory browser/email automation for export retrieval
- cloud dependency for core ingest and storage

## Quick Start (Local)

```bash
pnpm install
pnpm build
pnpm dev
```

Then open `http://localhost:4242`.

What you can do now:

1. Open provider export guide links (ChatGPT/Claude/Gemini/Cursor).
2. Upload export package (`.zip/.json/.ndjson/.txt/.md`).
3. Run import with dedupe/upsert.
4. See run history and copy agent-ready shell commands.

Data root default:

- `./data` (override with `MINGLE_DATA_ROOT`)

## v1 Milestone Status

- [x] Local desktop-style app shell (`Home`, `Import`, `Runs`, `Data`-oriented flow)
- [x] Manual package intake and validation (`.zip/.json/.ndjson/.txt/.md`)
- [x] ChatGPT parser/mapper
- [x] Claude parser/mapper
- [x] Gemini parser/mapper
- [x] Cursor parser/mapper
- [x] Canonical dedupe/upsert engine for repeated full exports
- [x] Run history and import result counters (`new/updated/unchanged/failed`)
- [x] Agent handoff snippets (`rg` / `jq` / `find`)

Current limitation:

- Dedicated viewers are not yet implemented for non-Claude providers.

## Use Your Centralized Filesystem

The point is not just exporting data.  
The point is making that local data immediately usable by your own AI agent workflows.

Start with basic shell-native access patterns:

```bash
# Search all messages by keyword
rg -n "project|invoice|meeting" "$MINGLE_DATA_ROOT/canonical/messages.ndjson"

# Filter only one provider
jq -c 'select(.provider=="chatgpt")' "$MINGLE_DATA_ROOT/canonical/messages.ndjson" | head

# Inspect attachment status
jq -c 'select(.status!="embedded")' "$MINGLE_DATA_ROOT/canonical/attachments.ndjson" | head
```

This is the initial product emphasis:

- Any user agent should be able to explore personal data with `grep`/`find`/`jq`.
- Data should remain readable and stable on local filesystem without proprietary lock-in.
- `raw/` is treated as decompressed source payload (zip packages are temporary by default).
- Repeated full exports should not create duplicate canonical records.

Filesystem format spec: [`docs/filesystem-format-v1.md`](./docs/filesystem-format-v1.md)

## Why This Matters

Centralization alone is not enough, especially for non-developers.

If data only gets dumped into a folder, the practical value stays low.  
MingleBot therefore treats tool-calling integration as a first-class product concern.

Target usage includes personal agent environments such as:

- Claude Code
- Claude Cowork
- Codex
- OpenClaw
- Other custom/local agent stacks

## Product Principles

1. Local-first by default: user keeps ownership of raw files.
2. Usability for non-developers: minimal-click workflows.
3. Agent-ready structure: data should be queryable and callable.
4. Practical security boundary: user performs login/authorization steps manually; repetitive post-auth work is automated.

## Scope Boundary (Important)

MingleBot does not try to automate everything:

- User handles sensitive auth actions directly (login, grant, verification).
- MingleBot automates the remaining repeatable collection and organization steps.

This keeps the system realistic, safer, and easier to maintain.

## High-Level Flow

```mermaid
flowchart LR
    A["User Exports Data (Provider UI)"] --> B["User Downloads Export Package"]
    B --> C["User Imports Package into MingleBot"]
    C --> D["Validate + Extract + Dedupe + Upsert"]
    D --> E["Expose Agent-Friendly Tool Calls"]
    E --> F["Use via Claude Code / Codex / OpenClaw / etc."]
```

## Tech Direction

- Primary language: TypeScript
- Automation style: browser-use based workflows
- Storage model: local filesystem as source of truth

## Roadmap

1. Reliable ingestion pipeline for ChatGPT/Claude/Gemini/Cursor chat data
2. Provider-specific parsing + canonical dedupe/upsert mapping
3. Tool-calling surface for personal agent systems
4. Import-first desktop UX for non-developers
5. Expansion beyond chat into broader personal data

## Status

Early-stage repository.  
Current focus is mission definition and architecture setup for implementation.

Architecture draft: [`docs/architecture-v1.md`](./docs/architecture-v1.md)
Data format draft: [`docs/filesystem-format-v1.md`](./docs/filesystem-format-v1.md)
UI/UX draft: [`docs/ui-ux-v1.md`](./docs/ui-ux-v1.md)

## Contributing

If you care about local-first personal AI systems, data ownership, and practical agent workflows, contributions are welcome.
