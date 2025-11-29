const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes, Op } = require('sequelize');
const { create, single, update, list } = require('../src');

async function build() {
  const sequelize = new Sequelize('sqlite::memory:', { logging: false });

  // Create models with relationships for testing include/attributes
  const Category = sequelize.define(
    'Category',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
      description: { type: DataTypes.STRING(255), allowNull: true },
    },
    { tableName: 'mixed_hooks_categories', timestamps: false }
  );

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
      category_id: { type: DataTypes.INTEGER, allowNull: true },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'active',
      },
      price: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    },
    { tableName: 'mixed_hooks_items', timestamps: false }
  );

  // Set up relationships
  Category.hasMany(Item, { foreignKey: 'category_id', as: 'items' });
  Item.belongsTo(Category, { foreignKey: 'category_id', as: 'category' });

  await sequelize.sync({ force: true });

  const app = express();
  app.use(bodyParser.json());

  // Create operation with array hooks
  app.use(
    '/items',
    create(Item, {
      pre: [
        async (ctx) => {
          return { createStep: 1 };
        },
        async (ctx) => {
          return { createStep: 2 };
        },
      ],
      post: async (ctx) => {
        ctx.payload.createHook = 'single-post';
      },
    })
  );

  // Update operation with mixed hooks (single pre, array post)
  app.use(
    '/items',
    update(Item, {
      pre: async (ctx) => {
        return { updateStep: 1 };
      },
      post: [
        async (ctx) => {
          ctx.payload.updateHook1 = 'mixed-post1';
        },
        async (ctx) => {
          ctx.payload.updateHook2 = 'mixed-post2';
        },
      ],
    })
  );

  return { sequelize, Item, Category, app };
}

