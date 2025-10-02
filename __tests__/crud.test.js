const express = require("express");
const bodyParser = require("body-parser");
const request = require("supertest");
const { Sequelize, DataTypes } = require("sequelize");
const { crud } = require("../src");

describe("crud() integration (default id only)", () => {
  let sequelize;
  let Thing;
  let Widget; // retained only if needed in future tests (currently unused)
  let app;

  beforeAll(async () => {
    sequelize = new Sequelize("sqlite::memory:", { logging: false });
    Thing = sequelize.define(
      "Thing",
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING, allowNull: false },
        desc: { type: DataTypes.STRING },
      },
      { tableName: "things", timestamps: false },
    );

    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await Thing.destroy({ where: {}, truncate: true, restartIdentity: true });
    app = express();
    app.use(bodyParser.json());
    app.use("/things", crud(Thing)); // crud still works (internally adapted)
  });

  test("Thing create/list/single", async () => {
    const create = await request(app).post("/things").send({ name: "Alpha" });
    expect(create.status).toBe(201);
    expect(create.body).toHaveProperty("id");
    const id = create.body.id;
    const list = await request(app).get("/things");
    expect(list.body.meta.count).toBe(1);
    expect(list.body.data[0].name).toBe("Alpha");
    const single = await request(app).get(`/things/${id}`);
    expect(single.status).toBe(200);
    expect(single.body).toMatchObject({ id, name: "Alpha" });
  });

  test("Thing update + delete cycle", async () => {
    const create = await request(app)
      .post("/things")
      .send({ name: "Orig", desc: "x" });
    const id = create.body.id;
    const put = await request(app).put(`/things/${id}`).send({ name: "New" });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ id, name: "New", desc: null });
    const patch = await request(app)
      .patch(`/things/${id}`)
      .send({ desc: "patched" });
    expect(patch.status).toBe(200);
    const single = await request(app).get(`/things/${id}`);
    expect(single.body.desc).toBe("patched");
    const del = await request(app).delete(`/things/${id}`);
    expect(del.status).toBe(200);
    const after = await request(app).get(`/things/${id}`);
    expect(after.status).toBe(404);
  });

  // Custom id attribute tests removed (feature no longer supported)
});
