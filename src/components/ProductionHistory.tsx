import { useState, useEffect, useCallback } from 'react'
import { ChevronLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface Props {
  department: string // 'בצקים' | 'קרמים'
}

interface HistoryGroup {
  report_date: string
  product_count: number
  total_cost: number
}

interface DetailRow {
  id: number
  product_name: string
  quantity: number
  unit_price: number
  total_cost: number
}

const fmtMoney = (n: number) => '₪' + Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 2 })

function getCurrentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatDateHe(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

const S = {
  th: { fontSize: 12, fontWeight: 600, color: '#64748b', padding: '8px 8px', textAlign: 'right' as const, borderBottom: '2px solid #e2e8f0' },
  td: { fontSize: 13, color: '#1e293b', padding: '8px 8px', borderBottom: '1px solid #f1f5f9' },
  btn: { border: 'none', borderRadius: 8, padding: '4px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
}

export default function ProductionHistory({ department }: Props) {
  const [groups, setGroups] = useState<HistoryGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(getCurrentMonth())
  const [detailDate, setDetailDate] = useState<string | null>(null)
  const [detailRows, setDetailRows] = useState<DetailRow[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [y, m] = month.split('-').map(Number)
    const from = `${y}-${String(m).padStart(2, '0')}-01`
    const toDate = new Date(y, m, 0)
    const to = `${y}-${String(m).padStart(2, '0')}-${String(toDate.getDate()).padStart(2, '0')}`

    const { data } = await supabase.from('production_reports')
      .select('report_date, quantity, total_cost')
      .eq('department', department)
      .gte('report_date', from).lte('report_date', to)
      .order('report_date', { ascending: false })

    if (data) {
      const grouped = new Map<string, HistoryGroup>()
      for (const row of data) {
        const existing = grouped.get(row.report_date)
        if (existing) {
          existing.product_count++
          existing.total_cost += Number(row.total_cost)
        } else {
          grouped.set(row.report_date, {
            report_date: row.report_date,
            product_count: 1,
            total_cost: Number(row.total_cost),
          })
        }
      }
      setGroups([...grouped.values()])
    }
    setLoading(false)
  }, [month, department])

  useEffect(() => { load() }, [load])

  async function openDetail(date: string) {
    setDetailDate(date)
    setDetailLoading(true)
    const { data } = await supabase.from('production_reports')
      .select('id, product_name, quantity, unit_price, total_cost')
      .eq('report_date', date).eq('department', department)
      .order('id')
    setDetailRows(data || [])
    setDetailLoading(false)
  }

  if (detailDate) {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
            דוח ייצור — {formatDateHe(detailDate)}
          </span>
          <button onClick={() => { setDetailDate(null); setDetailRows([]) }}
            style={{ ...S.btn, background: '#f1f5f9', color: '#374151', display: 'flex', alignItems: 'center', gap: 4 }}>
            <ChevronLeft size={14} /> חזרה
          </button>
        </div>
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: '16px 0', color: '#94a3b8', fontSize: 13 }}>טוען...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={S.th}>שם מוצר</th>
              <th style={{ ...S.th, width: 80 }}>כמות</th>
              <th style={{ ...S.th, width: 90 }}>מחיר</th>
              <th style={{ ...S.th, width: 100 }}>סה"כ</th>
            </tr></thead>
            <tbody>
              {detailRows.map((r, i) => (
                <tr key={r.id} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                  <td style={S.td}>{r.product_name}</td>
                  <td style={S.td}>{r.quantity}</td>
                  <td style={S.td}>{fmtMoney(r.unit_price)}</td>
                  <td style={{ ...S.td, fontWeight: 600 }}>{fmtMoney(r.total_cost)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td colSpan={3} style={{ ...S.td, fontWeight: 700, borderTop: '2px solid #e2e8f0', textAlign: 'left' }}>סה"כ</td>
              <td style={{ ...S.td, fontWeight: 700, borderTop: '2px solid #e2e8f0' }}>
                {fmtMoney(detailRows.reduce((s, r) => s + Number(r.total_cost), 0))}
              </td>
            </tr></tfoot>
          </table>
        )}
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>היסטוריית ייצור</span>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '4px 10px', fontSize: 12 }} />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '16px 0', color: '#94a3b8', fontSize: 13 }}>טוען...</div>
      ) : groups.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '16px 0', color: '#94a3b8', fontSize: 13 }}>אין דוחות לתקופה זו</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={S.th}>תאריך</th>
            <th style={S.th}>מוצרים</th>
            <th style={S.th}>סה"כ עלות</th>
            <th style={{ ...S.th, width: 60 }}></th>
          </tr></thead>
          <tbody>
            {groups.map((g, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                <td style={S.td}>{formatDateHe(g.report_date)}</td>
                <td style={S.td}>{g.product_count}</td>
                <td style={{ ...S.td, fontWeight: 600 }}>{fmtMoney(g.total_cost)}</td>
                <td style={S.td}>
                  <button onClick={() => openDetail(g.report_date)}
                    style={{ ...S.btn, background: '#f1f5f9', color: '#374151' }}>
                    פתח
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr>
            <td colSpan={2} style={{ ...S.td, fontWeight: 700, borderTop: '2px solid #e2e8f0', textAlign: 'left' }}>סה"כ</td>
            <td style={{ ...S.td, fontWeight: 700, borderTop: '2px solid #e2e8f0' }}>
              {fmtMoney(groups.reduce((s, g) => s + g.total_cost, 0))}
            </td>
            <td style={{ ...S.td, borderTop: '2px solid #e2e8f0' }}></td>
          </tr></tfoot>
        </table>
      )}
    </div>
  )
}
