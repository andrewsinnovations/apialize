/**
 * Documentation Examples Test
 *
 * This test file validates that the code examples in documentation/destroy.md
 * work as expected and produce the documented outputs.
 */

const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { create, destroy, single, list } = require('../src');

// Helper to build app with given destroy options and modelOptions
async function buildAppAndModel({
  destroyOptions = {},
  modelOptions = {},
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
        user_id: { type: DataTypes.INTEGER, allowNull: true },
        parent_id: { type: DataTypes.INTEGER, allowNull: true },
        archived: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
      },
      { tableName: 'doc_destroy_items', timestamps: false }
    );

  await sequelize.sync({ force: true });

  const app = express();
  app.use(bodyParser.json());
  app.use('/items', create(Item));
  app.use('/items', single(Item));
  app.use('/items', list(Item));
  app.use('/items', destroy(Item, destroyOptions, modelOptions));

  return { sequelize, Item, app };
}

// Helper to create a test item
async function createItem(app, data) {
  const res = await request(app).post('/items').send(data);
  return res.body.id;
}

describe('Documentation Examples: destroy.md', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  describe('Basic Usage', () => {
    // Documentation: "This creates a DELETE /items/:id endpoint"
    test('destroy(Item) creates a DELETE /items/:id endpoint', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const id = await createItem(app, { name: 'Test Item', category: 'test' });

      const res = await request(app).delete(`/items/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Default Usage (No Configuration)', () => {
    // Documentation example response structure
    test('returns success and id for deleted record', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const id = await createItem(app, { name: 'Test Item', category: 'test' });

      const res = await request(app).delete(`/items/${id}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('id', String(id));
    });

    // Documentation: Default id_mapping is 'id'
    test('defaults to id field for lookup', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const id = await createItem(app, { name: 'Product', category: 'test' });

      const res = await request(app).delete(`/items/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.id).toBe(String(id));
    });

    // Verify record is actually deleted
    test('record is actually removed from database', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const id = await createItem(app, { name: 'To Delete', category: 'test' });

      // Verify it exists
      const beforeCount = await Item.count();
      expect(beforeCount).toBe(1);

      // Delete it
      await request(app).delete(`/items/${id}`);

      // Verify it's gone
      const afterCount = await Item.count();
      expect(afterCount).toBe(0);
    });
  });

  describe('Configuration Options: ID Mapping', () => {
    // Documentation: id_mapping: 'external_id' deletes by external id
    test('id_mapping allows deletion by custom field', async () => {
      const ctx = await buildAppAndModel({
        destroyOptions: { id_mapping: 'external_id' },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      await createItem(app, {
        external_id: 'uuid-abc-123',
        name: 'Product',
        category: 'test',
      });

      const res = await request(app).delete('/items/uuid-abc-123');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        id: 'uuid-abc-123',
      });
    });

    // Verify record is gone after deletion by custom id
    test('record is removed when deleted by custom id_mapping', async () => {
      const ctx = await buildAppAndModel({
        destroyOptions: { id_mapping: 'external_id' },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await createItem(app, {
        external_id: 'to-delete-uuid',
        name: 'Product',
        category: 'test',
      });

      await request(app).delete('/items/to-delete-uuid');

      const remaining = await Item.findAll();
      expect(remaining).toHaveLength(0);
    });
  });

  describe('Configuration Options: Middleware', () => {
    // Documentation: Middleware can scope deletions
    test('middleware can scope deletions to specific records', async () => {
      const scopeToUser = (req, res, next) => {
        req.apialize.apply_where({ user_id: 42 });
        next();
      };

      const ctx = await buildAppAndModel({
        destroyOptions: { middleware: [scopeToUser] },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      // Create items for different users
      const userItem = await createItem(app, {
        name: 'User Item',
        category: 'test',
        user_id: 42,
      });
      const otherItem = await createItem(app, {
        name: 'Other Item',
        category: 'test',
        user_id: 99,
      });

      // Can delete own item
      const ownRes = await request(app).delete(`/items/${userItem}`);
      expect(ownRes.status).toBe(200);

      // Cannot delete other user's item (returns 404)
      const otherRes = await request(app).delete(`/items/${otherItem}`);
      expect(otherRes.status).toBe(404);
    });

    // Documentation: Parent scoping via middleware
    test('middleware can enforce parent scoping', async () => {
      const scopeToParent = (req, res, next) => {
        req.apialize.apply_where({ parent_id: 50 });
        next();
      };

      const ctx = await buildAppAndModel({
        destroyOptions: { middleware: [scopeToParent] },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const matchingItem = await createItem(app, {
        name: 'Matching',
        category: 'test',
        parent_id: 50,
      });
      const nonMatchingItem = await createItem(app, {
        name: 'Non-matching',
        category: 'test',
        parent_id: 999,
      });

      // Can delete item with matching parent_id
      const matchRes = await request(app).delete(`/items/${matchingItem}`);
      expect(matchRes.status).toBe(200);

      // Cannot delete item with different parent_id
      const nonMatchRes = await request(app).delete(`/items/${nonMatchingItem}`);
      expect(nonMatchRes.status).toBe(404);
    });
  });

  describe('Configuration Options: Hooks', () => {
    // Documentation: pre hook runs before deletion with transaction
    test('pre hook runs before record deletion with transaction', async () => {
      let preHookCalled = false;
      let contextId = null;
      let transactionAvailable = false;

      const ctx = await buildAppAndModel({
        destroyOptions: {
          pre: async (context) => {
            preHookCalled = true;
            contextId = context.id;
            transactionAvailable = !!context.transaction;
            return { deletedId: context.id };
          },
        },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const id = await createItem(app, { name: 'Product', category: 'test' });

      const res = await request(app).delete(`/items/${id}`);
      expect(res.status).toBe(200);
      expect(preHookCalled).toBe(true);
      expect(contextId).toBe(String(id));
      expect(transactionAvailable).toBe(true);
    });

    // Documentation: post hook runs after deletion
    test('post hook runs after record deletion and can modify payload', async () => {
      const ctx = await buildAppAndModel({
        destroyOptions: {
          post: async (context) => {
            context.payload.deletedAt = '2025-01-01T00:00:00.000Z';
            context.payload.recordId = context.id;
          },
        },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const id = await createItem(app, { name: 'Product', category: 'test' });

      const res = await request(app).delete(`/items/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.deletedAt).toBe('2025-01-01T00:00:00.000Z');
      expect(res.body.recordId).toBe(String(id));
    });

    // Documentation: post hook can access preResult
    test('post hook can access preResult from pre hook', async () => {
      const ctx = await buildAppAndModel({
        destroyOptions: {
          pre: async (context) => {
            return { deletedId: context.id, timestamp: Date.now() };
          },
          post: async (context) => {
            context.payload.preData = context.preResult;
          },
        },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const id = await createItem(app, { name: 'Product', category: 'test' });

      const res = await request(app).delete(`/items/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.preData).toBeDefined();
      expect(res.body.preData.deletedId).toBe(String(id));
      expect(typeof res.body.preData.timestamp).toBe('number');
    });

    // Documentation: Multiple hooks execute in order
    test('multiple pre/post hooks execute in order', async () => {
      const executionOrder = [];

      const ctx = await buildAppAndModel({
        destroyOptions: {
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
              ctx.payload.auditLogged = true;
            },
            async (ctx) => {
              executionOrder.push('post2');
              ctx.payload.notificationSent = true;
            },
          ],
        },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const id = await createItem(app, { name: 'Product', category: 'test' });

      const res = await request(app).delete(`/items/${id}`);
      expect(res.status).toBe(200);
      expect(executionOrder).toEqual(['pre1', 'pre2', 'post1', 'post2']);
      expect(res.body.auditLogged).toBe(true);
      expect(res.body.notificationSent).toBe(true);
    });

    // Documentation: Pre hook has access to context.where
    test('pre hook has access to context.id and context.where', async () => {
      let capturedId = null;
      let capturedWhere = null;

      const ctx = await buildAppAndModel({
        destroyOptions: {
          pre: async (context) => {
            capturedId = context.id;
            capturedWhere = context.where;
          },
        },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const id = await createItem(app, { name: 'Product', category: 'test' });

      await request(app).delete(`/items/${id}`);

      expect(capturedId).toBe(String(id));
      expect(capturedWhere).toBeDefined();
      expect(capturedWhere.id).toBe(String(id));
    });
  });

  describe('Request Format', () => {
    // Documentation: Delete by ID
    test('DELETE /items/:id deletes record by ID', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const id = await createItem(app, { name: 'Product', category: 'test' });

      const res = await request(app).delete(`/items/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    // Documentation: Query parameters for ownership scoping
    test('query parameters add additional where conditions', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const id = await createItem(app, {
        name: 'Product',
        category: 'test',
        user_id: 42,
      });

      // Wrong user_id returns 404
      const wrongUser = await request(app).delete(`/items/${id}?user_id=999`);
      expect(wrongUser.status).toBe(404);

      // Correct user_id succeeds
      const correctUser = await request(app).delete(`/items/${id}?user_id=42`);
      expect(correctUser.status).toBe(200);
    });
  });

  describe('Response Format', () => {
    // Documentation: Successful deletion response
    test('successful deletion returns { success: true, id: "..." }', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const id = await createItem(app, { name: 'Product', category: 'test' });

      const res = await request(app).delete(`/items/${id}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        id: String(id),
      });
    });

    // Documentation: Custom id_mapping response
    test('custom id_mapping response uses mapped field value', async () => {
      const ctx = await buildAppAndModel({
        destroyOptions: { id_mapping: 'external_id' },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      await createItem(app, {
        external_id: 'uuid-xyz-789',
        name: 'Product',
        category: 'test',
      });

      const res = await request(app).delete('/items/uuid-xyz-789');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        id: 'uuid-xyz-789',
      });
    });

    // Documentation: With post hook modifications
    test('post hook can add properties to response', async () => {
      const ctx = await buildAppAndModel({
        destroyOptions: {
          post: async (context) => {
            context.payload.deletedAt = '2025-01-01T00:00:00.000Z';
          },
        },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const id = await createItem(app, { name: 'Product', category: 'test' });

      const res = await request(app).delete(`/items/${id}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        id: String(id),
        deletedAt: '2025-01-01T00:00:00.000Z',
      });
    });
  });

  describe('Error Handling', () => {
    // Documentation: Record not found returns 404
    test('record not found returns 404', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app).delete('/items/99999');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    // Documentation: Custom id_mapping with non-existent record
    test('non-existent record with custom id_mapping returns 404', async () => {
      const ctx = await buildAppAndModel({
        destroyOptions: { id_mapping: 'external_id' },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const res = await request(app).delete('/items/does-not-exist');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    // Documentation: Ownership scoping failure returns 404
    test('ownership scoping failure returns 404', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const id = await createItem(app, {
        name: 'Product',
        category: 'test',
        user_id: 42,
      });

      // Try to delete with wrong user_id
      const res = await request(app).delete(`/items/${id}?user_id=999`);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    // Documentation: Already deleted record returns 404
    test('already deleted record returns 404 on second delete', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const id = await createItem(app, { name: 'Product', category: 'test' });

      // First delete succeeds
      const first = await request(app).delete(`/items/${id}`);
      expect(first.status).toBe(200);

      // Second delete returns 404
      const second = await request(app).delete(`/items/${id}`);
      expect(second.status).toBe(404);
    });
  });

  describe('Examples from Documentation', () => {
    // Documentation: Basic Delete example
    test('Basic Delete example', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const id = await createItem(app, { name: 'Product', category: 'test' });

      const res = await request(app).delete(`/items/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.id).toBe(String(id));
    });

    // Documentation: Custom ID Mapping with UUID example
    test('Custom ID Mapping with UUID example', async () => {
      const ctx = await buildAppAndModel({
        destroyOptions: { id_mapping: 'external_id' },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      await createItem(app, {
        external_id: 'uuid-abc-123',
        name: 'Product',
        category: 'test',
      });

      const res = await request(app).delete('/items/uuid-abc-123');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        id: 'uuid-abc-123',
      });
    });

    // Documentation: With Authentication Scoping example
    test('With Authentication Scoping example', async () => {
      const scopeToUser = (req, res, next) => {
        // Simulating req.user.id = 42
        req.apialize.apply_where({ user_id: 42 });
        next();
      };

      const ctx = await buildAppAndModel({
        destroyOptions: { middleware: [scopeToUser] },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      // Create item for user 42
      const ownId = await createItem(app, {
        name: 'Own Item',
        category: 'test',
        user_id: 42,
      });

      // Create item for another user
      const otherId = await createItem(app, {
        name: 'Other Item',
        category: 'test',
        user_id: 99,
      });

      // Can delete own item
      const ownRes = await request(app).delete(`/items/${ownId}`);
      expect(ownRes.status).toBe(200);

      // Cannot delete other user's item
      const otherRes = await request(app).delete(`/items/${otherId}`);
      expect(otherRes.status).toBe(404);
    });

    // Documentation: With Pre/Post Hooks example
    test('With Pre/Post Hooks example', async () => {
      let loggedMessage = null;

      const ctx = await buildAppAndModel({
        destroyOptions: {
          pre: async (context) => {
            loggedMessage = `Deleting record: ${context.id}`;
            return { deletedId: context.id };
          },
          post: async (context) => {
            context.payload.deletedAt = new Date().toISOString();
          },
        },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const id = await createItem(app, { name: 'Product', category: 'test' });

      const res = await request(app).delete(`/items/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.deletedAt).toBeDefined();
      expect(loggedMessage).toBe(`Deleting record: ${id}`);
    });

    // Documentation: With Multiple Hooks example
    test('With Multiple Hooks example', async () => {
      const ctx = await buildAppAndModel({
        destroyOptions: {
          pre: [
            async (ctx) => {
              return { step: 1 };
            },
            async (ctx) => {
              return { step: 2 };
            },
          ],
          post: [
            async (ctx) => {
              ctx.payload.auditLogged = true;
            },
            async (ctx) => {
              ctx.payload.notificationSent = true;
            },
          ],
        },
      });
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const id = await createItem(app, { name: 'Product', category: 'test' });

      const res = await request(app).delete(`/items/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.auditLogged).toBe(true);
      expect(res.body.notificationSent).toBe(true);
    });
  });

  describe('Integration: Verify deletion through list/single', () => {
    // Verify deleted record is not retrievable via single
    test('deleted record returns 404 via single', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const id = await createItem(app, { name: 'Product', category: 'test' });

      // Verify it exists
      const beforeSingle = await request(app).get(`/items/${id}`);
      expect(beforeSingle.status).toBe(200);

      // Delete it
      await request(app).delete(`/items/${id}`);

      // Verify it's gone
      const afterSingle = await request(app).get(`/items/${id}`);
      expect(afterSingle.status).toBe(404);
    });

    // Verify deleted record is not in list
    test('deleted record is not returned in list', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { app } = ctx;

      const id1 = await createItem(app, { name: 'Item 1', category: 'test' });
      const id2 = await createItem(app, { name: 'Item 2', category: 'test' });

      // Verify both exist in list
      const beforeList = await request(app).get('/items');
      expect(beforeList.body.data).toHaveLength(2);

      // Delete one
      await request(app).delete(`/items/${id1}`);

      // Verify only one remains
      const afterList = await request(app).get('/items');
      expect(afterList.body.data).toHaveLength(1);
      expect(afterList.body.data[0].name).toBe('Item 2');
    });
  });

  describe('Soft Delete with Paranoid Mode', () => {
    // Documentation: Paranoid mode marks records as deleted
    test('paranoid model sets deleted_at instead of removing', async () => {
      const ctx = await buildAppAndModel({
        defineModel: (sequelize, DataTypes) =>
          sequelize.define(
            'Item',
            {
              id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
              name: { type: DataTypes.STRING(100), allowNull: false },
              category: { type: DataTypes.STRING(50), allowNull: true },
            },
            {
              tableName: 'doc_destroy_items',
              timestamps: true,
              paranoid: true, // Enables soft delete
            }
          ),
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const id = await createItem(app, { name: 'Soft Delete Item', category: 'test' });

      // Delete it
      const res = await request(app).delete(`/items/${id}`);
      expect(res.status).toBe(200);

      // Verify it's "deleted" (has deletedAt)
      const softDeleted = await Item.findByPk(id, { paranoid: false });
      expect(softDeleted).not.toBeNull();
      expect(softDeleted.deletedAt).not.toBeNull();

      // Verify it's not returned in normal queries
      const notFound = await Item.findByPk(id);
      expect(notFound).toBeNull();
    });
  });
});
