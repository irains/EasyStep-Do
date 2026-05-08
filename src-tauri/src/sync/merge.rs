use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use std::path::Path;

pub struct MergeResult {
  pub local_updated: usize,
  pub remote_updated: usize,
  pub local_deleted: usize,
  pub remote_deleted: usize,
}

pub fn merge_databases(
  local_db_path: &Path,
  remote_db_path: &Path,
  device_id: &str,
) -> Result<MergeResult, String> {
  let mut local = Connection::open(local_db_path)
    .map_err(|e| format!("打开本地数据库失败: {e}"))?;

  let remote = Connection::open_with_flags(remote_db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
    .map_err(|e| format!("打开远程数据库失败: {e}"))?;

  let tx = local
    .transaction()
    .map_err(|e| format!("开启合并事务失败: {e}"))?;

  let mut result = MergeResult {
    local_updated: 0,
    remote_updated: 0,
    local_deleted: 0,
    remote_deleted: 0,
  };

  merge_todos(&tx, &remote, &mut result)?;
  apply_remote_tombstones(&tx, &remote, &mut result)?;
  apply_local_tombstones(&tx, &remote, device_id, &mut result)?;

  tx.commit().map_err(|e| format!("提交合并事务失败: {e}"))?;

  Ok(result)
}

fn merge_todos(
  local: &Connection,
  remote: &Connection,
  result: &mut MergeResult,
) -> Result<(), String> {
  let mut stmt = remote
    .prepare("SELECT id, title, detail_md, completed, created_at, updated_at, sort_order, journal_date FROM todos")
    .map_err(|e| format!("准备远程查询失败: {e}"))?;

  let rows = stmt
    .query_map([], |row| {
      Ok((
        row.get::<_, String>(0)?,
        row.get::<_, String>(1)?,
        row.get::<_, String>(2)?,
        row.get::<_, i64>(3)?,
        row.get::<_, String>(4)?,
        row.get::<_, String>(5)?,
        row.get::<_, f64>(6)?,
        row.get::<_, String>(7)?,
      ))
    })
    .map_err(|e| format!("读取远程待办失败: {e}"))?;

  for row in rows {
    let (id, title, detail_md, completed, created_at, updated_at, sort_order, journal_date) =
      row.map_err(|e| format!("解析远程待办数据失败: {e}"))?;

    let local_updated: Option<String> = local
      .query_row(
        "SELECT updated_at FROM todos WHERE id = ?1",
        params![&id],
        |r| r.get(0),
      )
      .optional()
      .map_err(|e| format!("查询本地待办失败: {e}"))?;

    match local_updated {
      None => {
        local
          .execute(
            "INSERT INTO todos (id, title, detail_md, completed, created_at, updated_at, sort_order, journal_date) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![&id, &title, &detail_md, completed, &created_at, &updated_at, sort_order, &journal_date],
          )
          .map_err(|e| format!("插入远程待办失败: {e}"))?;
        result.local_updated += 1;
      }
      Some(local_time) if updated_at > local_time => {
        local
          .execute(
            "UPDATE todos SET title = ?2, detail_md = ?3, completed = ?4, created_at = ?5, updated_at = ?6, sort_order = ?7, journal_date = ?8 WHERE id = ?1",
            params![&id, &title, &detail_md, completed, &created_at, &updated_at, sort_order, &journal_date],
          )
          .map_err(|e| format!("更新远程待办失败: {e}"))?;
        result.local_updated += 1;
      }
      _ => {
        result.remote_updated += 1;
      }
    }
  }

  Ok(())
}

fn apply_remote_tombstones(
  local: &Connection,
  remote: &Connection,
  result: &mut MergeResult,
) -> Result<(), String> {
  let mut stmt = remote
    .prepare("SELECT id, deleted_at, device_id FROM deleted_records")
    .map_err(|e| format!("准备远程墓碑查询失败: {e}"))?;

  let rows = stmt
    .query_map([], |row| {
      Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
    })
    .map_err(|e| format!("读取远程墓碑失败: {e}"))?;

  for row in rows {
    let (id, deleted_at, device_id) = row.map_err(|e| format!("解析远程墓碑失败: {e}"))?;

    let exists_locally: bool = local
      .query_row("SELECT COUNT(*) FROM deleted_records WHERE id = ?1", params![&id], |r| {
        r.get::<_, i64>(0)
      })
      .map_err(|e| format!("检查本地墓碑失败: {e}"))?
      > 0;

    if !exists_locally {
      local
        .execute("DELETE FROM todos WHERE id = ?1", params![&id])
        .map_err(|e| format!("应用远程删除失败: {e}"))?;
      local
        .execute(
          "INSERT OR IGNORE INTO deleted_records (id, deleted_at, device_id) VALUES (?1, ?2, ?3)",
          params![&id, &deleted_at, &device_id],
        )
        .map_err(|e| format!("记录远程墓碑失败: {e}"))?;
      result.local_deleted += 1;
    }
  }

  Ok(())
}

fn apply_local_tombstones(
  local: &Connection,
  remote: &Connection,
  local_device_id: &str,
  result: &mut MergeResult,
) -> Result<(), String> {
  let mut stmt = local
    .prepare("SELECT id, deleted_at FROM deleted_records WHERE device_id != ?1")
    .map_err(|e| format!("准备本地墓碑查询失败: {e}"))?;

  let rows = stmt
    .query_map(params![local_device_id], |row| {
      Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })
    .map_err(|e| format!("读取本地墓碑失败: {e}"))?;

  for row in rows {
    let (id, _deleted_at) = row.map_err(|e| format!("解析本地墓碑失败: {e}"))?;

    let remote_exists: bool = remote
      .query_row("SELECT COUNT(*) FROM deleted_records WHERE id = ?1", params![&id], |r| {
        r.get::<_, i64>(0)
      })
      .unwrap_or(0)
      > 0;

    if !remote_exists {
      result.remote_deleted += 1;
    }
  }

  Ok(())
}