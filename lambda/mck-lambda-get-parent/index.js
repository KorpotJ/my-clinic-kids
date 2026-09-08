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
  audit(event, "read_parent_and_children", { child_id: (event.queryStringParameters||{}).child_id || null, course_id: (event.queryStringParameters||{}).course_id || null });

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
    // พิมพ์เช็คว่ามี Event วิ่งเข้ามาจริง และ Authorizer ส่ง lineUserId มาให้หรือไม่
    console.log("Received Authorizer Context:", event.requestContext?.authorizer);

    const lineUserId = event.requestContext?.authorizer?.lambda?.lineUserId;

    if (!lineUserId) {
      console.log("Error: No lineUserId found in context");
      return {
        statusCode: 401,
        headers, // เพิ่ม headers ป้องกัน CORS error
        body: JSON.stringify({ error: 'no identity in token' })
      };
    }

    console.log("Attempting to connect to Database...");
    await client.connect();
    console.log("Database connected successfully!");

    const parentResult = await client.query(
      `SELECT id, line_user_id, name, phone FROM parents WHERE line_user_id = $1`,
      [lineUserId]
    );

    if (parentResult.rows.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Parent not found" })
      };
    }

    const parent = parentResult.rows[0];

    const childrenResult = await client.query(
      `SELECT id,
              parent_id,
              nickname AS name,
              EXTRACT(YEAR FROM AGE(date_of_birth))::int AS age,
              assigned_therapist
       FROM children
       WHERE parent_id = $1
       ORDER BY id`,
      [parent.id]
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ parent, children: childrenResult.rows })
    };
  } catch (err) {
    // หัวใจสำคัญ: ตะโกน Error ออกมาให้เราเห็นใน Logs!
    console.error("🚨 INTERNAL SERVER ERROR CAUGHT:", err); 
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  } finally {
    await client.end();
  }
};