use crate::db;
use chrono::{Local, NaiveDate, Utc};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use uuid::Uuid;

const MIN_ORDER_GAP: f64 = 0.0001;

pub struct AppState {
  pub db_path: std::path::PathBuf,
}

#[derive(Debug, Serialize)]
pub struct Todo {
  pub id: String,
  pub title: String,
  pub detail_md: String,
  pub completed: bool,
  pub created_at: String,
  pub updated_at: String,
  pub sort_order: f64,
  pub journal_date: String,
}

#[derive(Debug, Deserialize)]
pub struct ReorderPayload {
  pub moved_id: String,
  pub prev_id: Option<String>,
  pub next_id: Option<String>,
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_todos(date: Option<String>, state: State<'_, AppState>) -> Result<Vec<Todo>, String> {
  let connection = db::connect(&state.db_path)?;

  let mut todos = Vec::new();

  if let Some(raw_date) = date {
    let journal_date = resolve_journal_date(Some(raw_date))?;
    let mut statement = connection
      .prepare(
        "
        SELECT id, title, detail_md, completed, created_at, updated_at, sort_order, journal_date
        FROM todos
        WHERE journal_date = ?1
        ORDER BY sort_order ASC, created_at ASC, id ASC
        ",
      )
      .map_err(|error| format!("查询待办失败: {error}"))?;

    let rows = statement
      .query_map(params![&journal_date], |row| {
        Ok(Todo {
          id: row.get(0)?,
          title: row.get(1)?,
          detail_md: row.get(2)?,
          completed: row.get::<_, i64>(3)? != 0,
          created_at: row.get(4)?,
          updated_at: row.get(5)?,
          sort_order: row.get(6)?,
          journal_date: row.get(7)?,
        })
      })
      .map_err(|error| format!("读取待办列表失败: {error}"))?;

    for row in rows {
      todos.push(row.map_err(|error| format!("解析待办数据失败: {error}"))?);
    }
  } else {
    let mut statement = connection
      .prepare(
        "
        SELECT id, title, detail_md, completed, created_at, updated_at, sort_order, journal_date
        FROM todos
        ORDER BY journal_date DESC, sort_order ASC, created_at ASC, id ASC
        ",
      )
      .map_err(|error| format!("查询待办失败: {error}"))?;

    let rows = statement
      .query_map([], |row| {
        Ok(Todo {
          id: row.get(0)?,
          title: row.get(1)?,
          detail_md: row.get(2)?,
          completed: row.get::<_, i64>(3)? != 0,
          created_at: row.get(4)?,
          updated_at: row.get(5)?,
          sort_order: row.get(6)?,
          journal_date: row.get(7)?,
        })
      })
      .map_err(|error| format!("读取待办列表失败: {error}"))?;

    for row in rows {
      todos.push(row.map_err(|error| format!("解析待办数据失败: {error}"))?);
    }
  }

  Ok(todos)
}

#[tauri::command(rename_all = "snake_case")]
pub fn add_todo(
  title: String,
  detail_md: Option<String>,
  date: Option<String>,
  state: State<'_, AppState>,
) -> Result<Todo, String> {
  let trimmed_title = title.trim();
  if trimmed_title.is_empty() {
    return Err("待办内容不能为空".to_string());
  }

  let detail_md = detail_md.unwrap_or_default().trim().to_string();
  let journal_date = resolve_journal_date(date)?;
  let now = Utc::now().to_rfc3339();
  let connection = db::connect(&state.db_path)?;

  let max_order: Option<f64> = connection
    .query_row(
      "SELECT MAX(sort_order) FROM todos WHERE journal_date = ?1",
      params![&journal_date],
      |row| row.get(0),
    )
    .map_err(|error| format!("读取排序信息失败: {error}"))?;
  let sort_order = max_order.unwrap_or(0.0) + db::ORDER_STEP;

  let todo = Todo {
    id: Uuid::new_v4().to_string(),
    title: trimmed_title.to_string(),
    detail_md,
    completed: false,
    created_at: now.clone(),
    updated_at: now,
    sort_order,
    journal_date,
  };

  connection
    .execute(
      "
      INSERT INTO todos (id, title, detail_md, completed, created_at, updated_at, sort_order, journal_date)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      ",
      params![
        &todo.id,
        &todo.title,
        &todo.detail_md,
        if todo.completed { 1 } else { 0 },
        &todo.created_at,
        &todo.updated_at,
        todo.sort_order,
        &todo.journal_date
      ],
    )
    .map_err(|error| format!("新增待办失败: {error}"))?;

  Ok(todo)
}

#[tauri::command(rename_all = "snake_case")]
pub fn toggle_todo(id: String, state: State<'_, AppState>) -> Result<Todo, String> {
  let connection = db::connect(&state.db_path)?;

  let (current_title, current_detail_md, current_completed, created_at, sort_order, journal_date):
    (String, String, i64, String, f64, String) = connection
      .query_row(
        "SELECT title, detail_md, completed, created_at, sort_order, journal_date FROM todos WHERE id = ?1",
        params![&id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
      )
      .map_err(|_| "待办不存在".to_string())?;

  let next_completed = if current_completed == 0 { 1 } else { 0 };
  let updated_at = Utc::now().to_rfc3339();

  connection
    .execute(
      "UPDATE todos SET completed = ?1, updated_at = ?2 WHERE id = ?3",
      params![next_completed, &updated_at, &id],
    )
    .map_err(|error| format!("更新待办状态失败: {error}"))?;

  Ok(Todo {
    id,
    title: current_title,
    detail_md: current_detail_md,
    completed: next_completed != 0,
    created_at,
    updated_at,
    sort_order,
    journal_date,
  })
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_todo(
  id: String,
  title: String,
  detail_md: Option<String>,
  state: State<'_, AppState>,
) -> Result<Todo, String> {
  let trimmed_title = title.trim();
  if trimmed_title.is_empty() {
    return Err("待办标题不能为空".to_string());
  }

  let detail_md = detail_md.unwrap_or_default().trim().to_string();
  let updated_at = Utc::now().to_rfc3339();
  let connection = db::connect(&state.db_path)?;

  let affected_rows = connection
    .execute(
      "UPDATE todos SET title = ?1, detail_md = ?2, updated_at = ?3 WHERE id = ?4",
      params![trimmed_title, &detail_md, &updated_at, &id],
    )
    .map_err(|error| format!("更新待办失败: {error}"))?;

  if affected_rows == 0 {
    return Err("待办不存在".to_string());
  }

  connection
    .query_row(
      "SELECT id, title, detail_md, completed, created_at, updated_at, sort_order, journal_date FROM todos WHERE id = ?1",
      params![&id],
      |row| {
        Ok(Todo {
          id: row.get(0)?,
          title: row.get(1)?,
          detail_md: row.get(2)?,
          completed: row.get::<_, i64>(3)? != 0,
          created_at: row.get(4)?,
          updated_at: row.get(5)?,
          sort_order: row.get(6)?,
          journal_date: row.get(7)?,
        })
      },
    )
    .map_err(|error| format!("读取更新后待办失败: {error}"))
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_todo(id: String, state: State<'_, AppState>) -> Result<(), String> {
  let connection = db::connect(&state.db_path)?;
  let affected_rows = connection
    .execute("DELETE FROM todos WHERE id = ?1", params![&id])
    .map_err(|error| format!("删除待办失败: {error}"))?;

  if affected_rows == 0 {
    return Err("待办不存在".to_string());
  }

  Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub fn reorder_todo(
  payload: ReorderPayload,
  date: Option<String>,
  state: State<'_, AppState>,
) -> Result<(), String> {
  let journal_date = resolve_journal_date(date)?;

  let mut connection = db::connect(&state.db_path)?;
  let transaction = connection
    .transaction()
    .map_err(|error| format!("开启排序事务失败: {error}"))?;

  let moved_exists: Option<String> = transaction
    .query_row(
      "SELECT id FROM todos WHERE id = ?1 AND journal_date = ?2",
      params![&payload.moved_id, &journal_date],
      |row| row.get(0),
    )
    .optional()
    .map_err(|error| format!("读取待办失败: {error}"))?;

  if moved_exists.is_none() {
    return Err("待办不存在或不在当前日期".to_string());
  }

  let prev_order = match payload.prev_id.as_deref() {
    Some(prev_id) => Some(
      db::get_sort_order(&transaction, prev_id, &journal_date)?
        .ok_or_else(|| "前置待办不存在或不在当前日期".to_string())?,
    ),
    None => None,
  };

  let next_order = match payload.next_id.as_deref() {
    Some(next_id) => Some(
      db::get_sort_order(&transaction, next_id, &journal_date)?
        .ok_or_else(|| "后置待办不存在或不在当前日期".to_string())?,
    ),
    None => None,
  };

  let mut target_order = match (prev_order, next_order) {
    (Some(prev), Some(next)) => {
      if next <= prev {
        db::rebalance_sort_orders(&transaction, &journal_date)?;
        let prev = db::get_sort_order(
          &transaction,
          payload.prev_id.as_deref().ok_or_else(|| "前置待办缺失".to_string())?,
          &journal_date,
        )?
        .ok_or_else(|| "前置待办不存在".to_string())?;
        let next = db::get_sort_order(
          &transaction,
          payload.next_id.as_deref().ok_or_else(|| "后置待办缺失".to_string())?,
          &journal_date,
        )?
        .ok_or_else(|| "后置待办不存在".to_string())?;
        (prev + next) / 2.0
      } else {
        (prev + next) / 2.0
      }
    }
    (Some(prev), None) => prev + db::ORDER_STEP,
    (None, Some(next)) => next - db::ORDER_STEP,
    (None, None) => db::ORDER_STEP,
  };

  if let (Some(prev), Some(next)) = (prev_order, next_order) {
    if (next - prev).abs() < MIN_ORDER_GAP {
      db::rebalance_sort_orders(&transaction, &journal_date)?;
      let prev = db::get_sort_order(
        &transaction,
        payload.prev_id.as_deref().ok_or_else(|| "前置待办缺失".to_string())?,
        &journal_date,
      )?
      .ok_or_else(|| "前置待办不存在".to_string())?;
      let next = db::get_sort_order(
        &transaction,
        payload.next_id.as_deref().ok_or_else(|| "后置待办缺失".to_string())?,
        &journal_date,
      )?
      .ok_or_else(|| "后置待办不存在".to_string())?;
      target_order = (prev + next) / 2.0;
    }
  }

  transaction
    .execute(
      "UPDATE todos SET sort_order = ?1, updated_at = ?2 WHERE id = ?3 AND journal_date = ?4",
      params![target_order, Utc::now().to_rfc3339(), &payload.moved_id, &journal_date],
    )
    .map_err(|error| format!("更新排序失败: {error}"))?;

  transaction
    .commit()
    .map_err(|error| format!("提交排序事务失败: {error}"))?;

  Ok(())
}

fn resolve_journal_date(input: Option<String>) -> Result<String, String> {
  match input {
    Some(date) => {
      NaiveDate::parse_from_str(&date, "%Y-%m-%d")
        .map_err(|_| "日期格式必须是 YYYY-MM-DD".to_string())?;
      Ok(date)
    }
    None => Ok(Local::now().date_naive().format("%Y-%m-%d").to_string()),
  }
}

pub fn initialize_state(app: &AppHandle) -> Result<AppState, String> {
  let db_path = db::init_database(app)?;
  Ok(AppState { db_path })
}
