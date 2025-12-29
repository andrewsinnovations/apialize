const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { create, list } = require('../src');

async function build({
  createOptions = {},
  modelOptions = {},
  listModelOptions = {},
} = {}) {
  const sequelize = new Sequelize('sqlite::memory:', { logging: false });
  const Item = sequelize.define(
    'Item',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      external_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
      },
      name: { type: DataTypes.STRING(100), allowNull: false },
      desc: { type: DataTypes.STRING(255), allowNull: true },
      parent_id: { type: DataTypes.INTEGER, allowNull: true },
    },
    { tableName: 'create_items', timestamps: false }
  );
  await sequelize.sync({ force: true });
  const app = express();
  app.use(bodyParser.json());
  app.use('/items', create(Item, createOptions, modelOptions));
  app.use(
    '/items',
    list(
      Item,
      { meta_show_filters: true, meta_show_ordering: true },
      listModelOptions
    )
  );
  return { sequelize, Item, app };
}

describe('create operation: comprehensive options coverage', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  test('default id mapping returns numeric id, respects middleware value overrides, and modelOptions (attributes)', async () => {
    const prependDesc = (req, _res, next) => {
      req.apialize.values = {
        ...(req.apialize.values || {}),
        desc: `mdw-` + (req.apialize.values.desc || ''),
      };
      next();
    };

    const { sequelize: s, app } = await build({
      createOptions: { middleware: [prependDesc] },
      modelOptions: { fields: ['external_id', 'name', 'desc', 'parent_id'] },
      listModelOptions: { attributes: ['id', 'external_id', 'name', 'desc'] },
    });
    sequelize = s;

    const res = await request(app)
      .post('/items')
      .send({ external_id: 'c1', name: 'A', desc: 'x', parent_id: 99 });
    expect(res.status).toBe(201);
    expect(
      typeof res.body.id === 'number' || /^[0-9]+$/.test(String(res.body.id))
    ).toBe(true);

    const listRes = await request(app).get('/items');
    expect(listRes.status).toBe(200);
    expect(listRes.body.data[0].desc).toBe('mdw-x');
    // parent_id omitted due to list modelOptions.attributes
    expect(listRes.body.data[0]).not.toHaveProperty('parent_id');
  });

  test('custom id_mapping external_id returns external id', async () => {
    const { sequelize: s, app } = await build({
      createOptions: { id_mapping: 'external_id' },
    });
    sequelize = s;

    const res = await request(app)
      .post('/items')
      .send({ external_id: 'uuid-xyz', name: 'A' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, id: 'uuid-xyz' });
  });

  test('middleware can enforce parent scoping on create via options merger', async () => {
    const scope = (req, _res, next) => {
      req.apialize.options = {
        ...(req.apialize.options || {}),
        where: { parent_id: 7 },
      };
      next();
    };

    const { sequelize: s, app } = await build({
      createOptions: { middleware: [scope] },
    });
    sequelize = s;

    const res = await request(app)
      .post('/items')
      .send({ external_id: 'scoped', name: 'S1' });
    expect(res.status).toBe(201);
    // Not asserting DB side effects of options.where; just that it doesn't error and returns an id.
    expect(res.body.success).toBe(true);
  });

  test('pre/post hooks: transaction present and payload mutated (create)', async () => {
    const { sequelize: s, app } = await build({
      createOptions: {
        pre: async (ctx) => {
          expect(ctx.transaction).toBeTruthy();
          expect(typeof ctx.transaction.commit).toBe('function');
          return { ran: true };
        },
        post: async (ctx) => {
          expect(ctx.preResult).toEqual({ ran: true });
          ctx.payload.extra = 'ok';
        },
      },
    });
    sequelize = s;

    const res = await request(app)
      .post('/items')
      .send({ external_id: 'hook-c1', name: 'A' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.extra).toBe('ok');
  });

  test('array pre/post hooks: multiple functions execute in order (create)', async () => {
    const executionOrder = [];
    const { sequelize: s, app } = await build({
      createOptions: {
        pre: [
          async (ctx) => {
            executionOrder.push('pre1');
            expect(ctx.transaction).toBeTruthy();
            return { step: 1 };
          },
          async (ctx) => {
            executionOrder.push('pre2');
            expect(ctx.transaction).toBeTruthy();
            return { step: 2 };
          },
          async (ctx) => {
            executionOrder.push('pre3');
            expect(ctx.transaction).toBeTruthy();
            return { step: 3, finalPre: true };
          },
        ],
        post: [
          async (ctx) => {
            executionOrder.push('post1');
            expect(ctx.preResult).toEqual({ step: 3, finalPre: true });
            ctx.payload.hook1 = 'executed';
          },
          async (ctx) => {
            executionOrder.push('post2');
            expect(ctx.payload.hook1).toBe('executed');
            ctx.payload.hook2 = 'also-executed';
          },
        ],
      },
    });
    sequelize = s;

    const res = await request(app)
      .post('/items')
      .send({ external_id: 'array-hooks-c1', name: 'ArrayTest' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.hook1).toBe('executed');
    expect(res.body.hook2).toBe('also-executed');
    expect(executionOrder).toEqual(['pre1', 'pre2', 'pre3', 'post1', 'post2']);
  });
});
