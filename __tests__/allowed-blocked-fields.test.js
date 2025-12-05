const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { create, update, patch, single } = require('../src');

describe('Allowed and Blocked Fields Configuration', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  async function buildAppAndModel(
    createOptions = {},
    updateOptions = {},
    patchOptions = {}
  ) {
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
        cost: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: true,
        },
        internal_notes: {
          type: DataTypes.TEXT,
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
    app.use('/items', update(Item, updateOptions));
    app.use('/items', patch(Item, patchOptions));
    app.use('/items', single(Item)); // For GET operations

    return { Item, app };
  }

  describe('CREATE operation with allowed_fields', () => {
    test('allows creating with fields in allowed_fields list', async () => {
      const { Item, app } = await buildAppAndModel({
        allowed_fields: ['name', 'description', 'price'],
      });

      const res = await request(app).post('/items').send({
        name: 'Product A',
        description: 'A great product',
        price: 99.99,
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.id).toBeDefined();

      const item = await Item.findByPk(res.body.id);
      expect(item.name).toBe('Product A');
      expect(item.description).toBe('A great product');
      expect(parseFloat(item.price)).toBe(99.99);
    });

    test('returns 400 when creating with field not in allowed_fields list', async () => {
      const { app } = await buildAppAndModel({
        allowed_fields: ['name', 'description'],
      });

      const res = await request(app).post('/items').send({
        name: 'Product A',
        price: 99.99, // Not in allowed list
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('price');
    });

    test('allows all fields when allowed_fields is null', async () => {
      const { Item, app } = await buildAppAndModel({
        allowed_fields: null,
      });

      const res = await request(app).post('/items').send({
        name: 'Product A',
        description: 'Description',
        price: 99.99,
        cost: 50.0,
        internal_notes: 'Internal info',
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });

  describe('CREATE operation with blocked_fields', () => {
    test('blocks creating with fields in blocked_fields list', async () => {
      const { app } = await buildAppAndModel({
        blocked_fields: ['cost', 'internal_notes'],
      });

      const res = await request(app).post('/items').send({
        name: 'Product A',
        cost: 50.0, // Blocked field
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('cost');
    });

    test('allows creating with fields not in blocked_fields list', async () => {
      const { Item, app } = await buildAppAndModel({
        blocked_fields: ['cost', 'internal_notes'],
      });

      const res = await request(app).post('/items').send({
        name: 'Product A',
        description: 'Description',
        price: 99.99,
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });

  describe('CREATE operation with both allowed and blocked fields', () => {
    test('blocked_fields takes precedence over allowed_fields', async () => {
      const { app } = await buildAppAndModel({
        allowed_fields: ['name', 'description', 'price', 'cost'],
        blocked_fields: ['cost'], // cost is in both - should be blocked
      });

      // Should allow price
      const res1 = await request(app).post('/items').send({
        name: 'Product A',
        price: 99.99,
      });
      expect(res1.status).toBe(201);

      // Should block cost
      const res2 = await request(app).post('/items').send({
        name: 'Product B',
        cost: 50.0,
      });
      expect(res2.status).toBe(400);
      expect(res2.body.error).toContain('cost');
    });
  });

  describe('CREATE operation bulk insert with field controls', () => {
    test('validates all items in bulk create', async () => {
      const { app } = await buildAppAndModel({
        allow_bulk_create: true,
        allowed_fields: ['name', 'price'],
      });

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
  });

  describe('UPDATE operation with allowed_fields', () => {
    test('allows updating with fields in allowed_fields list', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        { allowed_fields: ['name', 'description', 'price'] },
        {}
      );

      // Create an item first
      const item = await Item.create({
        name: 'Original',
        description: 'Old description',
        price: 50.0,
        cost: 25.0,
      });

      const res = await request(app).put(`/items/${item.id}`).send({
        name: 'Updated',
        description: 'New description',
        price: 75.0,
        // cost and internal_notes will get defaults/null
        // status will get defaults/null
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const updated = await Item.findByPk(item.id);
      expect(updated.name).toBe('Updated');
      expect(updated.description).toBe('New description');
      expect(parseFloat(updated.price)).toBe(75.0);
    });

    test('returns 400 when updating with field not in allowed_fields list', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        { allowed_fields: ['name', 'description'] },
        {}
      );

      const item = await Item.create({
        name: 'Original',
        price: 50.0,
      });

      const res = await request(app).put(`/items/${item.id}`).send({
        name: 'Updated',
        description: 'New description',
        price: 75.0, // Not allowed
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('price');
    });
  });

  describe('UPDATE operation with blocked_fields', () => {
    test('blocks updating with fields in blocked_fields list', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        { blocked_fields: ['cost', 'internal_notes'] },
        {}
      );

      const item = await Item.create({
        name: 'Original',
        cost: 25.0,
      });

      const res = await request(app).put(`/items/${item.id}`).send({
        name: 'Updated',
        cost: 30.0, // Blocked
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('cost');
    });
  });

  describe('PATCH operation with allowed_fields', () => {
    test('allows patching with fields in allowed_fields list', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {},
        { allowed_fields: ['description', 'status'] }
      );

      const item = await Item.create({
        name: 'Original',
        description: 'Old',
        status: 'draft',
      });

      const res = await request(app).patch(`/items/${item.id}`).send({
        status: 'published',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const updated = await Item.findByPk(item.id);
      expect(updated.status).toBe('published');
      expect(updated.name).toBe('Original'); // Unchanged
    });

    test('returns 400 when patching with field not in allowed_fields list', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {},
        { allowed_fields: ['description'] }
      );

      const item = await Item.create({
        name: 'Original',
        status: 'draft',
      });

      const res = await request(app).patch(`/items/${item.id}`).send({
        status: 'published', // Not allowed
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('status');
    });
  });

  describe('PATCH operation with blocked_fields', () => {
    test('blocks patching with fields in blocked_fields list', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {},
        { blocked_fields: ['internal_notes', 'cost'] }
      );

      const item = await Item.create({
        name: 'Original',
        internal_notes: 'Secret',
      });

      const res = await request(app).patch(`/items/${item.id}`).send({
        internal_notes: 'New secret', // Blocked
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('internal_notes');
    });

    test('allows patching fields not in blocked_fields list', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {},
        { blocked_fields: ['cost'] }
      );

      const item = await Item.create({
        name: 'Original',
        description: 'Old',
      });

      const res = await request(app).patch(`/items/${item.id}`).send({
        description: 'New',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const updated = await Item.findByPk(item.id);
      expect(updated.description).toBe('New');
    });
  });

  describe('Different configurations per operation', () => {
    test('can have different field controls for create, update, and patch', async () => {
      const { Item, app } = await buildAppAndModel(
        { allowed_fields: ['name', 'description', 'price'] }, // CREATE
        { allowed_fields: ['description', 'price'] }, // UPDATE
        { allowed_fields: ['status'] } // PATCH
      );

      // CREATE allows name, description, price
      const createRes = await request(app).post('/items').send({
        name: 'Product A',
        description: 'Great product',
        price: 99.99,
      });
      expect(createRes.status).toBe(201);
      const itemId = createRes.body.id;

      // UPDATE does not allow name (only description, price)
      const updateRes = await request(app).put(`/items/${itemId}`).send({
        name: 'Updated Name',
        description: 'Updated description',
        price: 89.99,
      });
      expect(updateRes.status).toBe(400);
      expect(updateRes.body.error).toContain('name');

      // PATCH only allows status
      const patchRes = await request(app).patch(`/items/${itemId}`).send({
        status: 'active',
      });
      expect(patchRes.status).toBe(200);

      const patchRes2 = await request(app).patch(`/items/${itemId}`).send({
        price: 79.99, // Not allowed in PATCH
      });
      expect(patchRes2.status).toBe(400);
      expect(patchRes2.body.error).toContain('price');
    });
  });

  describe('Programmatic field setting should bypass restrictions', () => {
    test('middleware can set blocked fields on CREATE', async () => {
      const { Item, app } = await buildAppAndModel(
        {
          blocked_fields: ['cost', 'internal_notes'],
          middleware: [
            (req, res, next) => {
              // Middleware can set blocked fields programmatically using set_multiple_values
              req.apialize.set_multiple_values({
                cost: 25.0,
                internal_notes: 'Set by middleware',
              });
              next();
            },
          ],
        },
        {},
        {}
      );

      const res = await request(app).post('/items').send({
        name: 'Product A',
        price: 99.99,
      });

      expect(res.status).toBe(201);
      const item = await Item.findByPk(res.body.id);
      expect(parseFloat(item.cost)).toBe(25.0);
      expect(item.internal_notes).toBe('Set by middleware');
    });

    test('pre-hook can set blocked fields on CREATE', async () => {
      const { Item, app } = await buildAppAndModel(
        {
          blocked_fields: ['internal_notes'],
          pre: async (req, context) => {
            // Pre-hook can set blocked fields
            req.apialize.set_value('internal_notes', 'Set in pre-hook');
          },
        },
        {},
        {}
      );

      const res = await request(app).post('/items').send({
        name: 'Product B',
        price: 49.99,
      });

      expect(res.status).toBe(201);
      const item = await Item.findByPk(res.body.id);
      expect(item.internal_notes).toBe('Set in pre-hook');
    });

    test('middleware can set non-allowed fields on UPDATE', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {
          allowed_fields: ['name', 'description'],
          middleware: [
            (req, res, next) => {
              // Middleware can set fields not in allowed list
              req.apialize.set_value('cost', 30.0);
              next();
            },
          ],
        },
        {}
      );

      const item = await Item.create({
        name: 'Original',
        cost: 20.0,
      });

      const res = await request(app).put(`/items/${item.id}`).send({
        name: 'Updated',
        description: 'New description',
      });

      expect(res.status).toBe(200);
      const updated = await Item.findByPk(item.id);
      expect(parseFloat(updated.cost)).toBe(30.0);
    });

    test('pre-hook can set blocked fields on PATCH', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {},
        {
          blocked_fields: ['cost'],
          pre: async (req, context) => {
            // Pre-hook can set blocked fields
            req.apialize.set_value('cost', 35.0);
          },
        }
      );

      const item = await Item.create({
        name: 'Original',
        cost: 20.0,
      });

      const res = await request(app).patch(`/items/${item.id}`).send({
        description: 'Updated description',
      });

      expect(res.status).toBe(200);
      const updated = await Item.findByPk(item.id);
      expect(parseFloat(updated.cost)).toBe(35.0);
      expect(updated.description).toBe('Updated description');
    });

    test('user cannot set blocked field even if middleware sets allowed field', async () => {
      const { Item, app } = await buildAppAndModel(
        {
          blocked_fields: ['cost'],
          middleware: [
            (req, res, next) => {
              // Middleware sets an allowed field
              req.apialize.set_value('description', 'Set by middleware');
              next();
            },
          ],
        },
        {},
        {}
      );

      // User tries to set blocked field - should still fail
      const res = await request(app).post('/items').send({
        name: 'Product C',
        cost: 50.0, // Blocked
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('cost');
    });
  });
});
