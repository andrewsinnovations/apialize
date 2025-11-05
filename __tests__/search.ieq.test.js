const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { search } = require('../src');

async function buildAppAndModel() {
  const sequelize = new Sequelize('sqlite::memory:', { logging: false });
  const Item = sequelize.define(
    'Item',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
      score: { type: DataTypes.INTEGER, allowNull: false },
    },
    { tableName: 'items_search_ieq', timestamps: false }
  );

  await sequelize.sync({ force: true });

  const app = express();
  app.use(bodyParser.json());
  app.use('/items', search(Item)); // POST /items/search

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

describe('search operation: ieq operator and default case-insensitive equality', () => {
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

    const res = await request(app)
      .post('/items/search')
      .send({ filters: { name: 'alpha' }, ordering: { orderby: 'id' } });
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['Alpha', 'alpha']);
  });

  test('ieq operator performs case-insensitive equality', async () => {
    const ctx = await buildAppAndModel();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;
    await seed(Item);

    const res = await request(app)
      .post('/items/search')
      .send({
        filters: { name: { ieq: 'ALPHA' } },
        ordering: { orderby: 'id' },
      });
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['Alpha', 'alpha']);
  });
});
