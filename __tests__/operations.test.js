const express = require("express");
const request = require("supertest");
const bodyParser = require("body-parser");
const { list, single, create, update, patch, destroy } = require("../src");
const { Sequelize, DataTypes } = require("sequelize");

describe("apialize individual operations (Sequelize raw model)", () => {
  let sequelize;
  let Item; // Sequelize model used directly
  let app;

  beforeAll(async () => {
    sequelize = new Sequelize("sqlite::memory:", { logging: false });
    Item = sequelize.define(
      "Item",
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING, allowNull: false },
        desc: { type: DataTypes.STRING },
      },
      { tableName: "items", timestamps: false },
    );
    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    // Reset table data between tests
    await Item.destroy({ where: {}, truncate: true, restartIdentity: true });
  });

  test("list() returns all records", async () => {
    app = express();
    app.use(bodyParser.json());
    app.use("/items", create(Item));
    app.use("/items", list(Item));
    await request(app).post("/items").send({ name: "A" });
    await request(app).post("/items").send({ name: "B" });
  const res = await request(app).get("/items");
  expect(res.body).toHaveProperty("success", true);
  expect(res.body.meta).toMatchObject({ page: 1, page_size: 100, count: 2 });
  expect(res.body.data.length).toBe(2);
  });

  test("single() returns one record", async () => {
    app = express();
    app.use(bodyParser.json());
    app.use("/items", create(Item));
    app.use("/items", single(Item));
    const created = await request(app).post("/items").send({ name: "A" });
    const res = await request(app).get(`/items/${created.body.id}`);
    expect(res.body.name).toBe("A");
  });

  test("create() creates a record", async () => {
    app = express();
    app.use(bodyParser.json());
    app.use("/items", create(Item));
    app.use("/items", single(Item));
    const createRes = await request(app).post("/items").send({ name: "A" });
    expect(createRes.status).toBe(201);
    expect(createRes.body).toHaveProperty("success", true);
    expect(typeof createRes.body.id).toBe("number");

    const getRes = await request(app).get(`/items/${createRes.body.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({ id: createRes.body.id, name: "A" });
  });

  test("update() replaces a record", async () => {
    app = express();
    app.use(bodyParser.json());
    app.use("/items", create(Item));
    app.use("/items", update(Item));
    // Create with all fields so we can verify full replacement behavior
    const created = await request(app)
      .post("/items")
      .send({ name: "A", desc: "x" });
    // PUT omits 'desc' so it should be nulled (full replacement semantics)
    const res = await request(app)
      .put(`/items/${created.body.id}`)
      .send({ name: "New" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: created.body.id,
      name: "New",
      desc: null,
    });
    expect(Object.keys(res.body).sort()).toEqual(["desc", "id", "name"]);

    // Second PUT providing all attributes should properly set them
    const res2 = await request(app)
      .put(`/items/${created.body.id}`)
      .send({ name: "Newest", desc: "restored" });
    expect(res2.status).toBe(200);
    expect(res2.body).toMatchObject({
      id: created.body.id,
      name: "Newest",
      desc: "restored",
    });
    expect(Object.keys(res2.body).sort()).toEqual(["desc", "id", "name"]);
  });

  test("patch() merges a record", async () => {
    app = express();
    app.use(bodyParser.json());
    app.use("/items", create(Item));
    app.use("/items", patch(Item));
    app.use("/items", single(Item));
    const created = await request(app)
      .post("/items")
      .send({ name: "A", desc: "x" });
    const res = await request(app)
      .patch(`/items/${created.body.id}`)
      .send({ desc: "y" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      id: created.body.id.toString(),
    });

    const getRes = await request(app).get(`/items/${created.body.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({
      id: created.body.id,
      name: "A",
      desc: "y",
    });
  });

  test("destroy() deletes a record", async () => {
    app = express();
    app.use(bodyParser.json());
    app.use("/items", create(Item));
    app.use("/items", destroy(Item));
    const created = await request(app).post("/items").send({ name: "A" });
    const delRes = await request(app).delete(`/items/${created.body.id}`);
    expect(delRes.status).toBe(200);
    // Should not be found after delete
    app.use("/items", single(Item));
    const getRes = await request(app).get(`/items/${created.body.id}`);
    expect(getRes.status).toBe(404);
  });
});
