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


/* ── audit log: ใครเข้าถึงข้อมูลเด็กคนใด ──────────────────────────
   หลักการ: บันทึก "ตัวระบุ" เท่านั้น ไม่บันทึกเนื้อหาข้อมูล
   เพื่อไม่ให้บันทึกกลายเป็นสำเนาข้อมูลอ่อนไหวอีกชุดหนึ่ง        */
function audit(event, action, detail) {
  try {
    const rc = event.requestContext || {};
    const claims = rc.authorizer && rc.authorizer.jwt ? rc.authorizer.jwt.claims : null;
    const lineId = rc.authorizer && rc.authorizer.lambda ? rc.authorizer.lambda.lineUserId : null;
    const actor = (claims && claims.email) ? "staff:" + claims.email
                : lineId ? "parent:" + lineId
                : "unknown";
    console.log(JSON.stringify(Object.assign({
      audit: true,
      ts: new Date().toISOString(),
      actor: actor,
      action: action,
      path: (rc.http && rc.http.path) || event.rawPath || event.routeKey || null,
      method: (rc.http && rc.http.method) || null,
      ip: (rc.http && rc.http.sourceIp) || null,
      reqId: rc.requestId || null
    }, detail || {})));
  } catch (e) { console.log(JSON.stringify({ audit: true, action: action, error: "audit_failed" })); }
}

// Best-effort booking_id for the audit line ONLY — GET uses the query
// string, POST uses the body. Never used for anything but logging; the
// real identity check below never looks at this.
function auditBookingId(event) {
  const q = (event.queryStringParameters || {}).booking_id;
  if (q) return q;
  try { return JSON.parse(event.body || "{}").booking_id || null; }
  catch (e) { return null; }
}

exports.handler = async (event) => {
  audit(event, "read_or_write_clinical_notes", { booking_id: auditBookingId(event) });

  const creds = await getDbCredentials();
  const client = new Client({
    host: creds.host,
    port: creds.port,
    database: "babyplaytime",
    user: creds.username,
    password: creds.password,
    ssl: { rejectUnauthorized: true, ca: require('fs').readFileSync(__dirname + '/rds-ca.pem', 'utf8') }
  });

  const headers = { "Access-Control-Allow-Origin": "*" };
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";

  try {
    // Staff identity comes ONLY from the verified Cognito JWT authorizer
    // context (event.requestContext.authorizer.jwt.claims) — NEVER from
    // the request body. There's no staff_id/author field in the request
    // contract below on purpose; if one ever gets added, it must still be
    // ignored for identity purposes and re-derived from the token here.
    const claims = event.requestContext?.authorizer?.jwt?.claims;
    if (!claims) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "no staff identity in token" }) };
    }

    await client.connect();

    // ============ GET /admin/session-notes?booking_id=N ============
    // Fetches the note for one booking (e.g. to pre-fill an edit form).
    // 404 (not 200 + null) when there's no note yet, so the caller can
    // tell "no note written" apart from "booking_id malformed / db error".
    if (method === "GET") {
      const bookingId = Number((event.queryStringParameters || {}).booking_id);
      if (!Number.isFinite(bookingId)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "booking_id is required" }) };
      }

      const result = await client.query(
        `SELECT id, booking_id, clinical_note, parent_summary, created_at
           FROM session_notes
          WHERE booking_id = $1`,
        [bookingId]
      );

      if (result.rowCount === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: "NOT_FOUND" }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify(result.rows[0]) };
    }

    // ============ POST /admin/session-notes ============
    // Contract confirmed from Admin Setup/admin/js/30-modals.js (saveNote):
    //   body: { booking_id, clinical_note, parent_summary }
    //   success: 200 (updated an existing note) or 201 (created a new one)
    //            — the frontend already accepts either as success.
    //   failure: any other status, body { error: "..." }
    // There's one note per booking (the UI's "ดู/แก้" button always POSTs
    // here for the same booking_id), so this upserts by booking_id rather
    // than blindly inserting a second row on every re-save.
    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      const bookingId = Number(body.booking_id);
      if (!Number.isFinite(bookingId)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "booking_id is required" }) };
      }

      const clinicalRaw = typeof body.clinical_note === "string" ? body.clinical_note.trim() : "";
      const parentRaw = typeof body.parent_summary === "string" ? body.parent_summary.trim() : "";
      if (!clinicalRaw && !parentRaw) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "clinical_note or parent_summary is required" }) };
      }
      const clinicalNote = clinicalRaw || null;
      const parentSummary = parentRaw || null;

      const booking = await client.query('SELECT id FROM bookings WHERE id = $1', [bookingId]);
      if (booking.rowCount === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: "booking not found" }) };
      }

      const existing = await client.query(
        'SELECT id FROM session_notes WHERE booking_id = $1',
        [bookingId]
      );

      if (existing.rowCount > 0) {
        // COALESCE, not a bare overwrite: same "protected field" convention
        // used for children.parent_name in sessions-api. clinicalNote/
        // parentSummary are already normalized to null above when the
        // field was absent OR an explicitly-supplied empty string — so a
        // null here means "not supplied", and COALESCE leaves the existing
        // column value in place instead of erasing it. Posting only
        // clinical_note must not wipe out an existing parent_summary.
        const upd = await client.query(
          `UPDATE session_notes
              SET clinical_note = COALESCE($2, clinical_note),
                  parent_summary = COALESCE($3, parent_summary)
            WHERE booking_id = $1
          RETURNING id, booking_id, clinical_note, parent_summary, created_at`,
          [bookingId, clinicalNote, parentSummary]
        );
        return { statusCode: 200, headers, body: JSON.stringify(upd.rows[0]) };
      }

      const ins = await client.query(
        `INSERT INTO session_notes (booking_id, clinical_note, parent_summary)
         VALUES ($1, $2, $3)
         RETURNING id, booking_id, clinical_note, parent_summary, created_at`,
        [bookingId, clinicalNote, parentSummary]
      );
      return { statusCode: 201, headers, body: JSON.stringify(ins.rows[0]) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "method not allowed" }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  } finally {
    await client.end();
  }
};
