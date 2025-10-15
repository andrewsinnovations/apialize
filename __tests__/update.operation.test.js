const express = require("express");
const bodyParser = require("body-parser");
const request = require("supertest");
const { Sequelize, DataTypes } = require("sequelize");
const { create, single, update } = require("../src");

// Build a fresh app + model per test to isolate middleware/params
async function build({ mountSingle = true, mountCreate = true, updateOptions = {}, modelOptions = {} } = {}) {
  const sequelize = new Sequelize("sqlite::memory:", { logging: false });
  const Item = sequelize.define(
    "Item",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      external_id: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
      desc: { type: DataTypes.STRING(255), allowNull: true },
      flag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      category: { type: DataTypes.STRING(32), allowNull: true, defaultValue: "uncat" },
      user_id: { type: DataTypes.INTEGER, allowNull: true },
      tenant_id: { type: DataTypes.INTEGER, allowNull: true },
    },
    { tableName: "update_items", timestamps: false }
  );
  await sequelize.sync({ force: true });

  const app = express();
  app.use(bodyParser.json());
  if (mountCreate) app.use("/items", create(Item));
  if (mountSingle) app.use("/items", single(Item, { id_mapping: updateOptions.id_mapping || "id" }));
  app.use("/items", update(Item, updateOptions, modelOptions));

  return { sequelize, Item, app };
}

async function seed(Item, rows) {
  await Item.bulkCreate(rows);
}

async function getRecord(Item, where) {
  const row = await Item.findOne({ where });
  return row && row.get({ plain: true });
}

