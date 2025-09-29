const express = require("express");
const request = require("supertest");
const bodyParser = require("body-parser");
const { list, single, create, update, patch, destroy } = require("../src");
const { Sequelize, DataTypes } = require("sequelize");
function randId() {
  return (
    'u-' +
    Math.random().toString(16).slice(2, 10) +
    Date.now().toString(16) +
    Math.random().toString(16).slice(2, 6)
  );
}

// Custom id field test (uuid primary key instead of 'id')
// Verifies the idField option propagates through all operations

describe("idField option (uuid primary key)", () => {
  let sequelize;
  let Widget;
  let app;

  beforeAll(async () => {
    sequelize = new Sequelize("sqlite::memory:", { logging: false });
    Widget = sequelize.define(
      "Widget",
      {
        uuid: { type: DataTypes.STRING, primaryKey: true },
        name: { type: DataTypes.STRING, allowNull: false },
        desc: { type: DataTypes.STRING },
      },
      { tableName: "widgets", timestamps: false },
    );
    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await Widget.destroy({ where: {}, truncate: true });
    app = express();
    app.use(bodyParser.json());
  // Declare apialize id attribute on model (new mechanism)
  Widget.apialize = { id_attribute: "uuid" };
  app.use("/widgets", create(Widget));
  app.use("/widgets", list(Widget));
  app.use("/widgets", single(Widget));
  app.use("/widgets", update(Widget));
  app.use("/widgets", patch(Widget));
  app.use("/widgets", destroy(Widget));
  });

  test("create() returns normalized id field", async () => {
    const res = await request(app)
      .post("/widgets")
      .send({ uuid: randId(), name: "A" });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body).not.toHaveProperty("uuid");
  });

  test("full CRUD lifecycle with uuid", async () => {
    // Create
  const uuid = randId();
    const createRes = await request(app)
      .post("/widgets")
      .send({ uuid, name: "First", desc: "one" });
    expect(createRes.status).toBe(201);
    expect(createRes.body.id).toBe(uuid);

    // List (should include 1)
  const listRes = await request(app).get("/widgets");
  expect(listRes.status).toBe(200);
  expect(listRes.body.meta.count).toBe(1);
  expect(listRes.body.data[0].id).toBe(uuid);

    // Single
    const singleRes = await request(app).get(`/widgets/${uuid}`);
    expect(singleRes.status).toBe(200);
    expect(singleRes.body.id).toBe(uuid);

    // Patch
    const patchRes = await request(app)
      .patch(`/widgets/${uuid}`)
      .send({ desc: "two" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.id).toBe(uuid);

    const singleRes2 = await request(app).get(`/widgets/${uuid}`);
    expect(singleRes2.body.desc).toBe("two");

    // Update (PUT) with replacement - omit desc to null it
    const putRes = await request(app)
      .put(`/widgets/${uuid}`)
      .send({ name: "Replaced" });
    expect(putRes.status).toBe(200);
    expect(putRes.body.id).toBe(uuid);
    expect(putRes.body.desc).toBe(null);

    // Destroy
    const delRes = await request(app).delete(`/widgets/${uuid}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.id).toBe(uuid);

    // 404 after delete
    const singleAfter = await request(app).get(`/widgets/${uuid}`);
    expect(singleAfter.status).toBe(404);
  });
});
