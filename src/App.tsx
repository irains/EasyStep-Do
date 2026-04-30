import { useEffect, useMemo, useRef, useState } from 'react'
import { setTheme } from '@tauri-apps/api/app'
import { useTheme } from 'next-themes'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
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
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FileText, Sparkles, Trash2, X } from 'lucide-react'

import {
  addTodo,
  deleteTodo,
  listTodos,
  openExternalUrl,
  reorderTodo,
  toggleTodo,
  updateTodo,
  type Todo,
  type TodoFilter,
} from '@/api/todo'
import { MarkdownEditor } from '@/components/markdown-editor'
import { ModeToggle } from '@/components/mode-toggle'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

type CalendarDay = {
  key: string
  date: Date
  inCurrentMonth: boolean
  isToday: boolean
}

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

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
  const [showComposerDetail, setShowComposerDetail] = useState(false)
  const [activeFilter, setActiveFilter] = useState<TodoFilter>('all')
  const [scope, setScope] = useState<'all' | 'week' | 'date'>('all')
  const [composeDate, setComposeDate] = useState(() => formatLocalDate(new Date()))
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(new Date()))
  const [now, setNow] = useState(() => new Date())
  const lastDateStrRef = useRef(formatLocalDate(new Date()))

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const { resolvedTheme } = useTheme()

  useEffect(() => {
    if (resolvedTheme) {
      setTheme(resolvedTheme === 'dark' ? 'dark' : 'light').catch(() => {})
    }
  }, [resolvedTheme])

  const loadTodos = async () => {
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
  }

  useEffect(() => {
    void loadTodos()
  }, [])

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

  const filteredTodos = useMemo(() => {
    if (activeFilter === 'active') {
      return scopedTodos.filter((todo) => !todo.completed)
    }
    if (activeFilter === 'completed') {
      return scopedTodos.filter((todo) => todo.completed)
    }
    return scopedTodos
  }, [activeFilter, scopedTodos])

  const stats = useMemo(() => {
    const total = scopedTodos.length
    const completed = scopedTodos.filter((todo) => todo.completed).length
    const active = total - completed
    const rate = total === 0 ? 0 : Math.round((completed / total) * 100)
    return { total, active, completed, rate }
  }, [scopedTodos])

  const calendarDays = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth])
  const editingTodo = useMemo(
    () => (editingTodoId ? todos.find((todo) => todo.id === editingTodoId) ?? null : null),
    [editingTodoId, todos],
  )

  const handleSubmit = async () => {
    const nextTitle = title.trim()
    if (!nextTitle) {
      setError('请输入待办标题')
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
      setError('请输入待办标题')
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

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: 'long',
      }).format(visibleMonth),
    [visibleMonth],
  )

  const nowDateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now),
    [now],
  )

  const nowWeekdayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        weekday: 'short',
      }).format(now),
    [now],
  )

  const nowTimeLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(now),
    [now],
  )

  const nowPeriodLabel = useMemo(() => {
    const hour = now.getHours()
    if (hour < 6) return '凌晨'
    if (hour < 12) return '上午'
    if (hour < 14) return '中午'
    if (hour < 18) return '下午'
    return '晚上'
  }, [now])

  const scopeLabel = scope === 'all' ? '全部任务' : scope === 'week' ? '本周任务' : '按日期'
  const canReorder = scope === 'date'
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
      {editingTodo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-[1px]">
          <div className="w-full max-w-4xl overflow-hidden rounded-xl border border-border/80 bg-card/98 shadow-[0_18px_48px_rgba(0,0,0,0.22)]">
            <div className="flex items-center justify-between border-b border-border/70 bg-muted/20 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">编辑任务</p>
                <p className="truncate text-[11px] text-muted-foreground">{editingTodo.title}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleCancelEdit}
                disabled={savingEdit}
                className="size-7"
                aria-label="关闭编辑"
                title="关闭编辑"
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="space-y-3 px-3 py-3">
              <Input
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
                placeholder="任务标题"
                maxLength={200}
                disabled={savingEdit}
              />
              <MarkdownEditor
                value={editDetailMd}
                onChange={setEditDetailMd}
                placeholder="详细内容（可选，支持 Markdown）"
                disabled={savingEdit}
              />
              <div className="flex justify-end gap-1.5 border-t border-border/65 pt-2">
                <Button type="button" variant="ghost" size="sm" onClick={handleCancelEdit} disabled={savingEdit}>
                  取消
                </Button>
                <Button type="button" size="sm" onClick={handleSaveEdit} disabled={savingEdit}>
                  {savingEdit ? '保存中...' : '保存'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto grid h-full min-h-0 w-full max-w-[1500px] gap-1.5 md:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col gap-1.5">
          <div className="shrink-0">
            <div className="rounded-lg border border-border/80 bg-background/70 px-2.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
              <div className="flex items-center justify-center gap-2 border-b border-border/70 pb-1.5 text-center">
                <p className="text-[20px] font-bold leading-6 text-foreground [font-variant-numeric:tabular-nums]">
                  {nowTimeLabel}
                </p>
                <span className="inline-flex h-5.5 items-center rounded-full border border-border/65 bg-muted/35 px-2 text-[12px] font-medium text-muted-foreground">
                  {nowPeriodLabel}
                </span>
              </div>
              <p className="pt-1.5 text-center text-[18px] font-bold leading-5 text-foreground [font-variant-numeric:tabular-nums]">
                {nowDateLabel}
                <span className="ml-2 text-[18px] font-bold text-foreground">{nowWeekdayLabel}</span>
              </p>
            </div>
          </div>
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-border/90 bg-card/95 shadow-[0_8px_20px_rgba(16,24,40,0.08)]">
            <CardHeader className="border-b border-border/80 px-3.5 pt-3.5 pb-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <Sparkles className="size-3.5" />
                    <span>行简</span>
                  </div>
                  <CardTitle className="text-lg">任务与日历</CardTitle>
                  <CardDescription className="mt-1 text-xs">左栏切换日期，右侧处理任务</CardDescription>
                </div>
                <ModeToggle />
              </div>


              <div className="mt-2 grid gap-1">
                <SidebarButton active={scope === 'all'} onClick={() => setScope('all')}>
                  全部任务
                </SidebarButton>
                <SidebarButton active={scope === 'week'} onClick={() => setScope('week')}>
                  本周任务
                </SidebarButton>
                <SidebarButton active={scope === 'date'} onClick={() => setScope('date')}>
                  按日期
                </SidebarButton>
              </div>
            </CardHeader>

            <CardContent className="flex min-h-0 flex-1 flex-col space-y-1.5 overflow-hidden px-3 py-2">
              <div className="rounded-lg border border-border bg-muted/40 p-1">
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <CalendarDays className="size-4 text-muted-foreground" />
                    {monthLabel}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setVisibleMonth((prev) => shiftMonth(prev, -1))}
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setVisibleMonth((prev) => shiftMonth(prev, 1))}
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                </div>

                <div className="mb-0.5 grid grid-cols-7 text-center text-[10px] text-muted-foreground">
                  {WEEK_LABELS.map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-0.5">
                  {calendarDays.map((day) => (
                    <button
                      key={day.key}
                      type="button"
                      onClick={() => {
                        setScope('date')
                        setComposeDate(day.key)
                        setVisibleMonth(monthStart(day.date))
                      }}
                      className={`h-6 rounded text-[10px] transition-colors ${
                        day.key === composeDate
                          ? 'bg-foreground text-background'
                          : day.inCurrentMonth
                            ? 'hover:bg-muted'
                            : 'text-muted-foreground/50 hover:bg-muted/70'
                      } ${day.isToday && day.key !== composeDate ? 'ring-1 ring-foreground/35' : ''}`}
                    >
                      {day.date.getDate()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-1 flex-col gap-1 overflow-hidden">
                <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-1.5 py-1.5 text-[11px] text-muted-foreground">
                  <p className="mb-1 font-medium text-foreground/80">当前上下文</p>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/55 px-2 py-1">
                      <span>视图模式</span>
                      <span className={`font-medium ${scopeTextClass}`}>{scopeLabel}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/55 px-2 py-1">
                      <span>新增日期</span>
                      <span className="font-medium text-foreground">{composeDate === formatLocalDate(now) ? '今天' : composeDate}</span>
                    </div>
                    <div className="rounded-md border border-border/60 bg-background/55 px-2 py-1">
                      <div className="mb-1 flex items-center justify-between">
                        <span>完成进度</span>
                        <span className={`font-medium ${progressTextClass}`}>{stats.rate}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-border/60">
                        <div
                          className={`h-full rounded-full transition-all ${progressBarClass}`}
                          style={{ width: `${Math.max(stats.rate, 6)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-border/60 bg-background/55 px-1.5 py-1 text-[11px] text-muted-foreground">
                  <p className="font-medium text-foreground/80">快捷提示</p>
                  <ul className="mt-1 space-y-0.5 leading-4">
                    <li>• 单击任务标题可展开或收起详情。</li>
                    <li>• Markdown 支持 Ctrl/Cmd + B、Ctrl/Cmd + I。</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col gap-1 overflow-hidden">
          <Card className="border-border/90 bg-card/95 shadow-[0_6px_16px_rgba(16,24,40,0.06)]">
            <CardContent className="py-1.5">
              <div className="mb-1 flex items-center justify-between gap-2 rounded-md border border-border/70 bg-muted/25 px-2.5 py-1">
                <div className="min-w-0 flex items-center gap-2">
                  <p className="shrink-0 text-sm font-semibold text-foreground">快速添加待办</p>
                  <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                    标题必填，详情可选（支持 Markdown）
                  </span>
                </div>
                <p className="shrink-0 text-xs text-muted-foreground">{composeDate === formatLocalDate(now) ? `今天 ${composeDate.slice(5)}` : composeDate}</p>
              </div>

              <form
                className="grid gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleSubmit()
                }}
              >
                <div className="flex items-center gap-1.5">
                  <Input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="输入标题后回车或点击添加"
                    maxLength={200}
                    disabled={submitting}
                    className="h-9"
                  />
                  <Button type="submit" disabled={submitting} className="h-9 min-w-20">
                    {submitting ? '添加中...' : '添加'}
                  </Button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowComposerDetail((prev) => !prev)}
                    disabled={submitting}
                    className="h-7 px-2 text-xs"
                  >
                    {showComposerDetail ? '收起详情编辑器' : '添加详情（可选）'}
                  </Button>
                  <p className="text-xs text-muted-foreground">日期在左侧日历选择</p>
                </div>

                {showComposerDetail && (
                  <div className="max-h-[58vh] overflow-y-auto pr-1">
                    <MarkdownEditor
                      value={detailMd}
                      onChange={setDetailMd}
                      placeholder="详细内容（可选，支持 Markdown）"
                      disabled={submitting}
                    />
                  </div>
                )}
              </form>
              {error && (
                <p className="mt-1.5 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-500">
                  {error}
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-border/90 bg-card/95 shadow-[0_8px_20px_rgba(16,24,40,0.08)]">
            <CardHeader className="px-4 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">任务清单</CardTitle>
                <Tabs value={activeFilter} onValueChange={(value) => setActiveFilter(value as TodoFilter)}>
                  <TabsList>
                    <TabsTrigger value="all">全部 {stats.total}</TabsTrigger>
                    <TabsTrigger value="active">进行中 {stats.active}</TabsTrigger>
                    <TabsTrigger value="completed">已完成 {stats.completed}</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </CardHeader>
            <CardContent className="panel-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden pt-0 pb-2">
              {loading ? (
                <p className="py-5 text-sm text-muted-foreground">加载中...</p>
              ) : filteredTodos.length === 0 ? (
                <p className="py-5 text-sm text-muted-foreground">该范围/筛选下暂无任务。</p>
              ) : canReorder ? (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext
                    items={filteredTodos.map((todo) => todo.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="grid gap-1.5 pr-1">
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
                <ul className="grid gap-1.5 pr-1">
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
              )}
            </CardContent>
          </Card>
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
      className={`min-w-0 overflow-hidden rounded-lg border border-border bg-background/85 transition-all ${
        isDragging ? 'shadow-md' : 'hover:bg-muted/40'
      }`}
    >
      <div className="px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
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
                <div className="mt-1 flex items-center gap-1.5 text-[10px]">
                  <span className="shrink-0 rounded border border-border/40 bg-muted/25 px-1.5 py-px text-[10px] tabular-nums text-muted-foreground/80 [font-variant-numeric:tabular-nums]">
                    {todo.journal_date}
                  </span>
                  {todo.detail_md ? (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium transition-colors ${
                        expanded
                          ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                      }`}
                    >
                      {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                      {expanded ? '已展开' : '可展开'}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/35 px-2 py-0.5 text-muted-foreground/90">
                      <FileText className="size-3 opacity-75" />
                      暂无详情
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
                  确认删除
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onRequestDeleteConfirm(null)}
                  disabled={rowDisabled}
                  className="h-8 rounded-none rounded-r-md px-2"
                >
                  取消
                </Button>
              </div>
            ) : (
              <div className="inline-flex overflow-hidden rounded-md border border-border/70">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onStartEdit(todo)}
                  disabled={rowDisabled}
                  className="size-8 rounded-none rounded-l-md border-r border-border/70"
                  aria-label="编辑任务"
                  title="编辑任务"
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
                  aria-label="删除任务"
                  title="删除任务"
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
            <div className="todo-markdown text-sm text-foreground">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeSanitize]}
                components={{
                  a: ({ href, children, ...props }) => (
                    <a
                      {...props}
                      href={href}
                      className="text-sky-600 underline underline-offset-2 hover:text-sky-500 dark:text-sky-400 dark:hover:text-sky-300"
                      onClick={(event) => {
                        event.preventDefault()
                        if (!href) {
                          return
                        }
                        void openExternalUrl(href)
                      }}
                    >
                      {children}
                    </a>
                  ),
                }}
              >
                {todo.detail_md}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">暂无详细内容，点击编辑可补充。</p>
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
      className={`flex h-8 w-full items-center rounded-md px-2.5 text-left text-sm transition-colors ${
        active
          ? 'bg-foreground text-background shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function shiftMonth(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1)
}

function getWeekRange(date: Date): [string, string] {
  const day = date.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() + mondayOffset)
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
  return [formatLocalDate(monday), formatLocalDate(sunday)]
}

function buildCalendarDays(visibleMonth: Date): CalendarDay[] {
  const monthFirst = monthStart(visibleMonth)
  const offset = (monthFirst.getDay() + 6) % 7
  const start = new Date(monthFirst.getFullYear(), monthFirst.getMonth(), 1 - offset)
  const totalCells = 42
  const today = formatLocalDate(new Date())
  const days: CalendarDay[] = []

  for (let i = 0; i < totalCells; i += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    const key = formatLocalDate(date)
    days.push({
      key,
      date,
      inCurrentMonth: date.getMonth() === visibleMonth.getMonth(),
      isToday: key === today,
    })
  }

  return days
}

export default App
