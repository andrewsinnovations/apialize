const express = require("express");
const bodyParser = require("body-parser");
const request = require("supertest");
const { Sequelize, DataTypes } = require("sequelize");
const { create, single, destroy } = require("../src");

async function build({ destroyOptions = {}, modelOptions = {} } = {}) {
  const sequelize = new Sequelize("sqlite::memory:", { logging: false });
  const Item = sequelize.define(
    "Item",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      external_id: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
      user_id: { type: DataTypes.INTEGER, allowNull: true },
      parent_id: { type: DataTypes.INTEGER, allowNull: true },
    },
    { tableName: "destroy_items", timestamps: false }
  );
  await sequelize.sync({ force: true });

  const app = express();
  app.use(bodyParser.json());
  app.use("/items", create(Item));
  app.use("/items", single(Item));
  app.use("/items", destroy(Item, destroyOptions, modelOptions));
  return { sequelize, Item, app };
}

describe("destroy operation: comprehensive options coverage", () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  test("default id mapping deletes by numeric id and returns success with id", async () => {
    const { sequelize: s, app, Item } = await build();
    sequelize = s;

    const created = await request(app).post("/items").send({ external_id: "d1", name: "A" });
    const id = created.body.id;

    const del = await request(app).delete(`/items/${id}`);
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ success: true, id: String(id) });

    const get404 = await request(app).get(`/items/${id}`);
    expect(get404.status).toBe(404);
  });

  test("id_mapping: external_id deletes by external id", async () => {
    const { sequelize: s, app } = await build({ destroyOptions: { id_mapping: "external_id" } });
    sequelize = s;

    await request(app).post("/items").send({ external_id: "ex-d1", name: "A" });
    const del = await request(app).delete(`/items/ex-d1`);
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ success: true, id: "ex-d1" });

    const get404 = await request(app).get(`/items/ex-d1`);
    expect(get404.status).toBe(404);
  });

  test("ownership scoping via query filters prevents deleting foreign records", async () => {
    const { sequelize: s, app } = await build();
    sequelize = s;

    const a = await request(app).post("/items").send({ external_id: "a", name: "A", user_id: 1 });
    const b = await request(app).post("/items").send({ external_id: "b", name: "B", user_id: 2 });

    // Wrong scope -> 404
    const miss = await request(app).delete(`/items/${b.body.id}?user_id=1`);
    expect(miss.status).toBe(404);

    // Right scope
    const ok = await request(app).delete(`/items/${a.body.id}?user_id=1`);
    expect(ok.status).toBe(200);
  });

  test("middleware can enforce parent scoping via req.apialize.options.where", async () => {
    const scope = (req, _res, next) => {
      req.apialize = req.apialize || {};
      req.apialize.options = req.apialize.options || {};
      req.apialize.options.where = { ...(req.apialize.options.where || {}), parent_id: 50 };
      next();
    };

    const { sequelize: s, app } = await build({ destroyOptions: { middleware: [scope] } });
    sequelize = s;

    const t1 = await request(app).post("/items").send({ external_id: "t1", name: "T1", parent_id: 50 });
    await request(app).post("/items").send({ external_id: "t2", name: "T2", parent_id: 999 });

    const ok = await request(app).delete(`/items/${t1.body.id}`);
    expect(ok.status).toBe(200);

    const miss = await request(app).delete(`/items/${t1.body.id}`);
    expect(miss.status).toBe(404); // already deleted under parent scope
  });

  test("404 when record not found (default and custom mapping)", async () => {
    const { sequelize: s, app } = await build();
    sequelize = s;

    const missDefault = await request(app).delete(`/items/9999`);
    expect(missDefault.status).toBe(404);

    const { sequelize: s2, app: app2 } = await build({ destroyOptions: { id_mapping: "external_id" } });
    await request(app2).post("/items").send({ external_id: "exists", name: "X" });
    const del = await request(app2).delete(`/items/exists`);
    expect(del.status).toBe(200);
    const missCustom = await request(app2).delete(`/items/not-exists`);
    expect(missCustom.status).toBe(404);
    await s2.close();
  });
});
