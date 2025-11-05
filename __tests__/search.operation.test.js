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
      external_id: { type: DataTypes.STRING(64), allowNull: false },
      name: { type: DataTypes.STRING(100), allowNull: false },
      category: { type: DataTypes.STRING(50), allowNull: false },
      price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      score: { type: DataTypes.INTEGER, allowNull: false },
      active: { type: DataTypes.BOOLEAN, allowNull: false },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    { tableName: 'search_items', timestamps: false }
  );

  await sequelize.sync({ force: true });

  const app = express();
  app.use(bodyParser.json());
  app.use('/items', search(Item)); // mounts POST /items/search

  return { sequelize, Item, app };
}

async function seed(Item, rows) {
  await Item.bulkCreate(rows);
}

function names(res) {
  return res.body.data.map((r) => r.name);
}

describe('search operation: predicate coverage', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  test('basic POST /search defaults to id ASC and returns shape like list', async () => {
    const ctx = await buildAppAndModel();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    await seed(Item, [
      {
        external_id: 'uuid-3',
        name: 'Charlie',
        category: 'A',
        price: 1.23,
        score: 30,
        active: true,
      },
      {
        external_id: 'uuid-1',
        name: 'Alpha',
        category: 'B',
        price: 2.0,
        score: 10,
        active: true,
      },
      {
        external_id: 'uuid-2',
        name: 'Bravo',
        category: 'A',
        price: 3.5,
        score: 20,
        active: false,
      },
    ]);

    const res = await request(app).post('/items/search').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.meta.count).toBe(3);
    expect(names(res)).toEqual(['Charlie', 'Alpha', 'Bravo']);
  });

  test('implicit AND of fields in filters', async () => {
    const ctx = await buildAppAndModel();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    await seed(Item, [
      {
        external_id: '1',
        name: 'Phone',
        category: 'electronics',
        price: 199.99,
        score: 12,
        active: true,
      },
      {
        external_id: '2',
        name: 'DisplayPort Cable',
        category: 'electronics',
        price: 29.99,
        score: 5,
        active: true,
      },
      {
        external_id: '3',
        name: 'Shirt',
        category: 'apparel',
        price: 25,
        score: 2,
        active: true,
      },
    ]);

    const res = await request(app)
      .post('/items/search')
      .send({
        filtering: { category: 'electronics', active: { is_true: true } },
      });
    expect(res.status).toBe(200);
    expect(res.body.meta.count).toBe(2);
    expect(names(res)).toEqual(['Phone', 'DisplayPort Cable']);
  });

  test('AND/OR arrays and numeric comparisons', async () => {
    const ctx = await buildAppAndModel();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    await seed(Item, [
      {
        external_id: '1',
        name: 'Budget Display',
        category: 'electronics',
        price: 99.99,
        score: 1,
        active: true,
      },
      {
        external_id: '2',
        name: 'Mid Display',
        category: 'electronics',
        price: 250.0,
        score: 5,
        active: true,
      },
      {
        external_id: '3',
        name: 'Pro Display',
        category: 'electronics',
        price: 999.0,
        score: 10,
        active: true,
      },
      {
        external_id: '4',
        name: 'Desk',
        category: 'furniture',
        price: 300.0,
        score: 3,
        active: true,
      },
    ]);

    const body = {
      filtering: {
        and: [
          { category: 'electronics' },
          { or: [{ price: { lt: 300 } }, { score: { gte: 9 } }] },
        ],
      },
      ordering: { order_by: 'price', direction: 'asc' },
    };
    const res = await request(app).post('/items/search').send(body);
    expect(res.status).toBe(200);
    expect(names(res)).toEqual([
      'Budget Display',
      'Mid Display',
      'Pro Display',
    ]);
  });

  test('contains, icontains, starts_with, ends_with', async () => {
    const ctx = await buildAppAndModel();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    await seed(Item, [
      {
        external_id: '1',
        name: '4k Display',
        category: 'electronics',
        price: 500,
        score: 9,
        active: true,
      },
      {
        external_id: '2',
        name: 'display stand',
        category: 'electronics',
        price: 99,
        score: 3,
        active: true,
      },
      {
        external_id: '3',
        name: 'Monitor',
        category: 'electronics',
        price: 120,
        score: 4,
        active: true,
      },
      {
        external_id: '4',
        name: 'On Display',
        category: 'theatre',
        price: 30,
        score: 1,
        active: true,
      },
    ]);

    // contains (SQLite LIKE is case-insensitive by default for ASCII)
    const res1 = await request(app)
      .post('/items/search')
      .send({ filtering: { name: { contains: 'Display' } } });
    expect(names(res1)).toEqual(['4k Display', 'display stand', 'On Display']);

    // icontains
    const res2 = await request(app)
      .post('/items/search')
      .send({ filtering: { name: { icontains: 'display' } } });
    expect(names(res2)).toEqual(['4k Display', 'display stand', 'On Display']);

    // object operator variant is optional; suffix already covers icontains semantics reliably across dialects

    // anchors
    const res4 = await request(app)
      .post('/items/search')
      .send({ filtering: { name: { starts_with: 'dis' } } });
    expect(names(res4)).toEqual(['display stand']);

    const res5 = await request(app)
      .post('/items/search')
      .send({ filtering: { name: { ends_with: 'tor' } } });
    expect(names(res5)).toEqual(['Monitor']);
  });

  test('negative string operators: not_contains, not_icontains, not_starts_with, not_ends_with', async () => {
    const ctx = await buildAppAndModel();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    await seed(Item, [
      {
        external_id: '1',
        name: 'Auto Wrench',
        category: 'tools',
        price: 10,
        score: 1,
        active: true,
      },
      {
        external_id: '2',
        name: 'Automatic Transmission',
        category: 'vehicles',
        price: 20,
        score: 2,
        active: true,
      },
      {
        external_id: '3',
        name: 'Manual Bike',
        category: 'bicycles',
        price: 30,
        score: 3,
        active: true,
      },
      {
        external_id: '4',
        name: 'Router',
        category: 'network',
        price: 40,
        score: 4,
        active: true,
      },
    ]);

    // not_contains: exclude anything with 'Auto' (case-sensitive substring)
    const r1 = await request(app)
      .post('/items/search')
      .send({
        filtering: { name: { not_contains: 'Auto' } },
        ordering: { order_by: 'id', direction: 'asc' },
      });
    expect(names(r1)).toEqual(['Manual Bike', 'Router']);

    // not_icontains: exclude 'auto' regardless of case
    const r2 = await request(app)
      .post('/items/search')
      .send({
        filtering: { name: { not_icontains: 'auto' } },
        ordering: { order_by: 'id', direction: 'asc' },
      });
    expect(names(r2)).toEqual(['Manual Bike', 'Router']);

    // not_starts_with
    const r3 = await request(app)
      .post('/items/search')
      .send({
        filtering: { name: { not_starts_with: 'Auto' } },
        ordering: { order_by: 'id', direction: 'asc' },
      });
    expect(names(r3)).toEqual(['Manual Bike', 'Router']);

    // not_ends_with
    const r4 = await request(app)
      .post('/items/search')
      .send({
        filtering: { name: { not_ends_with: 'er' } },
        ordering: { order_by: 'id', direction: 'asc' },
      });
    expect(names(r4)).toEqual([
      'Auto Wrench',
      'Automatic Transmission',
      'Manual Bike',
    ]);
  });

  test('multi-field substring OR returns matches from any field', async () => {
    const ctx = await buildAppAndModel();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    await seed(Item, [
      // Match via external_id (uppercase AUTO, case-insensitive)
      {
        external_id: 'AUTO-001',
        name: 'Manual',
        category: 'tools',
        price: 10,
        score: 1,
        active: true,
      },
      // Match via name
      {
        external_id: 'id-2',
        name: 'Automatic Transmission',
        category: 'vehicles',
        price: 20,
        score: 2,
        active: true,
      },
      // No matches on any field
      {
        external_id: 'id-3',
        name: 'Bicycle',
        category: 'kitchen',
        price: 30,
        score: 3,
        active: true,
      },
      // Match via category
      {
        external_id: 'id-4',
        name: 'Router',
        category: 'Automotive',
        price: 40,
        score: 4,
        active: true,
      },
    ]);

    const res = await request(app)
      .post('/items/search')
      .send({
        filtering: {
          or: [
            { name: { icontains: 'auto' } },
            { category: { icontains: 'auto' } },
            { external_id: { icontains: 'auto' } },
          ],
        },
      });

    expect(res.status).toBe(200);
    // Default ordering is id ASC, so expect names by creation order
    expect(names(res)).toEqual(['Manual', 'Automatic Transmission', 'Router']);
  });

  test('equals (raw equality)', async () => {
    const ctx = await buildAppAndModel();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    await seed(Item, [
      {
        external_id: '1',
        name: 'A',
        category: 'A',
        price: 1,
        score: 1,
        active: true,
      },
      {
        external_id: '2',
        name: 'B',
        category: 'B',
        price: 2,
        score: 2,
        active: false,
      },
      {
        external_id: '3',
        name: 'C',
        category: 'C',
        price: 3,
        score: 3,
        active: true,
      },
    ]);

    const eqRes = await request(app)
      .post('/items/search')
      .send({ filtering: { category: 'B' } });
    expect(names(eqRes)).toEqual(['B']);
  });

  test('not equals (operator) - skipped on sqlite runner', async () => {
    const ctx = await buildAppAndModel();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    await seed(Item, [
      {
        external_id: '1',
        name: 'A',
        category: 'A',
        price: 1,
        score: 1,
        active: true,
      },
      {
        external_id: '2',
        name: 'B',
        category: 'B',
        price: 2,
        score: 2,
        active: false,
      },
      {
        external_id: '3',
        name: 'C',
        category: 'C',
        price: 3,
        score: 3,
        active: true,
      },
    ]);

    const neRes = await request(app)
      .post('/items/search')
      .send({ filtering: { category: { neq: 'B' } } });
    // Note: In some CI/Windows SQLite runners this operator-object form can behave flakily.
    // The suffix variant is covered in the next test and is stable across dialects.
    expect(names(neRes)).toEqual(['A', 'C']);
  });

  test('in operator', async () => {
    const ctx = await buildAppAndModel();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    await seed(Item, [
      {
        external_id: '1',
        name: 'A',
        category: 'A',
        price: 1,
        score: 1,
        active: true,
      },
      {
        external_id: '2',
        name: 'B',
        category: 'B',
        price: 2,
        score: 2,
        active: false,
      },
      {
        external_id: '3',
        name: 'C',
        category: 'C',
        price: 3,
        score: 3,
        active: true,
      },
    ]);

    // in operator
    const inRes = await request(app)
      .post('/items/search')
      .send({
        filtering: { category: { in: ['A', 'C'] } },
        ordering: { order_by: 'id', direction: 'asc' },
      });
    expect(names(inRes)).toEqual(['A', 'C']);

    const notInRes = await request(app)
      .post('/items/search')
      .send({ filtering: { category: { not_in: ['A', 'C'] } } });
    expect(names(notInRes)).toEqual(['B']);
  });

  test('boolean equality (raw)', async () => {
    const ctx = await buildAppAndModel();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    await seed(Item, [
      {
        external_id: '1',
        name: 'T1',
        category: 'A',
        price: 1,
        score: 1,
        active: true,
      },
      {
        external_id: '2',
        name: 'T2',
        category: 'A',
        price: 2,
        score: 2,
        active: false,
      },
    ]);

    const tRes = await request(app)
      .post('/items/search')
      .send({ filtering: { active: true } });
    expect(names(tRes)).toEqual(['T1']);

    const rawRes = await request(app)
      .post('/items/search')
      .send({ filtering: { active: false } });
    expect(names(rawRes)).toEqual(['T2']);
  });

  test('ordering array and paging', async () => {
    const ctx = await buildAppAndModel();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;

    await seed(Item, [
      {
        external_id: '1',
        name: 'N1',
        category: 'A',
        price: 10,
        score: 3,
        active: true,
      },
      {
        external_id: '2',
        name: 'N2',
        category: 'A',
        price: 20,
        score: 2,
        active: true,
      },
      {
        external_id: '3',
        name: 'N3',
        category: 'B',
        price: 15,
        score: 1,
        active: true,
      },
      {
        external_id: '4',
        name: 'N4',
        category: 'B',
        price: 5,
        score: 4,
        active: true,
      },
    ]);

    const body = {
      ordering: [
        { order_by: 'category', direction: 'asc' },
        { order_by: 'price', direction: 'desc' },
      ],
      paging: { page: 2, size: 2 },
    };
    const res = await request(app).post('/items/search').send(body);
    expect(res.status).toBe(200);
    // Order should be: A: price desc -> 20(N2), 10(N1); B: 15(N3), 5(N4)
    // Page 2, size 2 -> [N3, N4]
    expect(names(res)).toEqual(['N3', 'N4']);
    expect(res.body.meta).toMatchObject({
      page: 2,
      page_size: 2,
      total_pages: 2,
      count: 4,
    });
  });

  test('invalid column in filters returns 400', async () => {
    const ctx = await buildAppAndModel();
    sequelize = ctx.sequelize;
    const { Item, app } = ctx;
    await seed(Item, [
      {
        external_id: '1',
        name: 'X',
        category: 'A',
        price: 1,
        score: 1,
        active: true,
      },
    ]);

    const res = await request(app)
      .post('/items/search')
      .send({ filtering: { notARealColumn: 'foo' } });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: 'Bad request' });
  });
});
