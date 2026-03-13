import { useState, useEffect } from 'react'
import { supabase, getLast6Months, monthEnd } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import { useAppUser } from '../lib/UserContext'
import PeriodPicker from '../components/PeriodPicker'
import DailyProduction from './DailyProduction'
import FactoryWaste from './FactoryWaste'
import FactoryRepairs from './FactoryRepairs'
import Labor from './Labor'
import Suppliers from './Suppliers'
import DepartmentDashboard from './DepartmentDashboard'
import FactoryDashboard from './FactoryDashboard'
import DepartmentLabor from './DepartmentLabor'
import FactoryB2B from './FactoryB2B'
import FactorySettings from './FactorySettings'
import CEODashboard from './CEODashboard'
import BranchHome from './BranchHome'
import BranchManagerDashboard from './BranchManagerDashboard'
import DepartmentHome from './DepartmentHome'
import UserManagement from './UserManagement'
// DataImport is now embedded inside FactorySettings
import {
  FlaskConical, Croissant, Package, HardHat, BarChart3,
  Store, Trophy, Settings, LogOut, TrendingUp, TrendingDown,
  AlertTriangle, ClipboardList, Truck, UserCog,
  Factory, ChevronDown, ChevronLeft, Database,
  LayoutDashboard
} from 'lucide-react'

// ─── קבועים ─────────────────────────────────────────────────────────────────
const BRANCHES = [
  { id: 1, name: 'אברהם אבינו', color: '#3b82f6', page: 'branch_1' },
  { id: 2, name: 'הפועלים',     color: '#10b981', page: 'branch_2' },
  { id: 3, name: 'יעקב כהן',   color: '#a855f7', page: 'branch_3' },
]

const PANEL_FACTORY = [
  { label: 'קרמים',        subtitle: 'ייצור · פחת · תיקונים',         Icon: FlaskConical, color: '#3b82f6', page: 'dept_creams' },
  { label: 'בצקים',        subtitle: 'ייצור · פחת · תיקונים',         Icon: Croissant,    color: '#8b5cf6', page: 'dept_dough' },
  { label: 'אריזה',        subtitle: 'כמויות · תיקונים · לייבור',     Icon: Package,      color: '#0ea5e9', page: 'dept_packaging' },
  { label: 'ניקיון/נהג',   subtitle: 'תיקונים · לייבור',              Icon: Truck,        color: '#64748b', page: 'dept_cleaning' },
  { label: 'לייבור מרוכז', subtitle: 'העלאת CSV · כל המחלקות',       Icon: HardHat,      color: '#f59e0b', page: 'labor' },
  { label: 'מכירות',        subtitle: 'קרמים · בצקים · B2B · שונות',  Icon: TrendingUp,   color: '#6366f1', page: 'factory_b2b' },
  { label: 'ספקים',         subtitle: 'חשבוניות · ניהול ספקים',        Icon: ClipboardList, color: '#10b981', page: 'suppliers' },
  { label: 'דשבורד מפעל',  subtitle: 'KPI · רווח · גרפים',           Icon: BarChart3,    color: '#6366f1', page: 'factory_dashboard' },
  { label: 'הגדרות מפעל',  subtitle: 'יעדים · עובדים · עלויות',      Icon: Settings,     color: '#64748b', page: 'settings' },
]

const PANEL_MANAGE = [
  { label: 'דשבורד מנכ"ל', subtitle: 'מבט רשתי · כל הסניפים', Icon: Trophy,   color: '#f59e0b', page: 'ceo_dashboard' },
  { label: 'הגדרות מערכת', subtitle: 'יעדים · עובדים · עלויות', Icon: Settings, color: '#64748b', page: 'settings' },
  { label: 'ייבוא נתונים', subtitle: 'CSV מ-Base44 · העלאה',   Icon: Database, color: '#3b82f6', page: 'data_import' },
]

const fmtK = (n: number) => n === 0 ? '—' : '₪' + Math.round(n).toLocaleString()

interface BranchKpi { id: number; name: string; color: string; revenue: number; laborPct: number }

