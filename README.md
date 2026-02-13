# Minglebot

<p align="center">
  <img src="./assets/minglebot-banner-warm.svg" alt="Minglebot banner" width="100%">
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

Minglebot is an open-source project to build a single, structured local data hub for personal AI workflows.

Phase 1 is clear and concrete:

- Collect chat data from ChatGPT, Claude, and Gemini
- Normalize and organize it into one local filesystem location
- Make it directly usable by personal agent systems

Initial emphasis:

- Ensure personal data is explorable by user-owned AI agents through basic bash primitives (`grep`, `find`, etc.).
- Keep storage layout and file formats simple enough for fast terminal-level retrieval and chaining.

After this foundation, the scope expands toward broader personal data domains.

## v1 Operating Mode (Manual Batch Import)

Minglebot v1 intentionally uses a manual batch model:

1. User exports full data from provider (ChatGPT/Claude/Gemini).
2. User downloads export package.
3. User imports package into Minglebot.
4. Minglebot validates, extracts, deduplicates, and updates local dataset.

Why this mode first:

- More stable than brittle browser/email automation
- Lower auth/security surface
- Faster to ship reliable value

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
Minglebot therefore treats tool-calling integration as a first-class product concern.

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

Minglebot does not try to automate everything:

- User handles sensitive auth actions directly (login, grant, verification).
- Minglebot automates the remaining repeatable collection and organization steps.

This keeps the system realistic, safer, and easier to maintain.

## High-Level Flow

```mermaid
flowchart LR
    A["User Exports Data (Provider UI)"] --> B["User Downloads Export Package"]
    B --> C["User Imports Package into Minglebot"]
    C --> D["Validate + Extract + Dedupe + Upsert"]
    D --> E["Expose Agent-Friendly Tool Calls"]
    E --> F["Use via Claude Code / Codex / OpenClaw / etc."]
```

## Tech Direction

- Primary language: TypeScript
- Automation style: browser-use based workflows
- Storage model: local filesystem as source of truth

## Roadmap

1. Reliable ingestion pipeline for ChatGPT/Claude/Gemini chat data
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
