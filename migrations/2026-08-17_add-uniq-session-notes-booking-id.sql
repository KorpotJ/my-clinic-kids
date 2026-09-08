-- Migration: enforce one session_notes row per booking.
--
-- DO NOT RUN THIS AUTOMATICALLY. Written per request, not executed.
--
-- Why: babyplaytime-lambda-session-notes' POST handler upserts by doing
-- SELECT id FROM session_notes WHERE booking_id = $1, then INSERT or
-- UPDATE based on whether a row came back. Two concurrent POSTs for the
-- same booking_id (e.g. a staff member double-clicking "save", or two
-- tabs open on the same booking) can both run the SELECT before either
-- INSERT commits, both see "no existing row", and both INSERT — leaving
-- two session_notes rows for one booking_id. Nothing today stops that.
--
-- This constraint doesn't fix the race by itself — it turns the race from
-- "silently creates a duplicate row" into "the loser's INSERT fails with
-- 23505 unique_violation", which the Lambda does not currently catch (it
-- has no `if (e.code === '23505' ...)` handler in this path, unlike
-- create-bookings' handling of uniq_therapist_slot / uniq_child_per_session).
-- The loser would currently surface as a 500. Flagging this rather than
-- silently patching the Lambda too — only the migration file was asked for.
--
-- Before running in any real environment: check for existing duplicates
-- first (`SELECT booking_id, COUNT(*) FROM session_notes GROUP BY booking_id
-- HAVING COUNT(*) > 1;`) — this constraint will refuse to apply if any
-- exist, and today's data is dummy/demo only so this is likely a non-issue,
-- but it should still be checked rather than assumed.

ALTER TABLE session_notes
  ADD CONSTRAINT uniq_session_notes_booking_id UNIQUE (booking_id);
