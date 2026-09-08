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

// Only one therapist for now (ครูขนุน, id 2). Revisit when a 2nd therapist joins.
const DEFAULT_THERAPIST_ID = 2;

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
    const { child_id, session_id, course_id, booking_time } = body;

    if (!child_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required field: child_id" }) };
    }

    // Identity comes ONLY from the verified LINE token.
    const lineUserId = event.requestContext?.authorizer?.lambda?.lineUserId;
    if (!lineUserId) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "no identity in token" }) };
    }

    await client.connect();

    // OWNERSHIP: the child must belong to the parent identified by the token.
    // Guards BOTH booking paths below — a parent can only book for their own child.
    const owns = await client.query(
      `SELECT c.id FROM children c
         JOIN parents p ON p.id = c.parent_id
        WHERE c.id = $1 AND p.line_user_id = $2`,
      [child_id, lineUserId]
    );
    if (owns.rowCount === 0) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: "forbidden" }) };
    }

    // ================= GROUP PATH: join an existing session =================
    if (session_id) {
      try {
        await client.query('BEGIN');

        // Atomic seat claim: only succeeds if the session is open AND has room.
        const claim = await client.query(
          `UPDATE sessions
             SET seats_taken = seats_taken + 1
           WHERE id = $1
             AND status IN ('scheduled','confirmed')
             AND seats_taken < capacity
           RETURNING id, capacity, seats_taken`,
          [session_id]
        );

        if (claim.rowCount === 0) {
          await client.query('ROLLBACK');
          const info = await client.query(
            'SELECT capacity, seats_taken FROM sessions WHERE id = $1',
            [session_id]
          );
          const seatsLeft = info.rowCount
            ? Math.max(0, info.rows[0].capacity - info.rows[0].seats_taken)
            : 0;
          return { statusCode: 409, headers, body: JSON.stringify({ error: "SESSION_FULL", seats_left: seatsLeft }) };
        }

        // Group joins auto-confirm (the atomic claim is the guarantee).
        const ins = await client.query(
          `INSERT INTO bookings (child_id, session_id, status)
           VALUES ($1, $2, 'confirmed')
           RETURNING *`,
          [child_id, session_id]
        );

        await client.query('COMMIT');
        return { statusCode: 201, headers, body: JSON.stringify(ins.rows[0]) };
      } catch (e) {
        await client.query('ROLLBACK');
        if (e.code === '23505') {
          // uniq_child_per_session → this child is already in this session
          return { statusCode: 409, headers, body: JSON.stringify({ error: "ALREADY_BOOKED" }) };
        }
        throw e;
      }
    }

    // ============= INDIVIDUAL PATH: create session + booking =============
    if (course_id && booking_time) {
      try {
        await client.query('BEGIN');

        // capacity-1 session, default therapist. Duplicate therapist/time
        // trips uniq_therapist_slot → caught below as 409 SLOT_TAKEN.
        const sess = await client.query(
          `INSERT INTO sessions (course_id, therapist_id, starts_at, capacity, seats_taken, status)
           VALUES ($1, $2, $3, 1, 1, 'scheduled')
           RETURNING id`,
          [course_id, DEFAULT_THERAPIST_ID, booking_time]
        );
        const sessionId = sess.rows[0].id;

        const ins = await client.query(
          `INSERT INTO bookings (child_id, session_id, status)
           VALUES ($1, $2, 'pending')
           RETURNING *`,
          [child_id, sessionId]
        );

        await client.query('COMMIT');
        return { statusCode: 201, headers, body: JSON.stringify(ins.rows[0]) };
      } catch (e) {
        await client.query('ROLLBACK');
        if ((e.code === '23505' && e.constraint === 'uniq_therapist_slot') ||
            (e.code === '23P01' && e.constraint === 'excl_therapist_overlap')) {
          return { statusCode: 409, headers, body: JSON.stringify({ error: "SLOT_TAKEN" }) };
        }
        throw e;
      }
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Provide session_id (group) OR course_id + booking_time (individual)" })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  } finally {
    await client.end();
  }
};