describe("update operation: comprehensive options coverage", () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  test("default id mapping with full-replace semantics (unspecified -> default/null)", async () => {
    const ctx = await build();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    // Create an item with non-defaults
    const created = await request(app).post("/items").send({
      external_id: "ex-1",
      name: "Alpha",
      desc: "has-desc",
      flag: false, // will be reset to default (true) by PUT when unspecified
      category: "catA",
      user_id: 1,
      tenant_id: 10,
    });
    expect(created.status).toBe(201);
    const id = created.body.id;

  // PUT with only name provided would null external_id (NOT NULL). Include external_id to preserve it.
  const put = await request(app).put(`/items/${id}`).send({ name: "Beta", external_id: "ex-1" });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ success: true });

    const rec = await getRecord(Item, { id });
    expect(rec.name).toBe("Beta");
    expect(rec.desc).toBeNull(); // no default -> null
    expect(rec.flag).toBe(true); // defaultValue restored
    expect(rec.category).toBe("uncat"); // defaultValue restored
    expect(rec.external_id).toBe("ex-1"); // unchanged
  });

  test("cannot change numeric id even if provided in body (default id)", async () => {
    const ctx = await build();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    const created = await request(app).post("/items").send({ external_id: "ex-2", name: "A" });
    expect(created.status).toBe(201);
    const id = created.body.id;

  // Try to change numeric id in body; it should be ignored/overridden. Preserve external_id to satisfy NOT NULL.
  const put = await request(app).put(`/items/${id}`).send({ name: "B", id: 999, external_id: "ex-2" });
    expect(put.status).toBe(200);

    const rec = await getRecord(Item, { id });
    expect(rec.id).toBe(id);
  expect(rec.external_id).toBe("ex-2");
    expect(rec.name).toBe("B");
  });

  test("id_mapping: external_id with full-replace semantics and mapping immutability", async () => {
    const ctx = await build({ updateOptions: { id_mapping: "external_id" } });
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    const created = await request(app).post("/items").send({ external_id: "ext-A", name: "A", desc: "x", category: "c" });
    expect(created.status).toBe(201);

    const put = await request(app)
      .put(`/items/ext-A`)
      .send({ name: "B", external_id: "ext-B" }); // attempt to change mapping should be ignored
    expect(put.status).toBe(200);

    const rec = await getRecord(Item, { external_id: "ext-A" });
    expect(rec).toBeTruthy();
    expect(rec.name).toBe("B");
    expect(rec.external_id).toBe("ext-A"); // unchanged
    expect(rec.desc).toBeNull(); // unspecified -> null
    expect(rec.category).toBe("uncat"); // reset to default
  });

  test("ownership scoping via query filters: mismatch returns 404, match updates (preserve scoped fields)", async () => {
    const ctx = await build();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    const r1 = await request(app).post("/items").send({ external_id: "o1", name: "N1", user_id: 1 });
    const r2 = await request(app).post("/items").send({ external_id: "o2", name: "N2", user_id: 2 });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);

    const id2 = r2.body.id;
    const id1 = r1.body.id;

    // Attempt to update record 2 while scoping to user_id=1 -> not found
    const miss = await request(app).put(`/items/${id2}?user_id=1`).send({ name: "NOOP" });
    expect(miss.status).toBe(404);

    // Correct scope updates
  const ok = await request(app).put(`/items/${id1}?user_id=1`).send({ name: "Scoped", user_id: "1", external_id: "o1" });
    expect(ok.status).toBe(200);
    const rec = await getRecord(Item, { id: id1 });
    expect(rec.name).toBe("Scoped");
  });

  test("middleware can enforce tenant scoping via req.apialize.options.where (preserve scoped fields)", async () => {
    const tenantMiddleware = (req, _res, next) => {
      req.apialize = req.apialize || {};
      req.apialize.options = req.apialize.options || {};
      req.apialize.options.where = { ...(req.apialize.options.where || {}), tenant_id: 123 };
      next();
    };

    const ctx = await build({ updateOptions: { middleware: [tenantMiddleware] } });
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    const t1 = await request(app).post("/items").send({ external_id: "t1", name: "T1", tenant_id: 123 });
    const t2 = await request(app).post("/items").send({ external_id: "t2", name: "T2", tenant_id: 999 });
    expect(t1.status).toBe(201);
    expect(t2.status).toBe(201);

    // Correct tenant updates
  const ok = await request(app).put(`/items/${t1.body.id}`).send({ name: "T1-upd", tenant_id: 123, external_id: "t1" });
    expect(ok.status).toBe(200);

    // Wrong tenant -> 404
  const miss = await request(app).put(`/items/${t2.body.id}`).send({ name: "T2-upd", tenant_id: 123, external_id: "t2" });
    expect(miss.status).toBe(404);
  });

  test("middleware can modify values prior to update (category locked)", async () => {
    const lockCategory = (req, _res, next) => {
      req.apialize = req.apialize || {};
      req.apialize.values = { ...(req.apialize.values || {}), category: "locked" };
      next();
    };

    const ctx = await build({ updateOptions: { middleware: [lockCategory] } });
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    const created = await request(app).post("/items").send({ external_id: "val-1", name: "A", category: "open" });
    expect(created.status).toBe(201);

  const put = await request(app).put(`/items/${created.body.id}`).send({ name: "B", category: "should-be-ignored", external_id: "val-1" });
    expect(put.status).toBe(200);

    const rec = await getRecord(Item, { id: created.body.id });
    expect(rec.name).toBe("B");
    expect(rec.category).toBe("locked"); // middleware override applied
  });

  test("404 when record not found (default id mapping)", async () => {
    const ctx = await build();
    sequelize = ctx.sequelize;
    const { app } = ctx;

    const put = await request(app).put(`/items/9999`).send({ name: "Nope" });
    expect(put.status).toBe(404);
  });

  test("id_mapping external_id: 404 when record not found", async () => {
    const ctx = await build({ updateOptions: { id_mapping: "external_id" } });
    sequelize = ctx.sequelize;
    const { app } = ctx;

    const put = await request(app).put(`/items/missing-exid`).send({ name: "Nope" });
    expect(put.status).toBe(404);
  });
});
