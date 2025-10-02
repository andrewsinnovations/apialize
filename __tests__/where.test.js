const express = require("express");
const request = require("supertest");
const bodyParser = require("body-parser");
const { list } = require("../src");
const { Sequelize, DataTypes } = require("sequelize");

// This test verifies that query string parameters are translated into a Sequelize where clause
// by the built-in apializeContext middleware used inside list().
describe("list() where clause integration (Sequelize sqlite::memory:)", () => {
  let sequelize;
  let Item;
  let app;
  let calls;

  beforeAll(async () => {
    sequelize = new Sequelize("sqlite::memory:", { logging: false });
    Item = sequelize.define(
      "Item",
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        type: { type: DataTypes.STRING, allowNull: false },
        name: { type: DataTypes.STRING, allowNull: false },
      },
      { tableName: "items", timestamps: false },
    );
    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    calls = [];
    await Item.destroy({ where: {}, truncate: true, restartIdentity: true });
    await Item.bulkCreate([
      { type: "fruit", name: "apple" },
      { type: "fruit", name: "banana" },
      { type: "veggie", name: "carrot" },
      { type: "fruit", name: "pear" },
    ]);

    // Patch findAndCountAll to observe options argument
    const original = Item.findAndCountAll.bind(Item);
    Item.findAndCountAll = async function patched(options) {
      calls.push(options || {});
      return original(options);
    };

    app = express();
    app.use(bodyParser.json());
    app.use("/items", list(Item)); // options-form signature
  });

  test("applies simple where filter from query", async () => {
    const res = await request(app).get("/items?type=fruit");
    expect(res.status).toBe(200);
    expect(res.body.meta.count).toBe(3);
    expect(res.body.data.every((r) => r.type === "fruit")).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0]).toHaveProperty("where");
    expect(calls[0].where).toMatchObject({ type: "fruit" });
  });

  test("applies multi-field where filter from query", async () => {
    const res = await request(app).get("/items?type=fruit&name=pear");
    expect(res.status).toBe(200);
    expect(res.body.meta.count).toBe(1);
    expect(res.body.data[0].name).toBe("pear");
    expect(calls[0].where).toMatchObject({ type: "fruit", name: "pear" });
  });

  test("empty query yields full set", async () => {
    const res = await request(app).get("/items");
    expect(res.status).toBe(200);
    expect(res.body.meta.count).toBe(4);
    expect(calls[calls.length - 1].where).toMatchObject({});
  });
});
