-- Migration: create notification_log for LINE appointment reminders.
--
-- DO NOT RUN THIS AUTOMATICALLY. Written per request, not executed.
--
-- Backs mck-reminder-query / mck-reminder-dispatcher (see
-- Docs/Spec-LINE-Reminders.md). UNIQUE(booking_id, kind) is the actual
-- dedupe mechanism: mck-reminder-query INSERTs a 'pending' row here
-- BEFORE the dispatcher calls api.line.me for that booking. If the INSERT
-- conflicts, a previous attempt already claimed this send and the
-- dispatcher skips it — so an EventBridge retry, or the scheduler firing
-- twice, cannot produce a duplicate message. After the send attempt, the
-- same row is UPDATEd to 'sent' or 'failed' (+ error), so this table can
-- also answer "why didn't I get a reminder" without digging through
-- Lambda logs.
--
-- status includes 'pending' (not just sent | failed as in the original
-- spec sketch) because the claim-insert and the send-outcome update are
-- two separate steps — a row briefly exists as 'pending' between the
-- claim and the LINE API call completing. A row stuck on 'pending' means
-- the dispatcher claimed it but never got back to update it (e.g. it
-- crashed mid-send) — that's a signal worth alerting on, not an error state.
--
-- kind is a free-text discriminator so future reminder types (e.g. a
-- same-day reminder) can share this table without a new migration.

CREATE TABLE notification_log (
  id          SERIAL PRIMARY KEY,
  booking_id  INT NOT NULL REFERENCES bookings(id),
  kind        TEXT NOT NULL,        -- 'reminder_1day'
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  status      TEXT NOT NULL,        -- pending | sent | failed
  error       TEXT,
  UNIQUE (booking_id, kind)
);
