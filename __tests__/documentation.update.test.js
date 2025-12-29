/**
 * Documentation Examples Test
 *
 * This test file validates that the code examples in documentation/update.md
 * work as expected and produce the documented outputs.
 */

const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { update, create, single } = require('../src');

// Helper to build app with given update options and modelOptions
async function buildAppAndModel({
  updateOptions = {},
  modelOptions = {},
  createOptions = {},
  singleOptions = {},
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
        name: { type: DataTypes.STRING(100), allowNull: true },
        category: { type: DataTypes.STRING(50), allowNull: true },
        description: { type: DataTypes.TEXT, allowNull: true },
        price: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
        cost: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
        internal_notes: { type: DataTypes.TEXT, allowNull: true },
        status: { type: DataTypes.STRING(20), allowNull: true },
        user_id: { type: DataTypes.INTEGER, allowNull: true },
        created_by: { type: DataTypes.INTEGER, allowNull: true },
        updated_by: { type: DataTypes.INTEGER, allowNull: true },
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
      { tableName: 'doc_update_items', timestamps: false }
    );

  await sequelize.sync({ force: true });

  const app = express();
  app.use(bodyParser.json());
  app.use('/items', create(Item, createOptions));
  app.use('/items', single(Item, { id_mapping: updateOptions.id_mapping || 'id', ...singleOptions }));
  app.use('/items', update(Item, updateOptions, modelOptions));

  return { sequelize, Item, app };
}

async function seedItem(Item, data) {
  return await Item.create(data);
}

