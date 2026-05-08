interface Props {
  current: 1 | 2 | 3 | 4 | 5
  total?: number
}

export default function ProgressIndicator({ current, total = 5 }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginTop: 24, marginBottom: 8 }} dir="rtl">
      <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>
        שלב {current} מתוך {total}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {Array.from({ length: total }).map((_, i) => {
          const idx = i + 1
          const filled = idx <= current
          return (
            <div
              key={idx}
              style={{
                width: idx === current ? 12 : 9,
                height: idx === current ? 12 : 9,
                borderRadius: '50%',
                background: filled ? '#6366f1' : '#e2e8f0',
                transition: 'all 0.2s',
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
