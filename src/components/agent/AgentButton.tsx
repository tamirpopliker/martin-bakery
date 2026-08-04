// Floating entry point for the voice agent.
//
// Renders only for users who pass the phase-1 gate. This check is for the
// experience — nobody else should see a button they cannot use — and is NOT
// the security control. That lives in the edge functions, which re-check
// independently and reject regardless of what the client believes.
//
// Bottom-LEFT on purpose: the UI is RTL, so that corner is the empty one.
//
// See AGENT_PLAN.md sections 3.1, 9.

import { useState } from 'react'
import { useAppUser } from '../../lib/UserContext'
import AgentSheet from './AgentSheet'

export default function AgentButton() {
  const { appUser } = useAppUser()
  const [open, setOpen] = useState(false)

  if (!appUser?.agent_enabled || appUser.role !== 'admin') return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="עוזר מרטין"
        title="עוזר מרטין"
        // .agent-fab sets `bottom` — clears the mobile bottom nav (see index.css).
        // z must beat the nav's z-300.
        className="agent-fab fixed left-5 z-[310] flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-700 active:scale-95"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
        </svg>
      </button>

      {open && <AgentSheet onClose={() => setOpen(false)} />}
    </>
  )
}
