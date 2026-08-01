import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronLeft, ChevronRight, Copy, FileText, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { Todo } from '@/api/todo'
import { MarkdownPreview } from '@/components/markdown-preview'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatLocalDate, getMonthRange, getWeekRange } from '@/lib/date'
import { buildReportModel, generateReportMarkdown, type ReportMarkdownLabels, type ReportMarkdownTemplate } from '@/lib/report'

type ReportPreset = 'week' | 'month' | 'custom'
type ReportView = 'summary' | 'details'

type ReportPanelProps = {
  open: boolean
  todos: Todo[]
  now: Date
  locale: string
  pendingTodoId?: string | null
  onToggleTodo: (id: string) => void | Promise<void>
  onClose: () => void
}

export function ReportPanel({ open, todos, now, locale, pendingTodoId = null, onToggleTodo, onClose }: ReportPanelProps) {
  const { t } = useTranslation()
  const [preset, setPreset] = useState<ReportPreset>('month')
  const [view, setView] = useState<ReportView>('summary')
  const [template, setTemplate] = useState<ReportMarkdownTemplate>('compact')
  const [anchorDate, setAnchorDate] = useState(now)
  const [customStartDate, setCustomStartDate] = useState(() => getMonthRange(now)[0])
  const [customEndDate, setCustomEndDate] = useState(() => getMonthRange(now)[1])
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')

  const [weekStart, weekEnd] = useMemo(() => getWeekRange(anchorDate), [anchorDate])
  const [monthStartDate, monthEndDate] = useMemo(() => getMonthRange(anchorDate), [anchorDate])
  const [startDate, endDate] = useMemo(() => {
    if (preset === 'week') return [weekStart, weekEnd]
    if (preset === 'month') return [monthStartDate, monthEndDate]
    return [customStartDate, customEndDate]
  }, [customEndDate, customStartDate, monthEndDate, monthStartDate, preset, weekEnd, weekStart])

  const templateOptions = useMemo<Array<{ value: ReportMarkdownTemplate; label: string }>>(() => {
    const options: Array<{ value: ReportMarkdownTemplate; label: string }> = [
      { value: 'compact', label: t('report.templateCompact') },
    ]

    if (preset === 'week' || preset === 'custom') {
      options.push({ value: 'weekly', label: t('report.templateWeekly') })
    }

    if (preset === 'month' || preset === 'custom') {
      options.push({ value: 'monthly', label: t('report.templateMonthly') })
    }

    return options
  }, [preset, t])

  const invalidRange = startDate > endDate
  const reportModel = useMemo(
    () => (invalidRange ? null : buildReportModel(todos, startDate, endDate)),
    [endDate, invalidRange, startDate, todos],
  )

  const rangeLabel = useMemo(() => formatRange(startDate, endDate, locale), [endDate, locale, startDate])
  const markdownLabels: ReportMarkdownLabels = useMemo(
    () => ({
      heading: t('report.markdownHeading', { range: rangeLabel }),
      scopeNote: t('report.scopeNote'),
      completed: t('report.completed'),
      active: t('report.active'),
      weeklyCompleted: t('report.weeklyCompleted'),
      weeklyPlan: t('report.weeklyPlan'),
      monthlyCompleted: t('report.monthlyCompleted'),
      monthlyFollowUp: t('report.monthlyFollowUp'),
      risks: t('report.risks'),
      none: t('report.none'),
      emptyAll: t('report.emptyAllMarkdown'),
      emptyCompleted: t('report.emptyCompletedMarkdown'),
      emptyActive: t('report.emptyActiveMarkdown'),
    }),
    [rangeLabel, t],
  )
  const markdown = useMemo(
    () => (reportModel ? generateReportMarkdown(reportModel, markdownLabels, { includeActive: true, template }) : ''),
    [markdownLabels, reportModel, template],
  )

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (!open) return null

  const stats = reportModel?.totals ?? { all: 0, completed: 0, active: 0, daysWithCompleted: 0 }
  const canShiftRange = preset !== 'custom'

  const handlePresetChange = (value: string) => {
    const nextPreset = value as ReportPreset
    setPreset(nextPreset)
    setCopied(false)
    setCopyError('')
    if ((nextPreset === 'week' && template === 'monthly') || (nextPreset === 'month' && template === 'weekly')) {
      setTemplate('compact')
    }
    if (nextPreset !== 'custom') {
      setAnchorDate(now)
    }
  }

  const handleShiftRange = (direction: -1 | 1) => {
    setCopied(false)
    setCopyError('')
    setAnchorDate((prev) => (preset === 'week' ? shiftDate(prev, direction * 7) : shiftMonthDate(prev, direction)))
  }

  const handleResetRange = () => {
    setCopied(false)
    setCopyError('')
    setAnchorDate(now)
    const [nextStart, nextEnd] = getMonthRange(now)
    setCustomStartDate(nextStart)
    setCustomEndDate(nextEnd)
  }

  const handleCopy = async () => {
    if (invalidRange || !markdown) {
      return
    }
    setCopyError('')
    try {
      await navigator.clipboard.writeText(markdown)
      setCopied(true)
      setCopyError('')
    } catch {
      setCopyError(t('report.copyFailed'))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/28 backdrop-blur-[1px]" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t('report.title')}
        className="flex h-full w-[min(820px,calc(100vw-16px))] flex-col border-l border-border/80 bg-card/98 shadow-[-18px_0_48px_rgba(0,0,0,0.24)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-border/70 bg-muted/20 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-sky-500" />
                <h2 className="text-sm font-semibold text-foreground">{t('report.title')}</h2>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('report.subtitle')}</p>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={onClose} className="size-7" aria-label={t('report.close')}>
              <X className="size-4" />
            </Button>
          </div>
        </div>

        <div className="panel-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="rounded-xl border border-border/75 bg-background/55 p-2.5">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <Tabs value={preset} onValueChange={handlePresetChange} className="lg:w-auto">
                <TabsList className="w-full lg:w-auto">
                  <TabsTrigger value="week" className="flex-1 lg:flex-none">
                    {t('report.week')}
                  </TabsTrigger>
                  <TabsTrigger value="month" className="flex-1 lg:flex-none">
                    {t('report.month')}
                  </TabsTrigger>
                  <TabsTrigger value="custom" className="flex-1 lg:flex-none">
                    {t('report.custom')}
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {canShiftRange && (
                <div className="flex min-w-0 items-center gap-1 rounded-lg border border-border/60 bg-muted/20 p-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleShiftRange(-1)}
                    className="size-7 shrink-0"
                    aria-label={preset === 'week' ? t('report.previousWeek') : t('report.previousMonth')}
                    title={preset === 'week' ? t('report.previousWeek') : t('report.previousMonth')}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <div className="min-w-0 flex-1 px-2 text-center lg:min-w-[210px]">
                    <p className="text-[10px] leading-3 text-muted-foreground">{t('report.range')}</p>
                    <p className="truncate text-xs font-semibold text-foreground">{rangeLabel}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleShiftRange(1)}
                    className="size-7 shrink-0"
                    aria-label={preset === 'week' ? t('report.nextWeek') : t('report.nextMonth')}
                    title={preset === 'week' ? t('report.nextWeek') : t('report.nextMonth')}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={handleResetRange} className="h-7 shrink-0 px-2">
                    {t('report.currentPeriod')}
                  </Button>
                </div>
              )}
            </div>

            {preset === 'custom' && (
              <div className="mt-2 rounded-lg border border-border/60 bg-muted/20 p-1">
                <div className="grid gap-1 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                  <label className="flex items-center gap-2 rounded-md bg-background/55 px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    <span className="shrink-0">{t('report.startDate')}</span>
                    <Input
                      type="date"
                      value={customStartDate}
                      max={customEndDate || undefined}
                      onChange={(event) => {
                        setCopied(false)
                        setCopyError('')
                        setCustomStartDate(event.target.value || formatLocalDate(now))
                      }}
                      className="h-8 min-w-0 border-0 bg-transparent px-0 text-sm font-semibold text-foreground shadow-none focus-visible:ring-0"
                    />
                  </label>
                  <span className="hidden text-xs text-muted-foreground sm:block">-</span>
                  <label className="flex items-center gap-2 rounded-md bg-background/55 px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    <span className="shrink-0">{t('report.endDate')}</span>
                    <Input
                      type="date"
                      value={customEndDate}
                      min={customStartDate || undefined}
                      onChange={(event) => {
                        setCopied(false)
                        setCopyError('')
                        setCustomEndDate(event.target.value || formatLocalDate(now))
                      }}
                      className="h-8 min-w-0 border-0 bg-transparent px-0 text-sm font-semibold text-foreground shadow-none focus-visible:ring-0"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>

          {invalidRange && (
            <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
              {t('report.invalidRange')}
            </p>
          )}

          <section className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-background/55">
            <div className="flex flex-col gap-2 border-b border-border/60 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {view === 'summary' ? t('report.summaryTitle') : t('report.detailsTitle')}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {stats.all === 0
                    ? t('report.summaryEmpty')
                    : t('report.summaryCompact', { total: stats.all, completed: stats.completed, active: stats.active })}
                </p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
                {view === 'summary' && (
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="shrink-0">{t('report.template')}</span>
                    <select
                      value={template}
                      onChange={(event) => setTemplate(event.target.value as ReportMarkdownTemplate)}
                      className="h-8 rounded-md border border-border/60 bg-background/70 px-2 text-xs font-medium text-foreground outline-none transition-colors hover:bg-muted/30 focus:border-sky-500/50"
                    >
                      {templateOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <Tabs value={view} onValueChange={(value) => setView(value as ReportView)} className="w-full sm:w-auto">
                  <TabsList className="h-8 w-full sm:w-auto">
                    <TabsTrigger value="summary" className="flex-1 sm:min-w-[88px] sm:flex-none">
                      {t('report.summaryTab')}
                    </TabsTrigger>
                    <TabsTrigger value="details" className="flex-1 sm:min-w-[88px] sm:flex-none">
                      {t('report.detailsTab')}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>

            {view === 'summary' ? (
              <div className="p-3">
                <MarkdownPreview
                  value={markdown}
                  emptyLabel={t('report.emptyPreview')}
                  className="max-h-[58vh] min-h-[380px] border-0 bg-transparent p-0"
                />
              </div>
            ) : (
              reportModel && (
                <div className="grid gap-4 p-3">
                  <TaskGroupSection
                    title={t('report.completedTasks')}
                    count={reportModel.totals.completed}
                    emptyLabel={t('report.emptyCompleted')}
                    groups={reportModel.completedByDate}
                    pendingTodoId={pendingTodoId}
                    onToggleTodo={onToggleTodo}
                    tone="success"
                  />
                  <TaskGroupSection
                    title={t('report.activeTasks')}
                    count={reportModel.totals.active}
                    emptyLabel={t('report.emptyActive')}
                    groups={reportModel.activeByDate}
                    pendingTodoId={pendingTodoId}
                    onToggleTodo={onToggleTodo}
                    tone="warning"
                  />
                </div>
              )
            )}
          </section>
        </div>

        <div className="shrink-0 border-t border-border/70 bg-card/98 px-4 py-3">
          {copyError && (
            <p className="mb-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
              {copyError}
            </p>
          )}
          <Button type="button" onClick={handleCopy} disabled={invalidRange || !markdown} className="w-full">
            {copied ? <CheckCircle2 className="size-4" /> : <Copy className="size-4" />}
            {copied ? t('report.copied') : t('report.copyMarkdown')}
          </Button>
        </div>
      </aside>
    </div>
  )
}

function TaskGroupSection({
  title,
  count,
  emptyLabel,
  groups,
  pendingTodoId,
  onToggleTodo,
  tone,
}: {
  title: string
  count: number
  emptyLabel: string
  groups: Array<{ date: string; todos: Todo[] }>
  pendingTodoId: string | null
  onToggleTodo: (id: string) => void | Promise<void>
  tone: 'success' | 'warning'
}) {
  const dotClass = tone === 'success' ? 'bg-emerald-400' : 'bg-amber-400'
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
          <span className={`h-2 w-2 rounded-full ${dotClass}`} />
          <span className="truncate">{title}</span>
        </div>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{count}</span>
      </div>
      <TaskGroups groups={groups} emptyLabel={emptyLabel} pendingTodoId={pendingTodoId} onToggleTodo={onToggleTodo} />
    </section>
  )
}

function TaskGroups({
  groups,
  emptyLabel,
  pendingTodoId,
  onToggleTodo,
}: {
  groups: Array<{ date: string; todos: Todo[] }>
  emptyLabel: string
  pendingTodoId: string | null
  onToggleTodo: (id: string) => void | Promise<void>
}) {
  const { t } = useTranslation()

  if (groups.length === 0) {
    return <p className="rounded-md border border-dashed border-border/70 bg-muted/15 px-3 py-3 text-xs text-muted-foreground">{emptyLabel}</p>
  }

  return (
    <div className="rounded-lg border border-border/55 bg-muted/10 px-3 py-2">
      {groups.map((group, groupIndex) => (
        <div key={group.date} className={groupIndex === 0 ? '' : 'mt-3 border-t border-border/45 pt-3'}>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{group.date}</p>
          <ul className="grid gap-1">
            {group.todos.map((todo) => {
              const isPending = pendingTodoId === todo.id
              return (
                <li key={todo.id} className="flex items-start gap-2 text-sm leading-5">
                  <input
                    type="checkbox"
                    checked={todo.completed}
                    disabled={isPending}
                    onChange={() => void onToggleTodo(todo.id)}
                    aria-label={t('report.toggleTaskStatus', { title: todo.title })}
                    title={todo.completed ? t('report.markActive') : t('report.markComplete')}
                    className="mt-0.5 size-4 shrink-0 rounded border-border/75 bg-background text-emerald-500 accent-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <span className={todo.completed ? 'text-foreground' : 'text-muted-foreground'}>{todo.title}</span>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

function formatRange(startDate: string, endDate: string, locale: string) {
  const formatter = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' })
  return `${formatDate(startDate, formatter)} - ${formatDate(endDate, formatter)}`
}

function formatDate(value: string, formatter: Intl.DateTimeFormat) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return formatter.format(new Date(year, month - 1, day))
}

function shiftDate(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function shiftMonthDate(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}
