import pool from "../config/db.config.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../core/error.response.js";
import { hasPermission } from "./permission.repository.js";

const PUBLIC_COLUMNS = "id, name, email, age, created_at, updated_at";

const withTransaction = async (work) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// Serialize role changes and user deletions before checking for the last admin.
const lockAdminRole = async (client) => {
  const result = await client.query(
    "SELECT id FROM roles WHERE name = 'ADMIN' FOR NO KEY UPDATE",
  );
  return result.rows[0]?.id;
};

const ensureAdminRemains = async (client, userId, adminRoleId) => {
  if (adminRoleId === undefined) return;

  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM user_roles WHERE role_id = $1 AND user_id = $2
     ) AND NOT EXISTS (
       SELECT 1 FROM user_roles WHERE role_id = $1 AND user_id <> $2
     ) AS last_admin`,
    [adminRoleId, userId],
  );

  if (result.rows[0].last_admin) {
    throw new ConflictError("Cannot remove the last admin");
  }
};

export const findAll = async ({ sortBy = "id", order = "ASC" }) => {
  const validSortColumns = ["id", "name", "email"];

  if (!validSortColumns.includes(sortBy)) {
    throw new BadRequestError(`Invalid sort column: ${sortBy}`);
  }

  const validOder = ["asc", "desc"];

  if (!validOder.includes(String(order).toLowerCase())) {
    throw new BadRequestError(`Invalid sort order: ${order}`);
  }

  const result = await pool.query(
    `SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY ${sortBy} ${order}`,
  );
  return result.rows;
};

export const findById = async (id) => {
  const result = await pool.query(
    `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`,
    [id],
  );
  return result.rows[0] || null;
};

export const hasRole = async (userId, roleName) => {
  const result = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1 AND r.name = $2
      ) AS has_role
    `,
    [userId, roleName],
  );

  return result.rows[0].has_role;
};

export const findByEmail = async (email) => {
  const result = await pool.query(`SELECT * FROM users WHERE email = $1`, [
    email,
  ]);
  return result.rows[0] || null;
};

export const create = async ({ name, email, password, age }) => {
  const result = await pool.query(
    `INSERT INTO users (name, email, password_hash, age) VALUES ($1, $2, $3, $4) RETURNING ${PUBLIC_COLUMNS}`,
    [name, email, password, age],
  );
  return result.rows[0] || null;
};

export const update = async (id, { name, email, password, age }) => {
  const result = await pool.query(
    `
      UPDATE users
      SET name = COALESCE($1, name),
          email = COALESCE($2, email),
          password_hash = COALESCE($3, password_hash),
          age = COALESCE($4, age),
          updated_at = NOW()
      WHERE id = $5
      RETURNING ${PUBLIC_COLUMNS}
    `,
    [name ?? null, email ?? null, password ?? null, age ?? null, id],
  );
  return result.rows[0] || null;
};

export const deleteById = async (id) => {
  return withTransaction(async (client) => {
    const adminRoleId = await lockAdminRole(client);
    await ensureAdminRemains(client, id, adminRoleId);
    const result = await client.query(
      `DELETE FROM users WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
      [id],
    );
    return result.rows[0] || null;
  });
};

export const createWithRole = async (
  { name, email, password, age },
  roleName,
) => {
  return withTransaction(async (client) => {
    const userResult = await client.query(
      `INSERT INTO users (name, email, password_hash, age) VALUES ($1, $2, $3, $4) RETURNING ${PUBLIC_COLUMNS}`,
      [name, email, password, age],
    );
    const user = userResult.rows[0];

    const roleResult = await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name = $2`,
      [user.id, roleName],
    );

    if (roleResult.rowCount !== 1) {
      throw new Error(`Role '${roleName}' does not exist`);
    }

    return user;
  });
};

export const findRoles = async () => {
  const result = await pool.query(
    "SELECT name, description FROM roles ORDER BY name",
  );
  return result.rows;
};

export const findUserRoles = async (userId, db = pool) => {
  const result = await db.query(
    `
      SELECT u.id AS "userId", ARRAY(
        SELECT r.name
        FROM roles r
        JOIN user_roles ur ON r.id = ur.role_id
        WHERE ur.user_id = u.id
        ORDER BY r.name
      ) AS roles
      FROM users u
      WHERE u.id = $1
    `,
    [userId],
  );
  return result.rows[0] || null;
};

export const findRoleNames = async (userId) => {
  const user = await findUserRoles(userId);
  return user?.roles ?? [];
};

export const changeRole = async ({ actorId, userId, roleName, grant }) => {
  return withTransaction(async (client) => {
    const adminRoleId = await lockAdminRole(client);
    // A request may have passed the middleware while a revocation was in progress.
    if (!(await hasPermission(actorId, "USER_ROLE_MANAGE", client))) {
      throw new ForbiddenError("User does not have the required permission");
    }

    const user = await client.query(
      "SELECT id FROM users WHERE id = $1 FOR KEY SHARE",
      [userId],
    );
    if (user.rowCount === 0) throw new NotFoundError("User not found");

    const role = await client.query(
      "SELECT id FROM roles WHERE name = $1 FOR KEY SHARE",
      [roleName],
    );
    if (role.rowCount === 0) throw new NotFoundError("Role not found");
    const roleId = role.rows[0].id;

    if (!grant && roleId === adminRoleId) {
      await ensureAdminRemains(client, userId, adminRoleId);
    }

    const change = await client.query(
      grant
        ? `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)
           ON CONFLICT (user_id, role_id) DO NOTHING`
        : "DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2",
      [userId, roleId],
    );

    if (change.rowCount > 0) {
      await client.query(
        `INSERT INTO user_role_audit (actor_id, user_id, role_name, action)
         VALUES ($1, $2, $3, $4)`,
        [actorId, userId, roleName, grant ? "GRANT" : "REVOKE"],
      );
    }

    return findUserRoles(userId, client);
  });
};
