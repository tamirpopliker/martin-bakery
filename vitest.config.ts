import { defineConfig } from 'vitest/config'

// Unit tests run in Node against pure modules (no Supabase, no DOM).
// Scope is intentionally limited to src/**/*.test.ts so the legacy node-based
// scripts under tests/ are not picked up.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
