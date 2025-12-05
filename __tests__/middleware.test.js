const express = require('express');
const request = require('supertest');
const bodyParser = require('body-parser');
const { list, single } = require('../src');
const { Sequelize, DataTypes } = require('sequelize');

describe('middleware access control for odd numbers (Sequelize)', () => {
  let sequelize;
  let NumberModel;
  let model;
  let app;

  // Middleware that rejects even numbers
  function oddOnlyMiddleware(req, res, next) {
    // For list, filter after model
    if (req.params.id !== undefined && req.params.id !== null) {
      const id = parseInt(req.params.id, 10);
      if (id % 2 === 0) {
        return res.status(403).json({ error: 'Forbidden: Even number' });
      }
    } else {
      return res.status(400).json({ error: 'Bad Request: ID is required' });
    }
    next();
  }

  beforeAll(async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });
    NumberModel = sequelize.define(
      'Number',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true },
        value: { type: DataTypes.INTEGER, allowNull: false },
      },
      { tableName: 'numbers', timestamps: false }
    );
    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await NumberModel.destroy({ where: {}, truncate: true });
    // Seed 1..100
    const bulk = [];
    for (let i = 1; i <= 100; i++) {
      bulk.push({ id: i, value: i });
    }
    await NumberModel.bulkCreate(bulk);

    app = express();
    app.use(bodyParser.json());

    const oddNumbersFilter = (req, res, next) => {
      // Inject a where clause: value % 2 = 0 (SQLite supports %)
      req.apialize.apply_where({
        [Sequelize.Op.and]: Sequelize.literal('value % 2 = 1'),
      });
      next();
    };

    // List route (only odd numbers will be queried)
    app.use('/numbers', list(NumberModel, { middleware: [oddNumbersFilter] }));
    app.use(
      '/numbers',
      single(NumberModel, { middleware: [oddOnlyMiddleware] })
    );
  });

  test('list returns only odd numbers', async () => {
    const res = await request(app).get('/numbers');
    expect(res.body.meta.paging.count).toBe(50);
    expect(res.body.data.every((row) => row.value % 2 === 1)).toBe(true);
  });

  test('single returns odd number', async () => {
    const res = await request(app).get('/numbers/7');
    expect(res.status).toBe(200);
    expect(res.body.record.value).toBe(7);
  });

  test('single rejects even number', async () => {
    const res = await request(app).get('/numbers/8');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Forbidden/);
  });
});
