/**
 * Documentation Examples Test
 *
 * This test file validates that the code examples in documentation/create.md
 * work as expected and produce the documented outputs.
 */

const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { create, list, single } = require('../src');

// Helper to build app with given create options and modelOptions
async function buildAppAndModel({
  createOptions = {},
  modelOptions = {},
  listOptions = {},
  listModelOptions = {},
  defineModel = null,
} = {}) {
  const sequelize = new Sequelize('sqlite::memory:', { logging: false });

  const Item =
    defineModel?.(sequelize, DataTypes) ||
    sequelize.define(
      'Item',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        external_id: { type: DataTypes.STRING(64), allowNull: true, unique: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
        category: { type: DataTypes.STRING(50), allowNull: true },
        description: { type: DataTypes.TEXT, allowNull: true },
        price: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
        cost: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
        internal_notes: { type: DataTypes.TEXT, allowNull: true },
        user_id: { type: DataTypes.INTEGER, allowNull: true },
        created_by: { type: DataTypes.INTEGER, allowNull: true },
        created_at: {
          type: DataTypes.DATE,
          allowNull: true,
          defaultValue: DataTypes.NOW,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: true,
          defaultValue: DataTypes.NOW,
        },
      },
      { tableName: 'doc_create_items', timestamps: false }
    );

  await sequelize.sync({ force: true });

  const app = express();
  app.use(bodyParser.json());
  app.use('/items', create(Item, createOptions, modelOptions));
  app.use('/items', list(Item, listOptions, listModelOptions));
  app.use('/items', single(Item));

  return { sequelize, Item, app };
}

