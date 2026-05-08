import { useEffect, useState } from 'react'
import { Loader2, Monitor, Moon, RefreshCw, Save, Settings, Sun, TestTube2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTheme } from 'next-themes'
import {
  getSyncConfig,
  saveSyncConfig,
  syncNow,
  testSyncConnection,
  type AuthMethod,
  type WebdavConfig,
  type SyncResult,
} from '@/api/sync'
import { invoke } from '@tauri-apps/api/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const PROVIDERS = [
  { nameKey: 'providers.jianguo', url: 'https://dav.jianguo.com/dav/' },
  { nameKey: 'providers.nextcloud', url: 'https://<domain>/remote.php/dav/files/<user>/' },
  { nameKey: 'providers.synology', url: 'https://<domain>:5006/' },
]

const defaultConfig: WebdavConfig = {
  server_url: '',
  username: '',
  password: '',
  remote_dir: '/easystep-do/',
  auth_method: 'auto',
  timeout_secs: 30,
  auto_sync_enabled: false,
  auto_sync_interval_mins: 0,
}

type Props = {
  open: boolean
  onClose: () => void
  onSynced?: () => void
}

export function SettingsPanel({ open, onClose, onSynced }: Props) {
  const { t, i18n } = useTranslation()
  const { theme, setTheme } = useTheme()

  const [tab, setTab] = useState<'sync' | 'general'>('general')
  const [config, setConfig] = useState<WebdavConfig>(defaultConfig)
  const [loaded, setLoaded] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && !loaded) {
      setLoaded(true)
      getSyncConfig().then((c) => {
        if (c) setConfig(c)
      })
    }
    if (!open) {
      setLoaded(false)
      setTestResult('')
      setError('')
      setSyncResult(null)
    }
  }, [open, loaded])

  if (!open) return null

  const update = <K extends keyof WebdavConfig>(key: K, value: WebdavConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
    setTestResult('')
    setError('')
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult('')
    setError('')
    try {
      const result = await testSyncConnection(config)
      setTestResult(t('settings.sync.testSuccess', { method: result }))
    } catch (e) {
      setError(String(e))
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      await saveSyncConfig(config)
      setTestResult(t('settings.sync.configSaved'))
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    setSyncResult(null)
    setError('')
    try {
      const result = await syncNow()
      setSyncResult(result)
      onSynced?.()
    } catch (e) {
      setError(String(e))
    } finally {
      setSyncing(false)
    }
  }

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang)
    invoke('update_tray_language', { lang }).catch(() => {})
  }

  const tabClass = (active: boolean) =>
    `flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
      active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
    }`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-[1px]">
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-border/80 bg-card/98 shadow-[0_18px_48px_rgba(0,0,0,0.22)]">
        <div className="flex items-center justify-between border-b border-border/70 bg-muted/20 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Settings className="size-4 text-sky-500" />
            <p className="text-sm font-semibold text-foreground">{t('settings.title')}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} className="size-7" aria-label="关闭">
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex gap-1 border-b border-border/60 px-4 pt-3 pb-2">
          <button type="button" className={tabClass(tab === 'general')} onClick={() => setTab('general')}>
            {t('settings.theme.title')}
          </button>
          <button type="button" className={tabClass(tab === 'sync')} onClick={() => setTab('sync')}>
            {t('settings.sync.title')}
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-4">
          {tab === 'general' && (
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-xs font-medium text-muted-foreground">{t('settings.theme.title')}</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setTheme('system')}
                    className={`flex flex-col items-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs transition-colors ${
                      theme === 'system' ? 'border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-400' : 'border-border/60 text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <Monitor className="size-4" />
                    {t('settings.theme.system')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme('light')}
                    className={`flex flex-col items-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs transition-colors ${
                      theme === 'light' ? 'border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-400' : 'border-border/60 text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <Sun className="size-4" />
                    {t('settings.theme.light')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme('dark')}
                    className={`flex flex-col items-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs transition-colors ${
                      theme === 'dark' ? 'border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-400' : 'border-border/60 text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <Moon className="size-4" />
                    {t('settings.theme.dark')}
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium text-muted-foreground">{t('settings.language.title')}</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleLanguageChange('zh')}
                    className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${
                      i18n.language.startsWith('zh') ? 'border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-400' : 'border-border/60 text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    中文
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLanguageChange('en')}
                    className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${
                      i18n.language.startsWith('en') ? 'border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-400' : 'border-border/60 text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    English
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'sync' && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('settings.sync.serverUrl')}</label>
                <Input
                  value={config.server_url}
                  onChange={(e) => update('server_url', e.target.value)}
                  placeholder={t('settings.sync.serverPlaceholder')}
                  className="h-8 text-sm"
                />
                <div className="mt-1 flex flex-wrap gap-1">
                  {PROVIDERS.map((p) => (
                    <button
                      key={p.nameKey}
                      type="button"
                      onClick={() => update('server_url', p.url)}
                      className="rounded border border-border/50 bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted"
                    >
                      {t(p.nameKey)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('settings.sync.username')}</label>
                  <Input
                    value={config.username}
                    onChange={(e) => update('username', e.target.value)}
                    placeholder={t('settings.sync.username')}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('settings.sync.password')}</label>
                  <Input
                    type="password"
                    value={config.password}
                    onChange={(e) => update('password', e.target.value)}
                    placeholder={t('settings.sync.passwordPlaceholder')}
                    className="h-8 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('settings.sync.remoteDir')}</label>
                  <Input
                    value={config.remote_dir}
                    onChange={(e) => update('remote_dir', e.target.value)}
                    placeholder="/easystep-do/"
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('settings.sync.authMethod')}</label>
                  <select
                    value={config.auth_method}
                    onChange={(e) => update('auth_method', e.target.value as AuthMethod)}
                    className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
                  >
                    <option value="auto">{t('settings.sync.authAuto')}</option>
                    <option value="basic">Basic</option>
                    <option value="digest">Digest</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('settings.sync.timeout')}</label>
                  <Input
                    type="number"
                    value={config.timeout_secs}
                    onChange={(e) => update('timeout_secs', Number(e.target.value) || 30)}
                    min={5}
                    max={300}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('settings.sync.autoSyncInterval')}</label>
                  <Input
                    type="number"
                    value={config.auto_sync_interval_mins || ''}
                    onChange={(e) => update('auto_sync_interval_mins', Number(e.target.value) || 0)}
                    min={1}
                    max={1440}
                    placeholder="30"
                    className="h-8 text-sm"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="auto-sync"
                  checked={config.auto_sync_enabled}
                  onChange={(e) => update('auto_sync_enabled', e.target.checked)}
                  className="size-3.5 accent-black dark:accent-white"
                />
                <label htmlFor="auto-sync" className="text-xs text-muted-foreground">
                  {t('settings.sync.autoSyncEnabled')}
                </label>
              </div>

              {testResult && (
                <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                  {testResult}
                </p>
              )}

              {error && (
                <p className="rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-500">
                  {error}
                </p>
              )}

              {syncResult && (
                <div className="rounded-md border border-border/60 bg-muted/25 px-3 py-2 text-xs">
                  <p className="font-medium text-foreground">{syncResult.message}</p>
                  <p className="mt-1 text-muted-foreground">
                    {t('syncStatus.updated', { count: syncResult.local_updated + syncResult.remote_updated })} | {syncResult.duration_ms}ms
                  </p>
                </div>
              )}

              <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
                <Button type="button" variant="outline" size="sm" onClick={handleTest} disabled={testing || !config.server_url}>
                  {testing ? <Loader2 className="mr-1 size-3 animate-spin" /> : <TestTube2 className="mr-1 size-3" />}
                  {t('settings.sync.testConnection')}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={handleSave} disabled={saving || !config.server_url}>
                  {saving ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Save className="mr-1 size-3" />}
                  {t('settings.sync.saveConfig')}
                </Button>
                <Button type="button" size="sm" onClick={handleSync} disabled={syncing || !config.server_url}>
                  {syncing ? <Loader2 className="mr-1 size-3 animate-spin" /> : <RefreshCw className="mr-1 size-3" />}
                  {t('settings.sync.syncNow')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
