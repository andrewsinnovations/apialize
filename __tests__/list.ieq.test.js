const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list } = require('../src');

async function buildAppAndModel() {
  const sequelize = new Sequelize('sqlite::memory:', { logging: false });
  const Item = sequelize.define(
    'Item',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
      score: { type: DataTypes.INTEGER, allowNull: false },
    },
    { tableName: 'items_ieq', timestamps: false }
  );

  await sequelize.sync({ force: true });

  const app = express();
  app.use(bodyParser.json());
  app.use('/items', list(Item)); // GET /items

  return { sequelize, Item, app };
}

async function seed(Item) {
  await Item.bulkCreate([
    { name: 'Alpha', score: 1 },
    { name: 'alpha', score: 2 },
    { name: 'Bravo', score: 3 },
  ]);
}

function names(res) {
  return res.body.data.map((r) => r.name);
}

describe('list operation: default case-insensitive equality and ieq operator', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  test('default equality on string is case-insensitive', async () => {
    const ctx = await buildAppAndModel();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;
    await seed(Item);

    // name=alpha should match both 'Alpha' and 'alpha' (case-insensitive equality)
    const res = await request(app).get('/items?name=alpha&api:order_by=id');
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['Alpha', 'alpha']);
  });

  test('ieq operator forces case-insensitive equality', async () => {
    const ctx = await buildAppAndModel();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;
    await seed(Item);

    const res = await request(app).get('/items?name:ieq=ALPHA&api:order_by=id');
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['Alpha', 'alpha']);
  });

  test('numeric equality remains exact', async () => {
    const ctx = await buildAppAndModel();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;
    await seed(Item);

    const res = await request(app).get('/items?score=2');
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['alpha']);
  });
});