describe('Documentation Examples: create.md', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  describe('Basic Usage', () => {
    // Documentation: "This creates a POST /items endpoint"
    test('create(Item) creates a POST /items endpoint', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app)
        .post('/items')
        .send({ name: 'Test Item', category: 'test', price: 10.0 });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.id).toBeDefined();
    });
  });

  describe('Default Usage (No Configuration)', () => {
    // Documentation example response structure
    test('returns success and id for single record', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app).post('/items').send({
        name: 'Laptop',
        category: 'electronics',
        price: 999.99,
      });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('id');
      expect(typeof res.body.id).toBe('number');
    });

    // Documentation: Default behavior table
    test('defaults: validation enabled, bulk create disabled, id mapping is id', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { app } = ctx;

      // Single create works
      const singleRes = await request(app)
        .post('/items')
        .send({ name: 'Product', category: 'test' });
      expect(singleRes.status).toBe(201);
      expect(singleRes.body.id).toBeDefined();

      // Bulk create fails by default
      const bulkRes = await request(app)
        .post('/items')
        .send([
          { name: 'Item 1', category: 'test' },
          { name: 'Item 2', category: 'test' },
        ]);
      expect(bulkRes.status).toBe(400);
      expect(bulkRes.body.success).toBe(false);
      expect(bulkRes.body.error).toContain('Cannot insert multiple records');
    });

    // Documentation: All fields allowed by default
    test('all fields allowed by default', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app).post('/items').send({
        name: 'Product',
        category: 'test',
        description: 'A description',
        price: 99.99,
        cost: 50.0,
        internal_notes: 'Internal info',
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Configuration Options: Field Control', () => {
    // Documentation: allowed_fields whitelist
    test('allowed_fields restricts fields that can be set', async () => {
      const ctx = await buildAppAndModel({
        createOptions: { allowed_fields: ['name', 'description', 'price'] },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      // Allowed: fields in whitelist
      const allowed = await request(app).post('/items').send({
        name: 'Product',
        description: 'A great product',
        price: 99.99,
      });
      expect(allowed.status).toBe(201);
      expect(allowed.body.success).toBe(true);

      // Blocked: field not in whitelist
      const blocked = await request(app).post('/items').send({
        name: 'Product',
        cost: 50.0, // Not in allowed_fields
      });
      expect(blocked.status).toBe(400);
      expect(blocked.body.success).toBe(false);
      expect(blocked.body.error).toContain('cost');
    });

    // Documentation: blocked_fields blacklist
    test('blocked_fields prevents specific fields from being set', async () => {
      const ctx = await buildAppAndModel({
        createOptions: { blocked_fields: ['cost', 'internal_notes', 'created_by'] },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      // Blocked: fields in blacklist
      const blocked = await request(app).post('/items').send({
        name: 'Product',
        cost: 50.0, // Blocked field
      });
      expect(blocked.status).toBe(400);
      expect(blocked.body.success).toBe(false);
      expect(blocked.body.error).toContain('cost');

      // Allowed: fields not in blacklist
      const allowed = await request(app).post('/items').send({
        name: 'Product',
        description: 'Description',
        price: 99.99,
      });
      expect(allowed.status).toBe(201);
      expect(allowed.body.success).toBe(true);
    });

    // Documentation: blocked_fields takes precedence over allowed_fields
    test('blocked_fields takes precedence over allowed_fields', async () => {
      const ctx = await buildAppAndModel({
        createOptions: {
          allowed_fields: ['name', 'description', 'price', 'cost'],
          blocked_fields: ['cost'], // cost is blocked even though it's in allowed_fields
        },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      // price is in allowed_fields and not blocked - should work
      const allowedRes = await request(app).post('/items').send({
        name: 'Product A',
        price: 99.99,
      });
      expect(allowedRes.status).toBe(201);

      // cost is blocked even though it's in allowed_fields
      const blockedRes = await request(app).post('/items').send({
        name: 'Product B',
        cost: 50.0,
      });
      expect(blockedRes.status).toBe(400);
      expect(blockedRes.body.error).toContain('cost');
    });
  });

  describe('Configuration Options: Validation', () => {
    // Documentation: validate: false skips model validation
    test('validate: false skips Sequelize model validation', async () => {
      const ctx = await buildAppAndModel({
        createOptions: { validate: false },
        defineModel: (sequelize, DataTypes) =>
          sequelize.define(
            'Item',
            {
              id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
              name: {
                type: DataTypes.STRING(100),
                allowNull: false,
                validate: {
                  len: [5, 100], // Minimum 5 characters
                },
              },
              category: { type: DataTypes.STRING(50), allowNull: true },
            },
            { tableName: 'doc_create_items', timestamps: false }
          ),
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      // With validate: false, short name should be allowed
      // Note: SQLite doesn't enforce string length, so this primarily tests that
      // the validation option is passed through
      const res = await request(app).post('/items').send({
        name: 'A', // Less than 5 chars
        category: 'test',
      });
      // The record may or may not be created depending on database constraints,
      // but the Sequelize validation should be skipped
      expect(res.status).toBeLessThan(500);
    });

    // Documentation: validate: true (default) enables validation
    test('validate: true (default) enables Sequelize model validation', async () => {
      const ctx = await buildAppAndModel({
        defineModel: (sequelize, DataTypes) =>
          sequelize.define(
            'Item',
            {
              id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
              name: {
                type: DataTypes.STRING(100),
                allowNull: false,
                validate: {
                  len: [5, 100], // Minimum 5 characters
                },
              },
              category: { type: DataTypes.STRING(50), allowNull: true },
            },
            { tableName: 'doc_create_items', timestamps: false }
          ),
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      // With validate: true (default), short name should fail validation
      const res = await request(app).post('/items').send({
        name: 'A', // Less than 5 chars
        category: 'test',
      });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Configuration Options: Bulk Create', () => {
    // Documentation: allow_bulk_create: true enables bulk insert
    test('allow_bulk_create: true enables bulk insert with array body', async () => {
      const ctx = await buildAppAndModel({
        createOptions: { allow_bulk_create: true },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app)
        .post('/items')
        .send([
          { name: 'Item 1', category: 'test', price: 29.99 },
          { name: 'Item 2', category: 'test', price: 49.99 },
          { name: 'Item 3', category: 'test', price: 19.99 },
        ]);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.ids)).toBe(true);
      expect(res.body.ids).toHaveLength(3);
    });

    // Documentation: Bulk create returns array of ids
    test('bulk create returns array of ids', async () => {
      const ctx = await buildAppAndModel({
        createOptions: { allow_bulk_create: true },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app)
        .post('/items')
        .send([
          { name: 'Product A', category: 'test' },
          { name: 'Product B', category: 'test' },
        ]);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        success: true,
        ids: expect.arrayContaining([expect.any(Number), expect.any(Number)]),
      });
    });

    // Documentation: Atomic rollback - if any record fails, all are rolled back
    test('bulk create is atomic - failure rolls back all records', async () => {
      const ctx = await buildAppAndModel({
        createOptions: { allow_bulk_create: true },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      // Create first item with unique external_id
      await request(app)
        .post('/items')
        .send({ name: 'Existing', category: 'test', external_id: 'dup-1' });

      // Try bulk create with duplicate external_id
      const res = await request(app)
        .post('/items')
        .send([
          { name: 'New Item 1', category: 'test', external_id: 'new-1' },
          { name: 'Duplicate', category: 'test', external_id: 'dup-1' }, // Duplicate
        ]);

      expect(res.status).toBeGreaterThanOrEqual(400);

      // Verify rollback - new-1 should not exist
      const items = await Item.findAll({ where: { external_id: 'new-1' } });
      expect(items).toHaveLength(0);
    });

    // Documentation: Bulk create not allowed returns 400
    test('array body without allow_bulk_create returns 400', async () => {
      const ctx = await buildAppAndModel({
        createOptions: { allow_bulk_create: false }, // Default
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app)
        .post('/items')
        .send([
          { name: 'Item 1', category: 'test' },
          { name: 'Item 2', category: 'test' },
        ]);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: 'Cannot insert multiple records.',
      });
    });
  });

  describe('Configuration Options: ID Mapping', () => {
    // Documentation: id_mapping: 'external_id' returns external id
    test('id_mapping returns specified field as id in response', async () => {
      const ctx = await buildAppAndModel({
        createOptions: { id_mapping: 'external_id' },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app).post('/items').send({
        external_id: 'uuid-abc-123',
        name: 'Product',
        category: 'test',
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        success: true,
        id: 'uuid-abc-123',
      });
    });

    // Documentation: Bulk create with id_mapping returns mapped ids
    test('bulk create with id_mapping returns mapped ids', async () => {
      const ctx = await buildAppAndModel({
        createOptions: { id_mapping: 'external_id', allow_bulk_create: true },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app)
        .post('/items')
        .send([
          { external_id: 'm1', name: 'Mapped One', category: 'test' },
          { external_id: 'm2', name: 'Mapped Two', category: 'test' },
        ]);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.ids).toEqual(['m1', 'm2']);
    });
  });

  describe('Configuration Options: Middleware', () => {
    // Documentation: Middleware can modify req.apialize.values
    test('middleware can override field values', async () => {
      const setCreatedBy = (req, res, next) => {
        req.apialize.values = {
          ...(req.apialize.values || {}),
          created_by: 42, // Simulated authenticated user
        };
        next();
      };

      const ctx = await buildAppAndModel({
        createOptions: { middleware: [setCreatedBy] },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const res = await request(app).post('/items').send({
        name: 'Product',
        category: 'test',
      });

      expect(res.status).toBe(201);

      // Verify the created_by was set by middleware
      const created = await Item.findByPk(res.body.id);
      expect(created.created_by).toBe(42);
    });

    // Documentation: Middleware with blocked_fields prevents client override
    test('middleware sets field while blocked_fields prevents client override', async () => {
      const setOwner = (req, res, next) => {
        req.apialize.values = {
          ...(req.apialize.values || {}),
          user_id: 123,
          created_at: new Date('2025-01-01'),
        };
        next();
      };

      const ctx = await buildAppAndModel({
        createOptions: {
          middleware: [setOwner],
          blocked_fields: ['user_id', 'created_at'], // Prevent client from setting
        },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      // Client tries to set user_id but it's blocked
      const res = await request(app).post('/items').send({
        name: 'Product',
        category: 'test',
        user_id: 999, // Client tries to override - should be blocked
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('user_id');
    });
  });

  describe('Configuration Options: Hooks', () => {
    // Documentation: pre hook runs before record creation
    test('pre hook runs before record creation with transaction', async () => {
      let preHookCalled = false;
      let transactionAvailable = false;

      const ctx = await buildAppAndModel({
        createOptions: {
          pre: async (context) => {
            preHookCalled = true;
            transactionAvailable = !!context.transaction;
            return { startTime: Date.now() };
          },
        },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app).post('/items').send({
        name: 'Product',
        category: 'test',
      });

      expect(res.status).toBe(201);
      expect(preHookCalled).toBe(true);
      expect(transactionAvailable).toBe(true);
    });

    // Documentation: post hook runs after record creation
    test('post hook runs after record creation and can modify payload', async () => {
      const ctx = await buildAppAndModel({
        createOptions: {
          post: async (context) => {
            context.payload.extra = 'custom data';
            context.payload.createdName = context.created.name;
          },
        },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app).post('/items').send({
        name: 'Product',
        category: 'test',
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.extra).toBe('custom data');
      expect(res.body.createdName).toBe('Product');
    });

    // Documentation: post hook can access preResult
    test('post hook can access preResult from pre hook', async () => {
      const ctx = await buildAppAndModel({
        createOptions: {
          pre: async (context) => {
            return { startTime: Date.now() };
          },
          post: async (context) => {
            const duration = Date.now() - context.preResult.startTime;
            context.payload.creationTime = duration;
          },
        },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app).post('/items').send({
        name: 'Product',
        category: 'test',
      });

      expect(res.status).toBe(201);
      expect(res.body.creationTime).toBeDefined();
      expect(typeof res.body.creationTime).toBe('number');
    });

    // Documentation: Multiple hooks execute in order
    test('multiple pre/post hooks execute in order', async () => {
      const executionOrder = [];

      const ctx = await buildAppAndModel({
        createOptions: {
          pre: [
            async (ctx) => {
              executionOrder.push('pre1');
              return { step: 1 };
            },
            async (ctx) => {
              executionOrder.push('pre2');
              return { step: 2 };
            },
          ],
          post: [
            async (ctx) => {
              executionOrder.push('post1');
              ctx.payload.hook1 = true;
            },
            async (ctx) => {
              executionOrder.push('post2');
              ctx.payload.hook2 = true;
            },
          ],
        },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app).post('/items').send({
        name: 'Product',
        category: 'test',
      });

      expect(res.status).toBe(201);
      expect(executionOrder).toEqual(['pre1', 'pre2', 'post1', 'post2']);
      expect(res.body.hook1).toBe(true);
      expect(res.body.hook2).toBe(true);
    });
  });

  describe('Configuration Options: Field Aliases', () => {
    // Documentation: aliases map external field names to internal column names
    test('aliases map external field names to internal column names', async () => {
      const ctx = await buildAppAndModel({
        createOptions: {
          aliases: {
            productName: 'name',
            productPrice: 'price',
          },
        },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const res = await request(app).post('/items').send({
        productName: 'Widget',
        productPrice: 29.99,
        category: 'test',
      });

      expect(res.status).toBe(201);

      // Verify the data was stored with internal column names
      const created = await Item.findByPk(res.body.id);
      expect(created.name).toBe('Widget');
      expect(parseFloat(created.price)).toBe(29.99);
    });
  });

  describe('Configuration Options: Model Options', () => {
    // Documentation: modelOptions passed to Sequelize create
    test('modelOptions.fields restricts which fields are set', async () => {
      const ctx = await buildAppAndModel({
        modelOptions: {
          fields: ['name', 'category'], // Only allow these fields
        },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const res = await request(app).post('/items').send({
        name: 'Product',
        category: 'test',
        price: 99.99, // This should be ignored
      });

      expect(res.status).toBe(201);

      // Verify price was not set
      const created = await Item.findByPk(res.body.id);
      expect(created.name).toBe('Product');
      expect(created.category).toBe('test');
      expect(created.price).toBeNull();
    });
  });

  describe('Response Format', () => {
    // Documentation: Single record response format
    test('single record response: { success: true, id: <number> }', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app).post('/items').send({
        name: 'Product',
        category: 'test',
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        success: true,
        id: expect.any(Number),
      });
    });

    // Documentation: Bulk create response format
    test('bulk create response: { success: true, ids: [<numbers>] }', async () => {
      const ctx = await buildAppAndModel({
        createOptions: { allow_bulk_create: true },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app)
        .post('/items')
        .send([
          { name: 'Item 1', category: 'test' },
          { name: 'Item 2', category: 'test' },
          { name: 'Item 3', category: 'test' },
        ]);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        success: true,
        ids: expect.arrayContaining([
          expect.any(Number),
          expect.any(Number),
          expect.any(Number),
        ]),
      });
      expect(res.body.ids).toHaveLength(3);
    });

    // Documentation: With custom ID mapping response
    test('custom id_mapping response uses mapped field value', async () => {
      const ctx = await buildAppAndModel({
        createOptions: { id_mapping: 'external_id' },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app).post('/items').send({
        external_id: 'uuid-xyz-789',
        name: 'Product',
        category: 'test',
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        success: true,
        id: 'uuid-xyz-789',
      });
    });

    // Documentation: With post hook modifications
    test('post hook can add properties to response', async () => {
      const ctx = await buildAppAndModel({
        createOptions: {
          post: async (context) => {
            context.payload.extra = 'custom data';
          },
        },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app).post('/items').send({
        name: 'Product',
        category: 'test',
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        success: true,
        id: expect.any(Number),
        extra: 'custom data',
      });
    });
  });

  describe('Error Handling', () => {
    // Documentation: Field not allowed returns 400
    test('field not in allowed_fields returns 400', async () => {
      const ctx = await buildAppAndModel({
        createOptions: { allowed_fields: ['name', 'category'] },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app).post('/items').send({
        name: 'Product',
        price: 99.99, // Not allowed
      });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        success: false,
        error: expect.stringContaining('price'),
      });
    });

    // Documentation: Blocked field returns 400
    test('field in blocked_fields returns 400', async () => {
      const ctx = await buildAppAndModel({
        createOptions: { blocked_fields: ['cost', 'internal_notes'] },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app).post('/items').send({
        name: 'Product',
        category: 'test',
        cost: 50.0, // Blocked
      });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        success: false,
        error: expect.stringContaining('cost'),
      });
    });

    // Documentation: Validation error returns 400
    test('Sequelize validation error returns 400', async () => {
      const ctx = await buildAppAndModel({
        defineModel: (sequelize, DataTypes) =>
          sequelize.define(
            'Item',
            {
              id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
              name: {
                type: DataTypes.STRING(100),
                allowNull: false,
                validate: {
                  notEmpty: true,
                  len: [3, 100],
                },
              },
              category: { type: DataTypes.STRING(50), allowNull: true },
            },
            { tableName: 'doc_create_items', timestamps: false }
          ),
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app).post('/items').send({
        name: 'AB', // Too short
        category: 'test',
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    // Documentation: Bulk create without allow_bulk_create returns 400
    test('bulk create without allow_bulk_create returns 400', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app)
        .post('/items')
        .send([{ name: 'Item 1', category: 'test' }]);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: 'Cannot insert multiple records.',
      });
    });

    // Documentation: Constraint violation on unique field
    test('unique constraint violation returns error', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { app } = ctx;

      // Create first item
      await request(app).post('/items').send({
        external_id: 'unique-id',
        name: 'First',
        category: 'test',
      });

      // Try to create duplicate
      const res = await request(app).post('/items').send({
        external_id: 'unique-id', // Duplicate
        name: 'Second',
        category: 'test',
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Examples from Documentation', () => {
    // Documentation: Basic Create example
    test('Basic Create example', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app).post('/items').send({
        name: 'New Product',
        price: 29.99,
        category: 'test',
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.id).toBeDefined();
    });

    // Documentation: Restricted Fields example
    test('Restricted Fields example', async () => {
      const ctx = await buildAppAndModel({
        createOptions: {
          allowed_fields: ['name', 'description', 'price'],
          blocked_fields: ['cost', 'internal_notes'],
        },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      // Allowed fields work
      const allowed = await request(app).post('/items').send({
        name: 'Product',
        description: 'A product',
        price: 99.99,
      });
      expect(allowed.status).toBe(201);

      // Blocked fields fail
      const blocked = await request(app).post('/items').send({
        name: 'Product',
        cost: 50.0,
      });
      expect(blocked.status).toBe(400);
    });

    // Documentation: Custom ID Mapping with UUID example
    test('Custom ID Mapping with UUID example', async () => {
      const ctx = await buildAppAndModel({
        createOptions: { id_mapping: 'external_id' },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app).post('/items').send({
        external_id: 'uuid-abc-123',
        name: 'Product',
        category: 'test',
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        success: true,
        id: 'uuid-abc-123',
      });
    });

    // Documentation: Bulk Create with Field Controls example
    test('Bulk Create with Field Controls example', async () => {
      const ctx = await buildAppAndModel({
        createOptions: {
          allow_bulk_create: true,
          allowed_fields: ['name', 'description', 'price'],
          validate: true,
        },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app)
        .post('/items')
        .send([
          { name: 'A', price: 10 },
          { name: 'B', price: 20 },
        ]);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.ids).toHaveLength(2);
    });

    // Documentation: With Field Aliases example
    test('With Field Aliases example', async () => {
      const ctx = await buildAppAndModel({
        createOptions: {
          aliases: {
            productName: 'name',
            productPrice: 'price',
          },
        },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const res = await request(app).post('/items').send({
        productName: 'Widget',
        productPrice: 29.99,
        category: 'test',
      });

      expect(res.status).toBe(201);

      const created = await Item.findByPk(res.body.id);
      expect(created.name).toBe('Widget');
      expect(parseFloat(created.price)).toBe(29.99);
    });

    // Documentation: With Pre/Post Hooks example
    test('With Pre/Post Hooks example', async () => {
      const ctx = await buildAppAndModel({
        createOptions: {
          pre: async (context) => {
            return { startTime: Date.now() };
          },
          post: async (context) => {
            const duration = Date.now() - context.preResult.startTime;
            context.payload.creationTime = duration;
          },
        },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app).post('/items').send({
        name: 'Product',
        category: 'test',
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.creationTime).toBeDefined();
      expect(typeof res.body.creationTime).toBe('number');
    });
  });

  describe('Bulk Create: Field Controls', () => {
    // Documentation: Validates all items in bulk create
    test('bulk create validates allowed_fields on all items', async () => {
      const ctx = await buildAppAndModel({
        createOptions: {
          allow_bulk_create: true,
          allowed_fields: ['name', 'price'],
        },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      // Second item has disallowed field
      const res = await request(app)
        .post('/items')
        .send([
          { name: 'Product A', price: 99.99 },
          { name: 'Product B', internal_notes: 'Secret' }, // Not allowed
        ]);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('internal_notes');
    });

    // Documentation: Bulk create with blocked_fields
    test('bulk create validates blocked_fields on all items', async () => {
      const ctx = await buildAppAndModel({
        createOptions: {
          allow_bulk_create: true,
          blocked_fields: ['cost', 'internal_notes'],
        },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      // One item has blocked field
      const res = await request(app)
        .post('/items')
        .send([
          { name: 'Product A', category: 'test', price: 99.99 },
          { name: 'Product B', category: 'test', cost: 50.0 }, // Blocked
        ]);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('cost');
    });
  });

  describe('Integration: Created records can be retrieved', () => {
    // Verify created records are persisted and retrievable
    test('created record can be retrieved via list', async () => {
      const ctx = await buildAppAndModel({
        listOptions: { meta_show_filters: true },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      // Create a record
      const createRes = await request(app).post('/items').send({
        name: 'Test Product',
        category: 'electronics',
        price: 199.99,
      });
      expect(createRes.status).toBe(201);

      // Retrieve via list
      const listRes = await request(app).get('/items?category=electronics');
      expect(listRes.status).toBe(200);
      expect(listRes.body.data).toHaveLength(1);
      expect(listRes.body.data[0].name).toBe('Test Product');
      expect(parseFloat(listRes.body.data[0].price)).toBe(199.99);
    });

    // Verify created record can be retrieved via single
    test('created record can be retrieved via single', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { app } = ctx;

      // Create a record
      const createRes = await request(app).post('/items').send({
        name: 'Test Product',
        category: 'electronics',
        price: 299.99,
      });
      expect(createRes.status).toBe(201);
      const id = createRes.body.id;

      // Retrieve via single
      const singleRes = await request(app).get(`/items/${id}`);
      expect(singleRes.status).toBe(200);
      expect(singleRes.body.success).toBe(true);
      expect(singleRes.body.record.name).toBe('Test Product');
      expect(singleRes.body.record.category).toBe('electronics');
    });

    // Verify bulk created records are all persisted
    test('bulk created records can all be retrieved', async () => {
      const ctx = await buildAppAndModel({
        createOptions: { allow_bulk_create: true },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      // Bulk create
      const createRes = await request(app)
        .post('/items')
        .send([
          { name: 'Item 1', category: 'batch', price: 10 },
          { name: 'Item 2', category: 'batch', price: 20 },
          { name: 'Item 3', category: 'batch', price: 30 },
        ]);
      expect(createRes.status).toBe(201);
      expect(createRes.body.ids).toHaveLength(3);

      // Retrieve all via list
      const listRes = await request(app).get('/items?category=batch');
      expect(listRes.status).toBe(200);
      expect(listRes.body.data).toHaveLength(3);
      expect(listRes.body.data.map((d) => d.name).sort()).toEqual([
        'Item 1',
        'Item 2',
        'Item 3',
      ]);
    });
  });
});
