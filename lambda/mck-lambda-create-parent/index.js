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

exports.handler = async (event) => {
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
    // Identity comes ONLY from the verified LINE token, never the client body.
    const {
      parent_name, parent_phone,
      first_name, last_name, nickname,
      gender, date_of_birth, medical_alerts
    } = body;

    const lineUserId = event.requestContext?.authorizer?.lambda?.lineUserId;
    if (!lineUserId) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "no identity in token" }) };
    }

    if (!parent_name || !parent_phone || !first_name || !last_name || !nickname || !date_of_birth) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing required fields: parent_name, parent_phone, first_name, last_name, nickname, date_of_birth" })
      };
    }

    const phoneRegex = /^0\d{9}$/;
    if (!phoneRegex.test(parent_phone)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid phone number format. Must be 10 digits starting with 0." }) };
    }

    const dob = new Date(date_of_birth);
    if (isNaN(dob.getTime()) || dob > new Date()) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid date_of_birth" }) };
    }

    await client.connect();

    const existing = await client.query(
      `SELECT id FROM parents WHERE line_user_id = $1`,
      [lineUserId]
    );
    if (existing.rows.length > 0) {
      return { statusCode: 409, headers, body: JSON.stringify({ error: "Parent already registered with this line_user_id" }) };
    }

    // Parent + first child in one transaction: if the child insert fails,
    // the parent row rolls back too, so a retry isn't blocked by the 409 guard.
    await client.query('BEGIN');
    try {
      const parentResult = await client.query(
        `INSERT INTO parents (line_user_id, name, phone)
         VALUES ($1, $2, $3)
         RETURNING id, line_user_id, name, phone`,
        [lineUserId, parent_name, parent_phone]
      );
      const parent = parentResult.rows[0];

      const childResult = await client.query(
        `INSERT INTO children
           (parent_id, first_name, last_name, nickname, gender, date_of_birth, medical_alerts, assigned_therapist)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
         RETURNING id, parent_id, first_name, last_name, nickname,
                   nickname AS name,
                   EXTRACT(YEAR FROM AGE(date_of_birth))::int AS age,
                   gender, date_of_birth, medical_alerts, assigned_therapist`,
        [
          parent.id,
          String(first_name).trim(),
          String(last_name).trim(),
          String(nickname).trim(),
          gender || null,
          date_of_birth,
          medical_alerts || null
        ]
      );
      const child = childResult.rows[0];

      await client.query('COMMIT');
      return { statusCode: 201, headers, body: JSON.stringify({ parent, child }) };
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    }
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  } finally {
    await client.end();
  }
};