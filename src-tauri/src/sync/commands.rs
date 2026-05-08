use crate::db;
use crate::sync::config::{self, WebdavConfig};
use crate::sync::merge;
use crate::sync::webdav::WebdavClient;
use crate::todo::AppState;
use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncResult {
  pub success: bool,
  pub message: String,
  pub local_updated: usize,
  pub remote_updated: usize,
  pub local_deleted: usize,
  pub remote_deleted: usize,
  pub timestamp: String,
  pub duration_ms: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncHistoryEntry {
  pub id: String,
  pub sync_time: String,
  pub direction: String,
  pub status: String,
  pub message: String,
  pub local_updated: usize,
  pub remote_updated: usize,
  pub local_deleted: usize,
  pub remote_deleted: usize,
  pub duration_ms: u64,
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_sync_config(state: State<'_, AppState>) -> Result<Option<WebdavConfig>, String> {
  let connection = db::connect(&state.db_path)?;
  config::load_config(&connection)
}

#[tauri::command(rename_all = "snake_case")]
pub fn save_sync_config(config: WebdavConfig, state: State<'_, AppState>) -> Result<(), String> {
  let connection = db::connect(&state.db_path)?;
  config::save_config(&connection, &config)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn test_sync_connection(config: WebdavConfig) -> Result<String, String> {
  let client = WebdavClient::new(&config)?;
  let detected = client.detect_auth_method().await?;
  Ok(format!("{:?}", detected).to_lowercase())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn sync_now(state: State<'_, AppState>) -> Result<SyncResult, String> {
  let start = std::time::Instant::now();
  let timestamp = Utc::now().to_rfc3339();

  let connection = db::connect(&state.db_path)?;
  let sync_config = match config::load_config(&connection)? {
    Some(c) => c,
    None => return Err("请先配置 WebDAV 同步".to_string()),
  };

  drop(connection);

  let client = WebdavClient::new(&sync_config)?;

  // Ensure remote directory exists
  client.ensure_remote_dir().await?;

  // Backup local DB
  let backup_path = state.db_path.with_extension("sync-backup");
  let _ = std::fs::copy(&state.db_path, &backup_path);

  let db_filename = "todos.db";
  let remote_path = format!("{}/{}", sync_config.remote_dir.trim_end_matches('/'), db_filename);

  let mut local_updated = 0;
  let mut remote_updated = 0;
  let mut local_deleted = 0;
  let mut remote_deleted = 0;

  // Download remote DB
  let download_result = client.get_file(&remote_path).await;
  match download_result {
    Ok((remote_bytes, new_etag)) => {
      let remote_db_path = state.db_path.with_extension("sync-remote");
      std::fs::write(&remote_db_path, &remote_bytes).map_err(|e| format!("写入远程数据库失败: {e}"))?;

      // Merge
      let merge_result = merge::merge_databases(&state.db_path, &remote_db_path, &state.device_id)?;
      local_updated = merge_result.local_updated;
      remote_updated = merge_result.remote_updated;
      local_deleted = merge_result.local_deleted;
      remote_deleted = merge_result.remote_deleted;

      let _ = std::fs::remove_file(&remote_db_path);

      // Upload merged DB
      let local_bytes = std::fs::read(&state.db_path).map_err(|e| format!("读取本地数据库失败: {e}"))?;
      let final_etag = client.put_file(&remote_path, &local_bytes, new_etag.as_deref()).await?;

      // Update etag
      let connection = db::connect(&state.db_path)?;
      connection
        .execute(
          "UPDATE sync_meta SET remote_etag = ?1, last_sync_time = ?2 WHERE id = 1",
          params![final_etag.unwrap_or_default(), &timestamp],
        )
        .map_err(|e| format!("更新同步元数据失败: {e}"))?;
    }
    Err(e) if e.contains("远程文件不存在") => {
      // First time: upload local DB
      let local_bytes = std::fs::read(&state.db_path).map_err(|e| format!("读取本地数据库失败: {e}"))?;
      let etag = client.put_file(&remote_path, &local_bytes, None).await?;

      let connection = db::connect(&state.db_path)?;
      connection
        .execute(
          "UPDATE sync_meta SET remote_etag = ?1, last_sync_time = ?2 WHERE id = 1",
          params![etag.unwrap_or_default(), &timestamp],
        )
        .map_err(|e| format!("更新同步元数据失败: {e}"))?;
    }
    Err(e) => {
      return Err(e);
    }
  }

  let duration_ms = start.elapsed().as_millis() as u64;

  let result = SyncResult {
    success: true,
    message: "同步完成".to_string(),
    local_updated,
    remote_updated,
    local_deleted,
    remote_deleted,
    timestamp: timestamp.clone(),
    duration_ms,
  };

  // Record history
  let connection = db::connect(&state.db_path)?;
  connection
    .execute(
      "INSERT INTO sync_history (id, sync_time, direction, status, message, local_updated, remote_updated, local_deleted, remote_deleted, duration_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
      params![
        uuid::Uuid::new_v4().to_string(),
        &timestamp,
        "bidirectional",
        "success",
        &result.message,
        result.local_updated,
        result.remote_updated,
        result.local_deleted,
        result.remote_deleted,
        result.duration_ms,
      ],
    )
    .map_err(|e| format!("记录同步历史失败: {e}"))?;

  Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_sync_history(limit: Option<i64>, state: State<'_, AppState>) -> Result<Vec<SyncHistoryEntry>, String> {
  let connection = db::connect(&state.db_path)?;
  let max = limit.unwrap_or(50);

  let mut stmt = connection
    .prepare(
      "SELECT id, sync_time, direction, status, message, local_updated, remote_updated, local_deleted, remote_deleted, duration_ms FROM sync_history ORDER BY sync_time DESC LIMIT ?1",
    )
    .map_err(|e| format!("准备同步历史查询失败: {e}"))?;

  let rows = stmt
    .query_map(params![max], |row| {
      Ok(SyncHistoryEntry {
        id: row.get(0)?,
        sync_time: row.get(1)?,
        direction: row.get(2)?,
        status: row.get(3)?,
        message: row.get(4)?,
        local_updated: row.get(5)?,
        remote_updated: row.get(6)?,
        local_deleted: row.get(7)?,
        remote_deleted: row.get(8)?,
        duration_ms: row.get(9)?,
      })
    })
    .map_err(|e| format!("读取同步历史失败: {e}"))?;

  let mut entries = Vec::new();
  for row in rows {
    entries.push(row.map_err(|e| format!("解析同步历史失败: {e}"))?);
  }

  Ok(entries)
}