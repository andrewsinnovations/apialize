const express = require("express");
const bodyParser = require("body-parser");
const request = require("supertest");
const { Sequelize, DataTypes } = require("sequelize");
const { list, create } = require("../src");

/**
 * Ordering tests for list() using api:orderby and api:orderdir
 */

describe("list() ordering via api:orderby", () => {
  let sequelize;
  let Item;
  let app;

  beforeAll(async () => {
    sequelize = new Sequelize("sqlite::memory:", { logging: false });
    Item = sequelize.define(
      "Item",
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING },
        category: { type: DataTypes.STRING },
        score: { type: DataTypes.INTEGER },
      },
      { tableName: "items", timestamps: false },
    );
    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await Item.destroy({ where: {}, truncate: true, restartIdentity: true });
    await Item.bulkCreate([
      { name: "delta", category: "c", score: 50 },
      { name: "alpha", category: "a", score: 90 },
      { name: "charlie", category: "b", score: 70 },
      { name: "bravo", category: "b", score: 70 },
    ]);
    app = express();
    app.use(bodyParser.json());
    app.use("/items", list(Item));
  });

  test("single field ASC default", async () => {
    const res = await request(app).get("/items?api:orderby=name");
    const names = res.body.data.map((r) => r.name);
    expect(names).toEqual(["alpha", "bravo", "charlie", "delta"]);
  });

  test("single field global DESC", async () => {
    const res = await request(app).get("/items?api:orderby=name&api:orderdir=DESC");
    const names = res.body.data.map((r) => r.name);
    expect(names).toEqual(["delta", "charlie", "bravo", "alpha"]);
  });

  test("mixed explicit directions with global fallback", async () => {
    const res = await request(app).get("/items?api:orderby=-score,name");
    // score DESC (90,70,70,50) then name ASC among ties (bravo before charlie)
    const combos = res.body.data.map((r) => `${r.score}:${r.name}`);
    expect(combos).toEqual([
      "90:alpha",
      "70:bravo",
      "70:charlie",
      "50:delta",
    ]);
  });

  test("explicit + prefix ASC and - prefix DESC", async () => {
    const res = await request(app).get("/items?api:orderby=-score,+name");
    const combos = res.body.data.map((r) => `${r.score}:${r.name}`);
    expect(combos[0]).toBe("90:alpha");
    expect(combos[combos.length - 1]).toBe("50:delta");
  });
});
