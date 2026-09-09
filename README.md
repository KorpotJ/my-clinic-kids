# My Clinic Kids

Booking and progress-tracking system for a pediatric occupational therapy clinic in Thailand.
Parents use it inside LINE; clinic staff use a web console behind Cognito with mandatory MFA.

Serverless on AWS, deployed in **ap-southeast-7 (Bangkok)** so that personal data stays in-country.

<p align="center">
  <img src="media/3.3-parent-home.jpg" width="260" alt="Parent app home screen">
  &nbsp;&nbsp;
  <img src="media/2.5-staff-calendar-month.png" width="560" alt="Staff console monthly calendar">
</p>

---

## At a glance

| | |
|---|---|
| **Code written** | ~8,860 lines — Lambda 3,060 · LINE LIFF app 2,454 · staff console 3,276 |
| **Compute** | 13 Lambda functions (Node.js) |
| **API** | 26 routes on API Gateway HTTP API, 2 authorizers, no unauthenticated route |
| **Database** | PostgreSQL 18.3 — 8 tables, 53 constraints, 13 indexes |
| **Migrations** | 4 versioned SQL files; the two that alter existing constraints ship with rollback scripts |
| **Identity** | LINE (parents) · Amazon Cognito with enforced MFA (staff) |
| **Access control** | 4 roles in `cognito:groups`, fail-closed by default |
| **Running cost** | ~$34/month before decommissioning; ~95% of it was RDS + one VPC endpoint |

