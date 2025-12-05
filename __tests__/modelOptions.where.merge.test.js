const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list, single, create } = require('../src');

describe('Model Options Where Clause Merging', () => {
  let sequelize;
  let TestModel;

  beforeAll(async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    TestModel = sequelize.define(
      'TestModel',
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        name: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        category: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        status: {
          type: DataTypes.STRING,
          defaultValue: 'active',
        },
      },
      {
        tableName: 'test_models',
        timestamps: false,
      }
    );

    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    await TestModel.destroy({ where: {} });
  });

  afterAll(async () => {
    if (sequelize) {
      await sequelize.close();
    }
  });

  describe('Bug: where clause from model_options should not be overwritten', () => {
    test('list endpoint should preserve model_options where clause', async () => {
      const app = express();
      app.use(bodyParser.json());

      // Create endpoint for seeding data
      app.use('/items', create(TestModel));

      // List endpoint with where clause in modelOptions
      app.use(
        '/active-items',
        list(
          TestModel,
          {},
          {
            where: { status: 'active' },
          }
        )
      );

      // Seed test data
      await request(app)
        .post('/items')
        .send({ name: 'Active Item 1', category: 'A', status: 'active' });

      await request(app)
        .post('/items')
        .send({ name: 'Active Item 2', category: 'B', status: 'active' });

      await request(app)
        .post('/items')
        .send({ name: 'Inactive Item', category: 'C', status: 'inactive' });

      // Request should only return active items due to modelOptions.where
      const res = await request(app).get('/active-items');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((item) => item.status === 'active')).toBe(true);
    });

    test('single endpoint should preserve model_options where clause', async () => {
      const app = express();
      app.use(bodyParser.json());

      app.use('/items', create(TestModel));

      // Single endpoint with where clause in modelOptions
      app.use(
        '/active-items',
        single(
          TestModel,
          {},
          {
            where: { status: 'active' },
          }
        )
      );

      // Seed test data directly
      const activeItem = await TestModel.create({
        name: 'Active Item',
        category: 'A',
        status: 'active',
      });

      const inactiveItem = await TestModel.create({
        name: 'Inactive Item',
        category: 'B',
        status: 'inactive',
      });

      const activeId = activeItem.id;
      const inactiveId = inactiveItem.id;

      // Should find active item
      const foundActive = await request(app).get(`/active-items/${activeId}`);
      expect(foundActive.status).toBe(200);
      expect(foundActive.body.record.name).toBe('Active Item');

      // Should NOT find inactive item due to where clause
      const foundInactive = await request(app).get(`/active-items/${inactiveId}`);
      expect(foundInactive.status).toBe(404);
    });

    test('list endpoint should merge model_options where with query filters', async () => {
      const app = express();
      app.use(bodyParser.json());

      app.use('/items', create(TestModel));

      // List endpoint with where clause in modelOptions
      app.use(
        '/active-items',
        list(
          TestModel,
          {},
          {
            where: { status: 'active' },
          }
        )
      );

      // Seed test data
      await request(app)
        .post('/items')
        .send({ name: 'Active Item A', category: 'A', status: 'active' });

      await request(app)
        .post('/items')
        .send({ name: 'Active Item B', category: 'B', status: 'active' });

      await request(app)
        .post('/items')
        .send({ name: 'Inactive Item A', category: 'A', status: 'inactive' });

      // Request with additional filter - should combine both where clauses
      const res = await request(app).get('/active-items?category=A');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Active Item A');
      expect(res.body.data[0].status).toBe('active');
      expect(res.body.data[0].category).toBe('A');
    });

    test('list endpoint should handle complex where clauses with operators', async () => {
      const app = express();
      app.use(bodyParser.json());

      app.use('/items', create(TestModel));

      // List endpoint with complex where clause in modelOptions
      const { Op } = require('sequelize');
      app.use(
        '/filtered-items',
        list(
          TestModel,
          {},
          {
            where: {
              status: { [Op.in]: ['active', 'pending'] },
            },
          }
        )
      );

      // Seed test data
      await request(app)
        .post('/items')
        .send({ name: 'Active Item', category: 'A', status: 'active' });

      await request(app)
        .post('/items')
        .send({ name: 'Pending Item', category: 'B', status: 'pending' });

      await request(app)
        .post('/items')
        .send({ name: 'Inactive Item', category: 'C', status: 'inactive' });

      // Should only return items matching the where clause
      const res = await request(app).get('/filtered-items');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((item) => ['active', 'pending'].includes(item.status))).toBe(true);
    });

    test('should not lose model_options where when request has empty where', async () => {
      const app = express();
      app.use(bodyParser.json());

      app.use('/items', create(TestModel));

      // This simulates the exact bug scenario:
      // modelOptions has a where clause, but req.apialize.options.where = {} is initialized
      app.use(
        '/active-items',
        list(
          TestModel,
          {},
          {
            where: { status: 'active' },
          }
        )
      );

      // Seed test data
      await request(app)
        .post('/items')
        .send({ name: 'Active Item', category: 'A', status: 'active' });

      await request(app)
        .post('/items')
        .send({ name: 'Inactive Item', category: 'B', status: 'inactive' });

      // Make a request without any filters
      // req.apialize.options.where will be {} but modelOptions.where should be preserved
      const res = await request(app).get('/active-items');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].status).toBe('active');
    });

    test('should properly merge overlapping where conditions', async () => {
      const app = express();
      app.use(bodyParser.json());

      app.use('/items', create(TestModel));

      // List endpoint with where clause in modelOptions
      app.use(
        '/active-a-items',
        list(
          TestModel,
          {},
          {
            where: { status: 'active', category: 'A' },
          }
        )
      );

      // Seed test data
      await request(app)
        .post('/items')
        .send({ name: 'Active A Item', category: 'A', status: 'active' });

      await request(app)
        .post('/items')
        .send({ name: 'Active B Item', category: 'B', status: 'active' });

      await request(app)
        .post('/items')
        .send({ name: 'Inactive A Item', category: 'A', status: 'inactive' });

      // Request without filters - should respect both where conditions
      const res = await request(app).get('/active-a-items');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Active A Item');
    });
  });
});
