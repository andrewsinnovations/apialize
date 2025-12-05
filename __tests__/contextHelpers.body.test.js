const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { create, update, patch } = require('../src');

describe('Context Helpers - Body Value Management', () => {
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
          allowNull: true,
        },
        status: {
          type: DataTypes.STRING,
          defaultValue: 'pending',
        },
        priority: {
          type: DataTypes.INTEGER,
          defaultValue: 1,
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

  describe('set_value helper', () => {
    test('should set a single value in body', async () => {
      const app = express();
      app.use(bodyParser.json());

      app.use(
        '/items',
        create(TestModel, {
          pre: async (ctx) => {
            ctx.set_value('status', 'active');
          },
        })
      );

      const res = await request(app)
        .post('/items')
        .send({ name: 'Test Item', category: 'A' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const created = await TestModel.findByPk(res.body.id);
      expect(created.status).toBe('active');
      expect(created.name).toBe('Test Item');
    });

    test('should override existing value in body', async () => {
      const app = express();
      app.use(bodyParser.json());

      app.use(
        '/items',
        create(TestModel, {
          pre: async (ctx) => {
            ctx.set_value('status', 'approved');
          },
        })
      );

      const res = await request(app)
        .post('/items')
        .send({ name: 'Test Item', status: 'pending' });

      expect(res.status).toBe(201);
      const created = await TestModel.findByPk(res.body.id);
      expect(created.status).toBe('approved');
    });

    test('should set multiple values with multiple calls', async () => {
      const app = express();
      app.use(bodyParser.json());

      app.use(
        '/items',
        create(TestModel, {
          pre: async (ctx) => {
            ctx.set_value('status', 'active');
            ctx.set_value('priority', 5);
            ctx.set_value('category', 'Premium');
          },
        })
      );

      const res = await request(app).post('/items').send({ name: 'Test Item' });

      expect(res.status).toBe(201);
      const created = await TestModel.findByPk(res.body.id);
      expect(created.status).toBe('active');
      expect(created.priority).toBe(5);
      expect(created.category).toBe('Premium');
    });

    test('should return the body object after setting value', async () => {
      const app = express();
      app.use(bodyParser.json());

      let capturedBody;
      app.use(
        '/items',
        create(TestModel, {
          pre: async (ctx) => {
            capturedBody = ctx.set_value('status', 'active');
          },
        })
      );

      await request(app).post('/items').send({ name: 'Test Item' });

      expect(capturedBody).toBeDefined();
      expect(capturedBody.status).toBe('active');
      expect(capturedBody.name).toBe('Test Item');
    });

    test('should throw error if key is not a string', async () => {
      const app = express();
      app.use(bodyParser.json());

      app.use(
        '/items',
        create(TestModel, {
          pre: async (ctx) => {
            try {
              ctx.set_value(123, 'value');
              ctx.cancel_operation(500, { error: 'Should have thrown' });
            } catch (error) {
              ctx.cancel_operation(400, { error: error.message });
            }
          },
        })
      );

      const res = await request(app).post('/items').send({ name: 'Test Item' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Key must be a string');
    });
  });

  describe('remove_value helper', () => {
    test('should remove a single value from body', async () => {
      const app = express();
      app.use(bodyParser.json());

      app.use(
        '/items',
        create(TestModel, {
          pre: async (ctx) => {
            ctx.remove_value('category');
          },
        })
      );

      const res = await request(app)
        .post('/items')
        .send({ name: 'Test Item', category: 'A', status: 'active' });

      expect(res.status).toBe(201);
      const created = await TestModel.findByPk(res.body.id);
      expect(created.category).toBeNull();
      expect(created.status).toBe('active');
    });

    test('should remove multiple values with array', async () => {
      const app = express();
      app.use(bodyParser.json());

      app.use(
        '/items',
        create(TestModel, {
          pre: async (ctx) => {
            ctx.remove_value(['category', 'priority']);
          },
        })
      );

      const res = await request(app).post('/items').send({
        name: 'Test Item',
        category: 'A',
        status: 'active',
        priority: 3,
      });

      expect(res.status).toBe(201);
      const created = await TestModel.findByPk(res.body.id);
      expect(created.category).toBeNull();
      expect(created.priority).toBe(1); // Default value
      expect(created.status).toBe('active');
    });

    test('should handle removing non-existent keys gracefully', async () => {
      const app = express();
      app.use(bodyParser.json());

      app.use(
        '/items',
        create(TestModel, {
          pre: async (ctx) => {
            ctx.remove_value('nonexistent');
          },
        })
      );

      const res = await request(app)
        .post('/items')
        .send({ name: 'Test Item', status: 'active' });

      expect(res.status).toBe(201);
      const created = await TestModel.findByPk(res.body.id);
      expect(created.status).toBe('active');
    });

    test('should return the body object after removing values', async () => {
      const app = express();
      app.use(bodyParser.json());

      let capturedBody;
      app.use(
        '/items',
        create(TestModel, {
          pre: async (ctx) => {
            capturedBody = ctx.remove_value('category');
          },
        })
      );

      await request(app)
        .post('/items')
        .send({ name: 'Test Item', category: 'A' });

      expect(capturedBody).toBeDefined();
      expect(capturedBody.category).toBeUndefined();
      expect(capturedBody.name).toBe('Test Item');
    });

    test('should work in update operations', async () => {
      const app = express();
      app.use(bodyParser.json());

      const item = await TestModel.create({
        name: 'Original',
        category: 'A',
        status: 'active',
      });

      app.use(
        '/items',
        update(TestModel, {
          pre: async (ctx) => {
            // Remove category from update
            ctx.remove_value('category');
          },
        })
      );

      const res = await request(app)
        .put(`/items/${item.id}`)
        .send({ name: 'Updated', category: 'B', status: 'inactive' });

      expect(res.status).toBe(200);
      await item.reload();
      expect(item.name).toBe('Updated');
      expect(item.category).toBeNull(); // Update replaces all fields
      expect(item.status).toBe('inactive');
    });
  });

  describe('replace_body helper', () => {
    test('should completely replace the body', async () => {
      const app = express();
      app.use(bodyParser.json());

      app.use(
        '/items',
        create(TestModel, {
          pre: async (ctx) => {
            ctx.replace_body({
              name: 'Replaced Item',
              status: 'approved',
              priority: 10,
            });
          },
        })
      );

      const res = await request(app)
        .post('/items')
        .send({ name: 'Original', category: 'A' });

      expect(res.status).toBe(201);
      const created = await TestModel.findByPk(res.body.id);
      expect(created.name).toBe('Replaced Item');
      expect(created.status).toBe('approved');
      expect(created.priority).toBe(10);
      expect(created.category).toBeNull();
    });

    test('should replace with empty object when no argument provided', async () => {
      const app = express();
      app.use(bodyParser.json());

      app.use(
        '/items',
        create(TestModel, {
          pre: async (ctx) => {
            ctx.replace_body();
            // Add required fields after replacement
            ctx.set_value('name', 'Required Name');
          },
        })
      );

      const res = await request(app)
        .post('/items')
        .send({ name: 'Original', category: 'A', status: 'active' });

      expect(res.status).toBe(201);
      const created = await TestModel.findByPk(res.body.id);
      expect(created.name).toBe('Required Name');
      expect(created.category).toBeNull();
      expect(created.status).toBe('pending'); // Default value
    });

    test('should return the new body object', async () => {
      const app = express();
      app.use(bodyParser.json());

      let capturedBody;
      app.use(
        '/items',
        create(TestModel, {
          pre: async (ctx) => {
            capturedBody = ctx.replace_body({
              name: 'New Item',
              status: 'active',
            });
          },
        })
      );

      await request(app)
        .post('/items')
        .send({ name: 'Original', category: 'A' });

      expect(capturedBody).toBeDefined();
      expect(capturedBody.name).toBe('New Item');
      expect(capturedBody.status).toBe('active');
      expect(capturedBody.category).toBeUndefined();
    });

    test('should work in patch operations', async () => {
      const app = express();
      app.use(bodyParser.json());

      const item = await TestModel.create({
        name: 'Original',
        category: 'A',
        status: 'active',
        priority: 1,
      });

      app.use(
        '/items',
        patch(TestModel, {
          pre: async (ctx) => {
            // Replace entire patch body
            ctx.replace_body({
              status: 'archived',
            });
          },
        })
      );

      const res = await request(app)
        .patch(`/items/${item.id}`)
        .send({ name: 'Should be ignored', category: 'B' });

      expect(res.status).toBe(200);
      await item.reload();
      expect(item.name).toBe('Original'); // Unchanged
      expect(item.category).toBe('A'); // Unchanged
      expect(item.status).toBe('archived'); // Changed
    });
  });

  describe('Combined body helpers usage', () => {
    test('should work together in sequence', async () => {
      const app = express();
      app.use(bodyParser.json());

      app.use(
        '/items',
        create(TestModel, {
          pre: async (ctx) => {
            // First set some values
            ctx.set_value('priority', 5);
            ctx.set_value('category', 'Premium');

            // Then remove one
            ctx.remove_value('category');

            // Add it back with different value
            ctx.set_value('category', 'VIP');
          },
        })
      );

      const res = await request(app)
        .post('/items')
        .send({ name: 'Test Item', status: 'active' });

      expect(res.status).toBe(201);
      const created = await TestModel.findByPk(res.body.id);
      expect(created.name).toBe('Test Item');
      expect(created.status).toBe('active');
      expect(created.priority).toBe(5);
      expect(created.category).toBe('VIP');
    });

    test('should allow building body from scratch', async () => {
      const app = express();
      app.use(bodyParser.json());

      app.use(
        '/items',
        create(TestModel, {
          pre: async (ctx) => {
            // Start fresh
            ctx.replace_body({});

            // Build it up
            ctx.set_value('name', 'Constructed Item');
            ctx.set_value('category', 'Auto');
            ctx.set_value('status', 'active');
            ctx.set_value('priority', 3);
          },
        })
      );

      const res = await request(app)
        .post('/items')
        .send({ name: 'Ignored', random_field: 'also ignored' });

      expect(res.status).toBe(201);
      const created = await TestModel.findByPk(res.body.id);
      expect(created.name).toBe('Constructed Item');
      expect(created.category).toBe('Auto');
      expect(created.status).toBe('active');
      expect(created.priority).toBe(3);
    });

    test('should sanitize sensitive data', async () => {
      const app = express();
      app.use(bodyParser.json());

      app.use(
        '/items',
        create(TestModel, {
          pre: async (ctx) => {
            // Remove any sensitive fields that might have been sent
            ctx.remove_value(['password', 'api_key', 'secret']);
          },
        })
      );

      const res = await request(app).post('/items').send({
        name: 'Test Item',
        status: 'active',
        password: 'should_not_save',
        api_key: 'secret123',
      });

      expect(res.status).toBe(201);
      const created = await TestModel.findByPk(res.body.id);
      expect(created.name).toBe('Test Item');
      expect(created.status).toBe('active');
    });
  });
});
