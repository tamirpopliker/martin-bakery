import { getReportSchedule } from './lib/schedule.ts'
import { getRecipients } from './lib/recipients.ts'
import { logReport } from './lib/db.ts'

// ── Report senders ──
import { sendBranchDailyReport } from './reports/branch-daily.ts'
import { sendBranchWeeklyReport } from './reports/branch-weekly.ts'
import { sendBranchMonthlyReport } from './reports/branch-monthly.ts'
import { sendFactoryDailyReport } from './reports/factory-daily.ts'
import { sendFactoryWeeklyReport } from './reports/factory-weekly.ts'
import { sendFactoryMonthlyReport } from './reports/factory-monthly.ts'
import { sendAdminBranchesDailyReport, sendAdminBranchesWeeklyReport, sendAdminBranchesMonthlyReport } from './reports/admin-branches.ts'
import { sendAdminFactoryDailyReport, sendAdminFactoryWeeklyReport, sendAdminFactoryMonthlyReport } from './reports/admin-factory.ts'

Deno.serve(async (req: Request) => {
  try {
    // ── Auth: validate cron secret ──
    const cronSecret = Deno.env.get('CRON_SECRET')
    if (cronSecret) {
      const body = await req.json().catch(() => ({}))
      const authHeader = req.headers.get('Authorization')
      const headerToken = authHeader?.replace('Bearer ', '')

      if (body.cron_secret !== cronSecret && headerToken !== cronSecret) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // ── Determine schedule ──
    const now = new Date()
    const schedule = getReportSchedule(now)

    if (schedule.isSkipDay) {
      return json({ status: 'skipped', reason: 'Saturday' })
    }

    // ── Get recipients ──
    const recipients = await getRecipients()
    const results: Array<{ email: string; reports: string[]; errors: string[] }> = []

    // ── Send reports per recipient ──
    for (const user of recipients) {
      const sent: string[] = []
      const errors: string[] = []

      try {
        // ── Daily reports (Sun–Fri) ──
        if (schedule.sendDaily) {
          if (user.role === 'branch' && user.branch_id) {
            await sendBranchDailyReport(user, schedule)
            sent.push('branch-daily')
          } else if (user.role === 'factory') {
            await sendFactoryDailyReport(user, schedule)
            sent.push('factory-daily')
          } else if (user.role === 'admin') {
            await sendAdminBranchesDailyReport(user, schedule)
            sent.push('admin-branches-daily')
            await sendAdminFactoryDailyReport(user, schedule)
            sent.push('admin-factory-daily')
          }
        }

        // ── Weekly reports (Sunday) ──
        if (schedule.sendWeekly) {
          if (user.role === 'branch' && user.branch_id) {
            await sendBranchWeeklyReport(user, schedule)
            sent.push('branch-weekly')
          } else if (user.role === 'factory') {
            await sendFactoryWeeklyReport(user, schedule)
            sent.push('factory-weekly')
          } else if (user.role === 'admin') {
            await sendAdminBranchesWeeklyReport(user, schedule)
            sent.push('admin-branches-weekly')
            await sendAdminFactoryWeeklyReport(user, schedule)
            sent.push('admin-factory-weekly')
          }
        }

        // ── Monthly reports (2nd of month, or 3rd if 2nd was Saturday) ──
        if (schedule.sendMonthly) {
          if (user.role === 'branch' && user.branch_id) {
            await sendBranchMonthlyReport(user, schedule)
            sent.push('branch-monthly')
          } else if (user.role === 'factory') {
            await sendFactoryMonthlyReport(user, schedule)
            sent.push('factory-monthly')
          } else if (user.role === 'admin') {
            await sendAdminBranchesMonthlyReport(user, schedule)
            sent.push('admin-branches-monthly')
            await sendAdminFactoryMonthlyReport(user, schedule)
            sent.push('admin-factory-monthly')
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        errors.push(errorMsg)
        console.error(`Error sending reports to ${user.email}:`, errorMsg)
        await logReport('error', user.email, user.role, schedule.reportDate, 'failed', errorMsg)
      }

      results.push({ email: user.email, reports: sent, errors })
    }

    return json({
      status: 'completed',
      schedule: {
        daily: schedule.sendDaily,
        weekly: schedule.sendWeekly,
        monthly: schedule.sendMonthly,
        reportDate: schedule.reportDate,
      },
      recipients: results.length,
      results,
    })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error('Fatal error in send-reports:', errorMsg)
    return json({ status: 'error', error: errorMsg }, 500)
  }
})

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
