import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import type { Session } from '@supabase/supabase-js'

// ─── Types ───────────────────────────────────────────────────────────────────
export interface AppUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'factory' | 'branch' | 'employee' | 'scheduler'
  branch_id: number | null
  excluded_departments: string[]
  can_settings: boolean
  auth_uid: string | null
  managed_department: string | null // 'creams' | 'dough' | 'packaging' | 'cleaning' | null
  employee_id?: number | null
}

interface UserContextValue {
  appUser: AppUser | null
  loading: boolean
  unauthorized: boolean
  canAccessPage: (pageKey: string) => boolean
  logout: () => Promise<void>
}

const UserContext = createContext<UserContextValue>({
  appUser: null,
  loading: true,
  unauthorized: false,
  canAccessPage: () => false,
  logout: async () => {},
})

export function useAppUser() {
  return useContext(UserContext)
}

// ─── Permission Logic ────────────────────────────────────────────────────────

/** Extract department from page key, e.g. 'creams_dashboard' -> 'creams' */
function getDeptFromPage(pageKey: string): string | null {
  const deptMap: Record<string, string> = {
    dept_creams: 'creams',
    dept_dough: 'dough',
    dept_packaging: 'packaging',
    dept_cleaning: 'cleaning',
    creams_production: 'creams',
    creams_waste: 'creams',
    creams_repairs: 'creams',
    creams_labor: 'creams',
    creams_dashboard: 'creams',
    dough_production: 'dough',
    dough_waste: 'dough',
    dough_repairs: 'dough',
    dough_labor: 'dough',
    dough_dashboard: 'dough',
    packaging_production: 'packaging',
    packaging_waste: 'packaging',
    packaging_repairs: 'packaging',
    packaging_labor: 'packaging',
    cleaning_repairs: 'cleaning',
    cleaning_labor: 'cleaning',
  }
  return deptMap[pageKey] || null
}

/** Extract branch id from page key, e.g. 'branch_2' -> 2 */
function getBranchFromPage(pageKey: string): number | null {
  const match = pageKey.match(/^branch_(\d+)/)
  return match ? parseInt(match[1]) : null
}

