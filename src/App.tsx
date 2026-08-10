import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { setTheme } from '@tauri-apps/api/app'
import { useTheme } from 'next-themes'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FileText, Search, Settings, Trash2, X } from 'lucide-react'

import {
  addTodo,
  deleteTodo,
  listTodos,
  reorderTodo,
  toggleTodo,
  updateTodo,
  type Todo,
  type TodoFilter,
} from '@/api/todo'
import { invoke } from '@tauri-apps/api/core'
import { getSyncConfig, syncNow } from '@/api/sync'
import { MarkdownEditor } from '@/components/markdown-editor'
import { MarkdownPreview } from '@/components/markdown-preview'
import { ModeToggle } from '@/components/mode-toggle'
import { ReportPanel } from '@/components/report-panel'
import { SettingsPanel } from '@/components/settings-panel'
import { SyncStatus } from '@/components/sync-status'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  buildCalendarDays,
  formatLocalDate,
  getWeekRange,
  monthStart,
  shiftMonth,
} from '@/lib/date'

const WEEK_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

function App() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [title, setTitle] = useState('')
  const [detailMd, setDetailMd] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [expandedTodoId, setExpandedTodoId] = useState<string | null>(null)
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDetailMd, setEditDetailMd] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [syncSettingsOpen, setSyncSettingsOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [showComposerDetail, setShowComposerDetail] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<TodoFilter>('all')
  const [scope, setScope] = useState<'all' | 'week' | 'date'>('all')
  const [composeDate, setComposeDate] = useState(() => formatLocalDate(new Date()))
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(new Date()))
  const [now, setNow] = useState(() => new Date())
  const lastDateStrRef = useRef(formatLocalDate(new Date()))

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const { resolvedTheme } = useTheme()
  const { t, i18n } = useTranslation()

  useEffect(() => {
    if (resolvedTheme) {
      setTheme(resolvedTheme === 'dark' ? 'dark' : 'light').catch(() => {})
    }
  }, [resolvedTheme])

  // Sync tray language on mount
  useEffect(() => {
    invoke('update_tray_language', { lang: i18n.language }).catch(() => {})
  }, [i18n.language])

  const loadTodos = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await listTodos()
      setTodos(data)
      setExpandedTodoId((prev) => (prev && data.some((todo) => todo.id === prev) ? prev : null))
      setEditingTodoId((prev) => (prev && data.some((todo) => todo.id === prev) ? prev : null))
      setDeleteConfirmId((prev) => (prev && data.some((todo) => todo.id === prev) ? prev : null))
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTodos()
  }, [loadTodos])

  // Auto-sync timer
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const autoSyncRunningRef = useRef(false)

  const runAutoSync = useCallback(async () => {
    if (autoSyncRunningRef.current) {
      return
    }

    autoSyncRunningRef.current = true
    try {
      await syncNow()
      await loadTodos()
    } catch (e) {
      console.error('auto sync failed:', e)
    } finally {
      autoSyncRunningRef.current = false
    }
  }, [loadTodos])

  const startAutoSync = useCallback(async () => {
    if (syncTimerRef.current) {
      clearInterval(syncTimerRef.current)
      syncTimerRef.current = null
    }
    try {
      const cfg = await getSyncConfig()
      if (cfg?.auto_sync_enabled && cfg.auto_sync_interval_mins > 0) {
        syncTimerRef.current = setInterval(() => {
          void runAutoSync()
        }, cfg.auto_sync_interval_mins * 60 * 1000)
      }
    } catch {
      // ignore
    }
  }, [runAutoSync])

  useEffect(() => {
    void startAutoSync()
    return () => {
      if (syncTimerRef.current) clearInterval(syncTimerRef.current)
    }
  }, [startAutoSync])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const todayStr = formatLocalDate(now)
    if (todayStr !== lastDateStrRef.current) {
      const oldToday = lastDateStrRef.current
      lastDateStrRef.current = todayStr
      if (composeDate === oldToday) {
        setComposeDate(todayStr)
        setVisibleMonth(monthStart(now))
      }
    }
  }, [now, composeDate])

  const scopedTodos = useMemo(() => {
    if (scope === 'all') {
      return todos
    }
    if (scope === 'date') {
      return todos.filter((todo) => todo.journal_date === composeDate)
    }
    const [weekStart, weekEnd] = getWeekRange(now)
    return todos.filter((todo) => todo.journal_date >= weekStart && todo.journal_date <= weekEnd)
  }, [scope, todos, now, composeDate])

  const normalizedSearchQuery = useMemo(() => searchQuery.trim().toLocaleLowerCase(), [searchQuery])
  const searchActive = normalizedSearchQuery.length > 0

  const statusFilteredTodos = useMemo(() => {
    if (activeFilter === 'active') {
      return scopedTodos.filter((todo) => !todo.completed)
    }
    if (activeFilter === 'completed') {
      return scopedTodos.filter((todo) => todo.completed)
    }
    return scopedTodos
  }, [activeFilter, scopedTodos])

  const filteredTodos = useMemo(() => {
    if (!normalizedSearchQuery) {
      return statusFilteredTodos
    }

    return statusFilteredTodos.filter((todo) =>
      `${todo.title} ${todo.detail_md} ${todo.journal_date}`.toLocaleLowerCase().includes(normalizedSearchQuery),
    )
  }, [normalizedSearchQuery, statusFilteredTodos])

  const groupedFilteredTodos = useMemo(() => {
    const groups = new Map<string, Todo[]>()

    for (const todo of filteredTodos) {
      const group = groups.get(todo.journal_date)
      if (group) {
        group.push(todo)
      } else {
        groups.set(todo.journal_date, [todo])
      }
    }

    return Array.from(groups.entries()).map(([date, groupedTodos]) => ({ date, todos: groupedTodos }))
  }, [filteredTodos])

  const stats = useMemo(() => {
    const total = scopedTodos.length
    const completed = scopedTodos.filter((todo) => todo.completed).length
    const active = total - completed
    const rate = total === 0 ? 0 : Math.round((completed / total) * 100)
    return { total, active, completed, rate }
  }, [scopedTodos])

  const selectedDateTodos = useMemo(
    () => todos.filter((todo) => todo.journal_date === composeDate).toSorted((a, b) => a.sort_order - b.sort_order),
    [composeDate, todos],
  )

  const calendarDays = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth])
  const calendarStatusByDate = useMemo(() => {
    const statusByDate = new Map<string, { completed: number; active: number }>()

    for (const todo of todos) {
      const status = statusByDate.get(todo.journal_date) ?? { completed: 0, active: 0 }
      if (todo.completed) {
        status.completed += 1
      } else {
        status.active += 1
      }
      statusByDate.set(todo.journal_date, status)
    }

    return statusByDate
  }, [todos])
  const editingTodo = useMemo(
    () => (editingTodoId ? todos.find((todo) => todo.id === editingTodoId) ?? null : null),
    [editingTodoId, todos],
  )

  const handleSubmit = async () => {
    const nextTitle = title.trim()
    if (!nextTitle) {
      setError(t('todo.titleRequired'))
      return
    }

    const targetDate = composeDate
    const nextDetailMd = detailMd.trim()

    setSubmitting(true)
    setError('')
    try {
      await addTodo(nextTitle, targetDate, nextDetailMd || undefined)
      setTitle('')
      setDetailMd('')
      setShowComposerDetail(false)
      await loadTodos()
    } catch (e) {
      setError(String(e))
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggle = async (id: string) => {
    setPendingId(id)
    setError('')
    try {
      await toggleTodo(id)
      await loadTodos()
    } catch (e) {
      setError(String(e))
    } finally {
      setPendingId(null)
    }
  }

  const handleDelete = async (id: string) => {
    setPendingId(id)
    setError('')
    try {
      await deleteTodo(id)
      setDeleteConfirmId((prev) => (prev === id ? null : prev))
      if (expandedTodoId === id) {
        setExpandedTodoId(null)
      }
      if (editingTodoId === id) {
        setEditingTodoId(null)
        setEditTitle('')
        setEditDetailMd('')
      }
      await loadTodos()
    } catch (e) {
      setError(String(e))
    } finally {
      setPendingId(null)
    }
  }

  const handleStartEdit = (todo: Todo) => {
    setEditingTodoId(todo.id)
    setEditTitle(todo.title)
    setEditDetailMd(todo.detail_md)
    setError('')
  }

  const handleCancelEdit = () => {
    setEditingTodoId(null)
    setEditTitle('')
    setEditDetailMd('')
  }

  const handleSaveEdit = async () => {
    if (!editingTodoId) {
      return
    }

    const nextTitle = editTitle.trim()
    if (!nextTitle) {
      setError(t('todo.titleRequired'))
      return
    }

    setSavingEdit(true)
    setError('')
    try {
      const updated = await updateTodo(editingTodoId, nextTitle, editDetailMd.trim() || undefined)
      setTodos((prev) => prev.map((todo) => (todo.id === updated.id ? updated : todo)))
      setEditingTodoId(null)
      setEditTitle('')
      setEditDetailMd('')
    } catch (e) {
      setError(String(e))
      await loadTodos()
    } finally {
      setSavingEdit(false)
    }
  }

  const handleToggleExpand = (id: string) => {
    setExpandedTodoId((prev) => (prev === id ? null : id))
    if (editingTodoId === id) {
      handleCancelEdit()
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!canReorder) {
      return
    }
    const { active, over } = event
    if (!over || active.id === over.id) {
      return
    }

    const currentIds = filteredTodos.map((todo) => todo.id)
    const oldIndex = currentIds.indexOf(String(active.id))
    const newIndex = currentIds.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) {
      return
    }

    const nextIds = arrayMove(currentIds, oldIndex, newIndex)
    const movedId = String(active.id)
    const movedIndex = nextIds.indexOf(movedId)
    const prevId = movedIndex > 0 ? nextIds[movedIndex - 1] : null
    const nextId = movedIndex < nextIds.length - 1 ? nextIds[movedIndex + 1] : null

    try {
      await reorderTodo({ moved_id: movedId, prev_id: prevId, next_id: nextId }, composeDate)
      await loadTodos()
    } catch (e) {
      setError(String(e))
      await loadTodos()
    }
  }

  const locale = i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US'

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'long',
      }).format(visibleMonth),
    [visibleMonth, locale],
  )

  const nowDateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now),
    [now, locale],
  )

  const nowWeekdayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: 'short',
      }).format(now),
    [now, locale],
  )

  const nowTimeLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(now),
    [now, locale],
  )

  const nowPeriodLabel = useMemo(() => {
    const hour = now.getHours()
    if (hour < 6) return t('time.dawn')
    if (hour < 12) return t('time.morning')
    if (hour < 14) return t('time.noon')
    if (hour < 18) return t('time.afternoon')
    return t('time.evening')
  }, [now, t])

  const canReorder = scope === 'date' && !searchActive
  const scopeLabel = scope === 'all' ? t('scope.all') : scope === 'week' ? t('scope.week') : t('scope.date')
  const scopeTextClass = scope === 'all' ? 'text-sky-500 dark:text-sky-400' : scope === 'week' ? 'text-violet-500 dark:text-violet-400' : 'text-amber-500 dark:text-amber-400'
  const progressTextClass =
    stats.rate === 100
      ? 'text-emerald-500 dark:text-emerald-400'
      : stats.rate >= 60
        ? 'text-sky-500 dark:text-sky-400'
        : stats.rate >= 30
          ? 'text-amber-500 dark:text-amber-400'
          : 'text-rose-500 dark:text-rose-400'
  const progressBarClass =
    stats.rate === 100
      ? 'bg-emerald-400/90 dark:bg-emerald-400/80'
      : stats.rate >= 60
        ? 'bg-sky-400/90 dark:bg-sky-400/80'
        : stats.rate >= 30
          ? 'bg-amber-400/90 dark:bg-amber-400/80'
          : 'bg-rose-400/90 dark:bg-rose-400/80'

  return (
    <main className="h-screen overflow-hidden p-2 lg:p-4">
      <SettingsPanel
        open={syncSettingsOpen}
        onClose={() => setSyncSettingsOpen(false)}
        onSynced={() => void loadTodos()}
        onSyncConfigSaved={() => void startAutoSync()}
      />
      {reportOpen && (
        <ReportPanel
          open
          todos={todos}
          now={now}
          locale={locale}
          pendingTodoId={pendingId}
          onToggleTodo={handleToggle}
          onClose={() => setReportOpen(false)}
        />
      )}
      {editingTodo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-[1px]">
          <div className="w-full max-w-4xl overflow-hidden rounded-xl border border-border/80 bg-card/98 shadow-[0_18px_48px_rgba(0,0,0,0.22)]">
            <div className="flex items-center justify-between border-b border-border/70 bg-muted/20 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{t('todo.edit')}</p>
                <p className="truncate text-[11px] text-muted-foreground">{editingTodo.title}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleCancelEdit}
                disabled={savingEdit}
                className="size-7"
                aria-label={t('todo.closeEdit')}
                title={t('todo.closeEdit')}
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="space-y-3 px-3 py-3">
              <Input
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
                placeholder={t('todo.editTitle')}
                maxLength={200}
                disabled={savingEdit}
              />
              <MarkdownEditor
                value={editDetailMd}
                onChange={setEditDetailMd}
                placeholder={t('composer.detailPlaceholder')}
                disabled={savingEdit}
              />
              <div className="flex justify-end gap-1.5 border-t border-border/65 pt-2">
                <Button type="button" variant="ghost" size="sm" onClick={handleCancelEdit} disabled={savingEdit}>
                  {t('todo.cancel')}
                </Button>
                <Button type="button" size="sm" onClick={handleSaveEdit} disabled={savingEdit}>
                  {savingEdit ? t('todo.saving') : t('todo.save')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto grid h-full min-h-0 w-full max-w-[1480px] gap-3 md:grid-cols-[252px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-[0_10px_30px_rgba(15,23,42,0.07)]">
          <div className="shrink-0 px-4 pt-4 pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">{t('app.name')}</p>
                  <span className="inline-flex h-5 items-center rounded-full bg-muted/65 px-2 text-[11px] font-medium text-muted-foreground">
                    {nowPeriodLabel}
                  </span>
                </div>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">{t('app.description')}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <ModeToggle />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setSyncSettingsOpen(true)}
                  aria-label={t('settings.title')}
                  title={t('settings.title')}
                  className="size-8"
                >
                  <Settings className="size-4" />
                </Button>
              </div>
            </div>

            <div className="mt-4">
              <p className="text-[30px] font-semibold leading-none tracking-tight text-foreground [font-variant-numeric:tabular-nums]">
                {nowTimeLabel}
              </p>
              <p className="mt-2 text-xs font-medium text-muted-foreground [font-variant-numeric:tabular-nums]">
                {nowDateLabel}
                <span className="ml-2 text-foreground/80">{nowWeekdayLabel}</span>
              </p>
            </div>
          </div>

          <div className="px-3 pb-3">
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/45 p-1">
              <SidebarButton active={scope === 'all'} onClick={() => setScope('all')}>
                {t('scope.all')}
              </SidebarButton>
              <SidebarButton active={scope === 'week'} onClick={() => setScope('week')}>
                {t('scope.week')}
              </SidebarButton>
              <SidebarButton active={scope === 'date'} onClick={() => setScope('date')}>
                {t('scope.date')}
              </SidebarButton>
            </div>
          </div>

          <div className="panel-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3">
            <div className="rounded-xl bg-background/50 p-2">
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
                  <CalendarDays className="size-4 text-muted-foreground" />
                  <span className="truncate">{monthLabel}</span>
                </p>
                <div className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setVisibleMonth((prev) => shiftMonth(prev, -1))}
                    className="size-7"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setVisibleMonth((prev) => shiftMonth(prev, 1))}
                    className="size-7"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="mb-1 grid grid-cols-7 text-center text-[10px] font-medium text-muted-foreground/85">
                {WEEK_KEYS.map((key) => (
                  <span key={key}>{t(`week.${key}`)}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {calendarDays.map((day) => {
                  const dayStatus = calendarStatusByDate.get(day.key)
                  const hasCompleted = Boolean(dayStatus?.completed)
                  const hasActive = Boolean(dayStatus?.active)

                  return (
                    <button
                      key={day.key}
                      type="button"
                      onClick={() => {
                        setScope('date')
                        setComposeDate(day.key)
                        setVisibleMonth(monthStart(day.date))
                      }}
                      className={`relative flex h-7 flex-col items-center justify-center rounded-md text-[10px] leading-none transition-colors ${
                        day.key === composeDate
                          ? 'bg-foreground text-background'
                          : day.inCurrentMonth
                            ? 'text-foreground/85 hover:bg-muted/80'
                            : 'text-muted-foreground/45 hover:bg-muted/60'
                      } ${day.isToday && day.key !== composeDate ? 'ring-1 ring-foreground/25' : ''}`}
                    >
                      <span>{day.date.getDate()}</span>
                      {(hasCompleted || hasActive) && (
                        <span className="absolute bottom-0.5 flex items-center justify-center gap-0.5">
                          {hasCompleted && <span className="h-1 w-1 rounded-full bg-emerald-400" />}
                          {hasActive && <span className="h-1 w-1 rounded-full bg-amber-400" />}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="mt-3 border-t border-border/45 px-1 pt-3 text-[11px] text-muted-foreground">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span>{t('context.viewMode')}</span>
                <span className={`truncate font-medium ${scopeTextClass}`}>{scopeLabel}</span>
              </div>
              <div className="mt-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span>{t('context.progress')}</span>
                  <span className={`font-medium ${progressTextClass}`}>{stats.rate}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-border/55">
                  <div
                    className={`h-full rounded-full transition-all ${progressBarClass}`}
                    style={{ width: `${stats.rate}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="mt-auto px-1 pt-4">
              <div className="mb-2 flex items-center justify-between gap-2 text-[11px]">
                <span className="font-medium text-foreground/80">{t('context.selectedTasks')}</span>
                <span className="text-muted-foreground">{selectedDateTodos.length}</span>
              </div>
              {selectedDateTodos.length > 0 ? (
                <ul className="space-y-1">
                  {selectedDateTodos.slice(0, 3).map((todo) => (
                    <li key={todo.id} className="flex min-w-0 items-center gap-1.5 text-[11px]">
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${todo.completed ? 'bg-emerald-400' : 'bg-amber-400'}`}
                        aria-hidden="true"
                      />
                      <span className={`truncate ${todo.completed ? 'text-muted-foreground line-through' : 'text-foreground/80'}`}>
                        {todo.title}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] leading-5 text-muted-foreground/80">{t('context.selectedTasksEmpty')}</p>
              )}
              {selectedDateTodos.length > 3 && (
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  {t('context.moreSelectedTasks', { count: selectedDateTodos.length - 3 })}
                </p>
              )}
            </div>
          </div>

          <div className="shrink-0 border-t border-border/45 px-3 py-2">
            <SyncStatus />
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden">
          <div className="shrink-0 rounded-2xl border border-border/65 bg-card/90 px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{t('composer.title')}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{t('composer.hint')}</p>
              </div>
              <p className="shrink-0 rounded-full bg-muted/55 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {composeDate === formatLocalDate(now) ? `${t('context.today')} ${composeDate.slice(5)}` : composeDate}
              </p>
            </div>

            <form
              className="mt-3 grid gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void handleSubmit()
              }}
            >
              <div className="flex items-center gap-2">
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={t('composer.placeholder')}
                  maxLength={200}
                  disabled={submitting}
                  className="h-9 border-border/70 bg-background/70"
                />
                <Button type="submit" disabled={submitting} className="h-9 min-w-20">
                  {submitting ? t('composer.adding') : t('composer.add')}
                </Button>
              </div>

              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowComposerDetail((prev) => !prev)}
                  disabled={submitting}
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  {showComposerDetail ? t('composer.collapseDetail') : t('composer.toggleDetail')}
                </Button>
                <p className="text-xs text-muted-foreground">{t('composer.dateHint')}</p>
              </div>

              {showComposerDetail && (
                <div className="max-h-[58vh] overflow-y-auto pr-1">
                  <MarkdownEditor
                    value={detailMd}
                    onChange={setDetailMd}
                    placeholder={t('composer.detailPlaceholder')}
                    disabled={submitting}
                  />
                </div>
              )}
            </form>
            {error && (
              <p className="mt-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-500">
                {error}
              </p>
            )}
          </div>

          <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/65 bg-card/90 shadow-[0_10px_30px_rgba(15,23,42,0.07)]">
            <div className="shrink-0 border-b border-border/50 px-4 pt-3 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold leading-6 text-foreground">{t('todo.list')}</h2>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {t('report.summaryCompact', { total: stats.total, completed: stats.completed, active: stats.active })}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex min-w-0 items-center gap-2">
                <Tabs value={activeFilter} onValueChange={(value) => setActiveFilter(value as TodoFilter)} className="w-auto shrink-0">
                  <TabsList className="border-0 bg-muted/45">
                    <TabsTrigger value="all">{t('todo.all')} {stats.total}</TabsTrigger>
                    <TabsTrigger value="active">{t('todo.active')} {stats.active}</TabsTrigger>
                    <TabsTrigger value="completed">{t('todo.completed')} {stats.completed}</TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/75" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={t('todo.searchPlaceholder')}
                    className="h-9 border-border/70 bg-background/70 pr-8 pl-8 text-sm"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute top-1/2 right-2 flex size-4 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label={t('todo.clearSearch')}
                      title={t('todo.clearSearch')}
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setReportOpen(true)} className="h-9 shrink-0 px-3 text-xs">
                  <FileText className="size-3.5" />
                  {t('report.open')}
                </Button>
              </div>
            </div>
            <div className="panel-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3">
              {loading ? (
                <p className="py-5 text-sm text-muted-foreground">{t('todo.loading')}</p>
              ) : filteredTodos.length === 0 ? (
                <p className="py-5 text-sm text-muted-foreground">{searchActive ? t('todo.searchEmpty') : t('todo.empty')}</p>
              ) : canReorder ? (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext
                    items={filteredTodos.map((todo) => todo.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="grid gap-1.5">
                      {filteredTodos.map((todo) => (
                        <TodoRow
                          key={todo.id}
                          todo={todo}
                          disabled={pendingId === todo.id}
                          expanded={expandedTodoId === todo.id}
                          editing={editingTodoId !== null}
                          canReorder={canReorder}
                          deleteConfirming={deleteConfirmId === todo.id}
                          onToggle={handleToggle}
                          onDelete={handleDelete}
                          onRequestDeleteConfirm={setDeleteConfirmId}
                          onToggleExpand={handleToggleExpand}
                          onStartEdit={handleStartEdit}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              ) : (
                <div className="grid gap-4">
                  {groupedFilteredTodos.map((group) => (
                    <section key={group.date} className="grid gap-1.5">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground/80">{group.date}</span>
                        <span className="h-px min-w-4 flex-1 bg-border/45" />
                        <span>{group.todos.length}</span>
                      </div>
                      <ul className="grid gap-1.5">
                        {group.todos.map((todo) => (
                          <TodoRow
                            key={todo.id}
                            todo={todo}
                            disabled={pendingId === todo.id}
                            expanded={expandedTodoId === todo.id}
                            editing={editingTodoId !== null}
                            canReorder={canReorder}
                            deleteConfirming={deleteConfirmId === todo.id}
                            onToggle={handleToggle}
                            onDelete={handleDelete}
                            onRequestDeleteConfirm={setDeleteConfirmId}
                            onToggleExpand={handleToggleExpand}
                            onStartEdit={handleStartEdit}
                          />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </section>
        </section>
      </div>
    </main>
  )
}

type TodoRowProps = {
  todo: Todo
  disabled: boolean
  expanded: boolean
  editing: boolean
  canReorder: boolean
  deleteConfirming: boolean
  onToggle: (id: string) => void
  onDelete: (id: string) => void
  onRequestDeleteConfirm: (id: string | null) => void
  onToggleExpand: (id: string) => void
  onStartEdit: (todo: Todo) => void
}

function TodoRow({
  todo,
  disabled,
  expanded,
  editing,
  canReorder,
  deleteConfirming,
  onToggle,
  onDelete,
  onRequestDeleteConfirm,
  onToggleExpand,
  onStartEdit,
}: TodoRowProps) {
  const { t } = useTranslation()
  const rowDisabled = disabled

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: todo.id,
    disabled: !canReorder || rowDisabled || editing,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`group min-w-0 overflow-hidden rounded-xl border border-border/55 bg-background/70 transition-all ${
        isDragging ? 'shadow-md' : 'hover:border-border/80 hover:bg-muted/30'
      }`}
    >
      <div className="px-3 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            {...(canReorder && !rowDisabled && !editing ? attributes : {})}
            {...(canReorder && !rowDisabled && !editing ? listeners : {})}
            className={`flex min-w-0 flex-1 items-center gap-2.5 ${
              canReorder && !rowDisabled && !editing ? 'cursor-grab active:cursor-grabbing' : ''
            }`}
          >
            <label className="shrink-0">
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => onToggle(todo.id)}
                disabled={rowDisabled}
                className="size-3.5 accent-black dark:accent-white"
              />
            </label>

            <div className="min-w-0 flex-1">
              <button
                type="button"
                className="w-full min-w-0 text-left"
                onClick={() => onToggleExpand(todo.id)}
                disabled={rowDisabled}
              >
                <p className={`truncate text-sm font-medium ${todo.completed ? 'text-muted-foreground line-through' : ''}`}>
                  {todo.title}
                </p>
                <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
                  <span className="shrink-0 rounded-md bg-muted/35 px-1.5 py-px text-[10px] tabular-nums text-muted-foreground/80 [font-variant-numeric:tabular-nums]">
                    {todo.journal_date}
                  </span>
                  {todo.detail_md ? (
                    <span
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium transition-colors ${
                        expanded
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                      }`}
                    >
                      {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                      {expanded ? t('todo.expanded') : t('todo.expandable')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted/35 px-2 py-0.5 text-muted-foreground/90">
                      <FileText className="size-3 opacity-75" />
                      {t('todo.noDetail')}
                    </span>
                  )}
                </div>
              </button>
            </div>
          </div>

          <div className="shrink-0 self-center">
            {deleteConfirming ? (
              <div className="inline-flex overflow-hidden rounded-md border border-red-500/40 bg-red-500/8">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(todo.id)}
                  disabled={rowDisabled}
                  className="h-8 rounded-none rounded-l-md border-r border-red-500/30 px-2 text-red-600 hover:bg-red-500/15 dark:text-red-300"
                >
                  {t('todo.confirmDelete')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onRequestDeleteConfirm(null)}
                  disabled={rowDisabled}
                  className="h-8 rounded-none rounded-r-md px-2"
                >
                  {t('todo.cancel')}
                </Button>
              </div>
            ) : (
              <div className="inline-flex overflow-hidden rounded-lg border border-border/55 bg-background/70 opacity-80 transition-opacity group-hover:opacity-100">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onStartEdit(todo)}
                  disabled={rowDisabled}
                  className="size-8 rounded-none rounded-l-md border-r border-border/70"
                  aria-label={t('todo.edit')}
                  title={t('todo.edit')}
                >
                  <FileText className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onRequestDeleteConfirm(todo.id)}
                  disabled={rowDisabled}
                  className="size-8 rounded-none rounded-r-md text-red-500 hover:bg-red-500/12 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
                  aria-label={t('todo.deleteTask')}
                  title={t('todo.deleteTask')}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border/70 bg-muted/25 px-3 py-2 text-sm">
          {todo.detail_md ? (
            <MarkdownPreview
              value={todo.detail_md}
              emptyLabel={t('todo.noContent')}
              className="border-0 bg-transparent p-0"
            />
          ) : (
            <p className="text-xs text-muted-foreground">{t('todo.noContent')}</p>
          )}
        </div>
      )}
    </li>
  )
}

type SidebarButtonProps = {
  active: boolean
  onClick: () => void
  children: ReactNode
}

function SidebarButton({ active, onClick, children }: SidebarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 w-full items-center justify-center rounded-lg px-2 text-xs font-medium transition-colors ${
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

export default App