Status: feature-complete for its original scope and running with 8 demo cases. No real patient data was ever entered. The database layer has since been decommissioned and preserved as RDS snapshots — see [Project status](#project-status).

---

## Why it exists, and why it stopped

It began as an AWS lab. I wanted a project large enough to force real decisions about VPC design, identity and cost, instead of another tutorial stack that never has to survive contact with anything.

The idea came from my partner, who joined a newly opened children's clinic as an occupational therapist. Almost every parent here already lives inside LINE, so a booking flow that opens straight from the clinic's LINE official account looked like the path of least friction — nothing to install, nobody to onboard. Building it as a real product rather than a lab exercise was the point: that is how I wanted to learn AWS.

When the system was working, I approached the clinic and showed it to them. **Their answer is where the project stopped.** Their courses lock each child into a fixed programme of activities, so there is nothing for a parent to select and no gap for online booking to fill. That ended it.

The booking flow itself still holds up as a pattern — just not for this clinic. Somewhere with genuinely open slots, a dental practice or a restaurant, is where this design would earn its keep, and it is a reasonable thing to build on later.

Running it cost roughly 1,100 THB a month. I have taken it as far as it needed to go, and I would rather put that time into preparing for AWS certification next.

I enjoyed this more than I expected to. It never made money, but what I learned here is the part that transfers — and applying it somewhere with a real commercial need is the more likely way it eventually pays off.

### How it was built

I used AI as the driver for most of the implementation and worked largely as an orchestrator: setting the architecture, splitting work into pieces, checking each result against the running system, and discarding what did not hold up. I do not claim to understand every line of the codebase.

What I do claim is the verification discipline around it. **Every number in this README was measured from the live system** — line counts, route counts, constraint definitions, costs, group membership — not recalled or estimated. The [Known issues](#known-issues) section is the output of that same process: each entry was found by checking the running system against what the documentation claimed, and several contradict what I believed was true.

---

## Architecture

<p align="center">
  <img src="docs/architecture.svg" width="100%" alt="System architecture">
</p>

### Design decisions worth explaining

**No NAT Gateway.** A NAT Gateway costs about $32/month — more than the rest of the system combined. Instead, the ten functions that touch the database sit in a VPC with no internet route and reach Secrets Manager through a PrivateLink interface endpoint. The three functions that genuinely need outbound internet (LINE messaging, Cognito admin calls) run outside the VPC entirely.

**No secrets in code or environment variables.** Every function fetches credentials from Secrets Manager at runtime. There are no database passwords in `process.env` and none in the repository.

**Staff audit trail via CloudTrail, not a database table.** The function that manages staff accounts lives outside the VPC and therefore cannot write to RDS. Rather than adding a NAT Gateway to make one audit path work, the design leans on the fact that Cognito Admin API calls are already recorded in CloudTrail. Verified by checking that `AdminListGroupsForUser` appears in the event history.

**Double-booking is prevented in the database, not the UI.** The booking button disables itself client-side, but the real guarantee is a partial unique index:

```sql
CREATE UNIQUE INDEX uniq_child_per_session
  ON bookings (child_id, session_id)
  WHERE status IS DISTINCT FROM 'cancelled';
```

A `23505` violation is translated into `409 ALREADY_BOOKED`. Checking with a `SELECT` before `INSERT` leaves a race window; a constraint does not.

**Therapist double-booking uses an exclusion constraint,** so overlapping ranges are rejected, not just identical start times:

```sql
EXCLUDE USING gist (
  therapist_id WITH =,
  tstzrange(starts_at, ends_at) WITH &&
) WHERE (status <> 'cancelled')
```

**Clinical notes are split at the schema level.** `session_notes` has two columns: `clinical_note`, which never leaves the staff console, and `parent_summary`, which is what the parent app renders. Staff fill in both in one form; the parent app has no route that can return the clinical field.

**Nothing is hard-deleted.** Children, courses, staff accounts and cancelled sessions all move to an archive view and can be restored. Permanent deletion exists only inside the archive screens.

---

## Security posture

- RDS has no public endpoint. Its security group allows port 5432 from **one source security group only** — no CIDR range is permitted, including the VPC's own.
- Storage encryption at rest is enabled; 7-day automated backups plus manual snapshots taken before every migration.
- The S3 origin has all four public-access blocks enabled and no bucket policy. It is reachable only through CloudFront.
- Cognito enforces MFA for every staff account, requires 8+ characters with all four character classes, expires temporary passwords after 7 days, and has a two-step account recovery chain.
- The application never handles staff passwords — authentication is an OAuth2 authorization code flow against the Cognito Hosted UI.
- Role checks are fail-closed: a token with no recognised group receives `403`, not a default permission.

A separate write-up of issues found and fixed during the project's final audit is in [`docs/security-findings.md`](docs/security-findings.md).

---

## What it does

### Parents — LINE LIFF

| | |
|---|---|
| ![](media/3.1-parent-line-oa-welcome.jpg) | **LINE official account with a rich menu.** The app opens inside LINE, so there is nothing to install and no separate password. |
| ![](media/3.4-parent-booking-solo.jpg) | **Individual courses can be booked directly** — pick a course, pick a slot, done. |
| ![](media/3.5-parent-booking-group.jpg) | **Group courses route to chat instead.** Group composition depends on age range and skill level, which is a therapist's judgement call, so the CTA is "see open rounds" rather than a booking button. |
| ![](media/3.8-parent-progress.jpg) | **Progress notes after each visit,** written by the therapist. Parents see only the parent-facing summary. |
| ![](media/3.2-parent-line-reminder.jpg) | **Appointment reminders** delivered as LINE push messages. |

### Staff — web console

| | |
|---|---|
| ![](media/2.5-staff-calendar-month.png) | **Schedule in year / month / day views,** with counts for sessions, bookings and pending requests. |
| ![](media/2.10-staff-pending-requests.png) | **Booking requests wait for approval** before becoming confirmed sessions. |
| ![](media/2.8-staff-session-note-form.png) | **Session notes split into clinical and parent-facing fields,** labelled in the UI so the distinction is obvious while typing. |
| ![](media/2.18-staff-management.png) | **Staff accounts and roles** managed through the Cognito Admin API — no user table in the database. |

Short clips of the two cross-app flows — a parent booking being approved by staff, and a note being written and appearing in the parent app — are in [`media/`](media/).

---

## Tech stack

| Layer | Choice | Reason |
|---|---|---|
| Parent client | LINE LIFF | Every parent already has LINE; app installs and password resets disappear as problems |
| Staff client | Static HTML/CSS/JS on CloudFront | No build step, no framework to keep current, near-zero hosting cost |
| API | API Gateway HTTP API | Cheaper and simpler than REST API; native JWT authorizer support |
| Compute | Lambda (Node.js) | Traffic is a handful of requests per day — paying for an idle server made no sense |
| Database | RDS PostgreSQL | Exclusion constraints and partial indexes do the concurrency work that application code would otherwise fumble |
| Secrets | Secrets Manager via PrivateLink | Keeps credentials out of code and out of the public internet |
| Staff identity | Cognito + Hosted UI | MFA, password policy and recovery flows without writing auth code |

---

## Known issues

Honest list, all confirmed by inspection rather than guessed:

| Issue | Impact |
|---|---|
| Cognito has 4 groups but handlers only recognise `ClinicDirector` and `Admin` | An account assigned `OT` or `SpecialEd` can sign in but is rejected on every route. The UI offers all four in its role dropdown. |
| The session-note form does not pre-fill existing values | "View / edit" opens an empty form even when a note exists. Saved data is intact and visible in the parent app. |
| Migration adding `UNIQUE (booking_id)` to `session_notes` was never applied | Nothing prevents multiple notes per booking |
| Exclusion constraints raise SQLSTATE `23P01`, not `23505` | Handler code that only catches `23505` would return `500` instead of `409` on the admin session-creation path. Not yet verified in code. |
| `notification_log` has never been written to | The reminder dispatcher has no database driver; the table exists and is empty |
| Resource naming drifted mid-project | The instance is `mck-db`, the secret is `babyplaytime/db-credentials`, and the database is `babyplaytime`. Renaming would require redeploying twelve functions, so it is documented instead of changed. |
| Dashboard screen is a placeholder | Scoped but never built |
| Log retention is 14 days and no CloudTrail trail was created | Event history covers 90 days; adequate for a demo, not for production |

---

## Project status

Stopped after reaching feature completeness, for the reasons above.

To stop it costing money, the RDS instance and the Secrets Manager VPC endpoint were deleted; the database is preserved as five manual snapshots, including one taken immediately before deletion. Everything else — Lambda, API Gateway, Cognito, CloudFront, S3 — costs effectively nothing and remains deployed, so the interfaces are still browsable even though data no longer loads.

Restoring the system is a matter of restoring a snapshot and recreating one VPC endpoint.

---

## Repository layout

```
lambda/       13 functions, one folder each
liff/         parent-facing LINE app
admin/        staff console
migrations/   4 migrations, 2 of them with a rollback
docs/         architecture, decisions, security findings
media/        screenshots and clips
```
