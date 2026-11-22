import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, test } from "node:test";
import express from "express";
import pool from "../src/config/db.config.js";
import { r2Client } from "../src/config/r2.config.js";
import errorHandler from "../src/middlewares/errorHandler.js";
import router from "../src/routes/route.js";
import { generateToken } from "../src/utils/jwt.helper.js";

let server;
let localBaseUrl;
const sessionId = "00000000-0000-4000-8000-000000000001";

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  localBaseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

const rows = (...records) => ({ rows: records });

const mockDatabase = (t, permissions, query = (sql) => assert.fail(sql)) => {
  t.mock.method(pool, "query", async (sql, params) => {
    if (sql.includes("FROM auth_sessions")) {
      assert.equal(params[0], sessionId);
      return rows({ id: sessionId, user_id: params[1] });
    }
    if (sql.includes("AS has_permission")) {
      const requested = [params[1]].flat();
      return rows({
        has_permission: requested.some((name) => permissions.includes(name)),
      });
    }
    return query(sql.trim(), params);
  });
};

const request = (path, { userId = 1, method = "GET", body } = {}) => {
  const token = generateToken({ id: userId, sessionId });
  return fetch(`${localBaseUrl}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
};

test("Login thiếu thông tin trả 400 và lỗi theo trường", async () => {
  const baseUrl = process.env.TEST_API_URL || localBaseUrl;

  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.ok(Array.isArray(body.errors) && body.errors.length > 0);
});

test("Quyền sửa hồ sơ không cho phép cấp hoặc thu hồi vai trò", async (t) => {
  mockDatabase(t, ["USER_UPDATE"]);
  t.mock.method(pool, "connect", () => assert.fail("Unexpected role transaction"));

  for (const method of ["PUT", "DELETE"]) {
    const response = await request("/users/7/roles/ADMIN", { method });
    assert.equal(response.status, 403);
  }
});

test("Danh sách lớp trả pagination và Analytics trả thống kê", async (t) => {
  mockDatabase(t, ["CLASS_READ_ALL"], (sql, params) => {
    if (sql.startsWith("WITH visible_classes")) {
      assert.deepEqual(params, [1, 1]);
      return rows({ items: [{ id: 7 }], total: 2 });
    }
    if (sql.startsWith("WITH current_members")) {
      return rows({
        member_count: 2,
        lesson_count: 1,
        assignment_count: 1,
        completed_count: 1,
        submitted_count: 2,
        average_score: 8.5,
      });
    }
    if (sql.includes("FROM classes WHERE id")) return rows({ id: 7 });
    if (sql.includes("FROM class_members")) return rows();
    assert.fail(sql);
  });

  const list = await request("/classes?page=2&limit=1");
  assert.equal(list.status, 200);
  const { data, pagination } = await list.json();
  assert.deepEqual(data, [{ id: 7 }]);
  assert.deepEqual(pagination, { page: 2, limit: 1, total: 2, totalPages: 2 });

  const analytics = await request("/classes/7/analytics");
  assert.equal(analytics.status, 200);
  const result = await analytics.json();
  assert.deepEqual(result.data, {
    lessonCompletionRate: 50,
    submissionRate: 100,
    averageScore: 8.5,
  });
  assert.equal(result.pagination, undefined);
});

test("Thành viên của lớp xem được tài liệu trong chi tiết Lesson", async (t) => {
  const attachment = { id: 20, original_name: "handout.pdf" };
  mockDatabase(t, ["LESSON_READ"], (sql, params) => {
    if (sql.includes("FROM lessons WHERE id")) return rows({ id: 12, class_id: 7 });
    if (sql.includes("FROM classes WHERE id")) return rows({ id: 7, mentor_id: 2 });
    if (sql.includes("FROM class_members")) return rows({ member_id: 1 });
    if (sql.includes("FROM uploads")) {
      assert.deepEqual(params, [12]);
      return rows(attachment);
    }
    assert.fail(sql);
  });

  const response = await request("/lessons/12");
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data.attachments, [attachment]);
});

test("Tạo hoặc sửa lớp kiểm tra kiểu mentorId và quyền gán Mentor", async (t) => {
  mockDatabase(t, ["CLASS_CREATE", "CLASS_UPDATE"]);
  const classData = { name: "Backend", startDate: "2026-12-01", endDate: "2026-12-31" };

  for (const [method, path] of [["POST", "/classes"], ["PUT", "/classes/7"]]) {
    const invalid = await request(path, { method, body: { ...classData, mentorId: [1] } });
    assert.equal(invalid.status, 400);
    assert.ok((await invalid.json()).errors.some((error) => error.field === "mentorId"));

    const forbidden = await request(path, { method, body: { ...classData, mentorId: 1 } });
    assert.equal(forbidden.status, 403);
  }
});

test("Sửa lớp chỉ yêu cầu quyền gán Mentor khi có mentorId", async (t) => {
  mockDatabase(t, ["CLASS_UPDATE"], (sql) => {
    if (sql.includes("FROM classes WHERE id")) return rows({ id: 7 });
    if (sql.startsWith("UPDATE classes")) return rows({ id: 7, description: "Updated" });
    assert.fail(sql);
  });

  const response = await request("/classes/7", {
    method: "PUT",
    body: { description: "Updated" },
  });
  assert.equal(response.status, 200);
});

test("Người có quyền gán Mentor sửa được lớp với mentorId hợp lệ", async (t) => {
  mockDatabase(t, ["CLASS_UPDATE", "CLASS_ASSIGN_MENTOR"], (sql, params) => {
    if (sql.includes("FROM classes WHERE id")) return rows({ id: 7 });
    if (sql.includes("FROM users WHERE id")) {
      assert.deepEqual(params, [2]);
      return rows({ id: 2 });
    }
    if (sql.startsWith("UPDATE classes")) {
      assert.deepEqual(params.slice(-2), [2, 7]);
      return rows({ id: 7, mentor_id: 2 });
    }
    assert.fail(sql);
  });

  const response = await request("/classes/7", {
    method: "PUT",
    body: { mentorId: "2" },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.mentor_id, 2);
});

test("Xóa file độc lập theo ID chỉ cho phép chủ file", async (t) => {
  const actions = [];
  mockDatabase(t, [], (sql, [id]) => {
    if (sql.startsWith("SELECT * FROM uploads")) {
      return rows({
        id,
        r2_key: "documents/test.pdf",
        uploaded_by: 1,
        lesson_id: id === 21 ? 12 : null,
      });
    }
    assert.equal(sql, "DELETE FROM uploads WHERE id = $1");
    actions.push(["database", id]);
    return rows();
  });
  t.mock.method(r2Client, "send", async (command) => {
    actions.push(["storage", command.input.Key]);
  });

  assert.equal((await request("/upload/20", { method: "DELETE", userId: 2 })).status, 403);
  assert.equal((await request("/upload/21", { method: "DELETE" })).status, 403);
  assert.deepEqual(actions, []);

  const response = await request("/upload/20", { method: "DELETE" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data, null);
  assert.deepEqual(actions, [["storage", "documents/test.pdf"], ["database", 20]]);
});
