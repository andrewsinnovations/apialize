const express = require("express");
const bodyParser = require("body-parser");
const request = require("supertest");
const { Sequelize, DataTypes } = require("sequelize");
const { create, single, patch } = require("../src");

async function build({
  mountSingle = true,
  mountCreate = true,
  patchOptions = {},
  modelOptions = {},
} = {}) {
  const sequelize = new Sequelize("sqlite::memory:", { logging: false });
  const Item = sequelize.define(
    "Item",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      external_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
      },
      name: { type: DataTypes.STRING(100), allowNull: false },
      desc: { type: DataTypes.STRING(255), allowNull: true },
      flag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      user_id: { type: DataTypes.INTEGER, allowNull: true },
      parent_id: { type: DataTypes.INTEGER, allowNull: true },
    },
    { tableName: "patch_items", timestamps: false },
  );
  await sequelize.sync({ force: true });

  const app = express();
  app.use(bodyParser.json());
  if (mountCreate) app.use("/items", create(Item));
  if (mountSingle)
    app.use(
      "/items",
      single(Item, { id_mapping: patchOptions.id_mapping || "id" }),
    );
  app.use("/items", patch(Item, patchOptions, modelOptions));

  return { sequelize, Item, app };
}

async function getRecord(Item, where) {
  const row = await Item.findOne({ where });
  return row && row.get({ plain: true });
}

