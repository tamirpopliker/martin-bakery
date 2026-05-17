-- ═══════════════════════════════════════════════════════════════════════════
-- 043: doc_type on b2b_invoices — invoice vs delivery note
-- ═══════════════════════════════════════════════════════════════════════════
-- The b2b_invoices table stores both proper tax invoices and delivery notes
-- (תעודות משלוח) — they differ in tax/accounting treatment but currently
-- looked identical in the system. Add a classification column so users can
-- tag each PDF correctly at upload time.
--
-- Default 'invoice' is safe — all existing rows were uploaded as invoices.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE b2b_invoices
  ADD COLUMN IF NOT EXISTS doc_type TEXT NOT NULL DEFAULT 'invoice'
    CHECK (doc_type IN ('invoice', 'delivery_note'));

COMMENT ON COLUMN b2b_invoices.doc_type IS 'invoice = חשבונית מס · delivery_note = תעודת משלוח';
