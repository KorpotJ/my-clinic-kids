-- =====================================================================
-- ROLLBACK ของ 2026-08-20_sessions-ends-at-exclusion.sql
-- คืนสภาพกลับไปเป็นเหมือนก่อนรัน migration
--
-- ⚠️ รันแล้วจะกลับไปกันจองซ้อนได้แค่ "เวลาเริ่มตรงกันเป๊ะ" เหมือนเดิม
-- =====================================================================

BEGIN;

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS excl_therapist_overlap;
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_ends_after_starts;

DROP TRIGGER IF EXISTS trg_sessions_ends_at ON sessions;
DROP FUNCTION IF EXISTS sessions_set_ends_at();

ALTER TABLE sessions DROP COLUMN IF EXISTS ends_at;

-- สร้าง index เดิมกลับมา (นิยามตรงกับที่อ่านจาก pg_indexes เมื่อ 20 ส.ค. 2569)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_therapist_slot
  ON public.sessions USING btree (therapist_id, starts_at)
  WHERE (status <> 'cancelled'::text);

COMMIT;

-- หมายเหตุ: ไม่ DROP EXTENSION btree_gist เพราะอาจมีอย่างอื่นใช้อยู่
-- และการมี extension ค้างไว้ไม่มีผลเสีย
