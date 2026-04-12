import { invoke } from '@tauri-apps/api/core'

export type Todo = {
  id: string
  title: string
  detail_md: string
  completed: boolean
  created_at: string
  updated_at: string
  sort_order: number
  journal_date: string
}

export type TodoFilter = 'all' | 'active' | 'completed'

export type ReorderPayload = {
  moved_id: string
  prev_id: string | null
  next_id: string | null
}

export async function listTodos(date?: string) {
  return invoke<Todo[]>('list_todos', { date })
}

export async function addTodo(title: string, date?: string, detail_md?: string) {
  return invoke<Todo>('add_todo', { title, date, detail_md })
}

export async function toggleTodo(id: string) {
  return invoke<Todo>('toggle_todo', { id })
}

export async function updateTodo(id: string, title: string, detail_md?: string) {
  return invoke<Todo>('update_todo', { id, title, detail_md })
}

export async function deleteTodo(id: string) {
  return invoke<void>('delete_todo', { id })
}

export async function reorderTodo(payload: ReorderPayload, date?: string) {
  return invoke<void>('reorder_todo', { payload, date })
}

export async function openExternalUrl(url: string) {
  return invoke<void>('open_external_url', { url })
}
