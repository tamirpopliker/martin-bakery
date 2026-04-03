import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import type { Session } from '@supabase/supabase-js'

// ─── Types ───────────────────────────────────────────────────────────────────
export interface AppUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'factory' | 'branch'
  branch_id: number | null
  excluded_departments: string[]
  can_settings: boolean
  auth_uid: string | null
  managed_department: string | null // 'creams' | 'dough' | 'packaging' | 'cleaning' | null
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

    // Settings pages — department managers cannot access settings at all
    if (pageKey === 'settings' || pageKey === 'data_import' || pageKey === 'user_management') {
      if (pageKey === 'user_management') return false // admin only
      if (isDeptManager) return false // dept manager blocked from settings
      return user.can_settings
    }

    // CEO dashboard & reports/alerts - admin only
    if (pageKey === 'ceo_dashboard' || pageKey === 'reports_alerts') return user.role === 'admin'

    // Factory pages
    const dept = getDeptFromPage(pageKey)
    if (dept !== null || pageKey === 'factory_dashboard' || pageKey === 'factory_b2b' || pageKey === 'labor' || pageKey === 'suppliers') {
      if (user.role === 'branch') return false

      // Department manager: can only access their own department
      if (isDeptManager) {
        if (dept && dept !== user.managed_department) return false
        // Allow factory_dashboard, labor, suppliers for dept managers
        return true
      }

      // Regular factory user
      if (dept && user.excluded_departments.includes(dept)) return false
      return true
    }

    // Branch pages
    const branchId = getBranchFromPage(pageKey)
    if (branchId !== null) {
      if (user.role === 'factory') return false
      // Branch user - only their branch
      if (user.role === 'branch') return user.branch_id === branchId
      return true // admin
    }

    // Branch dashboard (all branches overview)
    if (pageKey === 'branch_dashboard') {
      return user.role === 'admin'
    }

    return true
  }
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function UserProvider({ session, children }: { session: Session; children: ReactNode }) {
  const [appUser, setAppUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [unauthorized, setUnauthorized] = useState(false)

  useEffect(() => {
    async function loadUser() {
      const email = session.user.email?.toLowerCase()
      if (!email) {
        setUnauthorized(true)
        setLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('app_users')
        .select('*')
        .ilike('email', email)
        .single()

      if (error || !data) {
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
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl',
      }}>
        <div style={{
          background: 'white', borderRadius: '20px', padding: '48px', textAlign: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)', maxWidth: '420px',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>&#128683;</div>
          <h2 style={{ margin: '0 0 8px', color: '#0f172a', fontSize: '22px' }}>אין הרשאת גישה</h2>
          <p style={{ color: '#94a3b8', marginBottom: '8px', lineHeight: '1.6' }}>
            המשתמש <strong style={{ color: '#374151' }}>{session.user.email}</strong> לא רשום במערכת.
          </p>
          <p style={{ color: '#94a3b8', marginBottom: '24px', fontSize: '14px' }}>
            פנה למנהל המערכת להוספת הרשאות.
          </p>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{
              background: '#ef4444', color: 'white', border: 'none', borderRadius: '10px',
              padding: '10px 24px', fontSize: '15px', fontWeight: '700', cursor: 'pointer',
            }}
          >
            התנתק
          </button>
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
