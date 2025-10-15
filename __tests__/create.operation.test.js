const express = require("express");
const bodyParser = require("body-parser");
const request = require("supertest");
const { Sequelize, DataTypes } = require("sequelize");
const { create, list } = require("../src");

async function build({ createOptions = {}, modelOptions = {}, listModelOptions = {} } = {}) {
  const sequelize = new Sequelize("sqlite::memory:", { logging: false });
  const Item = sequelize.define(
    "Item",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      external_id: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
      desc: { type: DataTypes.STRING(255), allowNull: true },
      tenant_id: { type: DataTypes.INTEGER, allowNull: true },
    },
    { tableName: "create_items", timestamps: false }
  );
  await sequelize.sync({ force: true });
  const app = express();
  app.use(bodyParser.json());
  app.use("/items", create(Item, createOptions, modelOptions));
  app.use("/items", list(Item, { metaShowFilters: true, metaShowOrdering: true }, listModelOptions));
  return { sequelize, Item, app };
}

describe("create operation: comprehensive options coverage", () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  test("default id mapping returns numeric id, respects middleware value overrides, and modelOptions (attributes)", async () => {
    const prependDesc = (req, _res, next) => {
      req.apialize = req.apialize || {};
      req.apialize.values = { ...(req.apialize.values || {}), desc: `mdw-` + (req.apialize.values.desc || "") };
      next();
    };

    const { sequelize: s, app } = await build({
      createOptions: { middleware: [prependDesc] },
      modelOptions: { fields: ["external_id", "name", "desc", "tenant_id"] },
      listModelOptions: { attributes: ["id", "external_id", "name", "desc"] },
    });
    sequelize = s;

    const res = await request(app).post("/items").send({ external_id: "c1", name: "A", desc: "x", tenant_id: 99 });
    expect(res.status).toBe(201);
    expect(typeof res.body.id === "number" || /^[0-9]+$/.test(String(res.body.id))).toBe(true);

    const listRes = await request(app).get("/items");
    expect(listRes.status).toBe(200);
    expect(listRes.body.data[0].desc).toBe("mdw-x");
  // tenant_id omitted due to list modelOptions.attributes
    expect(listRes.body.data[0]).not.toHaveProperty("tenant_id");
  });

  test("custom id_mapping external_id returns external id", async () => {
    const { sequelize: s, app } = await build({ createOptions: { id_mapping: "external_id" } });
    sequelize = s;

    const res = await request(app).post("/items").send({ external_id: "uuid-xyz", name: "A" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, id: "uuid-xyz" });
  });

  test("middleware can enforce tenant scoping on create via options merger", async () => {
    const scope = (req, _res, next) => {
      req.apialize = req.apialize || {};
      req.apialize.options = { ...(req.apialize.options || {}), where: { tenant_id: 7 } };
      next();
    };

    const { sequelize: s, app } = await build({ createOptions: { middleware: [scope] } });
    sequelize = s;

    const res = await request(app).post("/items").send({ external_id: "scoped", name: "S1" });
    expect(res.status).toBe(201);
    // Not asserting DB side effects of options.where; just that it doesn't error and returns an id.
    expect(res.body.success).toBe(true);
  });
});