// ─── קומפוננטה ──────────────────────────────────────────────────────────────
export default function Home() {
  const { period, setPeriod, from, to, comparisonPeriod } = usePeriod()
  const { appUser, canAccessPage, logout } = useAppUser()
  const [page, setPage]         = useState<string | null>(null)
  const [expandedSection, setExpandedSection] = useState<string | null>('factory')

  // ─── Filtered navigation based on permissions ─────────────────────────────
  const filteredBranches = BRANCHES.filter(br => canAccessPage(br.page))
  const filteredPanelFactory = PANEL_FACTORY.filter(item => canAccessPage(item.page))
  const filteredPanelManage = PANEL_MANAGE.filter(item => canAccessPage(item.page))

  // Add user management for admins
  const managePanelItems = appUser?.role === 'admin'
    ? [...filteredPanelManage, { label: 'ניהול משתמשים', subtitle: 'הרשאות · משתמשים', Icon: UserCog, color: '#8b5cf6', page: 'user_management' }]
    : filteredPanelManage

  // Determine which sections to show
  const showFactory = filteredPanelFactory.length > 0
  const showBranches = filteredBranches.length > 0 || canAccessPage('branch_dashboard')
  const showManage = managePanelItems.length > 0

  // KPI data
  const [factoryRevenue, setFactoryRevenue] = useState(0)
  const [factoryGross, setFactoryGross]     = useState(0)
  const [totalBranchRevenue, setTotalBranchRevenue] = useState(0)
  const [totalBranchGross, setTotalBranchGross]     = useState(0)
  const [branchKpi, setBranchKpi]           = useState<BranchKpi[]>([])
  const [avgLaborPct, setAvgLaborPct]       = useState(0)
  const [alerts, setAlerts]                 = useState(0)
  const [prevFactoryRevenue, setPrevFactoryRevenue] = useState(0)
  const [prevFactoryGross, setPrevFactoryGross] = useState(0)
  const [prevBranchRevenue, setPrevBranchRevenue] = useState(0)
  const [prevBranchGross, setPrevBranchGross] = useState(0)
  const [prevAvgLaborPct, setPrevAvgLaborPct] = useState(0)
  const [trendData, setTrendData] = useState<{ month: string; label: string; revenue: number; labor: number; profit: number }[]>([])

  // ─── Data Loading ─────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadKpi() {
      // Factory data
      const [salesFs, salesB2b, laborRes, suppliersRes] = await Promise.all([
        supabase.from('factory_sales').select('amount').eq('is_internal', false).gte('date', from).lt('date', to),
        supabase.from('factory_b2b_sales').select('amount').eq('is_internal', false).gte('date', from).lt('date', to),
        supabase.from('labor').select('employer_cost').eq('entity_type', 'factory').gte('date', from).lt('date', to),
        supabase.from('supplier_invoices').select('amount').gte('date', from).lt('date', to),
      ])

      const fSales = (salesFs.data || []).reduce((s, r) => s + Number(r.amount), 0)
                   + (salesB2b.data || []).reduce((s, r) => s + Number(r.amount), 0)
      const fLabor = (laborRes.data || []).reduce((s, r) => s + Number(r.employer_cost), 0)
      const fSupp  = (suppliersRes.data || []).reduce((s, r) => s + Number(r.amount), 0)
      setFactoryRevenue(fSales)
      setFactoryGross(fSales - fLabor - fSupp)

      // Branch data
      const bKpi: BranchKpi[] = []
      let totalBranchRev = 0, totalBranchLab = 0, totalBranchExp = 0, alertCount = 0

      for (const br of BRANCHES) {
        const [revRes, labRes, expRes] = await Promise.all([
          supabase.from('branch_revenue').select('amount').eq('branch_id', br.id).gte('date', from).lt('date', to),
          supabase.from('branch_labor').select('employer_cost').eq('branch_id', br.id).gte('date', from).lt('date', to),
          supabase.from('branch_expenses').select('amount').eq('branch_id', br.id).gte('date', from).lt('date', to),
        ])
        const rev = (revRes.data || []).reduce((s, r) => s + Number(r.amount), 0)
        const lab = (labRes.data || []).reduce((s, r) => s + Number(r.employer_cost), 0)
        const exp = (expRes.data || []).reduce((s, r) => s + Number(r.amount), 0)
        const labPct = rev > 0 ? (lab / rev) * 100 : 0
        if (labPct > 28) alertCount++
        totalBranchRev += rev
        totalBranchLab += lab
        totalBranchExp += exp
        bKpi.push({ id: br.id, name: br.name, color: br.color, revenue: rev, laborPct: labPct })
      }

      setBranchKpi(bKpi)
      setTotalBranchRevenue(totalBranchRev)
      setTotalBranchGross(totalBranchRev - totalBranchLab - totalBranchExp)
      const avgPct = totalBranchRev > 0 ? (totalBranchLab / totalBranchRev) * 100 : 0
      setAvgLaborPct(avgPct)
      setAlerts(alertCount)

      // Previous period (comparison)
      const pFrom = comparisonPeriod.from, pTo = comparisonPeriod.to
      const [pSalesFs, pSalesB2b, pLabor, pSupp] = await Promise.all([
        supabase.from('factory_sales').select('amount').eq('is_internal', false).gte('date', pFrom).lt('date', pTo),
        supabase.from('factory_b2b_sales').select('amount').eq('is_internal', false).gte('date', pFrom).lt('date', pTo),
        supabase.from('labor').select('employer_cost').eq('entity_type', 'factory').gte('date', pFrom).lt('date', pTo),
        supabase.from('supplier_invoices').select('amount').gte('date', pFrom).lt('date', pTo),
      ])
      const pFSales = (pSalesFs.data || []).reduce((s: any, r: any) => s + Number(r.amount), 0)
                     + (pSalesB2b.data || []).reduce((s: any, r: any) => s + Number(r.amount), 0)
      const pFLabor = (pLabor.data || []).reduce((s: any, r: any) => s + Number(r.employer_cost), 0)
      const pFSupp = (pSupp.data || []).reduce((s: any, r: any) => s + Number(r.amount), 0)
      setPrevFactoryRevenue(pFSales)
      setPrevFactoryGross(pFSales - pFLabor - pFSupp)

      let pTotalBranchRev = 0, pTotalBranchLab = 0, pTotalBranchExp = 0
      for (const br of BRANCHES) {
        const [pRevRes, pLabRes, pExpRes] = await Promise.all([
          supabase.from('branch_revenue').select('amount').eq('branch_id', br.id).gte('date', pFrom).lt('date', pTo),
          supabase.from('branch_labor').select('employer_cost').eq('branch_id', br.id).gte('date', pFrom).lt('date', pTo),
          supabase.from('branch_expenses').select('amount').eq('branch_id', br.id).gte('date', pFrom).lt('date', pTo),
        ])
        pTotalBranchRev += (pRevRes.data || []).reduce((s: any, r: any) => s + Number(r.amount), 0)
        pTotalBranchLab += (pLabRes.data || []).reduce((s: any, r: any) => s + Number(r.employer_cost), 0)
        pTotalBranchExp += (pExpRes.data || []).reduce((s: any, r: any) => s + Number(r.amount), 0)
      }
      setPrevBranchRevenue(pTotalBranchRev)
      setPrevBranchGross(pTotalBranchRev - pTotalBranchLab - pTotalBranchExp)
      const pAvgPct = pTotalBranchRev > 0 ? (pTotalBranchLab / pTotalBranchRev) * 100 : 0
      setPrevAvgLaborPct(pAvgPct)

      // 6-month trend (optimized: single range query per table)
      const refMonth = period.monthKey || period.from.slice(0, 7)
      const months6 = getLast6Months(refMonth)
      const tFrom = months6[0] + '-01', tTo = monthEnd(months6[5])
      const [tSalesFs, tSalesB2b, tLabor6, tSupp6] = await Promise.all([
        supabase.from('factory_sales').select('date, amount').eq('is_internal', false).gte('date', tFrom).lt('date', tTo),
        supabase.from('factory_b2b_sales').select('date, amount').eq('is_internal', false).gte('date', tFrom).lt('date', tTo),
        supabase.from('labor').select('date, employer_cost').eq('entity_type', 'factory').gte('date', tFrom).lt('date', tTo),
        supabase.from('supplier_invoices').select('date, amount').gte('date', tFrom).lt('date', tTo),
      ])
      const groupByMonth = (data: any[], field: string) => {
        const map: Record<string, number> = {}
        ;(data || []).forEach((r: any) => {
          const m = r.date?.slice(0, 7)
          if (m) map[m] = (map[m] || 0) + Number(r[field] || 0)
        })
        return map
      }
      const salesByM = groupByMonth([...(tSalesFs.data || []), ...(tSalesB2b.data || [])], 'amount')
      const laborByM = groupByMonth(tLabor6.data || [], 'employer_cost')
      const suppByM = groupByMonth(tSupp6.data || [], 'amount')
      const hebrewMonths = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר']
      setTrendData(months6.map(m => {
        const rev = salesByM[m] || 0
        const lab = laborByM[m] || 0
        const sup = suppByM[m] || 0
        return { month: m, label: hebrewMonths[parseInt(m.split('-')[1]) - 1], revenue: rev, labor: lab, profit: rev - lab - sup }
      }))
    }
    loadKpi()
  }, [from, to])

  // ─── Page routing with floating home button ────────────────────────────────
  function renderPage(): JSX.Element | null {
    if (page === 'creams_production')    return <DailyProduction department="creams"    onBack={() => setPage(null)} />
    if (page === 'dough_production')     return <DailyProduction department="dough"     onBack={() => setPage(null)} />
    if (page === 'packaging_production') return <DailyProduction department="packaging" onBack={() => setPage(null)} />

    if (page === 'creams_waste')         return <FactoryWaste department="creams"    onBack={() => setPage(null)} />
    if (page === 'dough_waste')          return <FactoryWaste department="dough"     onBack={() => setPage(null)} />
    if (page === 'packaging_waste')      return <FactoryWaste department="packaging" onBack={() => setPage(null)} />

    if (page === 'creams_repairs')       return <FactoryRepairs department="creams"    onBack={() => setPage(null)} />
    if (page === 'dough_repairs')        return <FactoryRepairs department="dough"     onBack={() => setPage(null)} />
    if (page === 'packaging_repairs')    return <FactoryRepairs department="packaging" onBack={() => setPage(null)} />
    if (page === 'cleaning_repairs')     return <FactoryRepairs department="cleaning"  onBack={() => setPage(null)} />

    if (page === 'labor')                return <Labor onBack={() => setPage(null)} />
    if (page === 'creams_labor')         return <DepartmentLabor department="creams"    onBack={() => setPage(null)} />
    if (page === 'dough_labor')          return <DepartmentLabor department="dough"     onBack={() => setPage(null)} />
    if (page === 'packaging_labor')      return <DepartmentLabor department="packaging" onBack={() => setPage(null)} />
    if (page === 'cleaning_labor')       return <DepartmentLabor department="cleaning"  onBack={() => setPage(null)} />

    if (page === 'suppliers')            return <Suppliers onBack={() => setPage(null)} />

    if (page === 'creams_dashboard')     return <DepartmentDashboard department="creams" onBack={() => setPage(null)} />
    if (page === 'dough_dashboard')      return <DepartmentDashboard department="dough"  onBack={() => setPage(null)} />
    if (page === 'factory_dashboard')    return <FactoryDashboard onBack={() => setPage(null)} />
    if (page === 'factory_b2b')          return <FactoryB2B onBack={() => setPage(null)} />
    if (page === 'settings')             return <FactorySettings onBack={() => setPage(null)} />
    if (page === 'ceo_dashboard')        return <CEODashboard onBack={() => setPage(null)} />
    if (page === 'data_import')          return <FactorySettings onBack={() => setPage(null)} />
    if (page === 'user_management')      return <UserManagement onBack={() => setPage(null)} />

    if (page === 'dept_creams')    return <DepartmentHome department="creams"    onBack={() => setPage(null)} />
    if (page === 'dept_dough')     return <DepartmentHome department="dough"     onBack={() => setPage(null)} />
    if (page === 'dept_packaging') return <DepartmentHome department="packaging" onBack={() => setPage(null)} />
    if (page === 'dept_cleaning')  return <DepartmentHome department="cleaning"  onBack={() => setPage(null)} />

    if (page === 'branch_dashboard') return <BranchManagerDashboard onBack={() => setPage(null)} />
    if (page === 'branch_1') return <BranchHome branch={{ id: 1, name: 'אברהם אבינו', color: '#3b82f6' }} onBack={() => setPage(null)} />
    if (page === 'branch_2') return <BranchHome branch={{ id: 2, name: 'הפועלים',     color: '#10b981' }} onBack={() => setPage(null)} />
    if (page === 'branch_3') return <BranchHome branch={{ id: 3, name: 'יעקב כהן',   color: '#a855f7' }} onBack={() => setPage(null)} />

    return null
  }

  // If a page is active, show it with floating home button
  if (page) {
    const pageContent = renderPage()
    if (pageContent) {
      return (
        <>
          {pageContent}
          {/* Floating Home Button */}
          <button
            onClick={() => setPage(null)}
            title="חזרה לדף הבית"
            style={{
              position: 'fixed', bottom: 24, left: 24,
              width: 52, height: 52, borderRadius: '50%',
              background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
              color: 'white', border: 'none',
              boxShadow: '0 4px 20px rgba(59,130,246,0.4)',
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', zIndex: 9999,
              transition: 'transform 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.boxShadow = '0 6px 28px rgba(59,130,246,0.5)' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(59,130,246,0.4)' }}
          >
            <LayoutDashboard size={24} />
          </button>
        </>
      )
    }
    // Unknown page — show "in development" fallback
    return (
      <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' }}>
        <div style={{ background: 'white', borderRadius: '20px', padding: '48px', textAlign: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🚧</div>
          <h2 style={{ margin: '0 0 8px', color: '#0f172a' }}>בפיתוח</h2>
          <p style={{ color: '#94a3b8', marginBottom: '24px' }}>מסך זה יהיה זמין בקרוב</p>
          <button onClick={() => setPage(null)} style={{ background: '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 24px', fontSize: '15px', fontWeight: '700', cursor: 'pointer' }}>
            חזרה לדף הבית
          </button>
        </div>
      </div>
    )
  }

  // ─── DiffBadge ────────────────────────────────────────────────────────────
  function DiffBadge({ curr, prev, inverse }: { curr: number; prev: number; inverse?: boolean }) {
    if (prev === 0 && curr === 0) return null
    if (prev === 0) return null
    const d = ((curr - prev) / Math.abs(prev)) * 100
    const up = d > 0
    const good = inverse ? !up : up
    const color = Math.abs(d) < 1 ? '#94a3b8' : good ? '#10b981' : '#ef4444'
    const Icon = up ? TrendingUp : TrendingDown
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '12px', fontWeight: '700', color, marginTop: '4px' }}>
        <Icon size={12} /> {Math.abs(d).toFixed(1)}%
      </span>
    )
  }

  // ─── Section toggle helper ─────────────────────────────────────────────────
  function toggleSection(key: string) {
    setExpandedSection(prev => prev === key ? null : key)
  }

  // ─── מסך הבית ─────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Segoe UI', Arial, sans-serif", direction: 'rtl' }}>

      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '20px 24px' }}>

        {/* ─── כותרת ─────────────────────────────────────────────────────── */}
        <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '42px', height: '42px', background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(59,130,246,0.3)' }}>
              <Croissant size={22} color="white" />
            </div>
            <div>
              <h1 style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a', margin: '0' }}>שלום, {appUser?.name || 'משתמש'}</h1>
              <p style={{ color: '#94a3b8', fontSize: '12px', margin: 0 }}>
                {new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <PeriodPicker period={period} onChange={setPeriod} />
            <button
              onClick={() => logout()}
              title="יציאה"
              style={{
                width: '36px', height: '36px', background: 'white', border: '1.5px solid #e2e8f0',
                borderRadius: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', transition: 'all 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#ef4444'; e.currentTarget.style.background = '#fef2f2' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = 'white' }}
            >
              <LogOut size={16} color="#64748b" />
            </button>
          </div>
        </div>

        {/* ─── KPI Strip ──────────────────────────────────────────────────── */}
        <div className="kpi-grid" style={{ background: 'white', borderRadius: '14px', padding: '14px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '0', flexWrap: 'wrap' }}>
          {/* הכנסות */}
          {(() => { const grandRevenue = factoryRevenue + totalBranchRevenue; return (
          <div style={{ flex: 1, minWidth: '140px', display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 16px 4px 0', borderLeft: '1px solid #e2e8f0' }}>
            <div>
              <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '600', marginBottom: '2px' }}>הכנסות</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                <span style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>{fmtK(grandRevenue)}</span>
                <DiffBadge curr={factoryRevenue + totalBranchRevenue} prev={prevFactoryRevenue + prevBranchRevenue} />
              </div>
            </div>
          </div>
          )})()}
          {/* רווח גולמי */}
          {(() => { const grandGross = factoryGross + totalBranchGross; return (
          <div style={{ flex: 1, minWidth: '140px', display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 16px', borderLeft: '1px solid #e2e8f0' }}>
            <div>
              <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '600', marginBottom: '2px' }}>רווח גולמי</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                <span style={{ fontSize: '18px', fontWeight: '800', color: grandGross >= 0 ? '#10b981' : '#ef4444' }}>{fmtK(grandGross)}</span>
                <DiffBadge curr={factoryGross + totalBranchGross} prev={prevFactoryGross + prevBranchGross} />
              </div>
            </div>
          </div>
          )})()}
          {/* % לייבור */}
          <div style={{ flex: 1, minWidth: '140px', display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 16px', borderLeft: '1px solid #e2e8f0' }}>
            <div>
              <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '600', marginBottom: '2px' }}>לייבור ממוצע</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                <span style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>{avgLaborPct.toFixed(1)}%</span>
                <span style={{ fontSize: '13px', fontWeight: '700', color: avgLaborPct <= 28 ? '#10b981' : '#ef4444' }}>{avgLaborPct <= 28 ? '✓' : '✗'}</span>
                <DiffBadge curr={avgLaborPct} prev={prevAvgLaborPct} inverse />
              </div>
            </div>
          </div>
          {/* התראות */}
          <div style={{ flex: 1, minWidth: '100px', display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 0 4px 16px' }}>
            <div>
              <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '600', marginBottom: '2px' }}>התראות</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                <span style={{ fontSize: '18px', fontWeight: '800', color: alerts > 0 ? '#ef4444' : '#10b981' }}>{alerts}</span>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>{alerts === 0 ? 'תקין' : 'חריגה'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ═══ Section 1: מפעל ═══════════════════════════════════════════════ */}
        {showFactory && (
          <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: '16px', overflow: 'hidden' }}>
            {/* Section Header */}
            <button
              onClick={() => toggleSection('factory')}
              style={{
                width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '12px',
                borderBottom: expandedSection === 'factory' ? '1px solid #e2e8f0' : 'none',
              }}
            >
              <div style={{ width: '40px', height: '40px', background: '#3b82f615', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Factory size={22} color="#3b82f6" />
              </div>
              <div style={{ flex: 1, textAlign: 'right' }}>
                <div style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>מפעל</div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '1px' }}>מחלקות · לייבור · מכירות · דשבורד</div>
              </div>
              <ChevronDown
                size={20} color="#94a3b8"
                style={{ transition: 'transform 0.2s', transform: expandedSection === 'factory' ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0 }}
              />
            </button>
            {/* Section Content */}
            {expandedSection === 'factory' && (
              <div style={{ padding: '16px 16px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                {filteredPanelFactory.map(item => {
                  const Icon = item.Icon
                  return (
                    <button
                      key={item.page}
                      onClick={() => setPage(item.page)}
                      style={{
                        background: '#f8fafc', border: '1.5px solid #e2e8f0',
                        borderRadius: '12px', padding: '14px 16px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '12px',
                        textAlign: 'right', transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = item.color; e.currentTarget.style.background = item.color + '08'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 4px 12px ${item.color}15` }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none' }}
                    >
                      <div style={{ width: '38px', height: '38px', background: item.color + '15', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon size={18} color={item.color} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>{item.label}</div>
                        <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>{item.subtitle}</div>
                      </div>
                      <ChevronLeft size={14} color="#cbd5e1" style={{ flexShrink: 0 }} />
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ Section 2: סניפים ═════════════════════════════════════════════ */}
        {showBranches && (
          <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: '16px', overflow: 'hidden' }}>
            {/* Section Header */}
            <button
              onClick={() => toggleSection('branches')}
              style={{
                width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '12px',
                borderBottom: expandedSection === 'branches' ? '1px solid #e2e8f0' : 'none',
              }}
            >
              <div style={{ width: '40px', height: '40px', background: '#10b98115', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Store size={22} color="#10b981" />
              </div>
              <div style={{ flex: 1, textAlign: 'right' }}>
                <div style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>סניפים</div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '1px' }}>ניהול סניפים · דשבורד מנהל</div>
              </div>
              <ChevronDown
                size={20} color="#94a3b8"
                style={{ transition: 'transform 0.2s', transform: expandedSection === 'branches' ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0 }}
              />
            </button>
            {/* Section Content */}
            {expandedSection === 'branches' && (
              <div style={{ padding: '16px 16px 20px' }}>
                {/* Branch Manager Dashboard button */}
                {canAccessPage('branch_dashboard') && (
                  <button
                    onClick={() => setPage('branch_dashboard')}
                    style={{
                      width: '100%', background: 'linear-gradient(135deg, #3b82f608, #10b98108)',
                      border: '1.5px solid #10b98130', borderRadius: '12px', padding: '14px 16px',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px',
                      textAlign: 'right', transition: 'all 0.12s', marginBottom: '12px',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#10b981'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(16,185,129,0.12)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#10b98130'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none' }}
                  >
                    <div style={{ width: '38px', height: '38px', background: 'linear-gradient(135deg, #3b82f6, #10b981)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <BarChart3 size={18} color="white" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a' }}>דשבורד מנהל סניפים</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '1px' }}>השוואת סניפים · P&L · KPI</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>{fmtK(totalBranchRevenue)}</span>
                      <ChevronLeft size={14} color="#cbd5e1" />
                    </div>
                  </button>
                )}

                {/* Individual branch cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                  {filteredBranches.map(br => {
                    const kpi = branchKpi.find(b => b.id === br.id)
                    const rev = kpi?.revenue ?? 0
                    const labPct = kpi?.laborPct ?? 0
                    return (
                      <button
                        key={br.id}
                        onClick={() => setPage(br.page)}
                        style={{
                          background: '#f8fafc', border: `1.5px solid ${br.color}30`,
                          borderRadius: '12px', padding: '14px 16px', cursor: 'pointer',
                          textAlign: 'right', transition: 'all 0.12s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = br.color; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 4px 12px ${br.color}18` }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = br.color + '30'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                          <div style={{ width: '32px', height: '32px', background: br.color, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Store size={16} color="white" />
                          </div>
                          <span style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a' }}>{br.name}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>{fmtK(rev)}</span>
                          <span style={{ fontSize: '12px', fontWeight: '700', color: labPct <= 28 ? '#10b981' : '#ef4444' }}>
                            {rev > 0 ? labPct.toFixed(1) + '%' : '—'} {rev > 0 ? (labPct <= 28 ? '✓' : '✗') : ''}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ Section 3: דשבורד מנכ"ל + ניהול ═══════════════════════════════ */}
        {showManage && (
          <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: '16px', overflow: 'hidden' }}>
            {/* Section Header */}
            <button
              onClick={() => toggleSection('manage')}
              style={{
                width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '12px',
                borderBottom: expandedSection === 'manage' ? '1px solid #e2e8f0' : 'none',
              }}
            >
              <div style={{ width: '40px', height: '40px', background: '#f59e0b15', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Trophy size={22} color="#f59e0b" />
              </div>
              <div style={{ flex: 1, textAlign: 'right' }}>
                <div style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>דשבורד מנכ"ל + ניהול</div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '1px' }}>דשבורד · הגדרות · ייבוא נתונים</div>
              </div>
              <ChevronDown
                size={20} color="#94a3b8"
                style={{ transition: 'transform 0.2s', transform: expandedSection === 'manage' ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0 }}
              />
            </button>
            {/* Section Content */}
            {expandedSection === 'manage' && (
              <div style={{ padding: '16px 16px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                {managePanelItems.map(item => {
                  const Icon = item.Icon
                  return (
                    <button
                      key={item.page}
                      onClick={() => setPage(item.page)}
                      style={{
                        background: '#f8fafc', border: '1.5px solid #e2e8f0',
                        borderRadius: '12px', padding: '14px 16px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '12px',
                        textAlign: 'right', transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = item.color; e.currentTarget.style.background = item.color + '08'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 4px 12px ${item.color}15` }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none' }}
                    >
                      <div style={{ width: '38px', height: '38px', background: item.color + '15', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon size={18} color={item.color} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>{item.label}</div>
                        <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>{item.subtitle}</div>
                      </div>
                      <ChevronLeft size={14} color="#cbd5e1" style={{ flexShrink: 0 }} />
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── מגמות 6 חודשים ─── */}
        {trendData.length > 0 && trendData.some(d => d.revenue > 0) && (
          <div style={{ marginBottom: '20px' }}>
            <div className="chart-container" style={{ background: 'white', borderRadius: '14px', padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <span style={{ fontSize: '13px', fontWeight: '700', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>מגמות 6 חודשים</span>
                <div style={{ display: 'flex', gap: '14px' }}>
                  {[{ color: '#3b82f6', label: 'הכנסות' }, { color: '#f59e0b', label: 'לייבור' }, { color: '#10b981', label: 'רווח' }].map(m => (
                    <span key={m.label} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#94a3b8' }}>
                      <span style={{ width: '8px', height: '8px', background: m.color, borderRadius: '2px', display: 'inline-block' }} />
                      {m.label}
                    </span>
                  ))}
                </div>
              </div>
              {(() => {
                const W = 650, H = 140, PL = 50, PR = 12, PT = 8, PB = 24
                const metrics = [
                  { key: 'revenue' as const, color: '#3b82f6' },
                  { key: 'labor' as const, color: '#f59e0b' },
                  { key: 'profit' as const, color: '#10b981' },
                ]
                const maxVal = Math.max(...trendData.flatMap(d => metrics.map(m => Math.abs(d[m.key]))), 1)
                const groupW = (W - PL - PR) / trendData.length
                const barW = groupW / (metrics.length + 1)
                return (
                  <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: '140px' }}>
                    <line x1={PL} y1={H - PB} x2={W - PR} y2={H - PB} stroke="#e2e8f0" strokeWidth="1" />
                    {trendData.map((d, di) => {
                      const gx = PL + di * groupW
                      return metrics.map((m, mi) => {
                        const val = Math.abs(d[m.key])
                        const h = (val / maxVal) * (H - PT - PB)
                        return <rect key={`${di}-${mi}`} x={gx + (mi + 0.5) * barW} y={H - PB - h} width={barW * 0.8} height={h} rx={3} fill={m.color} opacity={0.85} />
                      })
                    })}
                    {trendData.map((d, i) => (
                      <text key={i} x={PL + i * groupW + groupW / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="#94a3b8">{d.label}</text>
                    ))}
                  </svg>
                )
              })()}
            </div>
          </div>
        )}

      </div>

      {/* Mobile Bottom Nav */}
      <nav className="mobile-bottom-nav" style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, height: 56,
        background: '#0f172a', display: 'none',
        alignItems: 'center', justifyContent: 'space-around',
        zIndex: 300, borderTop: '1px solid #1e293b',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        <button onClick={() => setExpandedSection('factory')} style={{
          background: 'none', border: 'none', color: expandedSection === 'factory' ? '#38bdf8' : '#94a3b8',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, fontSize: 10, cursor: 'pointer', padding: '6px 12px',
        }}>
          <Factory size={22} />
          <span>מפעל</span>
        </button>
        <button onClick={() => setExpandedSection('branches')} style={{
          background: 'none', border: 'none', color: expandedSection === 'branches' ? '#38bdf8' : '#94a3b8',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, fontSize: 10, cursor: 'pointer', padding: '6px 12px',
        }}>
          <Store size={22} />
          <span>סניפים</span>
        </button>
        <button onClick={() => setExpandedSection('manage')} style={{
          background: 'none', border: 'none', color: expandedSection === 'manage' ? '#38bdf8' : '#94a3b8',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, fontSize: 10, cursor: 'pointer', padding: '6px 12px',
        }}>
          <Settings size={22} />
          <span>ניהול</span>
        </button>
        <button onClick={() => logout()} style={{
          background: 'none', border: 'none', color: '#94a3b8',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, fontSize: 10, cursor: 'pointer', padding: '6px 12px',
        }}>
          <LogOut size={22} />
          <span>יציאה</span>
        </button>
      </nav>
    </div>
  )
}
