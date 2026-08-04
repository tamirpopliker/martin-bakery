// The card that stands between a spoken sentence and a database row.
//
// Confirmation is a TAP, never a spoken word. The microphone is closed while
// this is on screen — background noise in a bakery must never be able to
// approve a financial entry.
//
// See AGENT_PLAN.md sections 7.1, 7.2.

export interface PendingAction {
  action_id: string
  title: string
  fields: Array<{ label: string; value: string }>
  amount: string | null
  warnings: string[]
}

interface Props {
  pending: PendingAction
  busy: boolean
  onConfirm: () => void
  onReject: () => void
}

export default function ConfirmationCard({ pending, busy, onConfirm, onReject }: Props) {
  return (
    <div className="rounded-2xl border-2 border-amber-300 bg-amber-50/60 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-amber-600">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </svg>
        </span>
        <span className="text-[13px] font-medium text-amber-800">אישור נדרש</span>
      </div>

      <div className="text-[15px] font-medium text-slate-900">{pending.title}</div>

      <div className="mt-3 space-y-1.5">
        {pending.fields.map((f) => (
          <div key={f.label} className="flex justify-between text-[14px]">
            <span className="text-slate-500">{f.label}</span>
            <span className="text-slate-900">{f.value}</span>
          </div>
        ))}
      </div>

      {pending.amount && (
        <div className="mt-3 border-t border-amber-200 pt-3 text-center">
          <div className="text-[28px] font-medium leading-none text-slate-900">{pending.amount}</div>
        </div>
      )}

      {pending.warnings.length > 0 && (
        <div className="mt-3 space-y-1">
          {pending.warnings.map((w) => (
            <div key={w} className="rounded-lg bg-amber-100 px-3 py-2 text-[13px] text-amber-900">
              {w}
            </div>
          ))}
        </div>
      )}

      {/* Confirm is wide and coloured, cancel is narrow and quiet, and they
          are far apart — a dirty thumb on a shared tablet must not approve
          an expense by accident. */}
      <div className="mt-4 flex gap-3">
        <button
          onClick={onConfirm}
          disabled={busy}
          className="flex-[2] rounded-xl bg-emerald-600 py-3 text-[15px] font-medium text-white transition active:scale-[0.98] disabled:bg-slate-300"
        >
          {busy ? 'רושם…' : 'אשר'}
        </button>
        <button
          onClick={onReject}
          disabled={busy}
          className="flex-1 rounded-xl border border-slate-300 bg-white py-3 text-[15px] text-slate-600 transition active:scale-[0.98] disabled:opacity-50"
        >
          בטל
        </button>
      </div>
    </div>
  )
}
