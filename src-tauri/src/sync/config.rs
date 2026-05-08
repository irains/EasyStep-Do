use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebdavConfig {
  pub server_url: String,
  pub username: String,
  pub password: String,
  pub remote_dir: String,
  pub auth_method: AuthMethod,
  pub timeout_secs: u64,
  pub auto_sync_enabled: bool,
  pub auto_sync_interval_mins: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AuthMethod {
  Auto,
  Basic,
  Digest,
}

impl Default for WebdavConfig {
  fn default() -> Self {
    Self {
      server_url: String::new(),
      username: String::new(),
      password: String::new(),
      remote_dir: "/easystep-do/".to_string(),
      auth_method: AuthMethod::Auto,
      timeout_secs: 30,
      auto_sync_enabled: false,
      auto_sync_interval_mins: 0,
    }
  }
}

pub fn load_config(connection: &Connection) -> Result<Option<WebdavConfig>, String> {
  let row = connection
    .query_row(
      "SELECT server_url, username, password, remote_dir, auth_method, timeout_secs, auto_sync_enabled, auto_sync_interval_mins FROM sync_config WHERE id = 1",
      [],
      |row| {
        let server_url: String = row.get(0)?;
        Ok((
          server_url,
          row.get::<_, String>(1)?,
          row.get::<_, String>(2)?,
          row.get::<_, String>(3)?,
          row.get::<_, String>(4)?,
          row.get::<_, u64>(5)?,
          row.get::<_, i64>(6)?,
          row.get::<_, u64>(7)?,
        ))
      },
    )
    .optional()
    .map_err(|e| format!("读取同步配置失败: {e}"))?;

  let (server_url, username, enc_pass, remote_dir, auth_str, timeout_secs, auto_enabled, auto_interval) =
    match row {
      Some(r) => r,
      None => return Ok(None),
    };

  if server_url.is_empty() {
    return Ok(None);
  }

  let password = BASE64.decode(&enc_pass).map(|b| String::from_utf8_lossy(&b).to_string()).unwrap_or_default();
  let auth_method = match auth_str.as_str() {
    "basic" => AuthMethod::Basic,
    "digest" => AuthMethod::Digest,
    _ => AuthMethod::Auto,
  };

  Ok(Some(WebdavConfig {
    server_url,
    username,
    password,
    remote_dir,
    auth_method,
    timeout_secs,
    auto_sync_enabled: auto_enabled != 0,
    auto_sync_interval_mins: auto_interval,
  }))
}

pub fn save_config(connection: &Connection, config: &WebdavConfig) -> Result<(), String> {
  let enc_pass = BASE64.encode(config.password.as_bytes());
  let auth_str = match config.auth_method {
    AuthMethod::Auto => "auto",
    AuthMethod::Basic => "basic",
    AuthMethod::Digest => "digest",
  };

  let count: i64 = connection
    .query_row("SELECT COUNT(*) FROM sync_config WHERE id = 1", [], |row| row.get(0))
    .map_err(|e| format!("检查同步配置失败: {e}"))?;

  if count == 0 {
    connection
      .execute(
        "INSERT INTO sync_config (id, server_url, username, password, remote_dir, auth_method, timeout_secs, auto_sync_enabled, auto_sync_interval_mins) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
          &config.server_url,
          &config.username,
          &enc_pass,
          &config.remote_dir,
          auth_str,
          config.timeout_secs,
          config.auto_sync_enabled as i64,
          config.auto_sync_interval_mins,
        ],
      )
      .map_err(|e| format!("保存同步配置失败: {e}"))?;
  } else {
    connection
      .execute(
        "UPDATE sync_config SET server_url = ?1, username = ?2, password = ?3, remote_dir = ?4, auth_method = ?5, timeout_secs = ?6, auto_sync_enabled = ?7, auto_sync_interval_mins = ?8 WHERE id = 1",
        params![
          &config.server_url,
          &config.username,
          &enc_pass,
          &config.remote_dir,
          auth_str,
          config.timeout_secs,
          config.auto_sync_enabled as i64,
          config.auto_sync_interval_mins,
        ],
      )
      .map_err(|e| format!("更新同步配置失败: {e}"))?;
  }

  Ok(())
}