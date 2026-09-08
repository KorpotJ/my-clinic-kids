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

// Only the ClinicDirector may permanently destroy a session.
function callerGroups(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims || {};
  let g = claims["cognito:groups"];
  if (!g) return [];
  if (Array.isArray(g)) return g;
  const s = String(g).trim().replace(/^\[/, "").replace(/\]$/, "");
  return s.split(/[\s,]+/).filter(Boolean);
}
function isDirector(event) { return callerGroups(event).includes("ClinicDirector"); }
// Edit / archive of children is restricted to Admin + ClinicDirector.
function canManage(event) {
  const g = callerGroups(event);
  return g.includes("ClinicDirector") || g.includes("Admin");
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
  audit(event, "admin_data_access", { child_id: (event.queryStringParameters||{}).child_id || null, course_id: (event.queryStringParameters||{}).course_id || null });

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
  const method = event.requestContext?.http?.method || event.httpMethod;
  const path   = event.requestContext?.http?.path   || event.rawPath || "";
  const isAdmin = path.includes("/admin/");   // /admin/sessions vs /sessions

  try {
    await client.connect();

    // ============ GET /bookings/pending : staff approval queue ============
    // Individual bookings are created as 'pending' and wait for staff approval.
    // (Group joins auto-confirm — the atomic seat claim is the guarantee.)
    if (method === "GET" && path.includes("/bookings/pending")) {
      const result = await client.query(
        `SELECT b.id            AS booking_id,
                b.status        AS booking_status,
                b.created_at,
                s.id            AS session_id,
                s.starts_at,
                s.capacity,
                s.seats_taken,
                co.name         AS course_name,
                co.duration_minutes,
                co.session_type,
                co.price,
                ch.id           AS child_id,
                ch.first_name   AS child_first_name,
                ch.last_name    AS child_last_name,
                ch.nickname     AS child_nickname,
                EXTRACT(YEAR FROM AGE(ch.date_of_birth))::int AS child_age,
                p.name          AS parent_name,
                p.phone         AS parent_phone,
                t.nickname      AS therapist_nickname
         FROM bookings b
         JOIN sessions   s  ON s.id  = b.session_id
         JOIN courses    co ON co.id = s.course_id
         JOIN children   ch ON ch.id = b.child_id
         JOIN parents    p  ON p.id  = ch.parent_id
         JOIN therapists t  ON t.id  = s.therapist_id
         WHERE b.status = 'pending'
           AND s.status <> 'cancelled'
         ORDER BY s.starts_at`
      );
      return { statusCode: 200, headers, body: JSON.stringify(result.rows) };
    }

    // ============ PUT /bookings/{id}/approve : confirm a booking ============
    if (method === "PUT" && path.includes("/approve")) {
      const bookingId = Number(
        event.pathParameters?.id ?? (path.match(/\/bookings\/(\d+)\/approve/) || [])[1]
      );
      if (!Number.isFinite(bookingId)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "booking id is required" }) };
      }

      // Only a pending booking on a live session can be approved.
      const r = await client.query(
        `UPDATE bookings b
            SET status = 'confirmed'
          FROM sessions s
          WHERE b.id = $1
            AND b.session_id = s.id
            AND b.status = 'pending'
            AND s.status <> 'cancelled'
          RETURNING b.id, b.status, b.session_id, b.child_id`,
        [bookingId]
      );
      if (r.rowCount === 0) {
        return {
          statusCode: 409, headers,
          body: JSON.stringify({ error: "NOT_PENDING", detail: "booking is not pending, or its session was cancelled" })
        };
      }

      // Move the session out of 'scheduled' once someone is confirmed in it.
      await client.query(
        `UPDATE sessions SET status = 'confirmed'
          WHERE id = $1 AND status = 'scheduled'`,
        [r.rows[0].session_id]
      );

      return { statusCode: 200, headers, body: JSON.stringify({ action: "approved", ...r.rows[0] }) };
    }

    // ============ POST /admin/sessions ============
    // Two modes:
    //   { session_id, child_id }                  → add a child to an EXISTING session
    //                                               (this is how group sessions get filled)
    //   { course_id, therapist_id, starts_at, .. } → create a new session,
    //                                               optionally booking child_id at once
    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { course_id, therapist_id, starts_at, child_id, session_id } = body;
      let { capacity, status } = body;

      // ============ POST /admin/parents : create OFFLINE parent (no LINE id) ============
      // Admin-created records for paper migration / phone + chat bookings.
      // line_user_id stays NULL — that is the signal for "offline / not yet on LINE".
      if (path.includes("/admin/parents")) {
        // Creating parent records is Admin + ClinicDirector only.
        if (!canManage(event)) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: "forbidden: requires Admin or ClinicDirector" }) };
        }
        const action = body.action || "create";
        const name  = (body.name  && String(body.name).trim())  ? String(body.name).trim()  : null;
        const phone = (body.phone && String(body.phone).trim()) ? String(body.phone).trim() : null;
        const parent2_name  = (body.parent2_name  && String(body.parent2_name).trim())  ? String(body.parent2_name).trim()  : null;
        const parent2_phone = (body.parent2_phone && String(body.parent2_phone).trim()) ? String(body.parent2_phone).trim() : null;
        const force = body.force === true;   // "save as new anyway" after duplicate warning

        // ----- lifecycle: archive / restore / permanent delete (id-based; no name needed) -----
        if (action === "archive" || action === "restore" || action === "delete") {
          const pid = Number(body.id);
          if (!pid) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "id is required" }) };
          }

          if (action === "restore") {
            const r = await client.query(
              'UPDATE parents SET is_active = true WHERE id = $1 RETURNING id, name',
              [pid]
            );
            if (r.rowCount === 0) return { statusCode: 404, headers, body: JSON.stringify({ error: "parent not found" }) };
            return { statusCode: 200, headers, body: JSON.stringify({ action: "restore", ...r.rows[0] }) };
          }

          if (action === "archive") {
            // Block if the parent still has ACTIVE children — the children must be archived first.
            const kids = await client.query(
              'SELECT COUNT(*)::int AS n FROM children WHERE parent_id = $1 AND is_active = true',
              [pid]
            );
            if (kids.rows[0].n > 0) {
              return { statusCode: 409, headers, body: JSON.stringify({ error: "HAS_ACTIVE_CHILDREN", children: kids.rows[0].n }) };
            }
            // line_user_id is left untouched: a LINE-linked parent keeps app access while archived.
            const r = await client.query(
              'UPDATE parents SET is_active = false WHERE id = $1 RETURNING id, name',
              [pid]
            );
            if (r.rowCount === 0) return { statusCode: 404, headers, body: JSON.stringify({ error: "parent not found" }) };
            return { statusCode: 200, headers, body: JSON.stringify({ action: "archive", ...r.rows[0] }) };
          }

          // action === "delete": permanent, Director only, blocked while ANY children remain.
          if (!isDirector(event)) {
            return { statusCode: 403, headers, body: JSON.stringify({ error: "DIRECTOR_ONLY" }) };
          }
          const kids = await client.query(
            'SELECT COUNT(*)::int AS n FROM children WHERE parent_id = $1', [pid]
          );
          if (kids.rows[0].n > 0) {
            // Children (active or archived) must be removed first. Children with booking
            // history can't be hard-deleted, so treatment records stay protected transitively.
            return { statusCode: 409, headers, body: JSON.stringify({ error: "HAS_CHILDREN", children: kids.rows[0].n }) };
          }
          const r = await client.query('DELETE FROM parents WHERE id = $1 RETURNING id, name', [pid]);
          if (r.rowCount === 0) return { statusCode: 404, headers, body: JSON.stringify({ error: "parent not found" }) };
          return { statusCode: 200, headers, body: JSON.stringify({ action: "deleted", ...r.rows[0] }) };
        }

        if (!name) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "name is required" }) };
        }

        // ----- UPDATE an existing parent record (offline or registered) -----
        if (action === "update") {
          const pid = Number(body.id);
          if (!pid) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "id is required for update" }) };
          }
          // name is protected (never blanked); phone + 2nd guardian are erasable.
          const r = await client.query(
            `UPDATE parents
                SET name          = COALESCE($2, name),
                    phone         = $3,
                    parent2_name  = $4,
                    parent2_phone = $5
              WHERE id = $1
              RETURNING id, name, phone, parent2_name, parent2_phone, line_user_id`,
            [pid, name, phone, parent2_name, parent2_phone]
          );
          if (r.rowCount === 0) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: "parent not found" }) };
          }
          return { statusCode: 200, headers, body: JSON.stringify(r.rows[0]) };
        }

        // Duplicate-guard: unless force=true, look for likely existing parents by
        // exact name OR matching phone. Return them so the admin can decide.
        if (!force) {
          const dup = await client.query(
            `SELECT id, name, phone, line_user_id,
                    (line_user_id IS NULL) AS is_offline,
                    (SELECT COUNT(*)::int FROM children c WHERE c.parent_id = p.id) AS child_count
               FROM parents p
              WHERE lower(trim(name)) = lower($1)
                 OR ($2 <> '' AND regexp_replace(COALESCE(phone,''),'[^0-9]','','g') = regexp_replace($2,'[^0-9]','','g'))
              ORDER BY id`,
            [name, phone || '']
          );
          if (dup.rowCount > 0) {
            return {
              statusCode: 409,
              headers,
              body: JSON.stringify({ error: "POSSIBLE_DUPLICATE", matches: dup.rows })
            };
          }
        }

        const ins = await client.query(
          `INSERT INTO parents (line_user_id, name, phone, parent2_name, parent2_phone)
           VALUES (NULL, $1, $2, $3, $4)
           RETURNING id, name, phone, parent2_name, parent2_phone, line_user_id`,
          [name, phone, parent2_name, parent2_phone]
        );
        return { statusCode: 201, headers, body: JSON.stringify(ins.rows[0]) };
      }

      // ============ POST /admin/children : manage children ============
      // action: create | update | archive | restore | delete
      if (path.includes("/admin/children")) {
        const action = body.action || "create";

        // Creating is open to all staff; changing/removing is Admin+Director.
        if (action !== "create" && !canManage(event)) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: "forbidden: requires Admin or ClinicDirector" }) };
        }

        if (action === "create") {
          const {
            parent_id, first_name, last_name, nickname,
            gender, date_of_birth, medical_alerts,
            chief_concern, medical_diagnosis, previous_therapy, treatment_goals,
            assigned_therapist
          } = body;
          // nickname is NOT NULL in the schema - reject early with a clear
          // message instead of letting Postgres raise a constraint violation.
          if (!parent_id || !first_name || !nickname) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "parent_id, first_name and nickname are required" }) };
          }
          const p = await client.query('SELECT id FROM parents WHERE id = $1', [parent_id]);
          if (p.rowCount === 0) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "parent_id not found" }) };
          }
          const r = await client.query(
            `INSERT INTO children
               (parent_id, first_name, last_name, nickname,
                gender, date_of_birth, medical_alerts,
                chief_concern, medical_diagnosis, previous_therapy, treatment_goals,
                assigned_therapist)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             RETURNING id, parent_id, first_name, last_name, nickname,
                       gender, date_of_birth, medical_alerts,
                       chief_concern, medical_diagnosis, previous_therapy, treatment_goals,
                       assigned_therapist, is_active`,
            [
              parent_id,
              String(first_name).trim(),
              last_name ? String(last_name).trim() : null,
              String(nickname).trim(),
              gender || null,
              date_of_birth || null,
              medical_alerts || null,
              chief_concern || null,
              medical_diagnosis || null,
              previous_therapy || null,
              treatment_goals || null,
              assigned_therapist || null
            ]
          );
          return { statusCode: 201, headers, body: JSON.stringify(r.rows[0]) };
        }

        const cid = Number(body.id);
        if (!Number.isFinite(cid)) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "id is required" }) };
        }

        if (action === "update") {
          const {
            first_name, last_name, nickname, date_of_birth,        // protected (child)
            gender, medical_alerts,                                // erasable (child)
            chief_concern, medical_diagnosis, previous_therapy, treatment_goals, // erasable (child)
            assigned_therapist,                                    // erasable (child)
            parent_name, parent_phone,                             // parent record
            parent2_name, parent2_phone                            // parent record (2nd guardian)
          } = body;

          // Update the shared parent record alongside the child.
          // parent_name is PROTECTED (blank never overwrites); phone + 2nd guardian are ERASABLE.
          const touchesParent =
            parent_name !== undefined || parent_phone !== undefined ||
            parent2_name !== undefined || parent2_phone !== undefined;
          if (touchesParent) {
            await client.query(
              `UPDATE parents
                  SET name          = COALESCE($2, name),
                      phone         = $3,
                      parent2_name  = $4,
                      parent2_phone = $5
                WHERE id = (SELECT parent_id FROM children WHERE id = $1)`,
              [
                cid,
                // protected: trim then null-if-empty so COALESCE keeps old value on blank
                (parent_name && String(parent_name).trim()) ? String(parent_name).trim() : null,
                // erasable: write exactly what came in (empty -> null)
                (parent_phone  && String(parent_phone).trim())  ? String(parent_phone).trim()  : null,
                (parent2_name  && String(parent2_name).trim())  ? String(parent2_name).trim()  : null,
                (parent2_phone && String(parent2_phone).trim()) ? String(parent2_phone).trim() : null
              ]
            );
          }

          const r = await client.query(
            `UPDATE children
                SET first_name         = COALESCE($2,  first_name),
                    last_name          = COALESCE($3,  last_name),
                    nickname           = COALESCE($4,  nickname),
                    date_of_birth      = COALESCE($5,  date_of_birth),
                    gender             = $6,
                    medical_alerts     = $7,
                    chief_concern      = $8,
                    medical_diagnosis  = $9,
                    previous_therapy   = $10,
                    treatment_goals    = $11,
                    assigned_therapist = $12
              WHERE id = $1
              RETURNING id, parent_id, first_name, last_name, nickname,
                        gender, date_of_birth, medical_alerts,
                        chief_concern, medical_diagnosis, previous_therapy, treatment_goals,
                        assigned_therapist, is_active`,
            [
              cid,
              // PROTECTED: null on blank/absent -> COALESCE keeps existing value
              (first_name    && String(first_name).trim())    ? String(first_name).trim()    : null,
              (last_name     && String(last_name).trim())     ? String(last_name).trim()     : null,
              (nickname      && String(nickname).trim())      ? String(nickname).trim()      : null,
              (date_of_birth && String(date_of_birth).trim()) ? String(date_of_birth).trim() : null,
              // ERASABLE: write exactly what arrived (empty string -> null), direct assign
              (gender            !== undefined && gender            !== null && String(gender).trim()            !== "") ? String(gender).trim()            : null,
              (medical_alerts    !== undefined && medical_alerts    !== null && String(medical_alerts).trim()    !== "") ? String(medical_alerts).trim()    : null,
              (chief_concern     !== undefined && chief_concern     !== null && String(chief_concern).trim()     !== "") ? String(chief_concern).trim()     : null,
              (medical_diagnosis !== undefined && medical_diagnosis !== null && String(medical_diagnosis).trim() !== "") ? String(medical_diagnosis).trim() : null,
              (previous_therapy  !== undefined && previous_therapy  !== null && String(previous_therapy).trim()  !== "") ? String(previous_therapy).trim()  : null,
              (treatment_goals   !== undefined && treatment_goals   !== null && String(treatment_goals).trim()   !== "") ? String(treatment_goals).trim()   : null,
              (assigned_therapist !== undefined && assigned_therapist !== null && String(assigned_therapist).trim() !== "") ? String(assigned_therapist).trim() : null
            ]
          );
          if (r.rowCount === 0) return { statusCode: 404, headers, body: JSON.stringify({ error: "child not found" }) };

          // Return the child plus the (possibly updated) parent fields so the UI can refresh in place.
          const pr = await client.query(
            `SELECT name AS parent_name, phone AS parent_phone, parent2_name, parent2_phone
               FROM parents WHERE id = $1`,
            [r.rows[0].parent_id]
          );
          const out = Object.assign({}, r.rows[0], pr.rows[0] || {});
          return { statusCode: 200, headers, body: JSON.stringify(out) };
        }

        if (action === "archive" || action === "restore") {
          const active = action === "restore";
          const r = await client.query(
            'UPDATE children SET is_active = $2 WHERE id = $1 RETURNING id, nickname AS name',
            [cid, active]
          );
          if (r.rowCount === 0) return { statusCode: 404, headers, body: JSON.stringify({ error: "child not found" }) };
          return { statusCode: 200, headers, body: JSON.stringify({ action, ...r.rows[0] }) };
        }

        if (action === "delete") {
          // Hard delete only for a child with NO history, and only the Director.
          // Anything with bookings must be archived so therapy records survive.
          if (!isDirector(event)) {
            return { statusCode: 403, headers, body: JSON.stringify({ error: "DIRECTOR_ONLY" }) };
          }
          const used = await client.query(
            'SELECT COUNT(*)::int AS n FROM bookings WHERE child_id = $1', [cid]
          );
          if (used.rows[0].n > 0) {
            return { statusCode: 409, headers, body: JSON.stringify({ error: "HAS_HISTORY", bookings: used.rows[0].n }) };
          }
          const r = await client.query('DELETE FROM children WHERE id = $1 RETURNING id, nickname AS name', [cid]);
          if (r.rowCount === 0) return { statusCode: 404, headers, body: JSON.stringify({ error: "child not found" }) };
          return { statusCode: 200, headers, body: JSON.stringify({ action: "deleted", ...r.rows[0] }) };
        }

        return { statusCode: 400, headers, body: JSON.stringify({ error: "unknown action" }) };
      }

      // ---- MODE 0: restore a cancelled session (กู้คืน) ----
      if (body.action === "restore" && body.session_id) {
        const sid = Number(body.session_id);
        try {
          await client.query('BEGIN');
          const r = await client.query(
            `UPDATE sessions SET status = 'scheduled'
              WHERE id = $1 AND status = 'cancelled' RETURNING id`, [sid]
          );
          if (r.rowCount === 0) {
            await client.query('ROLLBACK');
            return { statusCode: 404, headers, body: JSON.stringify({ error: "session not found or not cancelled" }) };
          }
          // Bring back only the bookings that WE cancelled with the session.
          await client.query(
            `UPDATE bookings
                SET status = 'confirmed', cancelled_at = NULL, cancel_reason = NULL
              WHERE session_id = $1 AND cancel_reason = 'session_cancelled'`, [sid]
          );
          await client.query(
            `UPDATE sessions SET seats_taken =
               (SELECT COUNT(*) FROM bookings WHERE session_id = $1 AND status <> 'cancelled')
             WHERE id = $1`, [sid]
          );
          await client.query('COMMIT');
          return { statusCode: 200, headers, body: JSON.stringify({ action: "session_restored", session_id: sid }) };
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        }
      }

      // ---- MODE A: add a child to an existing session (atomic seat claim) ----
      if (session_id) {
        if (!child_id) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "child_id is required" }) };
        }
        try {
          await client.query('BEGIN');

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
              'SELECT capacity, seats_taken FROM sessions WHERE id = $1', [session_id]
            );
            const seatsLeft = info.rowCount
              ? Math.max(0, info.rows[0].capacity - info.rows[0].seats_taken) : 0;
            return { statusCode: 409, headers, body: JSON.stringify({ error: "SESSION_FULL", seats_left: seatsLeft }) };
          }

          const ch = await client.query('SELECT id FROM children WHERE id = $1', [child_id]);
          if (ch.rowCount === 0) {
            await client.query('ROLLBACK');
            return { statusCode: 400, headers, body: JSON.stringify({ error: "child_id not found" }) };
          }

          const bk = await client.query(
            `INSERT INTO bookings (child_id, session_id, status)
             VALUES ($1, $2, 'confirmed') RETURNING *`,
            [child_id, session_id]
          );

          await client.query('COMMIT');
          return { statusCode: 201, headers, body: JSON.stringify({ booking: bk.rows[0], seats: claim.rows[0] }) };
        } catch (e) {
          await client.query('ROLLBACK');
          if (e.code === '23505') {
            return { statusCode: 409, headers, body: JSON.stringify({ error: "ALREADY_BOOKED" }) };
          }
          throw e;
        }
      }

      // ---- MODE B: create a new session ----
      if (!course_id || !therapist_id || !starts_at) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required fields: course_id, therapist_id, starts_at" }) };
      }
      if (capacity === undefined || capacity === null) {
        const c = await client.query('SELECT capacity FROM courses WHERE id = $1', [course_id]);
        if (c.rowCount === 0) return { statusCode: 400, headers, body: JSON.stringify({ error: "course_id not found" }) };
        capacity = c.rows[0].capacity;
      }
      status = status || 'scheduled';

      try {
        await client.query('BEGIN');

        // seats_taken starts at 1 if we're booking a child, else 0.
        const seats = child_id ? 1 : 0;
        const sess = await client.query(
          `INSERT INTO sessions (course_id, therapist_id, starts_at, capacity, seats_taken, status)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [course_id, therapist_id, starts_at, capacity, seats, status]
        );
        const session = sess.rows[0];

        let booking = null;
        if (child_id) {
          // Confirm the child exists (staff can book any child; no ownership check).
          const ch = await client.query('SELECT id FROM children WHERE id = $1', [child_id]);
          if (ch.rowCount === 0) {
            await client.query('ROLLBACK');
            return { statusCode: 400, headers, body: JSON.stringify({ error: "child_id not found" }) };
          }
          const bk = await client.query(
            `INSERT INTO bookings (child_id, session_id, status)
             VALUES ($1, $2, 'confirmed') RETURNING *`,
            [child_id, session.id]
          );
          booking = bk.rows[0];
        }

        await client.query('COMMIT');
        return { statusCode: 201, headers, body: JSON.stringify({ session, booking }) };
      } catch (e) {
        await client.query('ROLLBACK');
        if ((e.code === '23505' && e.constraint === 'uniq_therapist_slot') ||
            (e.code === '23P01' && e.constraint === 'excl_therapist_overlap')) {
          return { statusCode: 409, headers, body: JSON.stringify({ error: "THERAPIST_SLOT_TAKEN" }) };
        }
        if (e.code === '23505' && e.constraint === 'uniq_child_per_session') {
          return { statusCode: 409, headers, body: JSON.stringify({ error: "ALREADY_BOOKED" }) };
        }
        throw e;
      }
    }

    // ============ DELETE /admin/sessions ============
    //   ?booking_id=N → remove ONE child from a session (cancel that booking,
    //                   release the seat). Booking row is KEPT as audit trail.
    //   ?session_id=N → cancel the whole session and all its bookings.
    // Nothing is hard-deleted: therapy history must survive scheduling changes.
    if (method === "DELETE") {
      const q = event.queryStringParameters || {};
      const bookingId = q.booking_id ? Number(q.booking_id) : null;
      const sessionId = q.session_id ? Number(q.session_id) : null;

      if (!bookingId && !sessionId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Provide booking_id or session_id" }) };
      }

      // ---- ลบถาวร: hard-delete a cancelled session. Director only, and only
      //      when no clinical notes exist (notes are permanent records). ----
      if (sessionId && String(q.permanent || "") === "1") {
        if (!isDirector(event)) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: "DIRECTOR_ONLY" }) };
        }
        const notes = await client.query(
          `SELECT COUNT(*)::int AS n
             FROM session_notes sn
             JOIN bookings b ON b.id = sn.booking_id
            WHERE b.session_id = $1`,
          [sessionId]
        );
        // Notes are clinical records. Deleting them requires an EXPLICIT second
        // confirmation (&force=1) so it can never happen by accident.
        const force = String(q.force || "") === "1";
        if (notes.rows[0].n > 0 && !force) {
          return { statusCode: 409, headers, body: JSON.stringify({ error: "HAS_NOTES", notes: notes.rows[0].n }) };
        }
        try {
          await client.query('BEGIN');
          if (force) {
            await client.query(
              `DELETE FROM session_notes
                WHERE booking_id IN (SELECT id FROM bookings WHERE session_id = $1)`,
              [sessionId]
            );
          }
          await client.query('DELETE FROM bookings WHERE session_id = $1', [sessionId]);
          const del = await client.query('DELETE FROM sessions WHERE id = $1 RETURNING id', [sessionId]);
          await client.query('COMMIT');
          if (del.rowCount === 0) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: "session not found" }) };
          }
          return { statusCode: 200, headers, body: JSON.stringify({ action: "session_deleted", session_id: sessionId, notes_deleted: force ? notes.rows[0].n : 0 }) };
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        }
      }

      try {
        await client.query('BEGIN');

        // ---- cancel a single booking, free its seat ----
        if (bookingId) {
          const bk = await client.query(
            `UPDATE bookings
                SET status = 'cancelled', cancelled_at = NOW()
              WHERE id = $1 AND status <> 'cancelled'
              RETURNING id, session_id, child_id`,
            [bookingId]
          );
          if (bk.rowCount === 0) {
            await client.query('ROLLBACK');
            return { statusCode: 404, headers, body: JSON.stringify({ error: "booking not found or already cancelled" }) };
          }
          await client.query(
            `UPDATE sessions SET seats_taken = GREATEST(seats_taken - 1, 0) WHERE id = $1`,
            [bk.rows[0].session_id]
          );
          await client.query('COMMIT');
          return {
            statusCode: 200, headers,
            body: JSON.stringify({ action: "booking_cancelled", booking_id: bookingId, session_id: bk.rows[0].session_id })
          };
        }

        // ---- cancel a whole session (and every booking in it) ----
        const sess = await client.query(
          `UPDATE sessions SET status = 'cancelled'
            WHERE id = $1 AND status <> 'cancelled'
            RETURNING id`,
          [sessionId]
        );
        if (sess.rowCount === 0) {
          await client.query('ROLLBACK');
          return { statusCode: 404, headers, body: JSON.stringify({ error: "session not found or already cancelled" }) };
        }
        // Tag these so a later restore knows which bookings to bring back
        // (a child who cancelled on their own stays cancelled).
        const bks = await client.query(
          `UPDATE bookings
              SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = 'session_cancelled'
            WHERE session_id = $1 AND status <> 'cancelled'
            RETURNING id`,
          [sessionId]
        );
        await client.query('UPDATE sessions SET seats_taken = 0 WHERE id = $1', [sessionId]);

        await client.query('COMMIT');
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ action: "session_cancelled", session_id: sessionId, bookings_cancelled: bks.rowCount })
        };
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }

    if (method === "GET") {

      // ===== GET /admin/parents : STAFF list of ALL parents (incl childless offline) =====
      if (isAdmin && path.includes("/admin/parents")) {
        const wantArchived = String((event.queryStringParameters || {}).archived || "") === "1";
        const result = await client.query(
          `SELECT p.id, p.name, p.phone, p.parent2_name, p.parent2_phone,
                  p.line_user_id, p.is_active,
                  (p.line_user_id IS NULL) AS is_offline,
                  (SELECT COUNT(*)::int FROM children c WHERE c.parent_id = p.id) AS child_count,
                  (SELECT COUNT(*)::int FROM children c WHERE c.parent_id = p.id AND c.is_active = true) AS active_child_count
             FROM parents p
            WHERE p.is_active = $1
            ORDER BY p.id DESC`,
          [!wantArchived]
        );
        return { statusCode: 200, headers, body: JSON.stringify(result.rows) };
      }

      // ===== GET /admin/children : STAFF list of all children =====
      if (isAdmin && path.includes("/admin/children")) {
        const wantArchived = String((event.queryStringParameters || {}).archived || "") === "1";
        const result = await client.query(
          `SELECT c.id,
                  CONCAT(c.first_name, ' ', c.last_name, ' (', c.nickname, ')') AS name,
                  c.first_name,
                  c.last_name,
                  c.nickname,
                  c.date_of_birth,
                  EXTRACT(YEAR FROM AGE(c.date_of_birth))::int AS age,
                  c.gender,
                  c.medical_alerts,
                  c.chief_concern,
                  c.medical_diagnosis,
                  c.previous_therapy,
                  c.treatment_goals,
                  c.assigned_therapist,
                  c.is_active,
                  p.id            AS parent_id,
                  p.name          AS parent_name,
                  p.phone         AS parent_phone,
                  p.parent2_name  AS parent2_name,
                  p.parent2_phone AS parent2_phone,
                  (SELECT COUNT(*)::int FROM bookings b WHERE b.child_id = c.id) AS booking_count
           FROM children c
           JOIN parents p ON p.id = c.parent_id
           WHERE c.is_active = $1
           ORDER BY c.first_name`,
          [!wantArchived]
        );
        return { statusCode: 200, headers, body: JSON.stringify(result.rows) };
      }

      // ===== GET /admin/sessions : STAFF day schedule, WITH child names =====
      if (isAdmin && !path.includes("/admin/parents") && !path.includes("/admin/children")) {
        const q = event.queryStringParameters || {};
        const wantCancelled = String(q.cancelled || "") === "1"; // เช็กว่าเป็นโหมดยกเลิกหรือไม่
        const date = q.date;             
        const from = q.from, to = q.to;  

        // 🚨 1. ปลดล็อก Error: ถ้าเป็นโหมดยกเลิก (wantCancelled) จะไม่บังคับเช็กวันที่
        if (!wantCancelled && !date && !(from && to)) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Provide ?date=YYYY-MM-DD or ?from=&to=" }) };
        }

        let whereClause = "";
        let params = [];
        let orderDir = "ASC";

        // 🚨 2. แยกเงื่อนไขการสร้าง SQL ชัดเจน
        if (wantCancelled) {
          // โหมดดูคาบยกเลิก: กวาด status = 'cancelled' ทั้งหมดในระบบ เลิกสนวันที่ และเรียงจากล่าสุดลงไป
          whereClause = "s.status = 'cancelled'";
          orderDir = "DESC"; 
        } else {
          // โหมดตารางปกติ: กรองตามวันที่ส่งมา และต้องไม่ใช่สถานะ cancelled
          whereClause = "s.status <> 'cancelled' AND (s.starts_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1::date AND $2::date";
          params = date ? [date, date] : [from, to];
          orderDir = "ASC";
        }

        // One row per booking. Empty (unbooked) sessions still appear once with null child.
        const result = await client.query(
          `SELECT s.id            AS session_id,
                  s.starts_at,
                  s.capacity,
                  s.seats_taken,
                  s.status        AS session_status,
                  co.id           AS course_id,
                  co.name         AS course_name,
                  co.duration_minutes,
                  co.session_type,
                  t.id            AS therapist_id,
                  t.name          AS therapist_name,
                  t.nickname      AS therapist_nickname,
                  b.id            AS booking_id,
                  b.status        AS booking_status,
                  ch.id           AS child_id,
                  CONCAT(ch.first_name, ' ', ch.last_name, ' (', ch.nickname, ')') AS child_name,
                  EXTRACT(YEAR FROM AGE(ch.date_of_birth))::int AS child_age,
                  EXISTS (SELECT 1 FROM session_notes sn WHERE sn.booking_id = b.id) AS has_note
           FROM sessions s
           JOIN courses    co ON co.id = s.course_id
           JOIN therapists t  ON t.id  = s.therapist_id
           LEFT JOIN bookings b  ON b.session_id = s.id
                                AND (CASE WHEN ${wantCancelled} THEN TRUE
                                          ELSE b.status <> 'cancelled' END)
           LEFT JOIN children ch ON ch.id = b.child_id
           WHERE ${whereClause}
           ORDER BY s.starts_at ${orderDir}, b.id`,
          params
        );
        return { statusCode: 200, headers, body: JSON.stringify(result.rows) };
      }

      // ===== GET /sessions : PARENT list by course, NO identities (unchanged) =====
      const q = event.queryStringParameters || {};
      const courseId = q.course_id;
      const from = q.from;
      const to = q.to;
      if (!courseId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required query parameter: course_id" }) };
      }
      const params = [courseId];
      let where = `s.course_id = $1 AND s.status <> 'cancelled'`;
      if (from) { params.push(from); where += ` AND s.starts_at >= $${params.length}`; }
      else      { where += ` AND s.starts_at >= NOW()`; }
      if (to)   { params.push(to);   where += ` AND s.starts_at <= $${params.length}`; }

      const result = await client.query(
        `SELECT s.id, s.starts_at, s.capacity, s.seats_taken,
                (s.capacity - s.seats_taken) AS seats_left, s.status,
                s.course_id, c.name AS course_name, c.session_type, c.min_participants,
                t.id AS therapist_id, t.name AS therapist_name, t.nickname AS therapist_nickname
         FROM sessions s
         JOIN courses    c ON c.id = s.course_id
         JOIN therapists t ON t.id = s.therapist_id
         WHERE ${where}
         ORDER BY s.starts_at`,
        params
      );
      return { statusCode: 200, headers, body: JSON.stringify(result.rows) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  } finally {
    await client.end();
  }
};