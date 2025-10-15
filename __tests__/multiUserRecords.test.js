const express = require("express");
const request = require("supertest");
const bodyParser = require("body-parser");
function randId() {
  return (
    "u-" +
    Math.random().toString(16).slice(2, 10) +
    Date.now().toString(16) +
    Math.random().toString(16).slice(2, 6)
  );
}
const { crud } = require("../src");
const { Sequelize, DataTypes } = require("sequelize");

/**
 * Multi-user ownership test
 * Table: records
 *  - id (auto increment PK)
 *  - external_id (uuid string, unique)
 *  - user_id (string) user owner
 *  - data (string) arbitrary payload
 *
 * Requirements:
 *  - external_id returned for all operations; clients never send it on create (server-generated)
 *  - Users can only see and mutate their own records
 *  - Attempts to access another user's record return 404 (not found)
 */

describe("multi-user ownership with default numeric id (bearer auth)", () => {
  let sequelize;
  let Record;
  let Session;
  let app;
  let tokens;

  beforeAll(async () => {
    sequelize = new Sequelize("sqlite::memory:", { logging: false });
    Record = sequelize.define(
      "Record",
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        external_id: { type: DataTypes.STRING, unique: true },
        user_id: { type: DataTypes.STRING, allowNull: false },
        data: { type: DataTypes.STRING },
      },
      { tableName: "records", timestamps: false },
    );
    Session = sequelize.define(
      "Session",
      {
        token: { type: DataTypes.STRING, primaryKey: true },
        user_id: { type: DataTypes.STRING, allowNull: false },
      },
      { tableName: "sessions", timestamps: false },
    );
    await sequelize.sync({ force: true });

    // Hook to always generate external_id if not provided
    Record.beforeCreate((instance) => {
      if (!instance.external_id) instance.external_id = randId();
    });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await Record.destroy({ where: {}, truncate: true, restartIdentity: true });
    await Session.destroy({ where: {}, truncate: true });
    // Seed two sessions (bearer tokens)
    tokens = {
      userA: `token-A-${randId()}`,
      userB: `token-B-${randId()}`,
    };
    await Session.bulkCreate([
      { token: tokens.userA, user_id: "userA" },
      { token: tokens.userB, user_id: "userB" },
    ]);

    // Build single app with auth middleware
    app = express();
    app.use(bodyParser.json());

    const authOwnership = async (req, res, next) => {
      const header = req.get("Authorization") || "";
      const m = header.match(/^Bearer (.+)$/i);
      if (!m) return res.status(401).json({ error: "Unauthorized" });
      const token = m[1];
      const session = await Session.findOne({ where: { token } });
      if (!session) return res.status(401).json({ error: "Unauthorized" });
      const userId = session.user_id;

      req.apialize.options.where.user_id = userId;
      if (["POST", "PUT", "PATCH"].includes(req.method)) {
        req.body.user_id = userId;
        req.apialize.values = {
          ...(req.apialize.values || {}),
          user_id: userId,
        };
      }
      next();
    };

    const opts = { middleware: [authOwnership] };
    app.use("/records", crud(Record, opts)); // crud adapts to new operation signatures

    app.use((err, _req, res, _next) =>
      res.status(500).json({ error: err.message }),
    );
  });

  test("users can only CRUD their own records via bearer token", async () => {
    const authA = { Authorization: `Bearer ${tokens.userA}` };
    const authB = { Authorization: `Bearer ${tokens.userB}` };

    // User A creates two records (no external_id supplied)
    const createA1 = await request(app)
      .post("/records")
      .set(authA)
      .send({ data: "A1" });
    const createA2 = await request(app)
      .post("/records")
      .set(authA)
      .send({ data: "A2" });
    if (createA1.status !== 201) {
      // eslint-disable-next-line no-console
      console.log("createA1 error body", createA1.body);
    }
    expect(createA1.status).toBe(201);
    expect(createA2.status).toBe(201);
    expect(createA1.body).toHaveProperty("id"); // internal numeric id
    const a1 = createA1.body.id;
    const a2 = createA2.body.id;

    // User B creates one record
    const createB1 = await request(app)
      .post("/records")
      .set(authB)
      .send({ data: "B1" });
    expect(createB1.status).toBe(201);
    const b1 = createB1.body.id;

    // List endpoints only show each user's own data
    const listA = await request(app).get("/records").set(authA);
    expect(listA.status).toBe(200);
    expect(listA.body.meta.count).toBe(2);
    expect(listA.body.data.map((r) => r.data).sort()).toEqual(["A1", "A2"]);

    const listB = await request(app).get("/records").set(authB);
    expect(listB.status).toBe(200);
    expect(listB.body.meta.count).toBe(1);
    expect(listB.body.data[0].data).toBe("B1");

    // User A can read own record
    const getA1 = await request(app).get(`/records/${a1}`).set(authA);
    expect(getA1.status).toBe(200);
    expect(getA1.body.record.data).toBe("A1");

    // User B cannot read User A's record -> 404 (filtered out by ownership)
    const getA1ByB = await request(app).get(`/records/${a1}`).set(authB);
    expect(getA1ByB.status).toBe(404);

    // Patch own record (User A)
    const patchA1 = await request(app)
      .patch(`/records/${a1}`)
      .set(authA)
      .send({ data: "A1-updated" });
    expect(patchA1.status).toBe(200);
    const verifyA1 = await request(app).get(`/records/${a1}`).set(authA);
    expect(verifyA1.body.record.data).toBe("A1-updated");

    // Patch other user's record (User B tries to patch A1) -> 404
    const patchA1ByB = await request(app)
      .patch(`/records/${a1}`)
      .set(authB)
      .send({ data: "hack" });
    expect(patchA1ByB.status).toBe(404);

    // PUT replace own record (User B)
    const putB1 = await request(app)
      .put(`/records/${b1}`)
      .set(authB)
      .send({ data: "B1-replaced" });
    expect(putB1.status).toBe(200);
    expect(putB1.body).toMatchObject({ success: true });

    // PUT other user's record -> 404
    const putA2ByB = await request(app)
      .put(`/records/${a2}`)
      .set(authB)
      .send({ data: "takeover" });
    expect(putA2ByB.status).toBe(404);

    // Delete own record
    const delA2 = await request(app).delete(`/records/${a2}`).set(authA);
    expect(delA2.status).toBe(200);

    // Delete other user's (User B deleting A1) -> 404
    const delA1ByB = await request(app).delete(`/records/${a1}`).set(authB);
    expect(delA1ByB.status).toBe(404);

    // Final list userA should have 1 remaining
    const finalListA = await request(app).get("/records").set(authA);
    expect(finalListA.body.meta.count).toBe(1);
    expect(finalListA.body.data[0].id).toBe(a1);
  });
});
