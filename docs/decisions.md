# Design decisions

Short records of the choices that shaped this system, written after the fact but from measurements rather than memory. Each entry states the situation, the options, what was chosen, and what that choice costs.

---

## 1. No NAT Gateway

**Situation.** Ten Lambda functions need to reach RDS, so they must be attached to the VPC. Once attached, a Lambda has no route to the internet — but those same functions need Secrets Manager for database credentials, and three other functions need to call the LINE and Cognito APIs.

**Options.** Add a NAT Gateway so everything in the VPC can reach the internet; or split the functions and use VPC endpoints for the AWS services that support them.

**Chosen.** No NAT. Database-touching functions live inside the VPC and reach Secrets Manager over a PrivateLink interface endpoint. The three functions that genuinely need outbound internet run outside the VPC entirely and never touch the database.

**Cost of the choice.** A NAT Gateway is roughly $32/month, close to what the whole rest of the system cost. In exchange the topology is less uniform: which VPC a function belongs to is now a design decision per function rather than a default, and that has to be documented or it looks arbitrary. The interface endpoint is not free either — it was about $11.59/month, still a third of the NAT.

---

## 2. Audit for staff account changes lives in CloudTrail, not in the database

**Situation.** `mck-staff-manage` creates staff accounts and changes their roles. Those are exactly the actions that need an audit trail. But it runs outside the VPC (decision 1), so it cannot write to RDS.

**Options.** Move it into the VPC and add a NAT or a Cognito interface endpoint so it can do both; write audit rows through a second function; or use a record that already exists.

**Chosen.** Use CloudTrail. Cognito Admin API calls are recorded there automatically. Verified rather than assumed: `AdminListGroupsForUser` appears in the event history, and it belongs to the same API family as `AdminAddUserToGroup`, so role writes are recorded too. The reason `AdminAddUserToGroup` is not in the history is that no role has been changed yet, not that it goes unrecorded.

**Cost of the choice.** Without a configured trail, event history only covers 90 days and has no log file validation. Adequate for a system with no real users; not adequate for production. Creating a trail is a small piece of unfinished work, not a redesign.

---

## 3. Concurrency is enforced by database constraints, not application logic

**Situation.** Two things must never happen: the same child booked twice into one session, and one therapist booked into two overlapping sessions.

**Options.** Check with a `SELECT` before inserting; or express the rule as a constraint.

**Chosen.** Both rules are constraints.

```sql
-- one child, one session, ignoring cancellations
CREATE UNIQUE INDEX uniq_child_per_session
  ON bookings (child_id, session_id)
  WHERE status IS DISTINCT FROM 'cancelled';

-- a therapist's sessions may not overlap in time
ALTER TABLE sessions ADD CONSTRAINT excl_therapist_overlap
  EXCLUDE USING gist (
    therapist_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status <> 'cancelled');
```

A `SELECT` then `INSERT` leaves a window between the two statements where a second request can slip through. A constraint has no window. The booking handler catches SQLSTATE `23505` and returns `409 ALREADY_BOOKED`.

**Cost of the choice.** Error handling becomes SQLSTATE-specific and therefore easy to get subtly wrong. Exclusion constraints raise `23P01`, not `23505`, and `ON CONFLICT` does not work with them at all — so the same pattern that works for bookings does not transfer to sessions. That mismatch is still an open issue; see the README.

Note also that `uniq_child_per_session` is a partial index created directly, so it does not appear in `pg_constraint`. Checking only that catalogue makes it look as though the protection is missing when it is not.

---

## 4. Clinical notes and parent-facing notes are separate columns

**Situation.** After each session the therapist records what happened. Some of that is clinical assessment; some of it is what the parent should read. They are not the same text and should not be reachable by the same audience.

**Options.** One note field with a visibility flag; two fields.

**Chosen.** Two columns on `session_notes` — `clinical_note` and `parent_summary`. The staff form shows both with explicit labels while typing. No route reachable by a parent token returns the clinical column.

**Cost of the choice.** Staff have to fill in two fields instead of one, which is slower. In exchange, a mistake in an API handler cannot leak clinical text to a parent, because there is no handler that selects it on a parent route. A visibility flag would have put that guarantee in application code, where it is one forgotten `WHERE` clause away from failing.

---

## 5. Group courses do not have a self-service booking flow

**Situation.** Individual courses can be booked by picking a slot. Group courses hold up to four children and depend on age range and skill level fitting together.

**Options.** Build matching rules so parents can book group sessions directly; or route the request to a human.

**Chosen.** Group course cards show "see open rounds" and route into the LINE chat. There is no group booking endpoint.

**Cost of the choice.** The group path is not automated, so staff handle each request by hand. Automating it would have meant encoding a therapist's judgement about group composition as rules, and those rules would be wrong in exactly the cases that matter most. The FAQ screen in the parent app answers this directly rather than leaving the parent to discover it.

---

## 6. Nothing is hard-deleted from the normal interface

**Situation.** Staff need to remove children, courses, staff accounts and cancelled sessions from their working views.

**Options.** Delete rows; or mark them inactive and hide them.

**Chosen.** Every one of those four entities moves to an archive view and can be restored. Permanent deletion exists only inside the archive screens, behind a second step.

**Cost of the choice.** Every query that lists working data has to filter, and forgetting the filter shows archived records. In exchange there is no single misclick that destroys a child's history. Consistency mattered here: implementing this for three of the four entities and not the fourth would be worse than not doing it at all, because it would train staff to expect a safety net that is not always there.

---

## 7. TLS verification against RDS is enforced, not disabled

**Situation.** Node's `pg` client will happily connect to RDS with certificate verification turned off, and a great deal of sample code does exactly that to get past a certificate error.

**Chosen.** Each function ships the AWS RDS CA bundle and connects with `rejectUnauthorized: true`.

**Cost of the choice.** The CA file has to be included in every deployment package and rotated when AWS rotates its CA. That is real maintenance. `rejectUnauthorized: false` removes the work and also removes the guarantee that the host on the other end is actually the database.

---

## 8. Legacy naming was documented rather than corrected

**Situation.** The project was renamed part-way through. The RDS instance is `mck-db`, the secret is `babyplaytime/db-credentials`, and the database itself is `babyplaytime`. Twelve functions reference the old names at runtime.

**Options.** Create new resources with consistent names and redeploy everything; or leave the names and document them.

**Chosen.** Leave them, and record the mismatch in the README's known issues.

**Cost of the choice.** Anyone new to the system will find the names confusing, and someone tidying up "old babyplaytime stuff" could break all twelve functions. That risk is the reason it is written down in a place they will read before touching anything. Renaming would have required creating a new secret, editing and redeploying twelve functions, and renaming a live database — a real chance of breakage for a cosmetic gain.

---

## 9. Staff identity is delegated to Cognito

**Situation.** Staff need accounts, passwords, password resets and ideally MFA.

**Chosen.** Cognito user pool with the Hosted UI. The application never sees a staff password; it receives a JWT after an OAuth2 authorization code flow. MFA is set to `ON`, which makes it mandatory rather than optional. Roles live in `cognito:groups` and are checked in each handler, failing closed when the group is unrecognised.

**Cost of the choice.** The login screen is not part of the application and cannot be styled freely, and there is no user table in the database, so anything that wants a staff name has to ask Cognito. In exchange, none of password hashing, reset tokens, MFA enrolment or account recovery had to be written — and each of those is a place where hand-written auth code usually goes wrong.

Account recovery deserves a note of its own: enforcing MFA without a recovery path means a staff member who loses their phone is locked out permanently. The pool is configured with verified email first and verified phone second for exactly that reason.
