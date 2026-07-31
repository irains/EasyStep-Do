import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Clock, Cloud, CloudOff } from 'lucide-react'
import { getSyncHistory, type SyncHistoryEntry } from '@/api/sync'

export function SyncStatus() {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<SyncHistoryEntry[]>([])
  const [expanded, setExpanded] = useState(false)

  const loadHistory = async () => {
    try {
      const data = await getSyncHistory(20)
      setEntries(data)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void loadHistory(), 0)
    const timer = window.setInterval(() => void loadHistory(), 30000)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(timer)
    }
  }, [])

  const lastEntry = entries[0]
  const lastTime = lastEntry?.sync_time
    ? new Date(lastEntry.sync_time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : t('syncStatus.notSynced')

  return (
    <div className="rounded-md border border-border/60 bg-background/55 px-1.5 py-1 text-[11px] text-muted-foreground">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-1"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <div className="flex items-center gap-1.5">
          {lastEntry?.status === 'success' ? (
            <CheckCircle2 className="size-3 text-emerald-500" />
          ) : lastEntry?.status === 'error' ? (
            <CloudOff className="size-3 text-red-500" />
          ) : (
            <Cloud className="size-3 opacity-60" />
          )}
          <span className="font-medium text-foreground/80">{t('syncStatus.title')}</span>
        </div>
        <div className="flex items-center gap-1">
          <Clock className="size-3 opacity-60" />
          <span>{lastTime}</span>
        </div>
      </button>

      {expanded && entries.length > 0 && (
        <div className="mt-1.5 max-h-32 space-y-1 overflow-y-auto border-t border-border/50 pt-1">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between gap-2 rounded border border-border/40 bg-muted/20 px-1.5 py-0.5">
              <div className="flex items-center gap-1">
                {entry.status === 'success' ? (
                  <CheckCircle2 className="size-2.5 text-emerald-500" />
                ) : (
                  <CloudOff className="size-2.5 text-red-500" />
                )}
                <span className="text-[10px]">
                  {entry.status === 'success' ? t('syncStatus.updated', { count: entry.local_updated + entry.remote_updated }) : entry.message.slice(0, 20)}
                </span>
              </div>
              <span className="shrink-0 text-[10px]">
                {new Date(entry.sync_time).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