describe('mixed hooks: single functions and arrays together', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  test('mixed hook types work together correctly', async () => {
    const { sequelize: s, app } = await build();
    sequelize = s;

    // Test create with array pre hooks and single post hook
    const created = await request(app)
      .post('/items')
      .send({ external_id: 'mixed-1', name: 'MixedTest' });

    expect(created.status).toBe(201);
    expect(created.body.success).toBe(true);
    expect(created.body.createHook).toBe('single-post');

    const itemId = created.body.id;

    // Test update with single pre hook and array post hooks
    const updated = await request(app)
      .put(`/items/${itemId}`)
      .send({ external_id: 'mixed-1', name: 'MixedTestUpdated' });

    expect(updated.status).toBe(200);
    expect(updated.body.success).toBe(true);
    expect(updated.body.updateHook1).toBe('mixed-post1');
    expect(updated.body.updateHook2).toBe('mixed-post2');
  });

  test('execution order is preserved across different hook configurations', async () => {
    const { sequelize: s, app } = await build();
    sequelize = s;

    // Create item with array pre hooks
    const created = await request(app)
      .post('/items')
      .send({ external_id: 'order-test', name: 'OrderTest' });

    expect(created.status).toBe(201);
    expect(created.body.createHook).toBe('single-post');

    // Update with single pre and array post hooks
    const updated = await request(app)
      .put(`/items/${created.body.id}`)
      .send({ external_id: 'order-test', name: 'OrderTestUpdated' });

    expect(updated.status).toBe(200);
    expect(updated.body.updateHook1).toBe('mixed-post1');
    expect(updated.body.updateHook2).toBe('mixed-post2');
  });

  test('pre hooks can modify where clause to filter results', async () => {
    const { sequelize: s, Category, Item } = await build();
    sequelize = s;

    // Create test data
    const category1 = await Category.create({
      name: 'Electronics',
      description: 'Electronic items',
    });
    const category2 = await Category.create({
      name: 'Books',
      description: 'Book items',
    });

    await Item.create({
      external_id: 'item1',
      name: 'Laptop',
      category_id: category1.id,
      status: 'active',
      price: 999.99,
    });
    await Item.create({
      external_id: 'item2',
      name: 'Mouse',
      category_id: category1.id,
      status: 'inactive',
      price: 29.99,
    });
    await Item.create({
      external_id: 'item3',
      name: 'Novel',
      category_id: category2.id,
      status: 'active',
      price: 25.99,
    });

    // Create new app with list operation that modifies where clause
    const app = express();
    app.use(bodyParser.json());
    app.use(
      '/items',
      list(Item, {
        pre: [
          async (ctx) => {
            // First pre hook: filter by status
            ctx.applyWhere({ status: 'active' });
            return { step: 1 };
          },
          async (ctx) => {
            // Second pre hook: further filter by price > 20
            ctx.applyWhere({ price: { [Op.gt]: 20 } });
            return { step: 2, whereModified: true };
          },
        ],
        post: async (ctx) => {
          ctx.payload.meta.whereClauseModified = true;
          ctx.payload.meta.preResult = ctx.preResult;
        },
      })
    );

    const response = await request(app).get('/items');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(2); // Only laptop and novel (active + price > 20)
    expect(response.body.data.map((item) => item.name).sort()).toEqual([
      'Laptop',
      'Novel',
    ]);
    expect(response.body.meta.whereClauseModified).toBe(true);
    expect(response.body.meta.preResult).toEqual({
      step: 2,
      whereModified: true,
    });
  });

  test('pre hooks can modify include clause to add relations', async () => {
    const { sequelize: s, Category, Item } = await build();
    sequelize = s;

    // Create test data
    const category = await Category.create({
      name: 'Electronics',
      description: 'Electronic items',
    });
    const item = await Item.create({
      external_id: 'item-with-cat',
      name: 'Smartphone',
      category_id: category.id,
      status: 'active',
    });

    // Create separate app for this test to avoid routing conflicts
    const app = express();
    app.use(bodyParser.json());
    app.use(
      '/items',
      single(Item, {
        pre: [
          async (ctx) => {
            // First pre hook: add basic include
            ctx.req.apialize.options.include = [
              { model: Category, as: 'category' },
            ];
            return { step: 1 };
          },
          async (ctx) => {
            // Second pre hook: modify attributes for the include
            ctx.req.apialize.options.include[0].attributes = [
              'name',
              'description',
            ];
            return { step: 2, includeModified: true };
          },
        ],
        post: async (ctx) => {
          ctx.payload.includeClauseModified = true;
          ctx.payload.preResult = ctx.preResult;
        },
      })
    );

    const response = await request(app).get(`/items/${item.id}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.record.name).toBe('Smartphone');
    expect(response.body.record.category).toBeDefined();
    expect(response.body.record.category.name).toBe('Electronics');
    expect(response.body.record.category.description).toBe('Electronic items');
    expect(response.body.record.category.id).toBeUndefined(); // Should be excluded due to attributes filter
    expect(response.body.includeClauseModified).toBe(true);
    expect(response.body.preResult).toEqual({ step: 2, includeModified: true });
  });

  test('pre hooks can modify attributes clause to control returned fields', async () => {
    const { sequelize: s, Item } = await build();
    sequelize = s;

    // Create test data
    const item = await Item.create({
      external_id: 'attr-test',
      name: 'Test Item',
      desc: 'This is a test item',
      status: 'active',
      price: 99.99,
    });

    // Create separate app for this test to avoid routing conflicts
    const app = express();
    app.use(bodyParser.json());
    app.use(
      '/items',
      single(Item, {
        pre: [
          async (ctx) => {
            // First pre hook: limit to basic fields
            ctx.req.apialize.options.attributes = ['id', 'name', 'external_id'];
            return { step: 1 };
          },
          async (ctx) => {
            // Second pre hook: add one more field
            ctx.req.apialize.options.attributes.push('status');
            return { step: 2, attributesModified: true };
          },
        ],
        post: async (ctx) => {
          ctx.payload.attributesClauseModified = true;
          ctx.payload.preResult = ctx.preResult;
        },
      })
    );

    const response = await request(app).get(`/items/${item.id}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.record.id).toBe(item.id);
    expect(response.body.record.name).toBe('Test Item');
    expect(response.body.record.external_id).toBe('attr-test');
    expect(response.body.record.status).toBe('active');
    // These should be excluded due to attributes filter
    expect(response.body.record.desc).toBeUndefined();
    expect(response.body.record.price).toBeUndefined();
    expect(response.body.record.category_id).toBeUndefined();
    expect(response.body.attributesClauseModified).toBe(true);
    expect(response.body.preResult).toEqual({
      step: 2,
      attributesModified: true,
    });
  });

  test('single post hook mutations persist in returned payload', async () => {
    const { sequelize: s, Item } = await build();
    sequelize = s;

    // Seed one item
    const item = await Item.create({
      external_id: 'mut-payload',
      name: 'Original Name',
      status: 'active',
    });

    // New app with single route whose post hook mutates the payload
    const app = express();
    app.use(bodyParser.json());
    app.use(
      '/items',
      single(Item, {
        post: async (ctx) => {
          // mutate nested record and add a top-level field
          if (ctx && ctx.payload && ctx.payload.record) {
            ctx.payload.record.name = 'Name From Post Hook';
            ctx.payload.record.extra = 'added-by-hook';
          }
          ctx.payload.mutated = true;
        },
      })
    );

    const res = await request(app).get(`/items/${item.id}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Ensure the mutation happened on the same payload object that is returned
    expect(res.body.record.name).toBe('Name From Post Hook');
    expect(res.body.record.extra).toBe('added-by-hook');
    expect(res.body.mutated).toBe(true);
  });
});
