# Minglebot

<p align="center">
  <strong>Centralize your personal data locally, then make it AI-ready.</strong>
</p>

<p align="center">
  <em>Browser-use + TypeScript based automation for personal data aggregation and agent tool-calling.</em>
</p>

---

## What This Project Is

Minglebot is an open-source project to centralize personal data into a single, well-structured local filesystem hub.

The first milestone is focused on chat data:

- ChatGPT
- Claude
- Gemini

After that, the scope expands to broader personal data that can be accessed in practical ways.

## First Goal

Automate collection and organization of chat data from ChatGPT, Claude, and Gemini into one local directory.

Why this first:

- Most users already have valuable chat history spread across tools.
- Centralizing this data creates a portable personal memory layer.
- It becomes a consistent data source for downstream AI workflows.

## Product Direction

This project is not just about dumping files into one folder.

For non-developers, simple data export is not enough.  
So Minglebot is designed with **tool-calling support** so users can actually use their centralized data through agent systems such as:

- Claude Code
- Claude Cowork
- Codex
- OpenClaw
- and other personal agent setups

The core intent is:

1. Gather personal data locally.
2. Structure it for reliable access.
3. Make it directly usable by AI agents.

## Automation Boundary

Minglebot focuses on automating everything **except** user-auth-required steps.

- User handles login/authorization manually when needed.
- Minglebot automates the rest of the repetitive workflow.

This keeps the system practical while respecting security and account constraints.

## Tech Focus

- Main language: **TypeScript**
- Browser automation approach: **browser-use based workflow**
- Storage strategy: **local filesystem first**

## Why Local-First

- User owns raw data files.
- No forced cloud lock-in.
- Easy inspection, backup, and migration.
- Better fit for personal agent experimentation.

## High-Level Roadmap

1. Chat data ingestion from ChatGPT/Claude/Gemini.
2. Unified local schema and metadata normalization.
3. Tool-calling interfaces for agent systems.
4. Expansion to broader personal data domains.

## Status

Early stage.  
This repository currently defines the mission and initial architecture direction.

---

If you care about personal AI workflows, data ownership, and practical local-first systems, contributions are welcome.