function buildCanAccessPage(user: AppUser): (pageKey: string) => boolean {
  const isDeptManager = user.role === 'factory' && !!user.managed_department

  return (pageKey: string) => {
    // Admin can access everything
    if (user.role === 'admin') return true

    // Employee can only access employee pages
    if (user.role === 'employee') {
      return ['employee-home', 'employee-schedule', 'employee-constraints', 'employee-tasks'].includes(pageKey)
    }

    // Scheduler can only access shift scheduling features
    if (user.role === 'scheduler') {
      return ['branch-team', 'weekly-schedule', 'schedule-history',
              'manager-constraints', 'shift-settings'].includes(pageKey)
    }

    // ─── Admin-only pages ───
    if (pageKey === 'user_management' || pageKey === 'data_import' ||
        pageKey === 'ceo_dashboard' || pageKey === 'reports_alerts' ||
        pageKey === 'branch_dashboard' || pageKey === 'branch_comparison') {
      return false
    }

    // ─── Factory Settings: admin only ───
    if (pageKey === 'settings' || pageKey === 'factory_settings') {
      return false // non-admins cannot access factory settings
    }

    // ─── Branch Settings: admin only (KPI + costs) ───
    if (pageKey === 'branch_settings') {
      return false // non-admins cannot access branch settings
    }

    // ─── Factory employees page ───
    if (pageKey === 'factory_employees') {
      return user.role === 'factory' // both dept managers and regular factory users
    }

    // ─── Factory pages ───
    const dept = getDeptFromPage(pageKey)
    if (dept !== null || pageKey === 'factory_dashboard' || pageKey === 'factory_b2b' ||
        pageKey === 'labor' || pageKey === 'suppliers' || pageKey === 'production_report_upload') {
      if (user.role === 'branch') return false

      // Department manager: can access factory pages except the OTHER main dept
      if (isDeptManager) {
        if (dept === 'creams' && user.managed_department === 'dough') return false
        if (dept === 'dough' && user.managed_department === 'creams') return false
        return true
      }

      // Regular factory user
      if (dept && user.excluded_departments.includes(dept)) return false
      return true
    }

    // ─── Branch pages ───
    const branchId = getBranchFromPage(pageKey)
    if (branchId !== null) {
      if (user.role === 'factory') return false
      if (user.role === 'branch') return user.branch_id === branchId
      return true
    }

    // ─── Management pages ───
    if (pageKey === 'manage') {
      return false // non-admins
    }

    return true
  }
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function UserProvider({ session, children }: { session: Session; children: ReactNode }) {
  const [appUser, setAppUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [unauthorized, setUnauthorized] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [retryCountdown, setRetryCountdown] = useState(0)

  useEffect(() => {
    async function loadUser() {
      const email = session.user.email?.toLowerCase()
      if (!email) {
        setUnauthorized(true)
        setLoading(false)
        return
      }

      // Try to find the user, with retries for new accounts (trigger may need time)
      let data: any = null
      let attempts = 0
      const maxAttempts = retryCount === 0 ? 3 : 1
      const delayMs = 2000

      while (attempts < maxAttempts) {
        const result = await supabase
          .from('app_users')
          .select('*')
          .ilike('email', email)
          .single()

        if (result.data) {
          data = result.data
          break
        }
        attempts++
        if (attempts < maxAttempts) {
          await new Promise(r => setTimeout(r, delayMs))
        }
      }

      if (!data) {
        setUnauthorized(true)
        setLoading(false)
        return
      }

      // Link auth_uid on first login
      if (!data.auth_uid) {
        await supabase
          .from('app_users')
          .update({ auth_uid: session.user.id })
          .eq('id', data.id)
      }

      setAppUser({
        ...data,
        excluded_departments: data.excluded_departments || [],
        managed_department: data.managed_department || null,
      })
      setLoading(false)
    }

    loadUser()
  }, [session.user.id])

  const canAccessPage = appUser ? buildCanAccessPage(appUser) : () => false

  const logout = async () => {
    await supabase.auth.signOut()
  }

  // Auto-retry for pending approval (MUST be before conditional returns)
  useEffect(() => {
    if (!unauthorized || retryCount >= 3) return
    setRetryCountdown(5)
    const interval = setInterval(() => {
      setRetryCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval)
          setRetryCount(c => c + 1)
          setUnauthorized(false)
          setLoading(true)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [unauthorized, retryCount])

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '24px', marginBottom: '12px' }}>
            <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>&#9696;</span>
          </div>
          <p style={{ color: '#64748b', fontSize: '16px' }}>טוען...</p>
        </div>
      </div>
    )
  }

  if (unauthorized) {
    const canAutoRetry = retryCount < 3
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl',
      }}>
        <div style={{
          background: 'white', borderRadius: '20px', padding: '48px', textAlign: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)', maxWidth: '420px',
        }}>
          <div style={{ fontSize: 36, fontWeight: 900, color: '#0d6165', fontFamily: 'serif', marginBottom: 12 }}>מרטין</div>
          <p style={{ fontSize: 12, color: '#0d6165', letterSpacing: 3, marginBottom: 24 }}>קונדיטוריה ובית מאפה · 1964</p>
          <h2 style={{ margin: '0 0 8px', color: '#0f172a', fontSize: '22px' }}>
            {canAutoRetry ? 'ממתין לאישור...' : 'המשתמש טרם אושר'}
          </h2>
          <p style={{ color: '#94a3b8', marginBottom: '8px', lineHeight: '1.6' }}>
            המשתמש <strong style={{ color: '#374151' }}>{session.user.email}</strong> עדיין לא מוגדר במערכת.
          </p>
          {canAutoRetry ? (
            <p style={{ color: '#6366f1', marginBottom: '24px', fontSize: '14px', fontWeight: '600' }}>
              אם הוזמנת על ידי מנהל — המערכת מכינה את חשבונך.<br/>
              מנסה שוב בעוד {retryCountdown} שניות... (ניסיון {retryCount + 1}/3)
            </p>
          ) : (
            <p style={{ color: '#94a3b8', marginBottom: '24px', fontSize: '14px' }}>
              אם הוזמנת על ידי מנהל — נסה להתחבר שוב בעוד מספר שניות.<br/>
              אם הבעיה נמשכת — פנה למנהל הסניף שלך.
            </p>
          )}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
            <button
              onClick={() => { setRetryCount(0); setUnauthorized(false); setLoading(true) }}
              style={{
                background: '#6366f1', color: 'white', border: 'none', borderRadius: '10px',
                padding: '10px 24px', fontSize: '15px', fontWeight: '700', cursor: 'pointer',
              }}
            >
              נסה שוב
            </button>
            <button
              onClick={() => supabase.auth.signOut()}
              style={{
                background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '10px',
                padding: '10px 24px', fontSize: '15px', fontWeight: '600', cursor: 'pointer',
              }}
            >
              התנתק
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <UserContext.Provider value={{ appUser, loading, unauthorized, canAccessPage, logout }}>
      {children}
    </UserContext.Provider>
  )
}
