// GET /bookings — parent-facing, two modes selected by query params:
//   ?child_id=  → MODE 1: that child's own bookings, full course/therapist detail
//                 (ownership enforced against the caller's LINE identity).
//   ?date=      → MODE 2: availability for a calendar day. Returns one row per
//                 session for DEFAULT_THERAPIST_ID on that date — booking_time,
//                 therapist_id, and duration_minutes — so the caller can compute
//                 each session's [booking_time, booking_time + duration_minutes)
//                 occupied window instead of only matching exact start times.
//                 No child identities, no other families' data.
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

// Must match create-bookings' DEFAULT_THERAPIST_ID — see MODE 2 comment
// below for why the availability check has to filter on this same value.
const DEFAULT_THERAPIST_ID = 2;


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

exports.handler = async (event) => {
  audit(event, "read_child_bookings", { child_id: (event.queryStringParameters||{}).child_id || null, course_id: (event.queryStringParameters||{}).course_id || null });

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

  try {
    const childId = event.queryStringParameters?.child_id;
    const date = event.queryStringParameters?.date;

    const lineUserId = event.requestContext?.authorizer?.lambda?.lineUserId;
    if (!lineUserId) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: "no identity in token" })
      };
    }

    await client.connect();

    // --- MODE 1: a child's bookings (OWNERSHIP ENFORCED) ---
    if (childId) {
      // The child must belong to the parent identified by the token.
      const owns = await client.query(
        `SELECT c.id
           FROM children c
           JOIN parents p ON p.id = c.parent_id
          WHERE c.id = $1 AND p.line_user_id = $2`,
        [childId, lineUserId]
      );

      if (owns.rowCount === 0) {
        // Not your child (or doesn't exist) — identical response either way,
        // so this can't be used to probe which child IDs exist.
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ error: "forbidden" })
        };
      }

      const result = await client.query(
        `SELECT b.id,
                b.status,
                s.starts_at,
                s.starts_at AS booking_time,
                s.seats_taken,
                s.capacity,
                c.id   AS course_id,
                c.name AS course_name,
                c.duration_minutes,
                c.price,
                c.session_type,
                t.name     AS therapist_name,
                t.nickname AS therapist_nickname
         FROM bookings b
         JOIN sessions   s ON s.id = b.session_id
         JOIN courses    c ON c.id = s.course_id
         JOIN therapists t ON t.id = s.therapist_id
         WHERE b.child_id = $1
         ORDER BY s.starts_at DESC`,
        [childId]
      );
      return { statusCode: 200, headers, body: JSON.stringify(result.rows) };
    }

    // --- MODE 2: availability for a date (calendar) ---
    // Returns ONLY taken slot times. No child identities, no other families' data.
    //
    // Filters on DEFAULT_THERAPIST_ID (confirmed against create-bookings'
    // own DEFAULT_THERAPIST_ID = 2, ครูขนุน — the therapist every individual
    // booking is actually created against). This is correct ONLY because
    // parents currently have no way to choose a therapist: every booking
    // this endpoint needs to protect against double-booking lands on the
    // same therapist. It stops being correct the moment either (a) booking
    // gains therapist choice, or (b) staff schedules group sessions for a
    // second therapist whose slots also need to show as taken — at that
    // point this needs to become "join therapists, filter to active ones"
    // instead of a single hardcoded id. `therapist_id` is kept in the
    // response (additive, safe either way) so the frontend already has
    // what it needs once this filter is eventually broadened again.
    // NOT changing that filter here — the overlap-window check below only
    // ever sees DEFAULT_THERAPIST_ID's own sessions, so it protects against
    // double-booking that one therapist and nothing else.
    if (date) {
      const result = await client.query(
        `SELECT s.starts_at AS booking_time, s.therapist_id, co.duration_minutes
         FROM sessions s
         JOIN courses co ON co.id = s.course_id
         WHERE (s.starts_at AT TIME ZONE 'Asia/Bangkok')::date = $1::date
           AND s.status <> 'cancelled'
           AND s.therapist_id = $2`,
        [date, DEFAULT_THERAPIST_ID]
      );
      return { statusCode: 200, headers, body: JSON.stringify(result.rows) };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Missing required query parameter: child_id or date" })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  } finally {
    await client.end();
  }
};
