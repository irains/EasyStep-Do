use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::{
  fs,
  path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

pub const ORDER_STEP: f64 = 1024.0;

pub fn init_database(app: &AppHandle) -> Result<PathBuf, String> {
  let app_data_dir = app
    .path()
    .app_data_dir()
    .map_err(|error| format!("无法获取应用数据目录: {error}"))?;

  fs::create_dir_all(&app_data_dir).map_err(|error| format!("无法创建应用数据目录: {error}"))?;

  let db_path = app_data_dir.join("todos.db");
  let mut connection = connect(&db_path)?;

  connection
    .execute_batch(
      "
      CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        detail_md TEXT NOT NULL DEFAULT '',
        completed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sort_order REAL NOT NULL DEFAULT 0,
        journal_date TEXT NOT NULL DEFAULT ''
      );
      ",
    )
    .map_err(|error| format!("初始化数据库表失败: {error}"))?;

  ensure_sort_order_column(&connection)?;
  ensure_journal_date_column(&connection)?;
  ensure_detail_md_column(&connection)?;
  ensure_journal_date_values(&mut connection)?;
  ensure_sort_order_values(&mut connection)?;

  Ok(db_path)
}

pub fn connect(db_path: &Path) -> Result<Connection, String> {
  Connection::open(db_path).map_err(|error| format!("打开数据库失败: {error}"))
}

pub fn rebalance_sort_orders(transaction: &Transaction<'_>, journal_date: &str) -> Result<(), String> {
  let mut statement = transaction
    .prepare(
      "
      SELECT id
      FROM todos
      WHERE journal_date = ?1
      ORDER BY sort_order ASC, created_at ASC, id ASC
      ",
    )
    .map_err(|error| format!("读取待办排序失败: {error}"))?;

  let rows = statement
    .query_map(params![journal_date], |row| row.get::<_, String>(0))
    .map_err(|error| format!("读取待办排序失败: {error}"))?;

  let mut ids = Vec::new();
  for row in rows {
    ids.push(row.map_err(|error| format!("读取待办排序失败: {error}"))?);
  }

  for (index, id) in ids.iter().enumerate() {
    let order = (index as f64 + 1.0) * ORDER_STEP;
    transaction
      .execute(
        "UPDATE todos SET sort_order = ?1 WHERE id = ?2 AND journal_date = ?3",
        params![order, id, journal_date],
      )
      .map_err(|error| format!("更新待办排序失败: {error}"))?;
  }

  Ok(())
}

pub fn get_sort_order(
  transaction: &Transaction<'_>,
  id: &str,
  journal_date: &str,
) -> Result<Option<f64>, String> {
  transaction
    .query_row(
      "SELECT sort_order FROM todos WHERE id = ?1 AND journal_date = ?2",
      params![id, journal_date],
      |row| row.get(0),
    )
    .optional()
    .map_err(|error| format!("读取待办顺序失败: {error}"))
}

fn ensure_sort_order_column(connection: &Connection) -> Result<(), String> {
  let table_exists: Option<String> = connection
    .query_row(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'todos'",
      [],
      |row| row.get(0),
    )
    .optional()
    .map_err(|error| format!("检查数据表是否存在失败: {error}"))?;

  if table_exists.is_none() {
    return Ok(());
  }

  let mut statement = connection
    .prepare("PRAGMA table_info(todos)")
    .map_err(|error| format!("读取数据表结构失败: {error}"))?;

  let rows = statement
    .query_map([], |row| row.get::<_, String>(1))
    .map_err(|error| format!("读取数据表结构失败: {error}"))?;

  let mut has_sort_order = false;
  for row in rows {
    let column_name = row.map_err(|error| format!("读取数据表结构失败: {error}"))?;
    if column_name == "sort_order" {
      has_sort_order = true;
      break;
    }
  }

  if !has_sort_order {
    connection
      .execute("ALTER TABLE todos ADD COLUMN sort_order REAL", [])
      .map_err(|error| format!("迁移排序字段失败: {error}"))?;
  }

  connection
    .execute(
      "CREATE INDEX IF NOT EXISTS idx_todos_sort_order ON todos(sort_order)",
      [],
    )
    .map_err(|error| format!("创建排序索引失败: {error}"))?;

  Ok(())
}

