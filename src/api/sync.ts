import { invoke } from '@tauri-apps/api/core'

export type AuthMethod = 'auto' | 'basic' | 'digest'

export type WebdavConfig = {
  server_url: string
  username: string
  password: string
  remote_dir: string
  auth_method: AuthMethod
  timeout_secs: number
  auto_sync_enabled: boolean
  auto_sync_interval_mins: number
}

export type SyncResult = {
  success: boolean
  message: string
  local_updated: number
  remote_updated: number
  local_deleted: number
  remote_deleted: number
  timestamp: string
  duration_ms: number
}

export type SyncHistoryEntry = {
  id: string
  sync_time: string
  direction: string
  status: string
  message: string
  local_updated: number
  remote_updated: number
  local_deleted: number
  remote_deleted: number
  duration_ms: number
}

export async function getSyncConfig() {
  return invoke<WebdavConfig | null>('get_sync_config')
}

export async function saveSyncConfig(config: WebdavConfig) {
  return invoke<void>('save_sync_config', { config })
}

export async function testSyncConnection(config: WebdavConfig) {
  return invoke<string>('test_sync_connection', { config })
}

export async function syncNow() {
  return invoke<SyncResult>('sync_now')
}

export async function getSyncHistory(limit?: number) {
  return invoke<SyncHistoryEntry[]>('get_sync_history', { limit })
}
