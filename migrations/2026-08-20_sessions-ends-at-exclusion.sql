-- =====================================================================
-- 2026-08-20_sessions-ends-at-exclusion.sql
--
-- เป้าหมาย: กันจองซ้อนที่ระดับ DB แบบ "ช่วงเวลาทับกัน" ไม่ใช่แค่เวลาเริ่มตรงกัน
--
-- ปัญหาเดิม: uniq_therapist_slot เป็น partial unique index บน
--   (therapist_id, starts_at) WHERE status <> 'cancelled'
--   กันได้เฉพาะคาบที่เริ่มเวลาเดียวกันเป๊ะ ๆ
--   คอร์ส 90 นาทีที่เริ่ม 09:00 กับคอร์ส 60 นาทีที่เริ่ม 10:00 ทับกันแต่ผ่านฉลุย
--
-- ทำไมต้องเพิ่ม ends_at:
--   exclusion constraint อ้างได้เฉพาะคอลัมน์ในตารางตัวเอง
--   แต่ duration_minutes อยู่ที่ courses ไม่ใช่ sessions → ต้อง denormalize ลงมา
--
-- ทำไมไม่ใช้ GENERATED column:
--   timestamptz + interval เป็น STABLE ไม่ใช่ IMMUTABLE (ขึ้นกับ timezone)
--   Postgres ไม่ยอมให้ใช้ใน generated column → ใช้ trigger แทน
--
-- ทำไมใช้ trigger ไม่ให้ Lambda คำนวณ:
--   ไม่ต้องแก้ mck-lambda-sessions-api เลย และโค้ดไม่มีทางเขียนค่าผิด
--
-- ตรวจก่อนรันแล้ว (20 ส.ค. 2569): 23 คาบ · null_duration 0 · overlaps 0
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. ยืนยันสภาพก่อนแก้ — ถ้าไม่ตรงให้ล้มทั้ง transaction ทันที
-- ---------------------------------------------------------------------
DO $$
DECLARE
  n_null int;
  n_over int;
BEGIN
  SELECT count(*) INTO n_null
  FROM sessions s JOIN courses c ON c.id = s.course_id
  WHERE c.duration_minutes IS NULL;

  IF n_null > 0 THEN
    RAISE EXCEPTION 'มีคอร์สที่ duration_minutes เป็น NULL อยู่ % แถว — เติมค่าก่อน', n_null;
  END IF;

  WITH p AS (
    SELECT s.id, s.therapist_id,
           tstzrange(s.starts_at, s.starts_at + make_interval(mins => c.duration_minutes)) r
    FROM sessions s JOIN courses c ON c.id = s.course_id
    WHERE s.status <> 'cancelled'
  )
  SELECT count(*) INTO n_over
  FROM p a JOIN p b ON b.therapist_id = a.therapist_id AND b.id > a.id AND a.r && b.r;

  IF n_over > 0 THEN
    RAISE EXCEPTION 'มีคาบทับกันอยู่แล้ว % คู่ — แก้ข้อมูลก่อน', n_over;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. เพิ่มคอลัมน์ ends_at (ยังให้ NULL ได้ชั่วคราว เพื่อ backfill)
-- ---------------------------------------------------------------------
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ends_at timestamptz;

-- ---------------------------------------------------------------------
-- 2. เติมค่าให้แถวเดิมทั้งหมด
-- ---------------------------------------------------------------------
UPDATE sessions s
SET ends_at = s.starts_at + make_interval(mins => c.duration_minutes)
FROM courses c
WHERE c.id = s.course_id
  AND s.ends_at IS DISTINCT FROM s.starts_at + make_interval(mins => c.duration_minutes);

-- ---------------------------------------------------------------------
-- 3. trigger — DB คำนวณ ends_at ให้เองเสมอ
--    ค่า ends_at ที่ client ส่งมาจะถูกทับทิ้งโดยตั้งใจ
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sessions_set_ends_at() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d int;
BEGIN
  SELECT duration_minutes INTO d FROM courses WHERE id = NEW.course_id;

  IF d IS NULL THEN
    RAISE EXCEPTION 'course_id % ไม่มี duration_minutes', NEW.course_id;
  END IF;

  IF d <= 0 THEN
    RAISE EXCEPTION 'course_id % มี duration_minutes = % (ต้องมากกว่า 0)', NEW.course_id, d;
  END IF;

  NEW.ends_at := NEW.starts_at + make_interval(mins => d);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sessions_ends_at ON sessions;
CREATE TRIGGER trg_sessions_ends_at
  BEFORE INSERT OR UPDATE OF starts_at, course_id, ends_at ON sessions
  FOR EACH ROW EXECUTE FUNCTION sessions_set_ends_at();

-- ---------------------------------------------------------------------
-- 4. บังคับให้ ends_at มีค่าและมากกว่า starts_at เสมอ
--    ถ้า range ว่าง (ends = starts) ตัว && จะไม่ match อะไรเลย
--    = หลุดการป้องกันเงียบ ๆ จึงต้องมี CHECK ตัวนี้
-- ---------------------------------------------------------------------
ALTER TABLE sessions ALTER COLUMN ends_at SET NOT NULL;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_ends_after_starts CHECK (ends_at > starts_at);

-- ---------------------------------------------------------------------
-- 5. exclusion constraint — ตัวกันจองซ้อนของจริง
--    ครูคนเดียวกัน + ช่วงเวลาทับกัน + ยังไม่ยกเลิก = ถูกปฏิเสธ
--    tstzrange แบบ [) → คาบ 09:00-10:00 กับ 10:00-11:00 ต่อกันได้ ไม่นับว่าทับ
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE sessions
  ADD CONSTRAINT excl_therapist_overlap
  EXCLUDE USING gist (
    therapist_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status <> 'cancelled');

-- ---------------------------------------------------------------------
-- 6. ลบ index เก่า — exclusion constraint ครอบคลุมแทนแล้ว
--    ถ้าอยากเก็บไว้ก่อนเพื่อความอุ่นใจ ให้คอมเมนต์บรรทัดล่างนี้ทิ้ง
--    (เก็บไว้ไม่ผิด แค่ซ้ำซ้อนและเปลืองการเขียน index หนึ่งชุด)
-- ---------------------------------------------------------------------
DROP INDEX IF EXISTS uniq_therapist_slot;

COMMIT;
