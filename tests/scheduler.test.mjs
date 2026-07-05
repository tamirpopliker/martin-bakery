// Unit tests for the pure scheduling engine (src/lib/scheduler.ts).
// Run with:  node --experimental-strip-types tests/scheduler.test.mjs
// No database or network required.

import assert from 'node:assert/strict'
import { generateDraft } from '../src/lib/scheduler.ts'

let passed = 0
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++ }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1 }
}

const emp = (id, over = {}) => ({
  id, name: `E${id}`, priority: 2, min_shifts_per_week: 0, max_shifts_per_week: 6,
  training_status: 'regular', ...over,
})
const slot = (shift_id, role_id, date, shift_hours = 8) => ({ shift_id, role_id, date, shift_hours })

// ── 1. Available employees fill slots ──
test('assigns available employees to slots', () => {
  const r = generateDraft({
    employees: [emp(1), emp(2)],
    roleAssignments: [{ employee_id: 1, role_id: 10 }, { employee_id: 2, role_id: 10 }],
    slots: [slot(100, 10, '2026-07-12')],
    constraints: [{ employee_id: 1, date: '2026-07-12', shift_id: 100, availability: 'available' }],
  })
  assert.equal(r.assignments.length, 1)
  assert.equal(r.assignments[0].employee_id, 1)
  assert.equal(r.unfilled.length, 0)
})

// ── 2. 'unavailable' is never auto-assigned ──
test('never assigns an unavailable employee', () => {
  const r = generateDraft({
    employees: [emp(1)],
    roleAssignments: [{ employee_id: 1, role_id: 10 }],
    slots: [slot(100, 10, '2026-07-12')],
    constraints: [{ employee_id: 1, date: '2026-07-12', shift_id: 100, availability: 'unavailable' }],
  })
  assert.equal(r.assignments.length, 0)
  assert.equal(r.unfilled.length, 1)
})

// ── 3. 'prefer_not' only used as a compromise (pass 2) ──
test('prefers available over prefer_not, marks compromise', () => {
  const r = generateDraft({
    employees: [emp(1), emp(2)],
    roleAssignments: [{ employee_id: 1, role_id: 10 }, { employee_id: 2, role_id: 10 }],
    slots: [slot(100, 10, '2026-07-12')],
    constraints: [
      { employee_id: 1, date: '2026-07-12', shift_id: 100, availability: 'prefer_not' },
      { employee_id: 2, date: '2026-07-12', shift_id: 100, availability: 'available' },
    ],
  })
  assert.equal(r.assignments[0].employee_id, 2) // available wins
  assert.equal(r.compromises.length, 0)
})

test('falls back to prefer_not when no one is available', () => {
  const r = generateDraft({
    employees: [emp(1)],
    roleAssignments: [{ employee_id: 1, role_id: 10 }],
    slots: [slot(100, 10, '2026-07-12')],
    constraints: [{ employee_id: 1, date: '2026-07-12', shift_id: 100, availability: 'prefer_not' }],
  })
  assert.equal(r.assignments.length, 1)
  assert.equal(r.compromises.length, 1)
})

// ── 4. max_shifts_per_week cap ──
test('enforces max_shifts_per_week', () => {
  const r = generateDraft({
    employees: [emp(1, { max_shifts_per_week: 1 })],
    roleAssignments: [{ employee_id: 1, role_id: 10 }],
    slots: [slot(100, 10, '2026-07-12'), slot(100, 10, '2026-07-13')],
    constraints: [
      { employee_id: 1, date: '2026-07-12', shift_id: 100, availability: 'available' },
      { employee_id: 1, date: '2026-07-13', shift_id: 100, availability: 'available' },
    ],
  })
  assert.equal(r.assignments.length, 1) // capped at 1
  assert.equal(r.unfilled.length, 1)
})

// ── 5. below-min employee is preferred ──
test('prefers an employee below their weekly minimum', () => {
  const r = generateDraft({
    employees: [emp(1, { min_shifts_per_week: 0 }), emp(2, { min_shifts_per_week: 3 })],
    roleAssignments: [{ employee_id: 1, role_id: 10 }, { employee_id: 2, role_id: 10 }],
    slots: [slot(100, 10, '2026-07-12')],
    constraints: [
      { employee_id: 1, date: '2026-07-12', shift_id: 100, availability: 'available' },
      { employee_id: 2, date: '2026-07-12', shift_id: 100, availability: 'available' },
    ],
  })
  assert.equal(r.assignments[0].employee_id, 2) // below-min wins the tie
})

// ── 6. trainee requires a mentor in the same shift ──
test('drops an orphaned trainee (no mentor in shift)', () => {
  const r = generateDraft({
    employees: [emp(1, { training_status: 'trainee' })],
    roleAssignments: [{ employee_id: 1, role_id: 10 }],
    slots: [slot(100, 10, '2026-07-12')],
    constraints: [{ employee_id: 1, date: '2026-07-12', shift_id: 100, availability: 'available' }],
  })
  assert.equal(r.assignments.length, 0)
  assert.equal(r.unfilled.length, 1)
  assert.ok(r.warnings.some(w => w.includes('חניך')))
})

test('keeps a trainee when a mentor shares the shift', () => {
  const r = generateDraft({
    employees: [emp(1, { training_status: 'mentor' }), emp(2, { training_status: 'trainee' })],
    roleAssignments: [{ employee_id: 1, role_id: 10 }, { employee_id: 2, role_id: 11 }],
    slots: [slot(100, 10, '2026-07-12'), slot(100, 11, '2026-07-12')],
    constraints: [
      { employee_id: 1, date: '2026-07-12', shift_id: 100, availability: 'available' },
      { employee_id: 2, date: '2026-07-12', shift_id: 100, availability: 'available' },
    ],
  })
  assert.equal(r.assignments.length, 2) // mentor placed first (pass fills in slot order), trainee kept
})

// ── 7. blank cell = available for engaged employees; non-submitters skipped ──
test('treats blank cells as available once the employee submitted anything', () => {
  const r = generateDraft({
    employees: [emp(1)],
    roleAssignments: [{ employee_id: 1, role_id: 10 }],
    slots: [slot(100, 10, '2026-07-12'), slot(101, 10, '2026-07-13')],
    // Employee submitted only one 'unavailable' cell → engaged; other cell = available
    constraints: [{ employee_id: 1, date: '2026-07-12', shift_id: 100, availability: 'unavailable' }],
  })
  assert.equal(r.assignments.length, 1)
  assert.equal(r.assignments[0].date, '2026-07-13') // the blank (implied-available) cell
})

test('skips employees who submitted nothing and warns', () => {
  const r = generateDraft({
    employees: [emp(1)],
    roleAssignments: [{ employee_id: 1, role_id: 10 }],
    slots: [slot(100, 10, '2026-07-12')],
    constraints: [],
  })
  assert.equal(r.assignments.length, 0)
  assert.ok(r.warnings.some(w => w.includes('לא הגישו')))
})

// ── 8. no double-booking on the same day ──
test('does not assign the same employee twice on one day', () => {
  const r = generateDraft({
    employees: [emp(1)],
    roleAssignments: [{ employee_id: 1, role_id: 10 }],
    slots: [slot(100, 10, '2026-07-12'), slot(101, 10, '2026-07-12')],
    constraints: [
      { employee_id: 1, date: '2026-07-12', shift_id: 100, availability: 'available' },
      { employee_id: 1, date: '2026-07-12', shift_id: 101, availability: 'available' },
    ],
  })
  assert.equal(r.assignments.length, 1)
  assert.equal(r.unfilled.length, 1)
})

console.log(`\n${passed} passed`)
