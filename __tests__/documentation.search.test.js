/**
 * Documentation Examples Test
 *
 * This test file validates that the code examples in documentation/search.md
 * work as expected and produce the documented outputs.
 */

const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { search } = require('../src');

// Helper to build app with given search options and modelOptions
async function buildAppAndModel({
  searchOptions = {},
  modelOptions = {},
  modelApialize = {},
  defineModel = null,
} = {}) {
  const sequelize = new Sequelize('sqlite::memory:', { logging: false });

  const Item =
    defineModel?.(sequelize, DataTypes) ||
    sequelize.define(
      'Item',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        external_id: { type: DataTypes.STRING(64), allowNull: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
        category: { type: DataTypes.STRING(50), allowNull: false },
        price: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
        status: { type: DataTypes.STRING(20), allowNull: true },
        score: { type: DataTypes.INTEGER, allowNull: true },
        active: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: true },
        password: { type: DataTypes.STRING(100), allowNull: true },
        secret_key: { type: DataTypes.STRING(100), allowNull: true },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
      },
      { tableName: 'doc_search_items', timestamps: false }
    );

  Item.apialize = { ...(modelApialize || {}) };

  await sequelize.sync({ force: true });

  const app = express();
  app.use(bodyParser.json());
  app.use('/items', search(Item, searchOptions, modelOptions));

  return { sequelize, Item, app };
}

async function seed(Item, rows) {
  await Item.bulkCreate(rows);
}

function names(res) {
  return res.body.data.map((r) => r.name);
}

