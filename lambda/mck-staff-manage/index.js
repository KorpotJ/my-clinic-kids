const {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminListGroupsForUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminDeleteUserCommand
} = require("@aws-sdk/client-cognito-identity-provider");

const REGION = process.env.AWS_REGION;
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;

const TOP_ROLES = ["ClinicDirector", "Admin"];
const MANAGED_ROLES = ["ClinicDirector", "Admin", "OT", "SpecialEd"];

const cognito = new CognitoIdentityProviderClient({ region: REGION });
const headers = { "Access-Control-Allow-Origin": "*" };

function callerGroups(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims || {};
  let g = claims["cognito:groups"];
  if (!g) return [];
  if (Array.isArray(g)) return g;
  const s = String(g).trim().replace(/^\[/, "").replace(/\]$/, "");
  return s.split(/[\s,]+/).filter(Boolean);
}
function callerUsername(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims || {};
  return claims["cognito:username"] || claims["username"] || claims["sub"] || null;
}
function isTop(groups) { return groups.some(r => TOP_ROLES.includes(r)); }

async function groupsForUser(username) {
  const res = await cognito.send(new AdminListGroupsForUserCommand({
    UserPoolId: USER_POOL_ID, Username: username
  }));
  return (res.Groups || []).map(g => g.GroupName);
}

// Usernames of every ENABLED ClinicDirector. Used by the last-director guard.
async function enabledDirectorUsernames() {
  const users = await cognito.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID, Limit: 60 }));
  const out = [];
  for (const u of (users.Users || [])) {
    if (u.Enabled === false) continue;                 // disabled directors don't count as "active"
    const g = await groupsForUser(u.Username);
    if (g.includes("ClinicDirector")) out.push(u.Username);
  }
  return out;
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  const path = event.requestContext?.http?.path || event.rawPath || "";

  // ---- SERVER-SIDE ROLE ENFORCEMENT ----
  const groups = callerGroups(event);
  if (!isTop(groups)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "forbidden: requires ClinicDirector or Admin" }) };
  }

  try {
    // ===== GET /admin/staff : list users with their role =====
    // ?archived=1 -> only DISABLED users (the "เธเธเธฑเธเธเธฒเธเธ—เธตเนเธ–เธนเธเธฅเธ" view)
    // default     -> only ENABLED users (the normal roster)
    if (method === "GET") {
      const wantArchived = event.queryStringParameters?.archived === "1";
      const users = await cognito.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID, Limit: 60 }));
      const out = [];
      for (const u of (users.Users || [])) {
        const enabled = u.Enabled !== false;
        if (wantArchived ? enabled : !enabled) continue;   // filter by enabled/disabled
        const attrs = Object.fromEntries((u.Attributes || []).map(a => [a.Name, a.Value]));
        const g = await groupsForUser(u.Username);
        const role = MANAGED_ROLES.find(r => g.includes(r)) || null;
        out.push({
          username: u.Username,
          email: attrs.email || "",
          name: attrs.name || "",
          role,
          enabled,
          status: u.UserStatus
        });
      }
      return { statusCode: 200, headers, body: JSON.stringify(out) };
    }

    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");

      // ===== POST /admin/staff-create : create a new employee =====
      if (path.includes("staff-create")) {
        const { email, name, role } = body;
        if (!email || !name) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "email and name are required" }) };
        }
        if (role && !MANAGED_ROLES.includes(role)) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "invalid role" }) };
        }
        try {
          // Cognito emails the new user a temporary password; they set their own
          // password on first sign-in via the managed login page.
          await cognito.send(new AdminCreateUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: email,
            UserAttributes: [
              { Name: "email", Value: email },
              { Name: "email_verified", Value: "true" },
              { Name: "name", Value: name }
            ],
            DesiredDeliveryMediums: ["EMAIL"]
          }));
        } catch (e) {
          if (e.name === "UsernameExistsException") {
            return { statusCode: 409, headers, body: JSON.stringify({ error: "USER_EXISTS" }) };
          }
          throw e;
        }
        if (role) {
          await cognito.send(new AdminAddUserToGroupCommand({
            UserPoolId: USER_POOL_ID, Username: email, GroupName: role
          }));
        }
        return { statusCode: 201, headers, body: JSON.stringify({ email, name, role: role || null }) };
      }

      // ===== POST /admin/staff-status : archive(disable) / restore(enable) / permanent delete =====
      if (path.includes("staff-status")) {
        const { username, action } = body;
        if (!username || !["disable", "enable", "delete"].includes(action)) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "username and a valid action (disable|enable|delete) are required" }) };
        }

        const me = callerUsername(event);

        // Guard 1: never disable or delete your own account.
        if ((action === "disable" || action === "delete") && username === me) {
          return { statusCode: 409, headers, body: JSON.stringify({ error: "CANNOT_MODIFY_SELF" }) };
        }

        // Permanent delete is ClinicDirector-only (disable/enable stay Admin+Director).
        if (action === "delete" && !groups.includes("ClinicDirector")) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: "DIRECTOR_ONLY" }) };
        }

        // Guard 2: never remove the last active ClinicDirector.
        // Blocks disabling the sole enabled director, and deleting them too.
        // (Deleting an already-disabled director is fine: the invariant guarantees
        //  another enabled director still exists, so the clinic isn't locked out.)
        if (action === "disable" || action === "delete") {
          const dirs = await enabledDirectorUsernames();
          if (dirs.length === 1 && dirs.includes(username)) {
            return { statusCode: 409, headers, body: JSON.stringify({ error: "LAST_DIRECTOR" }) };
          }
        }

        try {
          if (action === "disable") {
            await cognito.send(new AdminDisableUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
            return { statusCode: 200, headers, body: JSON.stringify({ username, enabled: false }) };
          }
          if (action === "enable") {
            await cognito.send(new AdminEnableUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
            return { statusCode: 200, headers, body: JSON.stringify({ username, enabled: true }) };
          }
          // action === "delete"
          await cognito.send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
          return { statusCode: 200, headers, body: JSON.stringify({ username, deleted: true }) };
        } catch (e) {
          if (e.name === "UserNotFoundException") {
            return { statusCode: 404, headers, body: JSON.stringify({ error: "USER_NOT_FOUND" }) };
          }
          throw e;
        }
      }

      // ===== POST /admin/staff-role : set a user's role =====
      const { username, role } = body;
      if (!username || !MANAGED_ROLES.includes(role)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "username and a valid role are required" }) };
      }
      const me = callerUsername(event);
      if (username === me && !TOP_ROLES.includes(role)) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: "cannot remove your own top-level role" }) };
      }
      const current = (await groupsForUser(username)).filter(r => MANAGED_ROLES.includes(r));
      for (const r of current) {
        if (r !== role) {
          await cognito.send(new AdminRemoveUserFromGroupCommand({
            UserPoolId: USER_POOL_ID, Username: username, GroupName: r
          }));
        }
      }
      if (!current.includes(role)) {
        await cognito.send(new AdminAddUserToGroupCommand({
          UserPoolId: USER_POOL_ID, Username: username, GroupName: role
        }));
      }
      return { statusCode: 200, headers, body: JSON.stringify({ username, role }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "method not allowed" }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};