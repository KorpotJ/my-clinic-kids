// mck-reminder-query
// Runs INSIDE the VPC (needs RDS access). Not exposed via API Gateway —
// invoked directly by mck-reminder-dispatcher via lambda:InvokeFunction.
// IAM should restrict lambda:InvokeFunction on this function to that one
// caller only.
//
// Returns ONLY booking_id / line_user_id / nickname / starts_at for
// tomorrow's (Asia/Bangkok) non-cancelled bookings — no course name, no
// therapist name, no clinical field of any kind. The dispatcher runs
// outside the VPC and must never see anything beyond what this function
// selects, so the privacy boundary is enforced here, by simply not
// selecting those columns, not by filtering them out downstream.
const { Client } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });
let cachedSecret = null;

async function getDbCredentials() {
  if (cachedSecret) return cachedSecret;
  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: "babyplaytime/db-credentials" })
  );
  cachedSecret = JSON.parse(response.SecretString);
  return cachedSecret;
}

/* ── audit log: system-to-system call, no requestContext to parse ──
   This function has exactly one caller by IAM design (mck-reminder-dispatcher),
   so the actor is fixed instead of derived from claims. Same principle as
   mck-get-bookings' audit(): identifiers only, never content.          */
function audit(action, detail) {
  try {
    console.log(JSON.stringify(Object.assign({
      audit: true,
      ts: new Date().toISOString(),
      actor: "system:mck-reminder-dispatcher",
      action: action
    }, detail || {})));
  } catch (e) { console.log(JSON.stringify({ audit: true, action: action, error: "audit_failed" })); }
}

exports.handler = async (event) => {
  const action = event && event.action;

  const creds = await getDbCredentials();
  const client = new Client({
    host: creds.host,
    port: creds.port,
    database: "babyplaytime",
    user: creds.username,
    password: creds.password,
    ssl: { rejectUnauthorized: true, ca: require('fs').readFileSync(__dirname + '/rds-ca.pem', 'utf8') }
  });

  try {
    await client.connect();

    // ---- list_tomorrow: candidates for tomorrow's reminder ----
    if (action === 'list_tomorrow') {
      audit("reminder_list_tomorrow", {});
      const result = await client.query(
        `SELECT b.id AS booking_id,
                p.line_user_id,
                c.nickname,
                s.starts_at
           FROM bookings b
           JOIN sessions  s ON s.id = b.session_id
           JOIN children  c ON c.id = b.child_id
           JOIN parents   p ON p.id = c.parent_id
          WHERE (s.starts_at AT TIME ZONE 'Asia/Bangkok')::date
                = ((now() AT TIME ZONE 'Asia/Bangkok')::date + INTERVAL '1 day')
            AND b.status <> 'cancelled'
            AND s.status <> 'cancelled'
            AND p.line_user_id IS NOT NULL
            -- TODO(consents): once the consents table exists, add
            --   AND EXISTS (
            --     SELECT 1 FROM consents co
            --      WHERE co.parent_id = p.id
            --        AND co.consent_type = 'line_notify'
            --        AND co.granted = true
            --   )
            -- and drop (or keep alongside — a null line_user_id has nothing
            -- to send to either way) the line_user_id IS NOT NULL line above.
          ORDER BY s.starts_at`
      );
      return { ok: true, rows: result.rows };
    }

    // ---- claim: dedupe gate. This INSERT happens BEFORE the dispatcher
    // sends anything. If it doesn't insert a row (conflict on
    // booking_id+kind), a previous attempt already claimed this send and
    // the dispatcher must not call api.line.me again. ----
    if (action === 'claim') {
      const { booking_id, kind } = event;
      if (!booking_id || !kind) {
        return { ok: false, error: "claim requires booking_id and kind" };
      }
      const result = await client.query(
        `INSERT INTO notification_log (booking_id, kind, status)
              VALUES ($1, $2, 'pending')
         ON CONFLICT (booking_id, kind) DO NOTHING
         RETURNING id`,
        [booking_id, kind]
      );
      const claimed = result.rowCount > 0;
      audit("reminder_claim", { booking_id, kind, claimed });
      return { ok: true, claimed };
    }

    // ---- update_status: record the real outcome after the send attempt,
    // so notification_log stays accurate for "why didn't I get a reminder"
    // troubleshooting instead of every claimed row reading as 'sent'. ----
    if (action === 'update_status') {
      const { booking_id, kind, status, error } = event;
      if (!booking_id || !kind || !status) {
        return { ok: false, error: "update_status requires booking_id, kind and status" };
      }
      await client.query(
        `UPDATE notification_log
            SET status = $1, error = $2, sent_at = now()
          WHERE booking_id = $3 AND kind = $4`,
        [status, error || null, booking_id, kind]
      );
      audit("reminder_update_status", { booking_id, kind, status });
      return { ok: true };
    }

    return { ok: false, error: "unknown action: " + action };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    await client.end();
  }
};