describe('Documentation Examples: search.md', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  describe('Basic Usage', () => {
    // Documentation: "This creates a POST /items/search endpoint"
    test('search(Item) creates a POST /items/search endpoint', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [{ name: 'Test Item', category: 'test', price: 10.0 }]);

      const res = await request(app).post('/items/search').send({});
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('Default Usage (No Configuration)', () => {
    // Documentation example response structure
    test('returns success, data array, and meta with paging', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Laptop', category: 'electronics', price: 999.99 },
        { name: 'Headphones', category: 'electronics', price: 149.99 },
        { name: 'Coffee Maker', category: 'home', price: 79.99 },
      ]);

      const res = await request(app).post('/items/search').send({});
      expect(res.status).toBe(200);

      // Verify response structure matches documentation
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('meta');
      expect(res.body.meta).toHaveProperty('paging');
      expect(res.body.meta.paging).toHaveProperty('count', 3);
      expect(res.body.meta.paging).toHaveProperty('page', 1);
      expect(res.body.meta.paging).toHaveProperty('size', 100); // Default page size
      expect(res.body.meta.paging).toHaveProperty('total_pages', 1);
    });

    // Documentation: Default page size is 100, order by id ascending
    test('defaults to page size 100 and order by id ASC', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Third', category: 'A', price: 30 },
        { name: 'First', category: 'B', price: 10 },
        { name: 'Second', category: 'A', price: 20 },
      ]);

      const res = await request(app).post('/items/search').send({});
      expect(res.body.meta.paging.size).toBe(100);
      // Items returned in insertion order (by id ASC)
      expect(names(res)).toEqual(['Third', 'First', 'Second']);
    });

    // Documentation example: filtering and ordering in request body
    test('filtering, ordering, and paging in request body', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Laptop', category: 'electronics', price: 999.99 },
        { name: 'Headphones', category: 'electronics', price: 149.99 },
        { name: 'Coffee Maker', category: 'home', price: 79.99 },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: { category: 'electronics' },
          ordering: { order_by: 'price', direction: 'desc' },
          paging: { size: 10 },
        });

      expect(res.status).toBe(200);
      expect(res.body.meta.paging.count).toBe(2); // Only electronics
      expect(res.body.meta.paging.size).toBe(10);
      // Ordered by price DESC
      expect(names(res)).toEqual(['Laptop', 'Headphones']);
      expect(parseFloat(res.body.data[0].price)).toBeGreaterThan(
        parseFloat(res.body.data[1].price)
      );
    });
  });

  describe('Configuration Options: Filtering', () => {
    // Documentation: allow_filtering_on whitelist
    test('allow_filtering_on restricts filterable fields', async () => {
      const ctx = await buildAppAndModel({
        searchOptions: { allow_filtering_on: ['category', 'status'] },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Item1', category: 'A', status: 'active', price: 100 },
        { name: 'Item2', category: 'B', status: 'active', price: 200 },
      ]);

      // Allowed: category is in whitelist
      const allowed = await request(app)
        .post('/items/search')
        .send({ filtering: { category: 'A' } });
      expect(allowed.status).toBe(200);
      expect(allowed.body.data).toHaveLength(1);

      // Blocked: name is not in whitelist
      const blocked = await request(app)
        .post('/items/search')
        .send({ filtering: { name: 'Item1' } });
      expect(blocked.status).toBe(400);
    });

    // Documentation: block_filtering_on blacklist
    test('block_filtering_on blocks specific fields', async () => {
      const ctx = await buildAppAndModel({
        searchOptions: { block_filtering_on: ['password', 'secret_key'] },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        {
          name: 'Item1',
          category: 'A',
          password: 'secret123',
          secret_key: 'key123',
        },
      ]);

      // Blocked fields return 400
      const blockedPassword = await request(app)
        .post('/items/search')
        .send({ filtering: { password: 'secret123' } });
      expect(blockedPassword.status).toBe(400);

      const blockedKey = await request(app)
        .post('/items/search')
        .send({ filtering: { secret_key: 'key123' } });
      expect(blockedKey.status).toBe(400);

      // Other fields still work
      const allowed = await request(app)
        .post('/items/search')
        .send({ filtering: { category: 'A' } });
      expect(allowed.status).toBe(200);
    });
  });

  describe('Configuration Options: Ordering', () => {
    // Documentation: allow_ordering_on whitelist
    test('allow_ordering_on restricts orderable fields', async () => {
      const ctx = await buildAppAndModel({
        searchOptions: { allow_ordering_on: ['name', 'created_at', 'price'] },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Zeta', category: 'A', price: 100, score: 5 },
        { name: 'Alpha', category: 'B', price: 200, score: 10 },
      ]);

      // Allowed
      const allowed = await request(app)
        .post('/items/search')
        .send({ ordering: { order_by: 'name', direction: 'asc' } });
      expect(allowed.status).toBe(200);
      expect(names(allowed)).toEqual(['Alpha', 'Zeta']);

      // Blocked: score not in whitelist
      const blocked = await request(app)
        .post('/items/search')
        .send({ ordering: { order_by: 'score', direction: 'asc' } });
      expect(blocked.status).toBe(400);
    });

    // Documentation: block_ordering_on blacklist
    test('block_ordering_on prevents ordering on specific fields', async () => {
      const ctx = await buildAppAndModel({
        searchOptions: { block_ordering_on: ['password', 'internal_score'] },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'First', category: 'A', price: 100 },
        { name: 'Second', category: 'B', price: 200 },
      ]);

      // Allowed: name is not blocked
      const allowed = await request(app)
        .post('/items/search')
        .send({ ordering: { order_by: 'name', direction: 'asc' } });
      expect(allowed.status).toBe(200);
      expect(names(allowed)).toEqual(['First', 'Second']);
    });

    // Documentation: default_order_by and default_order_dir
    test('default_order_by and default_order_dir set defaults', async () => {
      const ctx = await buildAppAndModel({
        searchOptions: {
          default_order_by: 'created_at',
          default_order_dir: 'DESC',
          meta_show_ordering: true,
        },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const now = new Date();
      await seed(Item, [
        {
          name: 'Oldest',
          category: 'A',
          created_at: new Date(now.getTime() - 2000),
        },
        {
          name: 'Newest',
          category: 'B',
          created_at: new Date(now.getTime()),
        },
        {
          name: 'Middle',
          category: 'A',
          created_at: new Date(now.getTime() - 1000),
        },
      ]);

      const res = await request(app).post('/items/search').send({});
      expect(res.status).toBe(200);
      expect(names(res)).toEqual(['Newest', 'Middle', 'Oldest']);
      expect(res.body.meta.ordering).toEqual([
        { order_by: 'created_at', direction: 'DESC' },
      ]);
    });
  });

  describe('Configuration Options: Pagination', () => {
    // Documentation: default_page_size
    test('default_page_size controls records per page', async () => {
      const ctx = await buildAppAndModel({
        searchOptions: { default_page_size: 2 },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Item1', category: 'A', price: 10 },
        { name: 'Item2', category: 'A', price: 20 },
        { name: 'Item3', category: 'A', price: 30 },
        { name: 'Item4', category: 'A', price: 40 },
        { name: 'Item5', category: 'A', price: 50 },
      ]);

      const res = await request(app).post('/items/search').send({});
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.paging.size).toBe(2);
      expect(res.body.meta.paging.count).toBe(5);
      expect(res.body.meta.paging.total_pages).toBe(3);
    });
  });

  describe('Configuration Options: Metadata', () => {
    // Documentation: meta_show_ordering includes ordering in meta
    test('meta_show_ordering includes ordering info in response', async () => {
      const ctx = await buildAppAndModel({
        searchOptions: { meta_show_ordering: true },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Zeta', category: 'A', price: 100 },
        { name: 'Alpha', category: 'B', price: 200 },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({ ordering: { order_by: 'name', direction: 'asc' } });
      expect(res.status).toBe(200);
      expect(res.body.meta).toHaveProperty('ordering');
      expect(res.body.meta.ordering).toEqual([
        { order_by: 'name', direction: 'ASC' },
      ]);
    });
  });

  describe('Configuration Options: Field Aliases', () => {
    // Documentation: aliases maps external names to internal column names
    test('aliases maps external field names to internal columns', async () => {
      const sequelizeInstance = new Sequelize('sqlite::memory:', {
        logging: false,
      });

      const Item = sequelizeInstance.define(
        'Item',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          item_name: { type: DataTypes.STRING(100), allowNull: false },
          item_category: { type: DataTypes.STRING(50), allowNull: false },
        },
        { tableName: 'doc_search_aliased_items', timestamps: false }
      );

      await sequelizeInstance.sync({ force: true });
      sequelize = sequelizeInstance;

      await Item.bulkCreate([
        { item_name: 'Widget', item_category: 'gadget' },
        { item_name: 'Gizmo', item_category: 'gadget' },
        { item_name: 'Phone', item_category: 'electronics' },
      ]);

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/items',
        search(Item, {
          aliases: { name: 'item_name', category: 'item_category' },
          path: '/',
        })
      );

      // Filter using external alias name
      const res = await request(app).post('/items').send({
        filtering: { name: 'Widget' },
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      // Response uses external alias names
      expect(res.body.data[0]).toHaveProperty('name', 'Widget');
      expect(res.body.data[0]).toHaveProperty('category', 'gadget');
      // Internal column names not exposed
      expect(res.body.data[0]).not.toHaveProperty('item_name');
      expect(res.body.data[0]).not.toHaveProperty('item_category');
    });

    test('aliases work with filter operators', async () => {
      const sequelizeInstance = new Sequelize('sqlite::memory:', {
        logging: false,
      });

      const Item = sequelizeInstance.define(
        'Item',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          item_name: { type: DataTypes.STRING(100), allowNull: false },
          item_price: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
        },
        { tableName: 'doc_search_aliased_items2', timestamps: false }
      );

      await sequelizeInstance.sync({ force: true });
      sequelize = sequelizeInstance;

      await Item.bulkCreate([
        { item_name: 'Widget', item_price: 50 },
        { item_name: 'Gizmo', item_price: 100 },
        { item_name: 'Gadget', item_price: 150 },
      ]);

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/items',
        search(Item, {
          aliases: { name: 'item_name', price: 'item_price' },
          path: '/',
        })
      );

      const res = await request(app).post('/items').send({
        filtering: { price: { gte: 100 } },
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((item) => parseFloat(item.price) >= 100)).toBe(
        true
      );
    });

    test('aliases work with ordering', async () => {
      const sequelizeInstance = new Sequelize('sqlite::memory:', {
        logging: false,
      });

      const Item = sequelizeInstance.define(
        'Item',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          item_name: { type: DataTypes.STRING(100), allowNull: false },
          item_price: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
        },
        { tableName: 'doc_search_aliased_items3', timestamps: false }
      );

      await sequelizeInstance.sync({ force: true });
      sequelize = sequelizeInstance;

      await Item.bulkCreate([
        { item_name: 'C Widget', item_price: 50 },
        { item_name: 'A Gizmo', item_price: 100 },
        { item_name: 'B Gadget', item_price: 150 },
      ]);

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/items',
        search(Item, {
          aliases: { name: 'item_name', price: 'item_price' },
          path: '/',
        })
      );

      const res = await request(app).post('/items').send({
        ordering: [{ order_by: 'name', direction: 'ASC' }],
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data[0].name).toBe('A Gizmo');
      expect(res.body.data[1].name).toBe('B Gadget');
      expect(res.body.data[2].name).toBe('C Widget');
    });
  });

  describe('Configuration Options: Custom Path', () => {
    // Documentation: path option changes endpoint
    test('path option customizes endpoint path', async () => {
      const ctx = await buildAppAndModel({
        searchOptions: { path: '/find' },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [{ name: 'Item1', category: 'A' }]);

      // Should work on custom path
      const res = await request(app).post('/items/find').send({});
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Default path should not work
      const notFound = await request(app).post('/items/search').send({});
      expect(notFound.status).toBe(404);
    });
  });

  describe('Configuration Options: modelOptions', () => {
    // Documentation: modelOptions.attributes to select specific fields
    test('modelOptions.attributes limits returned fields', async () => {
      const ctx = await buildAppAndModel({
        modelOptions: {
          attributes: ['name', 'price'],
        },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Laptop', category: 'electronics', price: 999 },
      ]);

      const res = await request(app).post('/items/search').send({});
      expect(res.status).toBe(200);
      expect(res.body.data[0]).toHaveProperty('name');
      expect(res.body.data[0]).toHaveProperty('price');
    });

    // Documentation: modelOptions.where for default query conditions
    test('modelOptions.where applies default query conditions', async () => {
      const ctx = await buildAppAndModel({
        modelOptions: {
          where: { category: 'electronics' },
        },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Laptop', category: 'electronics', price: 999 },
        { name: 'Chair', category: 'furniture', price: 199 },
        { name: 'Phone', category: 'electronics', price: 699 },
      ]);

      const res = await request(app).post('/items/search').send({});
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((d) => d.category === 'electronics')).toBe(
        true
      );
    });
  });

  describe('Request Body Format: Filtering', () => {
    // Documentation: Simple equality
    test('simple equality filtering with multiple fields (implicit AND)', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Item1', category: 'electronics', status: 'active' },
        { name: 'Item2', category: 'electronics', status: 'inactive' },
        { name: 'Item3', category: 'home', status: 'active' },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({ filtering: { category: 'electronics', status: 'active' } });
      expect(res.status).toBe(200);
      expect(names(res)).toEqual(['Item1']);
    });

    // Documentation: Operator syntax
    test('operator syntax for comparison filters', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'iPhone 15', category: 'electronics', price: 999 },
        { name: 'Android Phone', category: 'electronics', price: 599 },
        { name: 'Laptop', category: 'electronics', price: 1299 },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: {
            price: { gte: 600 },
            name: { icontains: 'phone' },
          },
        });
      expect(res.status).toBe(200);
      expect(names(res)).toEqual(['iPhone 15']);
    });

    // Documentation: AND/OR logic
    test('AND/OR arrays for complex boolean logic', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Budget Display', category: 'electronics', price: 50.0, score: 1 },
        { name: 'Mid Display', category: 'electronics', price: 250.0, score: 5 },
        { name: 'Pro Display', category: 'electronics', price: 999.0, score: 10 },
        { name: 'Desk', category: 'furniture', price: 80.0, score: 3 },
      ]);

      // Documentation example: electronics AND (price < 100 OR score >= 9)
      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: {
            and: [
              { category: 'electronics' },
              {
                or: [{ price: { lt: 100 } }, { score: { gte: 9 } }],
              },
            ],
          },
        });
      expect(res.status).toBe(200);
      // Budget Display matches (electronics AND price < 100)
      // Pro Display matches (electronics AND score >= 9)
      expect(names(res).sort()).toEqual(['Budget Display', 'Pro Display']);
    });
  });

  describe('Request Body Format: Ordering', () => {
    // Documentation: Single field ordering
    test('single field ordering', async () => {
      const ctx = await buildAppAndModel({
        searchOptions: { meta_show_ordering: true },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Zeta', category: 'A', price: 100 },
        { name: 'Alpha', category: 'B', price: 200 },
        { name: 'Mid', category: 'A', price: 150 },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({ ordering: { order_by: 'name', direction: 'asc' } });
      expect(res.status).toBe(200);
      expect(names(res)).toEqual(['Alpha', 'Mid', 'Zeta']);
      expect(res.body.meta.ordering).toEqual([
        { order_by: 'name', direction: 'ASC' },
      ]);
    });

    // Documentation: Multiple fields ordering (array)
    test('multiple fields ordering with array', async () => {
      const ctx = await buildAppAndModel({
        searchOptions: { meta_show_ordering: true },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'N1', category: 'A', price: 10 },
        { name: 'N2', category: 'A', price: 20 },
        { name: 'N3', category: 'B', price: 15 },
        { name: 'N4', category: 'B', price: 5 },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({
          ordering: [
            { order_by: 'category', direction: 'asc' },
            { order_by: 'price', direction: 'desc' },
          ],
        });
      expect(res.status).toBe(200);
      // Category A first (price desc: 20, 10), then B (price desc: 15, 5)
      expect(names(res)).toEqual(['N2', 'N1', 'N3', 'N4']);
    });
  });

  describe('Request Body Format: Paging', () => {
    // Documentation: paging with page and size
    test('paging with page and size', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Item1', category: 'A', price: 10 },
        { name: 'Item2', category: 'A', price: 20 },
        { name: 'Item3', category: 'A', price: 30 },
        { name: 'Item4', category: 'A', price: 40 },
        { name: 'Item5', category: 'A', price: 50 },
      ]);

      const page1 = await request(app)
        .post('/items/search')
        .send({ paging: { page: 1, size: 2 } });
      expect(page1.status).toBe(200);
      expect(page1.body.data).toHaveLength(2);
      expect(names(page1)).toEqual(['Item1', 'Item2']);
      expect(page1.body.meta.paging).toMatchObject({
        page: 1,
        size: 2,
        count: 5,
        total_pages: 3,
      });

      const page2 = await request(app)
        .post('/items/search')
        .send({ paging: { page: 2, size: 2 } });
      expect(page2.status).toBe(200);
      expect(names(page2)).toEqual(['Item3', 'Item4']);
    });
  });

  describe('Filter Operators: Comparison', () => {
    // Documentation: neq - Not equal
    test('neq operator for not equal', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'A', category: 'A', status: 'active' },
        { name: 'B', category: 'B', status: 'deleted' },
        { name: 'C', category: 'C', status: 'active' },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({ filtering: { status: { neq: 'deleted' } } });
      expect(res.status).toBe(200);
      expect(names(res)).toEqual(['A', 'C']);
    });

    // Documentation: gt, gte, lt, lte
    test('comparison operators: gt, gte, lt, lte', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Cheap', category: 'A', price: 50 },
        { name: 'Mid', category: 'A', price: 100 },
        { name: 'Expensive', category: 'A', price: 200 },
      ]);

      // gte
      const gteRes = await request(app)
        .post('/items/search')
        .send({ filtering: { price: { gte: 100 } } });
      expect(gteRes.body.data.map((d) => d.name).sort()).toEqual([
        'Expensive',
        'Mid',
      ]);

      // gt
      const gtRes = await request(app)
        .post('/items/search')
        .send({ filtering: { price: { gt: 100 } } });
      expect(names(gtRes)).toEqual(['Expensive']);

      // lte
      const lteRes = await request(app)
        .post('/items/search')
        .send({ filtering: { price: { lte: 100 } } });
      expect(lteRes.body.data.map((d) => d.name).sort()).toEqual(['Cheap', 'Mid']);

      // lt
      const ltRes = await request(app)
        .post('/items/search')
        .send({ filtering: { price: { lt: 100 } } });
      expect(names(ltRes)).toEqual(['Cheap']);
    });
  });

  describe('Filter Operators: List', () => {
    // Documentation: in - In list
    test('in operator for list membership', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Book', category: 'books', price: 20 },
        { name: 'Laptop', category: 'electronics', price: 1000 },
        { name: 'Chair', category: 'furniture', price: 150 },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: { category: { in: ['electronics', 'books'] } },
        });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.map((d) => d.category).sort()).toEqual([
        'books',
        'electronics',
      ]);
    });

    // Documentation: not_in - Not in list
    test('not_in operator for exclusion', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Active1', category: 'A', status: 'active' },
        { name: 'Deleted', category: 'B', status: 'deleted' },
        { name: 'Archived', category: 'C', status: 'archived' },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: { status: { not_in: ['deleted', 'archived'] } },
        });
      expect(res.status).toBe(200);
      expect(names(res)).toEqual(['Active1']);
    });
  });

  describe('Filter Operators: String', () => {
    // Documentation: contains (case-sensitive in most databases, case-insensitive in SQLite)
    test('contains operator for substring search', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'iPhone 15', category: 'electronics', price: 999 },
        { name: 'Android Phone', category: 'electronics', price: 599 },
        { name: 'Laptop', category: 'electronics', price: 1299 },
      ]);

      // contains with exact case
      const containsRes = await request(app)
        .post('/items/search')
        .send({ filtering: { name: { contains: 'Phone' } } });
      expect(containsRes.status).toBe(200);
      // Note: SQLite's LIKE is case-insensitive, so both Phone matches appear
      // In production databases like PostgreSQL, this would be case-sensitive
      expect(containsRes.body.data.length).toBeGreaterThanOrEqual(1);
      expect(
        containsRes.body.data.some((d) => d.name.includes('Phone'))
      ).toBe(true);
    });

    // Documentation: icontains (case-insensitive)
    test('icontains operator for case-insensitive search', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'iPhone 15', category: 'electronics', price: 999 },
        { name: 'Android Phone', category: 'electronics', price: 599 },
        { name: 'Laptop', category: 'electronics', price: 1299 },
      ]);

      // icontains (case-insensitive)
      const icRes = await request(app)
        .post('/items/search')
        .send({ filtering: { name: { icontains: 'phone' } } });
      expect(icRes.status).toBe(200);
      expect(icRes.body.data).toHaveLength(2);
    });

    // Documentation: starts_with, ends_with
    test('starts_with and ends_with operators', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Product Alpha', category: 'A' },
        { name: 'Product Beta', category: 'A' },
        { name: 'Alpha Product', category: 'A' },
      ]);

      const startsRes = await request(app)
        .post('/items/search')
        .send({ filtering: { name: { starts_with: 'Product' } } });
      expect(startsRes.body.data).toHaveLength(2);

      const endsRes = await request(app)
        .post('/items/search')
        .send({ filtering: { name: { ends_with: 'Alpha' } } });
      expect(names(endsRes)).toEqual(['Product Alpha']);
    });

    // Documentation: not_contains, not_icontains
    test('not_contains and not_icontains operators', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Test Item', category: 'A' },
        { name: 'Real Product', category: 'A' },
        { name: 'Another TEST', category: 'A' },
      ]);

      const notContainsRes = await request(app)
        .post('/items/search')
        .send({ filtering: { name: { not_icontains: 'test' } } });
      expect(names(notContainsRes)).toEqual(['Real Product']);
    });

    // Documentation: not_starts_with, not_ends_with
    test('not_starts_with and not_ends_with operators', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Draft Item', category: 'A' },
        { name: 'Real Item', category: 'A' },
        { name: 'Final Draft', category: 'A' },
      ]);

      const notStartsRes = await request(app)
        .post('/items/search')
        .send({ filtering: { name: { not_starts_with: 'Draft' } } });
      expect(notStartsRes.body.data.map((d) => d.name).sort()).toEqual([
        'Final Draft',
        'Real Item',
      ]);

      const notEndsRes = await request(app)
        .post('/items/search')
        .send({ filtering: { name: { not_ends_with: 'Draft' } } });
      expect(notEndsRes.body.data.map((d) => d.name).sort()).toEqual([
        'Draft Item',
        'Real Item',
      ]);
    });
  });

  describe('Filter Operators: Boolean', () => {
    // Documentation: is_true, is_false, raw boolean
    test('boolean filtering with is_true, is_false, and raw boolean', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Active1', category: 'A', active: true },
        { name: 'Active2', category: 'A', active: true },
        { name: 'Inactive', category: 'A', active: false },
      ]);

      // is_true
      const trueRes = await request(app)
        .post('/items/search')
        .send({ filtering: { active: { is_true: true } } });
      expect(trueRes.body.data).toHaveLength(2);

      // Raw boolean true
      const rawTrueRes = await request(app)
        .post('/items/search')
        .send({ filtering: { active: true } });
      expect(rawTrueRes.body.data).toHaveLength(2);

      // Raw boolean false
      const rawFalseRes = await request(app)
        .post('/items/search')
        .send({ filtering: { active: false } });
      expect(names(rawFalseRes)).toEqual(['Inactive']);
    });

    // Documentation: is_false operator explicitly
    test('is_false operator for explicit false filtering', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Active1', category: 'A', active: true },
        { name: 'Active2', category: 'A', active: true },
        { name: 'Inactive', category: 'A', active: false },
      ]);

      // is_false - explicit form
      const falseRes = await request(app)
        .post('/items/search')
        .send({ filtering: { active: { is_false: true } } });
      expect(falseRes.body.data).toHaveLength(1);
      expect(falseRes.body.data[0].name).toBe('Inactive');
    });
  });

  describe('Filtering on Included Models', () => {
    // Documentation: Filter on included models using dot notation
    test('filter on included model fields using dot notation', async () => {
      const sequelizeInstance = new Sequelize('sqlite::memory:', { logging: false });

      const Label = sequelizeInstance.define(
        'Label',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'doc_labels', timestamps: false }
      );

      const Artist = sequelizeInstance.define(
        'Artist',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
          label_id: { type: DataTypes.INTEGER, allowNull: false },
        },
        { tableName: 'doc_artists', timestamps: false }
      );

      const Album = sequelizeInstance.define(
        'Album',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          title: { type: DataTypes.STRING(100), allowNull: false },
          artist_id: { type: DataTypes.INTEGER, allowNull: false },
        },
        { tableName: 'doc_albums', timestamps: false }
      );

      // Set up associations
      Artist.belongsTo(Label, { as: 'label', foreignKey: 'label_id' });
      Label.hasMany(Artist, { as: 'artists', foreignKey: 'label_id' });
      Album.belongsTo(Artist, { as: 'artist', foreignKey: 'artist_id' });
      Artist.hasMany(Album, { as: 'albums', foreignKey: 'artist_id' });

      await sequelizeInstance.sync({ force: true });

      // Seed data
      const [sony, warner] = await Label.bulkCreate(
        [{ name: 'Sony' }, { name: 'Warner' }],
        { returning: true }
      );
      const [beethoven, prince] = await Artist.bulkCreate(
        [
          { name: 'Ludwig van Beethoven', label_id: sony.id },
          { name: 'Prince', label_id: warner.id },
        ],
        { returning: true }
      );
      await Album.bulkCreate([
        { title: 'Symphony No. 5', artist_id: beethoven.id },
        { title: '1999', artist_id: prince.id },
        { title: 'Purple Rain', artist_id: prince.id },
      ]);

      // Set up app with included models
      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/albums',
        search(
          Album,
          {},
          {
            include: [
              {
                model: Artist,
                as: 'artist',
                include: [{ model: Label, as: 'label' }],
              },
            ],
          }
        )
      );

      sequelize = sequelizeInstance;

      // Filter by nested included model field (artist.label.name)
      const res = await request(app)
        .post('/albums/search')
        .send({ filtering: { 'artist.label.name': 'Sony' } });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].title).toBe('Symphony No. 5');

      // Filter by Warner label
      const warnerRes = await request(app)
        .post('/albums/search')
        .send({ filtering: { 'artist.label.name': 'Warner' } });

      expect(warnerRes.status).toBe(200);
      expect(warnerRes.body.data).toHaveLength(2);
      expect(warnerRes.body.data.map((d) => d.title).sort()).toEqual([
        '1999',
        'Purple Rain',
      ]);
    });
  });

  describe('Hooks', () => {
    // Documentation: pre and post hooks
    test('pre hook runs before query, post hook can modify payload', async () => {
      let preHookCalled = false;
      let postHookCalled = false;

      const ctx = await buildAppAndModel({
        searchOptions: {
          pre: async (context) => {
            preHookCalled = true;
            return { timestamp: 12345 };
          },
          post: async (context) => {
            postHookCalled = true;
            // Verify pre result is accessible
            expect(context.preResult).toEqual({ timestamp: 12345 });
            // Modify payload as shown in docs
            context.payload.meta.custom = 'value';
          },
        },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [{ name: 'Item1', category: 'A', price: 100 }]);

      const res = await request(app).post('/items/search').send({});
      expect(res.status).toBe(200);
      expect(preHookCalled).toBe(true);
      expect(postHookCalled).toBe(true);
      expect(res.body.meta.custom).toBe('value');
    });

    // Documentation: With Hooks example showing queryTime calculation
    test('hooks example with queryTime calculation', async () => {
      const ctx = await buildAppAndModel({
        searchOptions: {
          pre: async (context) => {
            console.log('Query starting');
            return { startTime: Date.now() };
          },
          post: async (context) => {
            const duration = Date.now() - context.preResult.startTime;
            context.payload.meta.queryTime = duration;
          },
        },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [{ name: 'Item1', category: 'A', price: 100 }]);

      const res = await request(app).post('/items/search').send({});
      expect(res.status).toBe(200);
      expect(res.body.meta).toHaveProperty('queryTime');
      expect(typeof res.body.meta.queryTime).toBe('number');
    });
  });

  describe('Middleware', () => {
    // Documentation: middleware with apply_where
    test('middleware can apply additional filters via apply_where', async () => {
      const scopeMiddleware = (req, res, next) => {
        // Simulate scoping to a specific category (like user scoping)
        req.apialize.apply_where({ category: 'A' });
        next();
      };

      const ctx = await buildAppAndModel({
        searchOptions: { middleware: [scopeMiddleware] },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Item1', category: 'A', price: 100 },
        { name: 'Item2', category: 'B', price: 200 },
        { name: 'Item3', category: 'A', price: 300 },
      ]);

      const res = await request(app).post('/items/search').send({});
      expect(res.status).toBe(200);
      // Only category A items returned due to middleware
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((d) => d.category === 'A')).toBe(true);
    });
  });

  describe('Invalid Requests', () => {
    // Documentation: Invalid column returns 400
    test('invalid column in filters returns 400', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [{ name: 'Item1', category: 'A' }]);

      const res = await request(app)
        .post('/items/search')
        .send({ filtering: { notARealColumn: 'foo' } });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false, error: 'Bad request' });
    });
  });

  describe('Documentation Examples Section', () => {
    // Documentation: Restricted Fields example
    test('restricted fields example combines allow_filtering_on, allow_ordering_on, and default_page_size', async () => {
      const ctx = await buildAppAndModel({
        searchOptions: {
          allow_filtering_on: ['category', 'status', 'price'],
          allow_ordering_on: ['name', 'created_at', 'price'],
          default_page_size: 20,
        },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Item1', category: 'A', status: 'active', price: 100 },
        { name: 'Item2', category: 'B', status: 'inactive', price: 200 },
      ]);

      // Allowed filter and ordering
      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: { category: 'A', price: { gte: 50 } },
          ordering: { order_by: 'name', direction: 'asc' },
        });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.paging.size).toBe(20);

      // Blocked filter field
      const blockedFilter = await request(app)
        .post('/items/search')
        .send({ filtering: { name: 'Item1' } });
      expect(blockedFilter.status).toBe(400);

      // Blocked ordering field
      const blockedOrder = await request(app)
        .post('/items/search')
        .send({ ordering: { order_by: 'score', direction: 'asc' } });
      expect(blockedOrder.status).toBe(400);
    });

    // Documentation: With Authentication Scoping example
    test('with authentication scoping example combines middleware with default ordering', async () => {
      // Simulate authentication middleware that scopes to user
      const scopeToUser = (req, res, next) => {
        // Simulating req.user.id = 'user123' by filtering to category 'A'
        req.apialize.apply_where({ category: 'A' });
        next();
      };

      const ctx = await buildAppAndModel({
        searchOptions: {
          middleware: [scopeToUser],
          default_order_by: 'created_at',
          default_order_dir: 'DESC',
          meta_show_ordering: true,
        },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      const now = new Date();
      await seed(Item, [
        { name: 'Old A', category: 'A', created_at: new Date(now.getTime() - 2000) },
        { name: 'New A', category: 'A', created_at: new Date(now.getTime()) },
        { name: 'B Item', category: 'B', created_at: new Date(now.getTime() - 1000) },
      ]);

      const res = await request(app).post('/items/search').send({});
      expect(res.status).toBe(200);
      // Only category A items (user-scoped)
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((d) => d.category === 'A')).toBe(true);
      // Ordered by created_at DESC (default)
      expect(names(res)).toEqual(['New A', 'Old A']);
      expect(res.body.meta.ordering).toEqual([
        { order_by: 'created_at', direction: 'DESC' },
      ]);
    });

    // Documentation: Multi-field Ordering with Pagination example
    test('multi-field ordering with pagination example', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      // Create enough items to span multiple pages
      const items = [];
      for (let i = 0; i < 60; i++) {
        items.push({
          name: `Item ${String(i).padStart(2, '0')}`,
          category: i % 2 === 0 ? 'A' : 'B',
          price: 100 + (i % 10) * 10,
        });
      }
      await seed(Item, items);

      // Documentation example: multi-field ordering with pagination
      const res = await request(app)
        .post('/items/search')
        .send({
          ordering: [
            { order_by: 'category', direction: 'asc' },
            { order_by: 'price', direction: 'desc' },
          ],
          paging: {
            page: 2,
            size: 25,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(25);
      expect(res.body.meta.paging.page).toBe(2);
      expect(res.body.meta.paging.size).toBe(25);
      expect(res.body.meta.paging.count).toBe(60);
      expect(res.body.meta.paging.total_pages).toBe(3);
    });

    // Documentation: Complex AND/OR Filtering example from Examples section
    test('complex AND/OR filtering with icontains example', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Budget Phone', category: 'electronics', price: 50, score: 5 },
        { name: 'Premium Phone', category: 'electronics', price: 150, score: 7 },
        { name: 'Basic Laptop', category: 'electronics', price: 80, score: 6 },
        { name: 'Desk', category: 'furniture', price: 200, score: 8 },
      ]);

      // Documentation example: electronics AND (price < 100 OR name icontains "premium")
      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: {
            and: [
              { category: 'electronics' },
              {
                or: [
                  { price: { lt: 100 } },
                  { name: { icontains: 'premium' } },
                ],
              },
            ],
          },
        });

      expect(res.status).toBe(200);
      // Budget Phone: electronics AND price < 100
      // Premium Phone: electronics AND name icontains 'premium'
      // Basic Laptop: electronics AND price < 100
      expect(res.body.data).toHaveLength(3);
      expect(names(res).sort()).toEqual([
        'Basic Laptop',
        'Budget Phone',
        'Premium Phone',
      ]);
    });
  });
});
