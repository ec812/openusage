|# OpenUsage (ec812 fork)
|
|**This is our own fork of robinebers/openusage.** Upstream remote removed. No syncs, no merge conflicts, no update failures.
|We only maintain `plugins/command-code`. Everything else is left as-is from the fork point.

## Instructions
- CRITICAL: Use simple, concise language. Avoid overtechnical jargon.
- Be radically precise. No fluff. Pure information only (drop grammar; min tokens).
- Critical: DO NOT OVER-ENGINEER! This app is typically used by 2-5 people, internally only.

## Guardrails
- Use `trash` for deletes
- Use `mv` / `cp` to move and copy files
- Bugs: add regression test when it fits
- Keep files <~400 LOC; split/refactor as needed
- Simplicity first: handle only important cases; no enterprise over-engineering/fallbacks
- New functionality: small OR absolutely necessary
- NEVER delete files, folders or other data unless explicilty approved or part of a plan
- Before writing code, stricly follow the below research rules

## Research
- Prefer skills if available over research.
- Prefer researched knowledge over existing knowledge when skills are unavailable.
- Research: Exa to websearch early, and Ref to seek specific documention or web fetch.
- Best results: Quote exact errors; prefer 2025-2026+ sources.

## Error Handling
- Expected issues: explicit result types (not throw/try/catch).
- Unexpected issues: fail LOUD (throw/console.error + toast.error); NEVER add silent fallbacks.

## This is our own fork
- **Upstream (robinebers/openusage) remote has been removed.** No syncs, no merge conflicts.
- We only actively maintain `plugins/command-code`. Other plugins left as-is.
- PRs go to ec812/openusage main branch only — no upstream contributions.

## Before Creating Pull Request
- Before creating a PR or pushing to main, ensure that `README.md` is updated with what plugins are supported.
- On any plugin change/new plugin, audit plugin-exposed request/response fields against `src-tauri/src/plugin_engine/host_api.rs` redaction lists and add/update tests for gaps. Compare with existing plugins for patterns.
- In `plugin.json`, set `brandColor` to the provider's real brand color.
- Plugin SVG logos must use `currentColor` so icon theming works correctly.
- If the PR includes visual changes, refuse to create it without providing before/after screenshots.

## Project Memories
Use below list to store and recall user notes when asked to do so.

- Use this list when asked to remember things. Keep each list item concise.
- Local dev (hot reload, no full release build): `bun run tauri:dev` (or `bun tauri dev`). Vite on :1420; Rust recompiles on `src-tauri` changes. Dev shows a **Dock icon** (easier to find); release is menu-bar-only.
- Tauri IPC: JS must use camelCase (`{ batchId, pluginIds }`), Tauri auto-converts to Rust's snake_case. Never send snake_case from JS—params silently won't match.
- tauri-action `latest.json`: Parallel matrix builds are safe—action fetches existing `latest.json`, merges platform entries, re-uploads. No `max-parallel: 1` needed.
