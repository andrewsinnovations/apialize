const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { create, list } = require('../src');

async function build({ createOptions = {}, listModelOptions = {} } = {}) {
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
    },
    { tableName: 'batch_items', timestamps: false }
  );
  await sequelize.sync({ force: true });
  const app = express();
  app.use(bodyParser.json());
  app.use('/items', create(Item, createOptions));
  app.use('/items', list(Item, { metaShowFilters: true }, listModelOptions));
  return { sequelize, Item, app };
}

describe('create operation: batch array body', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  test('creates multiple records atomically and returns array of created objects', async () => {
    const { sequelize: s, app } = await build({
      createOptions: { allow_bulk_create: true },
    });
    sequelize = s;

    const payload = [
      { external_id: 'b1', name: 'Batch One', desc: 'x' },
      { external_id: 'b2', name: 'Batch Two', desc: 'y' },
    ];

    const res = await request(app).post('/items').send(payload);
    expect(res.status).toBe(201);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
    // Ensure ids are present on returned objects
    for (const row of res.body) {
      expect(row).toHaveProperty('id');
      expect(row).toHaveProperty('external_id');
    }

    // Verify persisted via list
    const listRes = await request(app).get('/items');
    expect(listRes.status).toBe(200);
    expect(listRes.body.meta.count).toBe(2);
  });

  test('fails entire batch when one insert violates a constraint (rollback)', async () => {
    const { sequelize: s, app } = await build({
      createOptions: { allow_bulk_create: true },
    });
    sequelize = s;

    const badBatch = [
      { external_id: 'dup', name: 'Ok' },
      { external_id: 'dup', name: 'Duplicate should fail' },
    ];

    const res = await request(app).post('/items').send(badBatch);
    // Expect an error; status may be 500 depending on default error handler
    expect(res.status).toBeGreaterThanOrEqual(400);

    // Ensure rollback: no rows persisted
    const listRes = await request(app).get('/items');
    expect(listRes.status).toBe(200);
    expect(listRes.body.meta.count).toBe(0);
  });

  test('respects id_mapping in batch response by mirroring mapped value into id', async () => {
    const { sequelize: s, app } = await build({
      createOptions: { id_mapping: 'external_id', allow_bulk_create: true },
    });
    sequelize = s;

    const payload = [
      { external_id: 'm1', name: 'Mapped One' },
      { external_id: 'm2', name: 'Mapped Two' },
    ];

    const res = await request(app).post('/items').send(payload);
    expect(res.status).toBe(201);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.map((r) => r.id)).toEqual(['m1', 'm2']);
  });

  test('returns 400 when allow_bulk_create is false (default) and body is array', async () => {
    const { sequelize: s, app } = await build();
    sequelize = s;

    const payload = [
      { external_id: 'x1', name: 'Nope 1' },
      { external_id: 'x2', name: 'Nope 2' },
    ];

    const res = await request(app).post('/items').send(payload);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
