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

exports.handler = async (event) => {
  audit(event, "read_child_progress", { child_id: (event.queryStringParameters||{}).child_id || null, course_id: (event.queryStringParameters||{}).course_id || null });

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

    const lineUserId = event.requestContext?.authorizer?.lambda?.lineUserId;
    if (!lineUserId) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: "no identity in token" })
      };
    }

    if (!childId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing required query parameter: child_id" })
      };
    }

    await client.connect();

    // OWNERSHIP CHECK: the child must belong to the parent in the token.
    // Without this, any logged-in parent could read any child's progress notes.
    const owns = await client.query(
      `SELECT c.id
         FROM children c
         JOIN parents p ON p.id = c.parent_id
        WHERE c.id = $1 AND p.line_user_id = $2`,
      [childId, lineUserId]
    );

    if (owns.rowCount === 0) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: "forbidden" })
      };
    }

    // NOTE: clinical_note is deliberately NOT selected — parents only ever
    // see parent_summary.
    const result = await client.query(
      `SELECT
         bookings.id AS booking_id,
         sessions.starts_at AS booking_time,
         bookings.status,
         courses.name AS course_name,
         session_notes.parent_summary,
         session_notes.created_at AS note_created_at
       FROM bookings
       JOIN sessions ON sessions.id = bookings.session_id
       JOIN courses ON courses.id = sessions.course_id
       LEFT JOIN session_notes ON session_notes.booking_id = bookings.id
       WHERE bookings.child_id = $1
       ORDER BY sessions.starts_at DESC`,
      [childId]
    );

    return { statusCode: 200, headers, body: JSON.stringify(result.rows) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  } finally {
    await client.end();
  }
};