// mck-reminder-dispatcher
// Runs OUTSIDE the VPC (needs internet to reach api.line.me). Cannot reach
// RDS directly — instead invokes mck-reminder-query (inside the VPC) via
// lambda:InvokeFunction and gets back only booking_id / line_user_id /
// nickname / starts_at. This function must never receive or log a course
// name, therapist name, or any clinical field — mck-reminder-query doesn't
// select them, so there is nothing here to leak by omission.
//
// Trigger: EventBridge Scheduler, daily at 18:00 Asia/Bangkok (schedule not
// created by this change — see Docs/Spec-LINE-Reminders.md). Also callable
// by hand with { "dry_run": true } for manual testing before that schedule
// exists.
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const REGION = process.env.AWS_REGION;
const QUERY_FUNCTION_NAME = process.env.QUERY_FUNCTION_NAME || 'mck-reminder-query';
const KIND = 'reminder_1day';

const secretsClient = new SecretsManagerClient({ region: REGION });
const lambdaClient = new LambdaClient({ region: REGION });

let cachedChannelAccessToken = null;

// mck/line-credentials has exactly two keys: channel_secret and
// channel_access_token (snake_case, confirmed against the live secret
// 2026-08-19). Only channel_access_token is needed for push messages.
// Read defensively — no fallback to a guessed key name. A missing key
// means the secret is misconfigured and must fail loudly, not silently
// push with an empty/undefined token.
async function getLineChannelAccessToken() {
  if (cachedChannelAccessToken) return cachedChannelAccessToken;
  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: "mck/line-credentials" })
  );
  const parsed = JSON.parse(response.SecretString);
  if (!parsed.channel_access_token) {
    throw new Error("mck/line-credentials is missing channel_access_token");
  }
  cachedChannelAccessToken = parsed.channel_access_token;
  return cachedChannelAccessToken;
}

async function queryInvoke(payload) {
  const res = await lambdaClient.send(new InvokeCommand({
    FunctionName: QUERY_FUNCTION_NAME,
    Payload: Buffer.from(JSON.stringify(payload))
  }));
  const text = Buffer.from(res.Payload).toString('utf8');
  const body = JSON.parse(text);
  if (res.FunctionError || body.ok === false) {
    throw new Error("mck-reminder-query failed: " + (body.error || res.FunctionError || "unknown"));
  }
  return body;
}

// Renders the fixed, privacy-safe template from the spec — nickname, date,
// time only. No course name, no therapist name, no clinical content.
function reminderText(nickname, startsAt) {
  const d = new Date(startsAt);
  const datePart = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short'
  }).format(d);
  const timePart = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(d);
  return `แจ้งเตือนนัดหมาย\n\nพรุ่งนี้ (${datePart}) เวลา ${timePart} น.\nน้อง${nickname}มีนัดที่คลินิกค่ะ\n\nหากต้องการเลื่อนหรือยกเลิก กรุณาแจ้งล่วงหน้า`;
}

function auditLog(action, detail) {
  console.log(JSON.stringify(Object.assign({
    audit: true,
    ts: new Date().toISOString(),
    actor: "system:mck-reminder-dispatcher",
    action: action
  }, detail || {})));
}

exports.handler = async (event) => {
  const dryRun = !!(event && event.dry_run);
  const summary = { dry_run: dryRun, total: 0, sent: 0, failed: 0, skipped_duplicate: 0 };

  const listResult = await queryInvoke({ action: 'list_tomorrow' });
  const rows = listResult.rows || [];
  summary.total = rows.length;

  // ---- DRY RUN: preview only. Deliberately does NOT call `claim` — a
  // dry run must never write to notification_log, or it would consume the
  // dedupe slot and block the real send that follows it during testing
  // (see spec's test sequence: dry-run, then real, then re-run to prove
  // dedupe). No LINE call either. ----
  if (dryRun) {
    auditLog("reminder_dry_run_start", { count: rows.length });
    for (const row of rows) {
      auditLog("reminder_dry_run_would_send", {
        booking_id: row.booking_id,
        line_user_id: row.line_user_id,
        note: "DRY RUN — claim skipped, dedupe not exercised"
      });
    }
    auditLog("reminder_dispatch_summary", summary);
    return summary;
  }

  const channelAccessToken = await getLineChannelAccessToken();

  for (const row of rows) {
    let claim;
    try {
      claim = await queryInvoke({ action: 'claim', booking_id: row.booking_id, kind: KIND });
    } catch (e) {
      // Could not even attempt the dedupe claim — do not guess, do not
      // send. Count as failed so it's visible rather than silently dropped.
      auditLog("reminder_claim_error", { booking_id: row.booking_id, error: e.message });
      summary.failed++;
      continue;
    }

    if (!claim.claimed) {
      summary.skipped_duplicate++;
      continue;
    }

    try {
      const text = reminderText(row.nickname, row.starts_at);
      const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + channelAccessToken
        },
        body: JSON.stringify({ to: row.line_user_id, messages: [{ type: 'text', text }] })
      });
      if (!res.ok) {
        const bodyText = await res.text();
        throw new Error("LINE push failed " + res.status + ": " + bodyText);
      }
      await queryInvoke({ action: 'update_status', booking_id: row.booking_id, kind: KIND, status: 'sent' });
      summary.sent++;
    } catch (e) {
      summary.failed++;
      // Full error detail (may include LINE's response body) goes only to
      // notification_log via update_status — that table exists precisely
      // to answer "why didn't I get a reminder" without digging through
      // logs. Console gets an identifier and a fixed tag only, never the
      // message text or the raw error body.
      try {
        await queryInvoke({ action: 'update_status', booking_id: row.booking_id, kind: KIND, status: 'failed', error: e.message });
      } catch (e2) {
        auditLog("reminder_update_status_error", { booking_id: row.booking_id, error: e2.message });
      }
      auditLog("reminder_send_failed", { booking_id: row.booking_id });
    }
  }

  auditLog("reminder_dispatch_summary", summary);
  return summary;
};
