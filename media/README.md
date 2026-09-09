# Media index

Screenshots and screen recordings of the running system, captured before decommissioning.
All 8 cases visible in these files are demo data. No real patient information was ever entered.

**Naming:** `2.x` = staff web console · `3.x` = parent LINE LIFF app.
Numbers follow the order a user meets each screen, not the order they were captured.

Three flows exist as both a still and a clip — the still is used in the main README, the clip
shows the interaction: `3.4 ↔ 3.10` (solo booking) · `3.5 ↔ 3.11` (group booking) ·
`3.8 ↔ 3.12` (progress notes).

> **สำหรับผู้อ่านภาษาไทย:** `2.x` คือฝั่งเจ้าหน้าที่ · `3.x` คือฝั่งผู้ปกครอง
> เรียงตามลำดับที่ผู้ใช้เจอหน้าจอ ไฟล์ `.mp4` คือคลิป ที่เหลือเป็นภาพนิ่ง

---

## 2.x — Staff web console

| # | File | What it shows |
|---|---|---|
| 2.1 | `2.1-staff-login-page.png` | Cognito Hosted UI sign-in page |
| 2.2 | `2.2-staff-login-mfa.mp4` 🎬 | MFA challenge during sign-in |
| 2.3 | `2.3-staff-dashboard-wip.png` | Dashboard placeholder — scoped, never built |
| 2.4 | `2.4-staff-calendar-year.png` | Schedule, year view |
| 2.5 | `2.5-staff-calendar-month.png` | Schedule, month view with session and booking counts |
| 2.6 | `2.6-staff-calendar-day.png` | Schedule, day view |
| 2.7 | `2.7-staff-session-modal.png` | Session detail |
| 2.8 | `2.8-staff-session-note-form.png` | Note form — clinical and parent-facing fields side by side |
| 2.9 | `2.9-staff-write-session-note.mp4` 🎬 | **Cross-app:** staff writes a note, parent app renders the summary |
| 2.10 | `2.10-staff-pending-requests.png` | Booking requests awaiting approval |
| 2.11 | `2.11-staff-approve-booking.mp4` 🎬 | **Cross-app:** parent books, staff approves, both screens update |
| 2.12 | `2.12-staff-cancelled-history.png` | Cancelled sessions, retained not deleted |
| 2.13 | `2.13-staff-courses.png` | Course list |
| 2.14 | `2.14-staff-courses-archive.png` | Archived courses, restorable |
| 2.15 | `2.15-staff-children.png` | Child records |
| 2.16 | `2.16-staff-parents.png` | Parent records and LINE linkage |
| 2.17 | `2.17-staff-children-archive.png` | Archived child records |
| 2.18 | `2.18-staff-management.png` | Staff accounts and roles via Cognito Admin API |
| 2.19 | `2.19-staff-suspended-accounts.png` | Suspended accounts |

## 3.x — Parent LINE LIFF app

| # | File | What it shows |
|---|---|---|
| 3.1 | `3.1-parent-line-oa-welcome.jpg` | LINE official account with rich menu |
| 3.2 | `3.2-parent-line-reminder.jpg` | Appointment reminder as a LINE push message |
| 3.3 | `3.3-parent-home.jpg` | App home screen |
| 3.4 | `3.4-parent-booking-solo.jpg` | Solo course booking |
| 3.5 | `3.5-parent-booking-group.jpg` | Group course — routes to chat instead of a booking button |
| 3.6 | `3.6-parent-booking-flow.mp4` 🎬 | Full booking flow end to end |
| 3.7 | `3.7-parent-appointments.jpg` | Upcoming appointments |
| 3.8 | `3.8-parent-progress.jpg` | Progress notes, parent-facing summary only |
| 3.9 | `3.9-parent-chat-faq.jpg` | Chat and FAQ entry point |
| 3.10 | `3.10-parent-booking-solo.mp4` 🎬 | Solo booking, recorded (still: 3.4) |
| 3.11 | `3.11-parent-booking-group.mp4` 🎬 | Group booking, recorded (still: 3.5) |
| 3.12 | `3.12-parent-progress.mp4` 🎬 | Progress notes, recorded (still: 3.8) |

---

🎬 = video · 24 stills, 7 clips, 31 files total.
Clips are compressed with ffmpeg; the largest is under 4 MB.
