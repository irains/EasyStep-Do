export type CalendarDay = {
  key: string
  date: Date
  inCurrentMonth: boolean
  isToday: boolean
}

export function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function shiftMonth(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1)
}

export function getWeekRange(date: Date): [string, string] {
  const day = date.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() + mondayOffset)
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
  return [formatLocalDate(monday), formatLocalDate(sunday)]
}

export function getMonthRange(date: Date): [string, string] {
  const start = new Date(date.getFullYear(), date.getMonth(), 1)
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  return [formatLocalDate(start), formatLocalDate(end)]
}

export function isDateInRange(date: string, startDate: string, endDate: string) {
  return date >= startDate && date <= endDate
}

export function buildCalendarDays(visibleMonth: Date): CalendarDay[] {
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