describe('Documentation Examples: update.md', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  describe('Basic Usage', () => {
    // Documentation: "This creates a PUT /items/:id endpoint"
    test('update(Item) creates a PUT /items/:id endpoint', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const item = await seedItem(Item, { name: 'Test Item', price: 100.0 });

      const res = await request(app)
        .put(`/items/${item.id}`)
        .send({ name: 'Updated Item', price: 150.0 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Default Usage (No Configuration)', () => {
    // Documentation: Default response structure
    test('returns success for updated record', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const item = await seedItem(Item, { name: 'Laptop', price: 999.99 });

      const res = await request(app)
        .put(`/items/${item.id}`)
        .send({ name: 'Updated Item', category: 'electronics', price: 149.99 });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
    });

    // Documentation: Full replacement - unprovided fields set to null/default
    test('unprovided fields are set to null or default (full replacement)', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const item = await seedItem(Item, {
        name: 'Original Name',
        category: 'electronics',
        price: 100.0,
        status: 'active',
      });

      // PUT with only name - other fields should be nullified
      const res = await request(app)
        .put(`/items/${item.id}`)
        .send({ name: 'Updated Name' });

      expect(res.status).toBe(200);

      // Verify fields not provided are now null
      const updated = await Item.findByPk(item.id);
      expect(updated.name).toBe('Updated Name');
      expect(updated.category).toBeNull();
      expect(updated.price).toBeNull();
      expect(updated.status).toBeNull();
    });

    // Documentation: All fields allowed by default
    test('all fields allowed by default', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const item = await seedItem(Item, { name: 'Product', price: 50.0 });

      const res = await request(app)
        .put(`/items/${item.id}`)
        .send({
          name: 'Updated Product',
          category: 'updated',
          description: 'New description',
          price: 99.99,
          cost: 40.0,
          internal_notes: 'Updated notes',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Configuration Options: Field Control', () => {
    // Documentation: allowed_fields whitelist
    test('allowed_fields restricts fields that can be set', async () => {
      const ctx = await buildAppAndModel({
        updateOptions: { allowed_fields: ['name', 'description', 'price'] },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const item = await seedItem(Item, { name: 'Product', price: 100.0 });

      // Allowed: fields in whitelist
      const allowed = await request(app)
        .put(`/items/${item.id}`)
        .send({ name: 'New Name', price: 99.99 });
      expect(allowed.status).toBe(200);
      expect(allowed.body.success).toBe(true);

      // Blocked: field not in whitelist
      const blocked = await request(app)
        .put(`/items/${item.id}`)
        .send({ name: 'Product', cost: 50.0 });
      expect(blocked.status).toBe(400);
      expect(blocked.body.success).toBe(false);
      expect(blocked.body.error).toContain('cost');
    });

    // Documentation: blocked_fields blacklist
    test('blocked_fields prevents specific fields from being set', async () => {
      const ctx = await buildAppAndModel({
        updateOptions: { blocked_fields: ['cost', 'internal_notes', 'created_by'] },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const item = await seedItem(Item, { name: 'Product', price: 100.0 });

      // Blocked: fields in blacklist
      const blocked = await request(app)
        .put(`/items/${item.id}`)
        .send({ name: 'Product', cost: 50.0 });
      expect(blocked.status).toBe(400);
      expect(blocked.body.success).toBe(false);
      expect(blocked.body.error).toContain('cost');

      // Allowed: fields not in blacklist
      const allowed = await request(app)
        .put(`/items/${item.id}`)
        .send({ name: 'New Name', price: 75.0 });
      expect(allowed.status).toBe(200);
    });

    // Documentation: blocked_fields takes precedence over allowed_fields
    test('blocked_fields takes precedence over allowed_fields', async () => {
      const ctx = await buildAppAndModel({
        updateOptions: {
          allowed_fields: ['name', 'description', 'price', 'cost'],
          blocked_fields: ['cost'],
        },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const item = await seedItem(Item, { name: 'Product', price: 100.0 });

      // cost is blocked even though it's in allowed_fields
      const blocked = await request(app)
        .put(`/items/${item.id}`)
        .send({ name: 'Product', cost: 50.0 });
      expect(blocked.status).toBe(400);
      expect(blocked.body.success).toBe(false);

      // Other allowed fields still work
      const allowed = await request(app)
        .put(`/items/${item.id}`)
        .send({ name: 'New Name', price: 75.0 });
      expect(allowed.status).toBe(200);
    });
  });

  describe('Configuration Options: Validation', () => {
    // Documentation: validate: false skips validation
    test('validate: false skips model validation', async () => {
      const sequelizeInstance = new Sequelize('sqlite::memory:', { logging: false });
      const ValidatedItem = sequelizeInstance.define(
        'ValidatedItem',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: {
            type: DataTypes.STRING(100),
            allowNull: true,
            validate: { len: [3, 100] }, // Minimum 3 characters
          },
          price: {
            type: DataTypes.DECIMAL(10, 2),
            validate: { min: 0 }, // Must be positive
          },
        },
        { tableName: 'doc_update_validated', timestamps: false }
      );

      await sequelizeInstance.sync({ force: true });
      sequelize = sequelizeInstance;

      // Create initial item
      const item = await ValidatedItem.create({ name: 'Valid Name', price: 100 });

      const app = express();
      app.use(bodyParser.json());
      app.use('/items', single(ValidatedItem));
      // Both options validate: false AND modelOptions validate: false needed
      app.use('/items', update(ValidatedItem, { validate: false }, { validate: false }));

      // With validation disabled, invalid values are accepted
      const res = await request(app)
        .put(`/items/${item.id}`)
        .send({ name: 'AB', price: 50 }); // name too short

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Configuration Options: ID Mapping', () => {
    // Documentation: id_mapping uses different field for lookup
    test('id_mapping uses external_id for record lookup', async () => {
      const ctx = await buildAppAndModel({
        updateOptions: { id_mapping: 'external_id' },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const item = await seedItem(Item, {
        name: 'Product',
        external_id: 'uuid-123',
        price: 100.0,
      });

      // PUT using external_id
      const res = await request(app)
        .put('/items/uuid-123')
        .send({ name: 'Updated Name', price: 150 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify update happened
      const updated = await Item.findByPk(item.id);
      expect(updated.name).toBe('Updated Name');
    });

    // Documentation: 404 when record not found with custom id_mapping
    test('returns 404 when record not found with custom id_mapping', async () => {
      const ctx = await buildAppAndModel({
        updateOptions: { id_mapping: 'external_id' },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app)
        .put('/items/non-existent-uuid')
        .send({ name: 'New Name' });

      expect(res.status).toBe(404);
    });
  });

  describe('Configuration Options: Middleware', () => {
    // Documentation: middleware with apply_where for ownership scoping
    test('middleware can enforce ownership via apply_where', async () => {
      const enforceOwnership = (req, res, next) => {
        // Simulate scoping to user_id 1
        req.apialize.apply_where({ user_id: 1 });
        next();
      };

      const ctx = await buildAppAndModel({
        updateOptions: { middleware: [enforceOwnership] },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const user1Item = await seedItem(Item, { name: 'User 1 Item', user_id: 1 });
      const user2Item = await seedItem(Item, { name: 'User 2 Item', user_id: 2 });

      // User 1's item can be updated
      const allowed = await request(app)
        .put(`/items/${user1Item.id}`)
        .send({ name: 'Updated', user_id: 1 });
      expect(allowed.status).toBe(200);

      // User 2's item returns 404 (not visible to user 1)
      const blocked = await request(app)
        .put(`/items/${user2Item.id}`)
        .send({ name: 'Hacked', user_id: 2 });
      expect(blocked.status).toBe(404);

      // Verify user 2's item was not modified
      const unchanged = await Item.findByPk(user2Item.id);
      expect(unchanged.name).toBe('User 2 Item');
    });

    // Documentation: middleware can modify values
    test('middleware can override field values', async () => {
      const lockStatus = (req, res, next) => {
        req.apialize.values = {
          ...(req.apialize.values || {}),
          status: 'active',
        };
        next();
      };

      const ctx = await buildAppAndModel({
        updateOptions: { middleware: [lockStatus] },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const item = await seedItem(Item, { name: 'Product', status: 'pending' });

      // Even though we send a different status, middleware overrides it
      const res = await request(app)
        .put(`/items/${item.id}`)
        .send({ name: 'Updated', status: 'inactive' });

      expect(res.status).toBe(200);

      const updated = await Item.findByPk(item.id);
      expect(updated.name).toBe('Updated');
      expect(updated.status).toBe('active');
    });

    // Documentation: Multiple middleware functions
    test('multiple middleware functions execute in order', async () => {
      const scopeMiddleware = (req, res, next) => {
        req.apialize.apply_where({ user_id: 1 });
        next();
      };

      const valueMiddleware = (req, res, next) => {
        req.apialize.values = {
          ...(req.apialize.values || {}),
          updated_by: 1,
        };
        next();
      };

      const ctx = await buildAppAndModel({
        updateOptions: { middleware: [scopeMiddleware, valueMiddleware] },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const item = await seedItem(Item, { name: 'Product', user_id: 1 });

      const res = await request(app)
        .put(`/items/${item.id}`)
        .send({ name: 'Updated', user_id: 1 });

      expect(res.status).toBe(200);

      const updated = await Item.findByPk(item.id);
      expect(updated.name).toBe('Updated');
      expect(updated.updated_by).toBe(1);
    });
  });

  describe('Configuration Options: Hooks', () => {
    // Documentation: pre hook runs before update with transaction
    test('pre hook runs before update with access to transaction', async () => {
      let preHookCalled = false;
      let transactionExists = false;

      const ctx = await buildAppAndModel({
        updateOptions: {
          pre: async (context) => {
            preHookCalled = true;
            transactionExists = !!context.transaction;
            return { timestamp: 12345 };
          },
        },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const item = await seedItem(Item, { name: 'Original', price: 100 });

      const res = await request(app)
        .put(`/items/${item.id}`)
        .send({ name: 'Updated', price: 150 });

      expect(res.status).toBe(200);
      expect(preHookCalled).toBe(true);
      expect(transactionExists).toBe(true);
    });

    // Documentation: post hook can access preResult and modify payload
    test('post hook can access preResult and modify payload', async () => {
      const ctx = await buildAppAndModel({
        updateOptions: {
          pre: async (context) => {
            return { startTime: 12345 };
          },
          post: async (context) => {
            expect(context.preResult).toEqual({ startTime: 12345 });
            context.payload.updated = true;
            context.payload.timestamp = context.preResult.startTime;
          },
        },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const item = await seedItem(Item, { name: 'Product', price: 100 });

      const res = await request(app)
        .put(`/items/${item.id}`)
        .send({ name: 'Updated', price: 150 });

      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(true);
      expect(res.body.timestamp).toBe(12345);
    });

    // Documentation: Multiple hooks execute in order
    test('array of hooks execute in order', async () => {
      const executionOrder = [];

      const ctx = await buildAppAndModel({
        updateOptions: {
          pre: [
            async () => { executionOrder.push('pre1'); return { step: 1 }; },
            async () => { executionOrder.push('pre2'); return { step: 2 }; },
          ],
          post: [
            async (ctx) => { executionOrder.push('post1'); ctx.payload.hook1 = true; },
            async (ctx) => { executionOrder.push('post2'); ctx.payload.hook2 = true; },
          ],
        },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const item = await seedItem(Item, { name: 'Product', price: 100 });

      const res = await request(app)
        .put(`/items/${item.id}`)
        .send({ name: 'Updated', price: 150 });

      expect(res.status).toBe(200);
      expect(executionOrder).toEqual(['pre1', 'pre2', 'post1', 'post2']);
      expect(res.body.hook1).toBe(true);
      expect(res.body.hook2).toBe(true);
    });
  });

  describe('Configuration Options: Field Aliases', () => {
    // Documentation: aliases maps external names to internal names
    test('aliases maps external field names to internal columns', async () => {
      const ctx = await buildAppAndModel({
        updateOptions: {
          aliases: { title: 'name', type: 'category' },
        },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const item = await seedItem(Item, { name: 'Original', category: 'electronics' });

      // Client uses alias names
      const res = await request(app)
        .put(`/items/${item.id}`)
        .send({ title: 'New Title', type: 'gadgets', price: 99 });

      expect(res.status).toBe(200);

      // Verify internal columns were updated
      const updated = await Item.findByPk(item.id);
      expect(updated.name).toBe('New Title');
      expect(updated.category).toBe('gadgets');
    });
  });

  describe('Request Format', () => {
    // Documentation: Full replacement - all fields should be provided
    test('PUT replaces entire record, missing fields become null', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const item = await seedItem(Item, {
        name: 'Original',
        category: 'A',
        status: 'active',
        price: 100,
        description: 'Original description',
      });

      // PUT with only some fields
      const res = await request(app)
        .put(`/items/${item.id}`)
        .send({ name: 'New Name', price: 200 });

      expect(res.status).toBe(200);

      const updated = await Item.findByPk(item.id);
      expect(updated.name).toBe('New Name');
      expect(parseFloat(updated.price)).toBe(200);
      expect(updated.category).toBeNull(); // Was 'A', now null
      expect(updated.status).toBeNull(); // Was 'active', now null
      expect(updated.description).toBeNull(); // Was set, now null
    });
  });

  describe('Response Format', () => {
    // Documentation: Success response structure
    test('success response includes success: true', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const item = await seedItem(Item, { name: 'Product', price: 100 });

      const res = await request(app)
        .put(`/items/${item.id}`)
        .send({ name: 'Updated', price: 150 });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
    });
  });

  describe('Error Handling', () => {
    // Documentation: 404 Not Found when record doesn't exist
    test('returns 404 when record not found', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app)
        .put('/items/9999')
        .send({ name: 'New Name' });

      expect(res.status).toBe(404);
    });

    // Documentation: 400 Bad Request for blocked fields
    test('returns 400 when trying to update blocked field', async () => {
      const ctx = await buildAppAndModel({
        updateOptions: { blocked_fields: ['cost'] },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const item = await seedItem(Item, { name: 'Product', price: 100 });

      const res = await request(app)
        .put(`/items/${item.id}`)
        .send({ name: 'Updated', cost: 50 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('cost');
    });

    // Documentation: Validation errors
    test('returns 400 for validation errors when validation enabled', async () => {
      const sequelizeInstance = new Sequelize('sqlite::memory:', { logging: false });
      const ValidatedItem = sequelizeInstance.define(
        'ValidatedItem',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: {
            type: DataTypes.STRING(100),
            allowNull: true,
            validate: { len: [3, 100] },
          },
          price: {
            type: DataTypes.DECIMAL(10, 2),
            validate: { min: 0 },
          },
        },
        { tableName: 'doc_update_validation', timestamps: false }
      );

      await sequelizeInstance.sync({ force: true });
      sequelize = sequelizeInstance;

      const item = await ValidatedItem.create({ name: 'Valid Name', price: 100 });

      const app = express();
      app.use(bodyParser.json());
      app.use('/items', single(ValidatedItem));
      app.use('/items', update(ValidatedItem, { validate: true }));

      const res = await request(app)
        .put(`/items/${item.id}`)
        .send({ name: 'AB', price: 50 }); // Too short

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Update vs Patch Behavior', () => {
    // Documentation: Comparison showing UPDATE sets unprovided fields to null
    test('UPDATE (PUT) sets unprovided fields to null, unlike PATCH', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const item = await seedItem(Item, {
        name: 'Widget',
        price: 100,
        status: 'active',
        category: 'gadgets',
      });

      // PUT with only price
      const res = await request(app)
        .put(`/items/${item.id}`)
        .send({ price: 150 });

      expect(res.status).toBe(200);

      const updated = await Item.findByPk(item.id);
      expect(parseFloat(updated.price)).toBe(150);
      expect(updated.name).toBeNull(); // Set to null
      expect(updated.status).toBeNull(); // Set to null
      expect(updated.category).toBeNull(); // Set to null
    });
  });

  describe('Query String Filters', () => {
    // Documentation: Ownership scoping via query string
    test('query string filters can scope updates', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const item = await seedItem(Item, { name: 'Product', user_id: 1 });

      // Matching filter: update succeeds
      const ok = await request(app)
        .put(`/items/${item.id}?user_id=1`)
        .send({ name: 'Updated', user_id: 1 });
      expect(ok.status).toBe(200);

      const updated = await Item.findByPk(item.id);
      expect(updated.name).toBe('Updated');

      // Non-matching filter: returns 404
      const miss = await request(app)
        .put(`/items/${item.id}?user_id=2`)
        .send({ name: 'Hacked', user_id: 2 });
      expect(miss.status).toBe(404);
    });
  });

  describe('Relation ID Mapping', () => {
    // Documentation: relation_id_mapping for foreign key mapping
    test('relation_id_mapping maps external IDs to internal foreign keys', async () => {
      const sequelizeInstance = new Sequelize('sqlite::memory:', { logging: false });

      const Category = sequelizeInstance.define(
        'Category',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING },
          external_id: { type: DataTypes.STRING, unique: true },
        },
        { tableName: 'doc_update_categories', timestamps: false }
      );

      const Product = sequelizeInstance.define(
        'Product',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING },
          price: { type: DataTypes.DECIMAL(10, 2) },
          category_id: { type: DataTypes.INTEGER },
        },
        { tableName: 'doc_update_products', timestamps: false }
      );

      Product.belongsTo(Category, { foreignKey: 'category_id' });
      Category.hasMany(Product, { foreignKey: 'category_id' });

      await sequelizeInstance.sync({ force: true });
      sequelize = sequelizeInstance;

      const category1 = await Category.create({ name: 'Electronics', external_id: 'cat-001' });
      const category2 = await Category.create({ name: 'Books', external_id: 'cat-002' });
      const product = await Product.create({ name: 'Laptop', price: 999, category_id: category1.id });

      const app = express();
      app.use(express.json());
      app.use('/products', single(Product));
      app.use('/products', update(Product, {
        relation_id_mapping: [{ model: Category, id_field: 'external_id' }],
      }));

      // Update category using external ID
      const res = await request(app)
        .put(`/products/${product.id}`)
        .send({ name: 'Updated Laptop', price: 1099, category_id: 'cat-002' });

      expect(res.status).toBe(200);

      // Verify internal foreign key was updated
      const updated = await Product.findByPk(product.id);
      expect(updated.category_id).toBe(category2.id);
      expect(updated.name).toBe('Updated Laptop');
    });
  });

  describe('Default Value Behavior', () => {
    // Documentation: Fields with defaults use default when not provided
    test('fields with default values use defaults when not provided in PUT', async () => {
      const sequelizeInstance = new Sequelize('sqlite::memory:', { logging: false });
      const ItemWithDefaults = sequelizeInstance.define(
        'ItemWithDefaults',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: true },
          status: { type: DataTypes.STRING(20), allowNull: true, defaultValue: 'pending' },
          priority: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
        },
        { tableName: 'doc_update_defaults', timestamps: false }
      );

      await sequelizeInstance.sync({ force: true });
      sequelize = sequelizeInstance;

      const item = await ItemWithDefaults.create({
        name: 'Original',
        status: 'active',
        priority: 5,
      });

      const app = express();
      app.use(bodyParser.json());
      app.use('/items', single(ItemWithDefaults));
      app.use('/items', update(ItemWithDefaults));

      // PUT without status and priority - should use defaults
      const res = await request(app)
        .put(`/items/${item.id}`)
        .send({ name: 'Updated' });

      expect(res.status).toBe(200);

      const updated = await ItemWithDefaults.findByPk(item.id);
      expect(updated.name).toBe('Updated');
      expect(updated.status).toBe('pending'); // Default value
      expect(updated.priority).toBe(0); // Default value
    });
  });
});
