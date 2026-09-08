/**
 * NOTE: babyplaytime-get-courses is a full COURSE MANAGEMENT function.
 * Despite the name, it handles reads, creation, and deletion/archiving:
 *
 *   GET    /courses                        → parent app (LINE auth) — active only
 *   GET    /admin/courses                  → staff panel (Cognito)  — active only
 *   GET    /admin/courses?archived=1       → คลัง        — ClinicDirector ONLY
 *   POST   /admin/courses                  → create      — Director + Admin
 *   POST   /admin/courses {action:restore} → กู้คืน       — ClinicDirector ONLY
 *   DELETE /admin/courses?id=N             → archive     — Director + Admin
 *   DELETE /admin/courses?id=N&permanent=1 → ลบถาวร (only if no sessions,
 *                                            409 HAS_HISTORY otherwise)
 *                                                        — ClinicDirector ONLY
 *
 * The name is historical. Lambda has no rename, and renaming would mean
 * re-pointing 4 working API Gateway route integrations — deliberately left as-is.
 *
 * Role checks read event.requestContext.authorizer.jwt.claims['cognito:groups'].
 * This is the REAL enforcement; the admin panel's hidden buttons are only UX.
 *
 * Requires: VPC (reaches RDS) + 30s timeout.
 */

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

// Separation of duties: Admin runs day-to-day course management, but only the
// ClinicDirector may enter the archive, restore, or permanently destroy data.
const MANAGE_ROLES  = ["ClinicDirector", "Admin"];   // create + archive
const DIRECTOR_ONLY = ["ClinicDirector"];            // คลัง, restore, ลบถาวร

// Caller's Cognito groups from the verified JWT authorizer claims.
// May arrive as a real array OR a bracketed string like "[ClinicDirector]".
function callerGroups(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims || {};
  let g = claims["cognito:groups"];
  if (!g) return [];
  if (Array.isArray(g)) return g;
  const s = String(g).trim().replace(/^\[/, "").replace(/\]$/, "");
  return s.split(/[\s,]+/).filter(Boolean);
}
function canManage(groups)  { return groups.some(r => MANAGE_ROLES.includes(r)); }
function isDirector(groups) { return groups.some(r => DIRECTOR_ONLY.includes(r)); }

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
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";

  try {
    await client.connect();

    // ============ POST /admin/courses : create a course (top roles only) ============
    if (method === "POST") {
      const groups = callerGroups(event);
      if (!canManage(groups)) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: "forbidden: requires ClinicDirector or Admin" }) };
      }

      const body = JSON.parse(event.body || "{}");

      // --- restore a course from the archive (คลัง) — DIRECTOR ONLY ---
      if (body.action === "restore") {
        if (!isDirector(groups)) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: "DIRECTOR_ONLY" }) };
        }
        const rid = Number(body.id);
        if (!Number.isFinite(rid)) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "id is required" }) };
        }
        const r = await client.query(
          'UPDATE courses SET is_active = true WHERE id = $1 RETURNING id, name',
          [rid]
        );
        if (r.rowCount === 0) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: "course not found" }) };
        }
        return { statusCode: 200, headers, body: JSON.stringify({ action: "restored", ...r.rows[0] }) };
      }

      let {
        name, description, min_age, max_age,
        duration_minutes, price, session_type, capacity, min_participants
      } = body;

      if (!name || !String(name).trim()) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "name is required" }) };
      }
      session_type = session_type === "group" ? "group" : "individual";

      const isGroup = session_type === "group";
      duration_minutes = Number(duration_minutes) || (isGroup ? 120 : 60);
      capacity         = isGroup ? (Number(capacity) || 4) : 1;
      min_participants = isGroup ? (Number(min_participants) || 2) : 1;
      min_age  = Number(min_age);
      max_age  = Number(max_age);
      price    = Number(price);

      if (!Number.isFinite(min_age) || !Number.isFinite(max_age) || min_age < 0 || max_age < min_age) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "invalid age range" }) };
      }
      if (!Number.isFinite(price) || price < 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "invalid price" }) };
      }
      if (isGroup && capacity < 2) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "group capacity must be at least 2" }) };
      }

      const result = await client.query(
        `INSERT INTO courses
           (name, description, min_age, max_age, duration_minutes, price,
            session_type, capacity, min_participants)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, name, description, min_age, max_age, duration_minutes,
                   price, session_type, capacity, min_participants, is_active`,
        [String(name).trim(), description || null, min_age, max_age,
         duration_minutes, price, session_type, capacity, min_participants]
      );

      return { statusCode: 201, headers, body: JSON.stringify(result.rows[0]) };
    }

    // ====== DELETE /admin/courses?id=N : delete if unused, else archive ======
    if (method === "DELETE") {
      const groups = callerGroups(event);
      if (!canManage(groups)) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: "forbidden: requires ClinicDirector or Admin" }) };
      }

      const id = Number((event.queryStringParameters || {}).id);
      if (!Number.isFinite(id)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "id is required" }) };
      }

      const permanent = String((event.queryStringParameters || {}).permanent || "") === "1";
      // Permanent deletion is irreversible — ClinicDirector only.
      if (permanent && !isDirector(groups)) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: "DIRECTOR_ONLY" }) };
      }

      const exists = await client.query('SELECT id, name FROM courses WHERE id = $1', [id]);
      if (exists.rowCount === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: "course not found" }) };
      }
      const courseName = exists.rows[0].name;

      if (permanent) {
        // Hard delete is only allowed when NOTHING references the course.
        // Sessions carry real children's bookings and clinical notes — that
        // history must never be destroyed by a course cleanup.
        const used = await client.query(
          'SELECT COUNT(*)::int AS n FROM sessions WHERE course_id = $1', [id]
        );
        const sessionCount = used.rows[0].n;
        if (sessionCount > 0) {
          return {
            statusCode: 409, headers,
            body: JSON.stringify({ error: "HAS_HISTORY", sessions: sessionCount, name: courseName })
          };
        }
        await client.query('DELETE FROM courses WHERE id = $1', [id]);
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ action: "deleted", id, name: courseName })
        };
      }

      // Default: archive (ย้ายไปในคลัง) — hidden from parents, history intact.
      await client.query('UPDATE courses SET is_active = false WHERE id = $1', [id]);
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ action: "archived", id, name: courseName })
      };
    }

    // ============ GET /courses (parent) and GET /admin/courses (staff) ============
    // Archived courses are hidden from both — existing bookings keep working.
    // ?archived=1 lists the คลัง (staff panel only); default is active courses.
    const wantArchived = String((event.queryStringParameters || {}).archived || "") === "1";
    // The คลัง is ClinicDirector-only. (Plain GET stays open to parents/staff.)
    if (wantArchived && !isDirector(callerGroups(event))) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: "DIRECTOR_ONLY" }) };
    }
    const result = await client.query(
      `SELECT id, name, description, min_age, max_age, duration_minutes, price,
              session_type, capacity, min_participants, is_active
       FROM courses
       WHERE is_active = $1
       ORDER BY min_age ASC`,
      [!wantArchived]
    );

    return { statusCode: 200, headers, body: JSON.stringify(result.rows) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  } finally {
    await client.end();
  }
};