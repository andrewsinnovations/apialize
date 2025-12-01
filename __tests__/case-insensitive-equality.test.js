const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list, search } = require('../src');

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

describe('case-insensitive equality for list and search operations', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  describe('list operation', () => {
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

      const res = await request(app).get(
        '/items?name:ieq=ALPHA&api:order_by=id'
      );
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

  describe('search operation', () => {
    test('default equality on string is case-insensitive', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;
      await seed(Item);

      const res = await request(app)
        .post('/items/search')
        .send({ filtering: { name: 'alpha' }, ordering: { order_by: 'id' } });
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
          filtering: { name: { ieq: 'ALPHA' } },
          ordering: { order_by: 'id' },
        });
      expect(res.status).toBe(200);
      expect(names(res)).toEqual(['Alpha', 'alpha']);
    });

    test('numeric equality remains exact', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;
      await seed(Item);

      const res = await request(app)
        .post('/items/search')
        .send({ filtering: { score: 2 } });
      expect(res.status).toBe(200);
      expect(names(res)).toEqual(['alpha']);
    });
  });

  describe('consistency between list and search operations', () => {
    test('both operations should return same results for case-insensitive queries', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;
      await seed(Item);

      // Test with list operation
      const listRes = await request(app).get(
        '/items?name=ALPHA&api:order_by=id'
      );
      expect(listRes.status).toBe(200);
      const listNames = names(listRes);

      // Test with search operation
      const searchRes = await request(app)
        .post('/items/search')
        .send({ filtering: { name: 'ALPHA' }, ordering: { order_by: 'id' } });
      expect(searchRes.status).toBe(200);
      const searchNames = names(searchRes);

      // Both should return the same results
      expect(listNames).toEqual(searchNames);
      expect(listNames).toEqual(['Alpha', 'alpha']);
    });

    test('both operations handle ieq operator consistently', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;
      await seed(Item);

      // Test with list operation using ieq
      const listRes = await request(app).get(
        '/items?name:ieq=alpha&api:order_by=id'
      );
      expect(listRes.status).toBe(200);
      const listNames = names(listRes);

      // Test with search operation using ieq
      const searchRes = await request(app)
        .post('/items/search')
        .send({
          filtering: { name: { ieq: 'alpha' } },
          ordering: { order_by: 'id' },
        });
      expect(searchRes.status).toBe(200);
      const searchNames = names(searchRes);

      // Both should return the same results
      expect(listNames).toEqual(searchNames);
      expect(listNames).toEqual(['Alpha', 'alpha']);
    });
  });
});
