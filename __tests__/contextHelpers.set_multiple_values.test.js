const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { create } = require('../src');

describe('Context Helper: set_multiple_values', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  async function buildAppAndModel(createOptions = {}) {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    const Item = sequelize.define(
      'Item',
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        name: {
          type: DataTypes.STRING(100),
          allowNull: false,
        },
        description: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        price: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: true,
        },
        status: {
          type: DataTypes.STRING(20),
          allowNull: true,
        },
      },
      {
        tableName: 'items',
        timestamps: false,
      }
    );

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());
    app.use('/items', create(Item, createOptions));

    return { Item, app };
  }

  test('set_multiple_values works with object syntax', async () => {
    const { Item, app } = await buildAppAndModel({
      middleware: [
        (req, res, next) => {
          req.apialize.set_multiple_values({
            description: 'Set via object',
            price: 99.99,
            status: 'active',
          });
          next();
        },
      ],
    });

    const res = await request(app).post('/items').send({
      name: 'Product A',
    });

    expect(res.status).toBe(201);
    const item = await Item.findByPk(res.body.id);
    expect(item.name).toBe('Product A');
    expect(item.description).toBe('Set via object');
    expect(parseFloat(item.price)).toBe(99.99);
    expect(item.status).toBe('active');
  });

  test('set_multiple_values works with array of [key, value] pairs', async () => {
    const { Item, app } = await buildAppAndModel({
      middleware: [
        (req, res, next) => {
          req.apialize.set_multiple_values([
            ['description', 'Set via array'],
            ['price', 149.99],
            ['status', 'pending'],
          ]);
          next();
        },
      ],
    });

    const res = await request(app).post('/items').send({
      name: 'Product B',
    });

    expect(res.status).toBe(201);
    const item = await Item.findByPk(res.body.id);
    expect(item.name).toBe('Product B');
    expect(item.description).toBe('Set via array');
    expect(parseFloat(item.price)).toBe(149.99);
    expect(item.status).toBe('pending');
  });

  test('set_multiple_values overwrites user-provided values', async () => {
    const { Item, app } = await buildAppAndModel({
      middleware: [
        (req, res, next) => {
          req.apialize.set_multiple_values({
            description: 'Overwritten by middleware',
            price: 199.99,
          });
          next();
        },
      ],
    });

    const res = await request(app).post('/items').send({
      name: 'Product C',
      description: 'User description',
      price: 50.0,
    });

    expect(res.status).toBe(201);
    const item = await Item.findByPk(res.body.id);
    expect(item.description).toBe('Overwritten by middleware');
    expect(parseFloat(item.price)).toBe(199.99);
  });

  test('set_multiple_values can be called multiple times', async () => {
    const { Item, app } = await buildAppAndModel({
      middleware: [
        (req, res, next) => {
          req.apialize.set_multiple_values({ description: 'First' });
          req.apialize.set_multiple_values({ price: 99.99 });
          req.apialize.set_multiple_values({ status: 'active' });
          next();
        },
      ],
    });

    const res = await request(app).post('/items').send({
      name: 'Product D',
    });

    expect(res.status).toBe(201);
    const item = await Item.findByPk(res.body.id);
    expect(item.description).toBe('First');
    expect(parseFloat(item.price)).toBe(99.99);
    expect(item.status).toBe('active');
  });

  test('set_multiple_values throws error for invalid array format', async () => {
    const { app } = await buildAppAndModel({
      middleware: [
        (req, res, next) => {
          try {
            req.apialize.set_multiple_values(['invalid', 'array', 'format']);
            next();
          } catch (error) {
            res.status(500).json({ error: error.message });
          }
        },
      ],
    });

    const res = await request(app).post('/items').send({
      name: 'Product E',
    });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('[key, value] pairs');
  });

  test('set_multiple_values throws error for non-object and non-array', async () => {
    const { app } = await buildAppAndModel({
      middleware: [
        (req, res, next) => {
          try {
            req.apialize.set_multiple_values('invalid');
            next();
          } catch (error) {
            res.status(500).json({ error: error.message });
          }
        },
      ],
    });

    const res = await request(app).post('/items').send({
      name: 'Product F',
    });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('must be an object or array');
  });

  test('set_multiple_values works in pre-hook', async () => {
    const { Item, app } = await buildAppAndModel({
      pre: async (req, context) => {
        req.apialize.set_multiple_values({
          description: 'Set in pre-hook',
          status: 'draft',
        });
      },
    });

    const res = await request(app).post('/items').send({
      name: 'Product G',
      price: 75.0,
    });

    expect(res.status).toBe(201);
    const item = await Item.findByPk(res.body.id);
    expect(item.description).toBe('Set in pre-hook');
    expect(item.status).toBe('draft');
    expect(parseFloat(item.price)).toBe(75.0);
  });

  test('set_multiple_values with empty object does nothing', async () => {
    const { Item, app } = await buildAppAndModel({
      middleware: [
        (req, res, next) => {
          req.apialize.set_multiple_values({});
          next();
        },
      ],
    });

    const res = await request(app).post('/items').send({
      name: 'Product H',
      price: 25.0,
    });

    expect(res.status).toBe(201);
    const item = await Item.findByPk(res.body.id);
    expect(item.name).toBe('Product H');
    expect(parseFloat(item.price)).toBe(25.0);
  });

  test('set_multiple_values with empty array does nothing', async () => {
    const { Item, app } = await buildAppAndModel({
      middleware: [
        (req, res, next) => {
          req.apialize.set_multiple_values([]);
          next();
        },
      ],
    });

    const res = await request(app).post('/items').send({
      name: 'Product I',
      price: 35.0,
    });

    expect(res.status).toBe(201);
    const item = await Item.findByPk(res.body.id);
    expect(item.name).toBe('Product I');
    expect(parseFloat(item.price)).toBe(35.0);
  });
});
