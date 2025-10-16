const express = require("express");
const bodyParser = require("body-parser");
const request = require("supertest");
const { Sequelize, DataTypes } = require("sequelize");
const { list } = require("../src");

// Helper to build app with given list options and modelOptions
async function buildAppAndModel({ listOptions = {}, modelOptions = {}, modelApialize = {} } = {}) {
  const sequelize = new Sequelize("sqlite::memory:", { logging: false });
  const Item = sequelize.define(
    "Item",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      external_id: { type: DataTypes.STRING(64), allowNull: false },
      name: { type: DataTypes.STRING(100), allowNull: false },
      category: { type: DataTypes.STRING(50), allowNull: false },
      score: { type: DataTypes.INTEGER, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { tableName: "list_items", timestamps: false }
  );

  // Attach apialize model config for default ordering/page size when referenced by list
  Item.apialize = { ...(modelApialize || {}) };

  await sequelize.sync({ force: true });

  const app = express();
  app.use(bodyParser.json());
  app.use("/items", list(Item, listOptions, modelOptions));

  return { sequelize, Item, app };
}

async function seed(Item, rows) {
  await Item.bulkCreate(rows);
}

function names(res) {
  return res.body.data.map((r) => r.name);
}

function ids(res) {
  return res.body.data.map((r) => r.id);
}

describe("list operation: comprehensive options coverage", () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  test("basic list with no options returns all and defaults to id ASC", async () => {
    const ctx = await buildAppAndModel();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    await seed(Item, [
      { external_id: "uuid-3", name: "Charlie", category: "A", score: 30 },
      { external_id: "uuid-1", name: "Alpha", category: "B", score: 10 },
      { external_id: "uuid-2", name: "Bravo", category: "A", score: 20 },
    ]);

    const res = await request(app).get("/items");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.meta.count).toBe(3);
    // Default order is id ASC (in insertion order => 1,2,3)
    expect(names(res)).toEqual(["Charlie", "Alpha", "Bravo"]);
  });

  test("filtering by simple columns (category)", async () => {
    const ctx = await buildAppAndModel({ listOptions: { metaShowFilters: true } });
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    await seed(Item, [
      { external_id: "u1", name: "A1", category: "A", score: 1 },
      { external_id: "u2", name: "A2", category: "A", score: 2 },
      { external_id: "u3", name: "B1", category: "B", score: 3 },
    ]);

    const res = await request(app).get("/items?category=A");
    expect(res.status).toBe(200);
    expect(res.body.meta.count).toBe(2);
    expect(names(res)).toEqual(["A1", "A2"]);
    // meta.filters included when metaShowFilters is true
    expect(res.body.meta.filters).toEqual({ category: "A" });
  });

  test("ordering by one and multiple fields with global direction", async () => {
    const ctx = await buildAppAndModel({ listOptions: { metaShowOrdering: true } });
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    await seed(Item, [
      { external_id: "u1", name: "Zeta", category: "A", score: 2 },
      { external_id: "u2", name: "Alpha", category: "B", score: 2 },
      { external_id: "u3", name: "Alpha", category: "A", score: 1 },
    ]);

    // Single field DESC using sign
    const res1 = await request(app).get("/items?api:orderby=-name");
    expect(res1.status).toBe(200);
    expect(names(res1)).toEqual(["Zeta", "Alpha", "Alpha"]);
    expect(res1.body.meta.order).toEqual([["name", "DESC"]]);

    // Multiple fields with global ASC direction: category asc, then name asc
    const res2 = await request(app).get("/items?api:orderby=category,name&api:orderdir=ASC");
    expect(res2.status).toBe(200);
    expect(names(res2)).toEqual(["Alpha", "Zeta", "Alpha"]); // A: Alpha, Zeta; then B: Alpha
    expect(res2.body.meta.order).toEqual([["category", "ASC"], ["name", "ASC"]]);
  });

  test("invalid ordering column returns 400", async () => {
    const ctx = await buildAppAndModel();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;
    await seed(Item, [{ external_id: "u1", name: "A", category: "A", score: 1 }]);

    const res = await request(app).get("/items?api:orderby=invalidField");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: "Bad request" });
  });

  test("invalid filtering column returns 400", async () => {
    const ctx = await buildAppAndModel();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;
    await seed(Item, [{ external_id: "u1", name: "A", category: "A", score: 1 }]);

    const res = await request(app).get("/items?notARealColumn=foo");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: "Bad request" });
  });

  test("invalid filtering data type returns 400 (score expects number)", async () => {
    const ctx = await buildAppAndModel();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;
    await seed(Item, [
      { external_id: "u1", name: "A", category: "A", score: 1 },
      { external_id: "u2", name: "B", category: "B", score: 2 },
    ]);

    const res = await request(app).get("/items?score=notANumber");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: "Bad request" });
  });

  test("pagination via page and pagesize, defaults, and model apialize page_size", async () => {
    const ctx = await buildAppAndModel({ modelApialize: { page_size: 2 } });
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    await seed(Item, [
      { external_id: "u1", name: "N1", category: "A", score: 1 },
      { external_id: "u2", name: "N2", category: "A", score: 2 },
      { external_id: "u3", name: "N3", category: "A", score: 3 },
      { external_id: "u4", name: "N4", category: "A", score: 4 },
      { external_id: "u5", name: "N5", category: "A", score: 5 },
    ]);

    // No api:pagesize specified -> uses model apialize page_size (2)
    const page1 = await request(app).get("/items?api:page=1");
    expect(page1.status).toBe(200);
    expect(page1.body.meta.page).toBe(1);
    expect(page1.body.meta.page_size).toBe(2);
    expect(page1.body.meta.total_pages).toBe(3);
    expect(page1.body.meta.count).toBe(5);
    expect(names(page1)).toEqual(["N1", "N2"]);

    const page2 = await request(app).get("/items?api:page=2");
    expect(page2.status).toBe(200);
    expect(page2.body.meta.page).toBe(2);
    expect(names(page2)).toEqual(["N3", "N4"]);

  // Explicit pagesize overrides model config
  const page2size3 = await request(app).get("/items?api:page=2&api:pagesize=3");
  expect(page2size3.status).toBe(200);
  expect(page2size3.body.meta.page).toBe(2);
  expect(page2size3.body.meta.page_size).toBe(3);
  expect(page2size3.body.meta.total_pages).toBe(2); // ceil(5/3) = 2
  expect(names(page2size3)).toEqual(["N4", "N5"]);

  // Out-of-range page returns empty data but preserves meta
  const page3size3 = await request(app).get("/items?api:page=3&api:pagesize=3");
  expect(page3size3.status).toBe(200);
  expect(page3size3.body.meta.page).toBe(3);
  expect(page3size3.body.meta.total_pages).toBe(2);
  expect(names(page3size3)).toEqual([]);
  });

  test("disabling filtering and ordering via options", async () => {
    // allowFiltering: false should ignore query filters
    const ctx1 = await buildAppAndModel({ listOptions: { allowFiltering: false } });
    sequelize = ctx1.sequelize;
    const { Item: Item1, app: app1 } = ctx1;
    await seed(Item1, [
      { external_id: "u1", name: "A", category: "A", score: 1 },
      { external_id: "u2", name: "B", category: "B", score: 2 },
    ]);
    const resFilt = await request(app1).get("/items?category=A");
    expect(resFilt.status).toBe(200);
    // Without filtering, all rows are returned (default page size is large enough)
    expect(resFilt.body.meta.count).toBe(2);

    await sequelize.close();

    // allowOrdering: false should ignore query orderby and use model config or default order
    const ctx2 = await buildAppAndModel({ modelApialize: { orderby: "name", orderdir: "DESC" }, listOptions: { allowOrdering: false } });
    sequelize = ctx2.sequelize;
    const { Item: Item2, app: app2 } = ctx2;
    await seed(Item2, [
      { external_id: "u1", name: "Alpha", category: "A", score: 1 },
      { external_id: "u2", name: "Bravo", category: "B", score: 2 },
      { external_id: "u3", name: "Charlie", category: "C", score: 3 },
    ]);

    const resOrd = await request(app2).get("/items?api:orderby=id"); // should be ignored
    expect(resOrd.status).toBe(200);
    // Uses model.apialize orderby DESC by name -> Charlie, Bravo, Alpha
    expect(names(resOrd)).toEqual(["Charlie", "Bravo", "Alpha"]);
  });

  test("listing by external id uses external_id as id and supports filtering", async () => {
    const ctx = await buildAppAndModel({ 
      listOptions: { defaultOrderBy: "external_id", metaShowOrdering: true },
      // Alias external_id to id so clients consume uuid as the id field
      modelOptions: { attributes: [["external_id", "id"], "name", "category", "score"] },
    });
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;
    await seed(Item, [
      { external_id: "b-uuid", name: "Bee", category: "A", score: 2 },
      { external_id: "a-uuid", name: "Aye", category: "A", score: 1 },
      { external_id: "c-uuid", name: "Cee", category: "B", score: 3 },
    ]);

  // With no api:orderby, list should use defaultOrderBy external_id ASC
    const res = await request(app).get("/items");
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(["Aye", "Bee", "Cee"]);
    expect(res.body.meta.order).toEqual([["external_id", "ASC"]]);
  // Confirm id is the external_id for all records, and external_id is not separately present
  const rows = res.body.data;
  const expectedIds = ["a-uuid", "b-uuid", "c-uuid"];
  expect(rows.map(r => r.id)).toEqual(expectedIds);
  expect(rows.every(r => typeof r.external_id === "undefined")).toBe(true);

    // Filter by external_id still works even when it's aliased to id in output
    const resFilter = await request(app).get("/items?external_id=b-uuid");
    expect(resFilter.status).toBe(200);
    expect(resFilter.body.meta.count).toBe(1);
    expect(names(resFilter)).toEqual(["Bee"]);
    expect(resFilter.body.data[0].id).toBe("b-uuid");
    expect("external_id" in resFilter.body.data[0]).toBe(false);
  });

  test("list id_mapping: default order by id uses mapped field and rows expose mapped id", async () => {
    const ctx = await buildAppAndModel({
      listOptions: { id_mapping: "external_id" },
    });
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;
    await seed(Item, [
      { external_id: "b", name: "Bee", category: "A", score: 2 },
      { external_id: "a", name: "Aye", category: "A", score: 1 },
      { external_id: "c", name: "Cee", category: "B", score: 3 },
    ]);

    // With no api:orderby, list should order by external_id ASC because id_mapping is external_id
    const res = await request(app).get("/items");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Names should be ordered by external_id: a, b, c
    expect(res.body.data.map(r => r.name)).toEqual(["Aye", "Bee", "Cee"]);
    // id field should be normalized to external_id values
    expect(res.body.data.map(r => r.id)).toEqual(["a", "b", "c"]);
  });

  test("multi-column filter: case-insensitive OR across fields", async () => {
    const ctx = await buildAppAndModel();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    await seed(Item, [
      { external_id: "u1", name: "Alpha", category: "Zed", score: 1 },
      { external_id: "u2", name: "Bravo", category: "ALpine", score: 2 },
      { external_id: "u3", name: "Charlie", category: "Bee", score: 3 },
    ]);

    // filter 'al' should match name: Alpha and category: ALpine (case-insensitive)
    const res = await request(app).get("/items?api:filter=al&api:filterfields=name,category");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.meta.count).toBe(2);
    expect(names(res)).toEqual(["Alpha", "Bravo"]);
  });

  test("multi-column filter can be disabled via option", async () => {
    const ctx = await buildAppAndModel({ listOptions: { allowMultiColumnFiltering: false } });
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    await seed(Item, [
      { external_id: "u1", name: "Alpha", category: "Zed", score: 1 },
      { external_id: "u2", name: "Bravo", category: "ALpine", score: 2 },
      { external_id: "u3", name: "Charlie", category: "Bee", score: 3 },
    ]);

    const res = await request(app).get("/items?api:filter=al&api:filterfields=name,category");
    expect(res.status).toBe(200);
    // With filtering disabled, all rows are returned (no other filters applied)
    expect(res.body.meta.count).toBe(3);
    expect(names(res)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  test("multi-column filter: invalid field returns 400", async () => {
    const ctx = await buildAppAndModel();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;
    await seed(Item, [{ external_id: "u1", name: "Alpha", category: "Zed", score: 1 }]);

    const res = await request(app).get("/items?api:filter=al&api:filterfields=name,notARealColumn");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: "Bad request" });
  });
});
