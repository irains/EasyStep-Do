# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
- Desktop todo app “行简 (EasyStep-Do)” built with **Tauri 2 + React + TypeScript**.
- Frontend runs in WebView and communicates with Rust backend via Tauri `invoke` commands.
- Local persistence is SQLite (`rusqlite` with bundled SQLite), stored under Tauri app data directory (`todos.db`).

## Common Commands
Run from repository root.

- Install dependencies:
  - `npm ci`
- Frontend dev server only (Vite, fixed port):
  - `npm run dev`  (port `5180`, strict)
- Full desktop app dev (recommended for feature work):
  - `npm run tauri:dev`
- Frontend build:
  - `npm run build`
- Desktop bundle build:
  - `npm run tauri:build`
- Lint:
  - `npm run lint`
- Rust backend check (useful when touching `src-tauri`):
  - `cargo check --manifest-path src-tauri/Cargo.toml`
- Rust clean + rebuild check (use when Tauri build references stale paths/artifacts):
  - `cargo clean --manifest-path src-tauri/Cargo.toml`
  - `cargo check --manifest-path src-tauri/Cargo.toml`

## Test Status
- There is currently **no project test suite configured** in `package.json` (no `test` script, no Vitest/Jest setup, no Rust tests in `src-tauri/src`).
- There is no single-test command available yet.
- Validation currently relies on lint/build/manual verification via `npm run tauri:dev`.

## High-Level Architecture

### 1) App startup and desktop shell (Rust / Tauri)
- Entry: `src-tauri/src/main.rs` → `app_lib::run()` in `src-tauri/src/lib.rs`.
- `run()` wires:
  - `tauri-plugin-autostart`
  - optional dev logging plugin (`tauri-plugin-log` in debug)
  - tray icon + tray menu
  - window event handling (close hides window to tray)
  - invoke command registration.
- Autostart behavior: plugin is configured with `--autostart`; startup checks argv and hides main window on autostart launch.
- Tray menu actions: show main window, toggle autostart, quit app.

### 2) Frontend/backend contract
- Frontend API wrapper: `src/api/todo.ts`.
- All frontend data mutations/queries call Rust commands via `invoke`:
  - `list_todos`, `add_todo`, `toggle_todo`, `update_todo`, `delete_todo`, `reorder_todo`, `open_external_url`.
- Keep command names/parameter shapes aligned between:
  - Rust command signatures in `src-tauri/src/todo.rs` + `src-tauri/src/lib.rs`
  - TypeScript wrappers in `src/api/todo.ts`.

### 3) Data model and storage
- DB bootstrap/migrations in `src-tauri/src/db.rs`.
- Main table: `todos` with fields:
  - `id`, `title`, `detail_md`, `completed`, `created_at`, `updated_at`, `sort_order`, `journal_date`.
- `db.rs` contains idempotent migration helpers (`ensure_*`) to evolve schema for existing installs.
- Ordering model:
  - Uses floating `sort_order` gaps (`ORDER_STEP = 1024.0`) for efficient drag reordering.
  - Rebalance is triggered when gaps become too small.

### 4) Domain logic (Rust)
- `src-tauri/src/todo.rs` implements command handlers and business rules:
  - date-scoped listing (`journal_date`), title validation, CRUD, reorder transaction logic.
  - `resolve_journal_date` normalizes/validates date input (`YYYY-MM-DD`) and defaults to local today.
- Reorder operations are transactional and constrained to current date scope.

### 5) UI flow (React)
- Main screen/state orchestration: `src/App.tsx`.
- Key UI responsibilities combined in `App.tsx`:
  - calendar/date scope switching (`selected` vs `allDates`)
  - todo list filtering (`all`/`active`/`completed`)
  - DnD reorder (`@dnd-kit`) when in date-scoped view
  - create/edit/delete/toggle flows and optimistic-refresh pattern via reload.
- Markdown editor component: `src/components/markdown-editor.tsx`
  - split/write/preview modes
  - markdown rendering uses `react-markdown + remark-gfm + rehype-sanitize`
  - links route through backend `open_external_url` instead of direct browser navigation.

## Config and Build Pipeline Notes
- Vite config: `vite.config.ts`
  - alias `@ -> ./src`
  - dev server fixed to `5180` with `strictPort: true`.
- Tauri app config: `src-tauri/tauri.conf.json`
  - `build.devUrl` must match Vite dev port (`http://localhost:5180`).
- CI release workflow: `.github/workflows/build-tauri.yml`
  - Builds Windows/macOS/Linux bundles.
  - Tag push `v*` triggers GitHub Release asset upload.

## Permissions / Rules Files
- No repository Cursor rules (`.cursor/rules`, `.cursorrules`) found.
- No Copilot instructions file (`.github/copilot-instructions.md`) found.
- Tauri capability file is minimal: `src-tauri/capabilities/default.json` (`core:default`, window `main`).