describe("patch operation: comprehensive options coverage", () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  test("partial update only changes provided fields and ignores id mapping field", async () => {
    const ctx = await build();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    const created = await request(app)
      .post("/items")
      .send({ external_id: "p-1", name: "Alpha", desc: "x", flag: false });
    expect(created.status).toBe(201);
    const id = created.body.id;

    // Attempt to patch name and include id/external_id in body; mapping field must be ignored
    const res = await request(app)
      .patch(`/items/${id}`)
      .send({ name: "Beta", id: 999, external_id: "nope" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, id: String(id) });

    const rec = await getRecord(Item, { id });
    expect(rec.name).toBe("Beta");
    expect(rec.desc).toBe("x");
    expect(rec.flag).toBe(false);
    // external_id is not the id_mapping here, so it should be updated
    expect(rec.external_id).toBe("nope");
  });

  test("id_mapping: external_id returns param id and updates partially", async () => {
    const ctx = await build({ patchOptions: { id_mapping: "external_id" } });
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    await request(app)
      .post("/items")
      .send({ external_id: "ext-1", name: "A", desc: "x" });

    const res = await request(app)
      .patch(`/items/ext-1`)
      .send({ desc: "patched" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, id: "ext-1" });

    const rec = await getRecord(Item, { external_id: "ext-1" });
    expect(rec.name).toBe("A");
    expect(rec.desc).toBe("patched");
  });

  test("empty patch responds success when record exists, otherwise 404", async () => {
    const ctx = await build();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;
    const created = await request(app)
      .post("/items")
      .send({ external_id: "p-2", name: "X" });
    const id = created.body.id;

    const ok = await request(app).patch(`/items/${id}`).send({});
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ success: true, id: String(id) });

    const miss = await request(app).patch(`/items/9999`).send({});
    expect(miss.status).toBe(404);
  });

  test("ownership scoping via query filters: mismatch returns 404, match updates", async () => {
    const ctx = await build();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;
    const r1 = await request(app)
      .post("/items")
      .send({ external_id: "u1", name: "N1", user_id: 1 });
    const r2 = await request(app)
      .post("/items")
      .send({ external_id: "u2", name: "N2", user_id: 2 });

    const miss = await request(app)
      .patch(`/items/${r2.body.id}?user_id=1`)
      .send({ name: "no" });
    expect(miss.status).toBe(404);

    const ok = await request(app)
      .patch(`/items/${r1.body.id}?user_id=1`)
      .send({ name: "yes" });
    expect(ok.status).toBe(200);
    const rec = await getRecord(Item, { id: r1.body.id });
    expect(rec.name).toBe("yes");
  });

  test("middleware can enforce parent scoping and modify values", async () => {
    const scope = (req, _res, next) => {
      req.apialize = req.apialize || {};
      req.apialize.options = req.apialize.options || {};
      req.apialize.options.where = {
        ...(req.apialize.options.where || {}),
        parent_id: 8,
      };
      next();
    };
    const override = (req, _res, next) => {
      req.apialize = req.apialize || {};
      req.apialize.values = { ...(req.apialize.values || {}), desc: "locked" };
      next();
    };

    const ctx = await build({
      patchOptions: { middleware: [scope, override] },
    });
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    const t1 = await request(app)
      .post("/items")
      .send({ external_id: "t1", name: "A", parent_id: 8 });
    await request(app)
      .post("/items")
      .send({ external_id: "t2", name: "B", parent_id: 9 });

    const ok = await request(app)
      .patch(`/items/${t1.body.id}`)
      .send({ name: "A+" });
    expect(ok.status).toBe(200);

    const miss = await request(app)
      .patch(`/items/${t1.body.id}`)
      .send({ name: "A++" });
    expect(miss.status).toBe(200); // Still scoped to parent 8 by middleware; same record

    const rec = await getRecord(Item, { id: t1.body.id });
    expect(rec.name).toBe("A++");
    expect(rec.desc).toBe("locked");
  });

  test("404 when record not found with custom id_mapping", async () => {
    const ctx = await build({ patchOptions: { id_mapping: "external_id" } });
    sequelize = ctx.sequelize;
    const { app } = ctx;

    const res = await request(app)
      .patch(`/items/not-there`)
      .send({ name: "nope" });
    expect(res.status).toBe(404);
  });

  test("pre/post hooks: transaction present and payload mutated (patch)", async () => {
    const ctx = await build({
      patchOptions: {
        pre: async (context) => {
          expect(context.transaction).toBeTruthy();
          expect(typeof context.transaction.commit).toBe("function");
          return { ok: true };
        },
        post: async (context) => {
          expect(context.preResult).toEqual({ ok: true });
          context.payload.hook = "post";
        },
      },
    });
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    const created = await request(app)
      .post("/items")
      .send({ external_id: "hook-p1", name: "A" });
    const id = created.body.id;

    const res = await request(app).patch(`/items/${id}`).send({ name: "B" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.hook).toBe("post");
  });

  test("array pre/post hooks: multiple functions execute in order (patch)", async () => {
    const executionOrder = [];
    const ctx = await build({
      patchOptions: {
        pre: [
          async (context) => {
            executionOrder.push("pre1");
            expect(context.transaction).toBeTruthy();
            return { step: 1 };
          },
          async (context) => {
            executionOrder.push("pre2");
            expect(context.transaction).toBeTruthy();
            return { step: 2 };
          },
          async (context) => {
            executionOrder.push("pre3");
            expect(context.transaction).toBeTruthy();
            return { step: 3, finalPre: true };
          },
        ],
        post: [
          async (context) => {
            executionOrder.push("post1");
            expect(context.preResult).toEqual({ step: 3, finalPre: true });
            context.payload.hook1 = "executed";
          },
          async (context) => {
            executionOrder.push("post2");
            expect(context.payload.hook1).toBe("executed");
            context.payload.hook2 = "also-executed";
          },
        ],
      },
    });
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    // First create an item
    const created = await request(app)
      .post("/items")
      .send({ external_id: "array-hooks-p1", name: "ArrayPatchTest" });
    expect(created.status).toBe(201);
    const id = created.body.id;

    // Then patch it with array hooks
    const patched = await request(app)
      .patch(`/items/${id}`)
      .send({ name: "ArrayPatchTestPatched" });
    
    expect(patched.status).toBe(200);
    expect(patched.body.success).toBe(true);
    expect(patched.body.hook1).toBe("executed");
    expect(patched.body.hook2).toBe("also-executed");
    expect(executionOrder).toEqual(["pre1", "pre2", "pre3", "post1", "post2"]);
  });
});
