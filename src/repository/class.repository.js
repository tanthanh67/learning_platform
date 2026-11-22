import pool from "../config/db.config.js";
import { BadRequestError } from "../core/error.response.js";

const CLASS_COLUMNS =
  "c.id, c.name, c.description, c.start_date, c.end_date, c.mentor_id";

const buildOrderBy = ({ sortBy = "id", order = "ASC" }) => {
  const validSortColumns = [
    "id",
    "name",
    "description",
    "start_date",
    "end_date",
    "mentor_id",
  ];

  if (!validSortColumns.includes(sortBy)) {
    throw new BadRequestError(`Invalid sort column: ${sortBy}`);
  }

  const validOder = ["asc", "desc"];

  if (!validOder.includes(String(order).toLowerCase())) {
    throw new BadRequestError(`Invalid sort order: ${order}`);
  }

  const orderBy = `ORDER BY c.${sortBy} ${order}`;
  return sortBy === "id" ? orderBy : `${orderBy}, c.id ASC`;
};

const findPage = async (query, where = "", values = []) => {
  const { page, limit } = query;
  const offset = (page - 1) * limit;
  const limitParam = values.length + 1;
  const offsetParam = values.length + 2;

  const { rows } = await pool.query(
    `
      WITH visible_classes AS (
        SELECT ${CLASS_COLUMNS}
        FROM classes c
        ${where}
      )
      SELECT
        (SELECT COUNT(*)::int FROM visible_classes) AS total,
        ARRAY(
          SELECT row_to_json(c)
          FROM visible_classes c
          ${buildOrderBy(query)}
          LIMIT $${limitParam} OFFSET $${offsetParam}
        ) AS items
    `,
    [...values, limit, offset],
  );

  return rows[0];
};

export const findAll = (query) => findPage(query);

export const findAllForUser = (userId, query) =>
  findPage(
    query,
    `WHERE c.mentor_id = $1
       OR EXISTS (
         SELECT 1 FROM class_members cm
         WHERE cm.class_id = c.id AND cm.member_id = $1
       )`,
    [userId],
  );

export const findById = async (id) => {
  const result = await pool.query(
    "SELECT id, name, description, start_date, end_date, mentor_id FROM classes WHERE id = $1",
    [id],
  );
  return result.rows[0] || null;
};

export const findByName = async (name) => {
  const result = await pool.query("SELECT * FROM classes WHERE name = $1", [
    name,
  ]);
  return result.rows[0] || null;
};

export const create = async ({
  name,
  description,
  startDate,
  endDate,
  mentorId,
}) => {
  const result = await pool.query(
    "INSERT INTO classes (name, description, start_date, end_date, mentor_id) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    [name, description, startDate, endDate, mentorId],
  );
  return result.rows[0];
};

export const update = async (
  id,
  { name, description, startDate, endDate, mentorId },
) => {
  const result = await pool.query(
    `
      UPDATE classes
      SET name = COALESCE($1, name),
          description = COALESCE($2, description),
          start_date = COALESCE($3, start_date),
          end_date = COALESCE($4, end_date),
          mentor_id = COALESCE($5, mentor_id),
          updated_at = NOW()
      WHERE id = $6
      RETURNING *
    `,
    [
      name ?? null,
      description ?? null,
      startDate ?? null,
      endDate ?? null,
      mentorId ?? null,
      id,
    ],
  );
  return result.rows[0];
};

export const deleteById = async (id) => {
  const result = await pool.query(
    "DELETE FROM classes WHERE id = $1 RETURNING *",
    [id],
  );
  return result.rows[0] || null;
};

export const findAnalyticsByClassId = async (classId) => {
  const { rows } = await pool.query(
    `
    WITH current_members AS (
      SELECT member_id FROM class_members WHERE class_id = $1
    ),
    class_lessons AS (
      SELECT id FROM lessons WHERE class_id = $1
    ),
    class_assignments AS (
      SELECT id FROM assignments WHERE class_id = $1
    ),
    submission_stats AS (
      SELECT
        COUNT(*)::int AS submitted_count,
        ROUND(AVG(s.score), 2) AS average_score
      FROM submissions s
      JOIN class_assignments a ON a.id = s.assignment_id
      JOIN current_members cm ON cm.member_id = s.member_id
    )
    SELECT
      (SELECT COUNT(*)::int FROM current_members) AS member_count,
      (SELECT COUNT(*)::int FROM class_lessons) AS lesson_count,
      (SELECT COUNT(*)::int FROM class_assignments) AS assignment_count,
      (
        SELECT COUNT(*)::int
        FROM lesson_progress lp
        JOIN class_lessons l ON l.id = lp.lesson_id
        JOIN current_members cm ON cm.member_id = lp.member_id
      ) AS completed_count,
      submitted_count,
      average_score
    FROM submission_stats
    `,
    [classId],
  );

  return rows[0];
};
