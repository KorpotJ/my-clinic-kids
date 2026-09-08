-- =====================================================================
-- 2026-08-20_add-uniq-child-per-session.sql
--
-- เป้าหมาย: กันเด็กคนเดียวกันจองคาบเดียวกันซ้ำ ที่ระดับ DB
--
-- ปัญหา: mck-sessions-api ดัก
--   e.code === '23505' && e.constraint === 'uniq_child_per_session'
--   แล้วคืน 409 ALREADY_BOOKED
--   แต่ constraint ชื่อนี้ไม่เคยถูกสร้าง → โค้ดดักของที่ไม่มีอยู่
--   ตอนนี้เด็กคนเดียวจองคาบเดียวซ้ำได้ไม่จำกัด
--
-- ⚠️ ชื่อ index ต้องเป็น uniq_child_per_session เป๊ะ ๆ
--    โค้ดอ้างชื่อนี้ ถ้าตั้งชื่ออื่น 409 จะกลายเป็น 500
--
-- ทำไมเป็น partial index (WHERE):
--   ถ้าเป็น unique เต็มรูปแบบ เด็กที่ยกเลิกแล้วจะจองคาบเดิมใหม่ไม่ได้ตลอดกาล
--   ยกเว้นแถวที่ยกเลิกแล้วออกไป เพื่อให้จองซ้ำหลังยกเลิกได้
--
-- ทำไม IS DISTINCT FROM ไม่ใช่ <> :
--   bookings.status ไม่มี NOT NULL (ต่างจาก sessions.status)
--   ถ้าใช้ <> แถวที่ status เป็น NULL จะได้เงื่อนไข NULL แล้วหลุดการป้องกัน
--   IS DISTINCT FROM คืน true เมื่อ status เป็น NULL → แถวนั้นถูกกันด้วย
--
-- ตรวจก่อนรันแล้ว (20 ส.ค. 2569):
--   21 แถว · status: confirmed 20, cancelled 1 · ไม่มี NULL · ไม่มีคู่ซ้ำ
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. ยืนยันว่าไม่มีคู่ซ้ำอยู่ก่อน — ถ้ามีให้ล้มทั้ง transaction
-- ---------------------------------------------------------------------
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT child_id, session_id
    FROM bookings
    WHERE status IS DISTINCT FROM 'cancelled'
    GROUP BY child_id, session_id
    HAVING count(*) > 1
  ) d;

  IF n > 0 THEN
    RAISE EXCEPTION 'มีเด็กจองคาบซ้ำอยู่แล้ว % คู่ — ต้องล้างข้อมูลก่อน', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. สร้าง partial unique index
--    ชื่อต้องตรงกับที่ sessions-api ดักไว้
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX uniq_child_per_session
  ON public.bookings (child_id, session_id)
  WHERE (status IS DISTINCT FROM 'cancelled');

COMMIT;

-- =====================================================================
-- หมายเหตุ (ไม่ได้ทำในไฟล์นี้ — เก็บเป็น backlog):
--
-- bookings.status ยังไม่มี NOT NULL และไม่มี CHECK จำกัดค่า
-- ต่างจาก sessions.status ที่มีทั้งคู่
-- ควรเพิ่มทีหลัง แต่ต้อง grep โค้ดก่อนว่ามีเส้นทางไหน INSERT ค่าอื่น
-- นอกเหนือจาก pending / confirmed / cancelled หรือเปล่า
-- ไม่งั้นจะกลายเป็น 500 ตอน runtime
-- =====================================================================
