import type { Todo } from '@/api/todo'
import { isDateInRange } from '@/lib/date'

export type TodoReportGroup = {
  date: string
  todos: Todo[]
}

export type TodoReportModel = {
  startDate: string
  endDate: string
  completed: Todo[]
  active: Todo[]
  completedByDate: TodoReportGroup[]
  activeByDate: TodoReportGroup[]
  totals: {
    all: number
    completed: number
    active: number
    daysWithCompleted: number
  }
}

export type ReportMarkdownLabels = {
  heading: string
  scopeNote: string
  completed: string
  active: string
  emptyAll: string
  emptyCompleted: string
  emptyActive: string
}

export function buildReportModel(todos: Todo[], startDate: string, endDate: string): TodoReportModel {
  const inRange = todos
    .filter((todo) => isDateInRange(todo.journal_date, startDate, endDate))
    .toSorted(compareTodosForReport)

  const completed = inRange.filter((todo) => todo.completed)
  const active = inRange.filter((todo) => !todo.completed)

  const completedByDate = groupTodosByDate(completed)
  const activeByDate = groupTodosByDate(active)

  return {
    startDate,
    endDate,
    completed,
    active,
    completedByDate,
    activeByDate,
    totals: {
      all: inRange.length,
      completed: completed.length,
      active: active.length,
      daysWithCompleted: completedByDate.length,
    },
  }
}

export function generateReportMarkdown(
  model: TodoReportModel,
  labels: ReportMarkdownLabels,
  options: { includeActive: boolean },
) {
  const lines: string[] = [`# ${labels.heading}`, '']

  if (model.totals.all === 0) {
    lines.push(labels.emptyAll)
    return lines.join('\n').trimEnd()
  }

  lines.push(labels.scopeNote, '')
  appendDateStatusGroups(lines, model, labels, options.includeActive)

  return lines.join('\n').trimEnd()
}

export function getTodoDetailSummary(todo: Todo) {
  return todo.detail_md
    .replace(/[#*_`>\-[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 88)
}

function appendDateStatusGroups(lines: string[], model: TodoReportModel, labels: ReportMarkdownLabels, includeActive: boolean) {
  const groupedByDate = new Map<string, { completed: Todo[]; active: Todo[] }>()

  for (const todo of model.completed) {
    getDateStatusGroup(groupedByDate, todo.journal_date).completed.push(todo)
  }

  if (includeActive) {
    for (const todo of model.active) {
      getDateStatusGroup(groupedByDate, todo.journal_date).active.push(todo)
    }
  }

  if (groupedByDate.size === 0) {
    lines.push(labels.emptyCompleted, '')
    if (includeActive) {
      lines.push(labels.emptyActive, '')
    }
    return
  }

  for (const [date, group] of Array.from(groupedByDate.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`## ${date}`, '')

    if (group.completed.length > 0) {
      appendStatusItems(lines, `${labels.completed} (${group.completed.length})`, group.completed)
    }

    if (includeActive && group.active.length > 0) {
      appendStatusItems(lines, `${labels.active} (${group.active.length})`, group.active)
    }
  }
}

function getDateStatusGroup(groups: Map<string, { completed: Todo[]; active: Todo[] }>, date: string) {
  const group = groups.get(date)
  if (group) {
    return group
  }

  const nextGroup = { completed: [], active: [] }
  groups.set(date, nextGroup)
  return nextGroup
}

function appendStatusItems(lines: string[], statusLabel: string, todos: Todo[]) {
  lines.push(`### ${statusLabel}`)
  for (const todo of todos) {
    lines.push(`- ${sanitizeTodoTitle(todo.title)}`)
  }
  lines.push('')
}

function groupTodosByDate(todos: Todo[]): TodoReportGroup[] {
  const groups = new Map<string, Todo[]>()
  for (const todo of todos) {
    const group = groups.get(todo.journal_date)
    if (group) {
      group.push(todo)
    } else {
      groups.set(todo.journal_date, [todo])
    }
  }

  return Array.from(groups.entries()).map(([date, groupedTodos]) => ({ date, todos: groupedTodos }))
}

function compareTodosForReport(a: Todo, b: Todo) {
  const dateCompare = a.journal_date.localeCompare(b.journal_date)
  if (dateCompare !== 0) return dateCompare

  const orderCompare = a.sort_order - b.sort_order
  if (orderCompare !== 0) return orderCompare

  const createdCompare = a.created_at.localeCompare(b.created_at)
  if (createdCompare !== 0) return createdCompare

  return a.id.localeCompare(b.id)
}

function sanitizeTodoTitle(title: string) {
  return title.replace(/\s+/g, ' ').trim()
}
