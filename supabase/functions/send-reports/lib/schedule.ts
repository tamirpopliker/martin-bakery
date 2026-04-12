export interface ReportSchedule {
  isSkipDay: boolean
  sendDaily: boolean
  sendWeekly: boolean
  sendMonthly: boolean
  /** Yesterday in YYYY-MM-DD (for daily reports) */
  reportDate: string
  /** Month key for yesterday YYYY-MM */
  monthKey: string
  /** Sunday of previous week YYYY-MM-DD (for weekly) */
  weekStart: string
  /** Friday of previous week YYYY-MM-DD (for weekly) */
  weekEnd: string
  /** Previous month YYYY-MM (for monthly) */
  prevMonthKey: string
  /** Same month last year YYYY-MM (for monthly YoY) */
  prevYearMonthKey: string
}

/** Determine what reports to send based on current time in Israel timezone */
export function getReportSchedule(now: Date): ReportSchedule {
  // Get current date/time in Israel timezone
  const israelDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })
  const israelDate = new Date(israelDateStr + 'T12:00:00')
  const dayOfWeek = israelDate.getDay() // 0=Sunday, 6=Saturday
  const dayOfMonth = israelDate.getDate()

  // Yesterday
  const yesterday = new Date(israelDate)
  yesterday.setDate(yesterday.getDate() - 1)
  const reportDate = yesterday.toISOString().slice(0, 10)
  const monthKey = reportDate.slice(0, 7)

  // Saturday = skip
  const isSkipDay = dayOfWeek === 6

  // Daily reports disabled — only weekly and monthly active
  const sendDaily = false

  // Weekly: Sunday only — covers previous Sun–Fri
  const sendWeekly = dayOfWeek === 0
  // Previous Sunday = today - 7
  const prevSunday = new Date(israelDate)
  prevSunday.setDate(prevSunday.getDate() - 7)
  const weekStart = prevSunday.toISOString().slice(0, 10)
  // Previous Friday = today - 2
  const prevFriday = new Date(israelDate)
  prevFriday.setDate(prevFriday.getDate() - 2)
  const weekEnd = prevFriday.toISOString().slice(0, 10)

  // Monthly: 2nd of month, or 3rd if 2nd was Saturday
  const sendMonthly = dayOfMonth === 2 || (dayOfMonth === 3 && dayOfWeek === 0)

  // Previous month for monthly report
  const [y, m] = monthKey.split('-').map(Number)
  const pm = m === 1 ? new Date(y - 1, 11, 1) : new Date(y, m - 2, 1)
  const prevMonthKey = `${pm.getFullYear()}-${String(pm.getMonth() + 1).padStart(2, '0')}`
  // Same month last year
  const prevYearMonthKey = `${pm.getFullYear() - 1}-${String(pm.getMonth() + 1).padStart(2, '0')}`

  return {
    isSkipDay,
    sendDaily,
    sendWeekly,
    sendMonthly,
    reportDate,
    monthKey,
    weekStart,
    weekEnd,
    prevMonthKey,
    prevYearMonthKey,
  }
}
