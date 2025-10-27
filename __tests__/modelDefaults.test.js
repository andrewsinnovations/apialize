const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list } = require('../src');

/**
 * Tests for model.apialize defaults: page_size, orderby, orderdir
 */

describe('model.apialize default page_size + ordering', () => {
  let sequelize;
  let Item;
  let app;

  beforeAll(async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });
    Item = sequelize.define(
      'Item',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING },
        score: { type: DataTypes.INTEGER },
      },
      { tableName: 'items', timestamps: false }
    );
    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await Item.destroy({ where: {}, truncate: true, restartIdentity: true });
    const bulk = [];
    for (let i = 1; i <= 30; i++) {
      bulk.push({ name: `n${String(i).padStart(2, '0')}`, score: i % 5 });
    }
    await Item.bulkCreate(bulk);
    Item.apialize = { page_size: 7, orderby: 'name', orderdir: 'DESC' };
    app = express();
    app.use(bodyParser.json());
    app.use('/items', list(Item)); // unchanged semantics with new signature default
  });

  test('uses model default page_size when query missing', async () => {
    const res = await request(app).get('/items');
    expect(res.status).toBe(200);
    expect(res.body.meta.page_size).toBe(7);
    expect(res.body.data.length).toBe(7);
    // Ordered by name DESC (n30..n24)
    const names = res.body.data.map((r) => r.name);
    expect(names[0]).toBe('n30');
    expect(names[names.length - 1]).toBe('n24');
  });

  test('query api:pagesize overrides model default', async () => {
    const res = await request(app).get('/items?api:pagesize=3');
    expect(res.body.meta.page_size).toBe(3);
    expect(res.body.data.length).toBe(3);
  });

  test('model default order overwritten by query orderby + orderdir', async () => {
    const res = await request(app).get(
      '/items?api:orderby=+score,-name&api:orderdir=ASC'
    );
    // Expect score ASC then name DESC (because -name) among ties
    const combos = res.body.data.map((r) => `${r.score}:${r.name}`);
    // Since page_size=7 still applies, we only inspect first 7 combos.
    // Ensure first items are score 0 ascending groups
    expect(combos[0].startsWith('0:')).toBe(true);
    // At least one later item should have higher score
    expect(combos.some((c) => c.startsWith('1:'))).toBe(true);
  });
});