fn ensure_journal_date_column(connection: &Connection) -> Result<(), String> {
  let mut statement = connection
    .prepare("PRAGMA table_info(todos)")
    .map_err(|error| format!("读取数据表结构失败: {error}"))?;

  let rows = statement
    .query_map([], |row| row.get::<_, String>(1))
    .map_err(|error| format!("读取数据表结构失败: {error}"))?;

  let mut has_journal_date = false;
  for row in rows {
    let column_name = row.map_err(|error| format!("读取数据表结构失败: {error}"))?;
    if column_name == "journal_date" {
      has_journal_date = true;
      break;
    }
  }

  if !has_journal_date {
    connection
      .execute("ALTER TABLE todos ADD COLUMN journal_date TEXT", [])
      .map_err(|error| format!("迁移归属日期字段失败: {error}"))?;
  }

  connection
    .execute(
      "CREATE INDEX IF NOT EXISTS idx_todos_journal_date ON todos(journal_date)",
      [],
    )
    .map_err(|error| format!("创建日期索引失败: {error}"))?;

  connection
    .execute(
      "CREATE INDEX IF NOT EXISTS idx_todos_journal_date_sort ON todos(journal_date, sort_order)",
      [],
    )
    .map_err(|error| format!("创建日期排序索引失败: {error}"))?;

  Ok(())
}

fn ensure_detail_md_column(connection: &Connection) -> Result<(), String> {
  let mut statement = connection
    .prepare("PRAGMA table_info(todos)")
    .map_err(|error| format!("读取数据表结构失败: {error}"))?;

  let rows = statement
    .query_map([], |row| row.get::<_, String>(1))
    .map_err(|error| format!("读取数据表结构失败: {error}"))?;

  let mut has_detail_md = false;
  for row in rows {
    let column_name = row.map_err(|error| format!("读取数据表结构失败: {error}"))?;
    if column_name == "detail_md" {
      has_detail_md = true;
      break;
    }
  }

  if !has_detail_md {
    connection
      .execute("ALTER TABLE todos ADD COLUMN detail_md TEXT NOT NULL DEFAULT ''", [])
      .map_err(|error| format!("迁移详情字段失败: {error}"))?;
  }

  Ok(())
}

fn ensure_journal_date_values(connection: &mut Connection) -> Result<(), String> {
  let missing_count: i64 = connection
    .query_row(
      "SELECT COUNT(*) FROM todos WHERE journal_date IS NULL OR journal_date = ''",
      [],
      |row| row.get(0),
    )
    .map_err(|error| format!("检查归属日期字段失败: {error}"))?;

  if missing_count == 0 {
    return Ok(());
  }

  connection
    .execute(
      "
      UPDATE todos
      SET journal_date = substr(created_at, 1, 10)
      WHERE journal_date IS NULL OR journal_date = ''
      ",
      [],
    )
    .map_err(|error| format!("回填归属日期字段失败: {error}"))?;

  Ok(())
}

fn ensure_sort_order_values(connection: &mut Connection) -> Result<(), String> {
  let missing_count: i64 = connection
    .query_row(
      "SELECT COUNT(*) FROM todos WHERE sort_order IS NULL OR sort_order <= 0",
      [],
      |row| row.get(0),
    )
    .map_err(|error| format!("检查排序字段失败: {error}"))?;

  if missing_count == 0 {
    return Ok(());
  }

  let ids = {
    let mut statement = connection
      .prepare(
        "
        SELECT id
        FROM todos
        ORDER BY created_at ASC, id ASC
        ",
      )
      .map_err(|error| format!("读取历史待办失败: {error}"))?;

    let rows = statement
      .query_map([], |row| row.get::<_, String>(0))
      .map_err(|error| format!("读取历史待办失败: {error}"))?;

    let mut ids = Vec::new();
    for row in rows {
      ids.push(row.map_err(|error| format!("读取历史待办失败: {error}"))?);
    }
    ids
  };

  let transaction = connection
    .transaction()
    .map_err(|error| format!("开启迁移事务失败: {error}"))?;

  for (index, id) in ids.iter().enumerate() {
    let order = (index as f64 + 1.0) * ORDER_STEP;
    transaction
      .execute(
        "UPDATE todos SET sort_order = ?1 WHERE id = ?2",
        params![order, id],
      )
      .map_err(|error| format!("回填排序字段失败: {error}"))?;
  }

  transaction
    .commit()
    .map_err(|error| format!("提交迁移事务失败: {error}"))?;

  Ok(())
}
