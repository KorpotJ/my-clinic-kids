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
  audit(event, "create_child_record", { child_id: (event.queryStringParameters||{}).child_id || null, course_id: (event.queryStringParameters||{}).course_id || null });

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
    const body = JSON.parse(event.body || "{}");
    // parent_id is derived from the verified LINE token, never the client body.
    const {
      first_name, last_name, nickname,
      gender, date_of_birth, medical_alerts
    } = body;

    const lineUserId = event.requestContext?.authorizer?.lambda?.lineUserId;
    if (!lineUserId) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "no identity in token" }) };
    }

    if (!first_name || !last_name || !nickname || !date_of_birth) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing required fields: first_name, last_name, nickname, date_of_birth" })
      };
    }

    const dob = new Date(date_of_birth);
    if (isNaN(dob.getTime()) || dob > new Date()) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid date_of_birth" }) };
    }

    await client.connect();

    const parentCheck = await client.query(
      `SELECT id FROM parents WHERE line_user_id = $1`,
      [lineUserId]
    );
    if (parentCheck.rows.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Parent not found" }) };
    }
    const parentId = parentCheck.rows[0].id;

    const childResult = await client.query(
      `INSERT INTO children
         (parent_id, first_name, last_name, nickname, gender, date_of_birth, medical_alerts, assigned_therapist)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
       RETURNING id, parent_id, first_name, last_name, nickname,
                 nickname AS name,
                 EXTRACT(YEAR FROM AGE(date_of_birth))::int AS age,
                 gender, date_of_birth, medical_alerts, assigned_therapist`,
      [
        parentId,
        String(first_name).trim(),
        String(last_name).trim(),
        String(nickname).trim(),
        gender || null,
        date_of_birth,
        medical_alerts || null
      ]
    );

    return { statusCode: 201, headers, body: JSON.stringify(childResult.rows[0]) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  } finally {
    await client.end();
  }
};