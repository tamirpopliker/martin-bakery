-- Support preset cakes for medium-round orders:
-- When a customer picks 'עגולה בינונית' + a ready-made cake,
-- preset_cake_name holds the preset name and the torte/cream/filling fields
-- are filled with the same preset name (they remain NOT NULL).
ALTER TABLE special_orders ADD COLUMN IF NOT EXISTS preset_cake_name TEXT;
