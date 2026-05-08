# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
- Desktop todo app "行简 (EasyStep-Do)" built with **Tauri 2 + React + TypeScript**.
- Frontend runs in WebView and communicates with Rust backend via Tauri `invoke` commands.
- Local persistence is SQLite (`rusqlite` with bundled SQLite), stored under Tauri app data directory (`todos.db`).
- Supports **WebDAV sync** (bidirectional merge with last-write-wins + tombstone-based delete propagation).
- Full **i18n** support (Chinese / English) via `i18next` + `react-i18next`, with system language auto-detection.
- **Theme** support (system / light / dark) via `next-themes`, synced to native title bar via Tauri `setTheme()`.

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
  - `tauri-plugin-single-instance` (re-launch activates existing instance)
  - optional dev logging plugin (`tauri-plugin-log` in debug)
  - tray icon + tray menu (i18n-aware via `update_tray_language` command)
  - window event handling (close hides window to tray)
  - invoke command registration.
- Autostart behavior: plugin is configured with `--autostart`; startup checks argv and hides main window on autostart launch.
- Tray menu actions: show main window, toggle autostart, quit app.
- Tray menu text is bilingual (zh/en), updated via `update_tray_language` command from frontend.

### 2) Frontend/backend contract
- Frontend API wrappers: `src/api/todo.ts`, `src/api/sync.ts`.
- All frontend data mutations/queries call Rust commands via `invoke`:
  - **Todo**: `list_todos`, `add_todo`, `toggle_todo`, `update_todo`, `delete_todo`, `reorder_todo`, `open_external_url`.
  - **Sync**: `get_sync_config`, `save_sync_config`, `test_sync_connection`, `sync_now`, `get_sync_history`.
  - **System**: `update_tray_language`.
- Keep command names/parameter shapes aligned between:
  - Rust command signatures in `src-tauri/src/todo.rs`, `src-tauri/src/sync/commands.rs`, `src-tauri/src/lib.rs`
  - TypeScript wrappers in `src/api/todo.ts`, `src/api/sync.ts`.

### 3) Data model and storage
- DB bootstrap/migrations in `src-tauri/src/db.rs`.
- Main table: `todos` with fields:
  - `id`, `title`, `detail_md`, `completed`, `created_at`, `updated_at`, `sort_order`, `journal_date`.
- Sync tables: `sync_config`, `sync_meta`, `deleted_records`, `sync_history`.
- `db.rs` contains idempotent migration helpers (`ensure_*`) to evolve schema for existing installs.
- Ordering model:
  - Uses floating `sort_order` gaps (`ORDER_STEP = 1024.0`) for efficient drag reordering.
  - Rebalance is triggered when gaps become too small.

### 4) Domain logic (Rust)
- `src-tauri/src/todo.rs` implements command handlers and business rules:
  - date-scoped listing (`journal_date`), title validation, CRUD, reorder transaction logic.
  - `resolve_journal_date` normalizes/validates date input (`YYYY-MM-DD`) and defaults to local today.
  - `delete_todo` inserts tombstone record before deleting for cross-device sync.
  - `AppState` holds `db_path` and `device_id`.
- Reorder operations are transactional and constrained to current date scope.

### 5) WebDAV sync (Rust)
- `src-tauri/src/sync/` module:
  - `config.rs` — `WebdavConfig` struct, load/save from DB, base64 password encoding.
  - `webdav.rs` — `WebdavClient` with PROPFIND/MKCOL/GET/PUT, auto auth detection (Basic/Digest), ETag-based concurrency.
  - `merge.rs` — `merge_databases()` implementing last-write-wins per record + tombstone propagation.
  - `commands.rs` — 5 Tauri commands for sync config, connection testing, sync execution, history retrieval.
- Sync flow: load config → backup local DB → ensure remote dir → download remote DB → merge → upload → record history.
- Uses `reqwest` with `rustls-tls` (no OpenSSL dependency).

### 6) UI flow (React)
- Main screen/state orchestration: `src/App.tsx`.
- Key UI responsibilities combined in `App.tsx`:
  - calendar/date scope switching (`all`/`week`/`date`)
  - todo list filtering (`all`/`active`/`completed`)
  - DnD reorder (`@dnd-kit`) when in date-scoped view
  - create/edit/delete/toggle flows and optimistic-refresh pattern via reload.
  - auto-sync timer (`setInterval`) based on saved WebDAV config.
  - i18n locale sync to tray on mount and language change.
- Settings panel: `src/components/settings-panel.tsx`
  - unified modal with two tabs: General (theme + language) and Sync (WebDAV config + auto-sync).
- Sync status: `src/components/sync-status.tsx`
  - expandable history list with i18n.
- Markdown editor component: `src/components/markdown-editor.tsx`
  - split/write/preview modes
  - markdown rendering uses `react-markdown + remark-gfm + rehype-sanitize`
  - links route through backend `open_external_url` instead of direct browser navigation.

### 7) Internationalization (i18n)
- `src/i18n/index.ts` — i18next init with `i18next-browser-languagedetector`.
- `src/i18n/locales/zh.json` — Chinese translations.
- `src/i18n/locales/en.json` — English translations.
- Language stored in `localStorage` (key: `easystep-lang`), first visit reads `navigator.language`.
- All UI strings use `t('key')` from `react-i18next`.
- Date/time formatting uses `Intl.DateTimeFormat` with locale derived from `i18n.language`.
- Tray menu text is updated from frontend via `update_tray_language` command.

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
- Tauri capability file: `src-tauri/capabilities/default.json` (`core:default`, `core:app:allow-set-app-theme`, window `main`).
