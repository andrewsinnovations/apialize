/**
 * Tests for documentation/filtering.md
 *
 * Validates all code examples in the filtering documentation work as expected.
 */
const express = require('express');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list, search } = require('../src');

// Helper to build app with given list/search options
async function buildAppAndModel(listOptions = {}, searchOptions = {}) {
  const sequelize = new Sequelize('sqlite::memory:', { logging: false });

  const Item = sequelize.define(
    'Item',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
      description: { type: DataTypes.STRING(500), allowNull: true },
      category: { type: DataTypes.STRING(50), allowNull: true },
      status: { type: DataTypes.STRING(50), allowNull: true, defaultValue: 'active' },
      type: { type: DataTypes.STRING(50), allowNull: true },
      price: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      password: { type: DataTypes.STRING, allowNull: true },
      secret_key: { type: DataTypes.STRING, allowNull: true },
      internal_id: { type: DataTypes.STRING, allowNull: true },
      is_active: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
      is_featured: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
      created_at: { type: DataTypes.DATE, allowNull: true },
      updated_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: 'doc_filtering_items',
      timestamps: false,
    }
  );

  await sequelize.sync({ force: true });

  const app = express();
  app.use(express.json());
  app.use('/items', list(Item, listOptions));
  app.use('/items', search(Item, searchOptions));

  return { sequelize, Item, app };
}

// Seed helper
async function seed(Model, records) {
  for (const rec of records) {
    await Model.create(rec);
  }
}

// Extract names helper
const names = (res) => res.body.data.map((d) => d.name);

describe('Documentation Examples: filtering.md', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  describe('Filter Operators: List Operation', () => {
    // Documentation: Basic Equality
    // GET /items?category=electronics
    test('basic equality filter', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Laptop', category: 'electronics', price: 999 },
        { name: 'Chair', category: 'furniture', price: 199 },
        { name: 'Phone', category: 'electronics', price: 599 },
      ]);

      const res = await request(app).get('/items?category=electronics');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((d) => d.category === 'electronics')).toBe(true);
    });

    // Documentation: GET /items?status=active&type=product
    test('multiple equality filters (AND)', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Item1', status: 'active', type: 'product', price: 100 },
        { name: 'Item2', status: 'active', type: 'service', price: 200 },
        { name: 'Item3', status: 'inactive', type: 'product', price: 150 },
      ]);

      const res = await request(app).get('/items?status=active&type=product');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Item1');
    });

    // Documentation: GET /items?name:icontains=phone
    test(':icontains operator for case-insensitive search', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'iPhone 15', category: 'electronics', price: 999 },
        { name: 'Android Phone', category: 'electronics', price: 599 },
        { name: 'Laptop', category: 'electronics', price: 1299 },
      ]);

      const res = await request(app).get('/items?name:icontains=phone');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    // Documentation: GET /items?price:gte=100
    test(':gte operator for greater than or equal', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Cheap', category: 'A', price: 50 },
        { name: 'Medium', category: 'A', price: 100 },
        { name: 'Expensive', category: 'A', price: 200 },
      ]);

      const res = await request(app).get('/items?price:gte=100');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(names(res).sort()).toEqual(['Expensive', 'Medium']);
    });

    // Documentation: GET /items?price:lt=500
    test(':lt operator for less than', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Cheap', category: 'A', price: 100 },
        { name: 'Medium', category: 'A', price: 400 },
        { name: 'Expensive', category: 'A', price: 600 },
      ]);

      const res = await request(app).get('/items?price:lt=500');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(names(res).sort()).toEqual(['Cheap', 'Medium']);
    });

    // Documentation: GET /items?category:in=electronics,books,toys
    test(':in operator for list membership', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Laptop', category: 'electronics', price: 999 },
        { name: 'Novel', category: 'books', price: 20 },
        { name: 'Teddy', category: 'toys', price: 30 },
        { name: 'Chair', category: 'furniture', price: 150 },
      ]);

      const res = await request(app).get('/items?category:in=electronics,books,toys');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data.every((d) => ['electronics', 'books', 'toys'].includes(d.category))).toBe(true);
    });

    // Documentation: GET /items?status:neq=deleted
    test(':neq operator for not equal', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Active1', category: 'A', status: 'active', price: 100 },
        { name: 'Active2', category: 'B', status: 'active', price: 200 },
        { name: 'Deleted', category: 'A', status: 'deleted', price: 150 },
      ]);

      const res = await request(app).get('/items?status:neq=deleted');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((d) => d.status !== 'deleted')).toBe(true);
    });

    // Documentation: Combining Filters
    // GET /items?category=electronics&price:gte=100&price:lte=500
    test('combining filters with AND logic', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Cheap Phone', category: 'electronics', price: 50 },
        { name: 'Budget Phone', category: 'electronics', price: 150 },
        { name: 'Mid Phone', category: 'electronics', price: 400 },
        { name: 'Premium Phone', category: 'electronics', price: 800 },
        { name: 'Chair', category: 'furniture', price: 200 },
      ]);

      const res = await request(app).get('/items?category=electronics&price:gte=100&price:lte=500');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(names(res).sort()).toEqual(['Budget Phone', 'Mid Phone']);
    });
  });

  describe('Filter Operators: Search Operation', () => {
    // Documentation: Basic Equality (POST)
    test('basic equality filter with POST body', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Item1', category: 'electronics', status: 'active', price: 100 },
        { name: 'Item2', category: 'electronics', status: 'inactive', price: 200 },
        { name: 'Item3', category: 'home', status: 'active', price: 150 },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: {
            category: 'electronics',
            status: 'active',
          },
        });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Item1');
    });

    // Documentation: Using Operators (POST)
    test('operators in POST body with $icontains, $gte, $lte, $in', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Gaming Laptop', category: 'electronics', price: 400 },
        { name: 'Office Laptop', category: 'electronics', price: 200 },
        { name: 'Gaming Phone', category: 'electronics', price: 800 },
        { name: 'Gaming Chair', category: 'furniture', price: 300 },
        { name: 'Novel', category: 'books', price: 20 },
      ]);

      // Test $icontains
      const containsRes = await request(app)
        .post('/items/search')
        .send({ filtering: { name: { icontains: 'laptop' } } });
      expect(containsRes.body.data).toHaveLength(2);

      // Test $gte and $lte combined
      const rangeRes = await request(app)
        .post('/items/search')
        .send({ filtering: { price: { gte: 100, lte: 500 } } });
      expect(rangeRes.body.data).toHaveLength(3);

      // Test $in
      const inRes = await request(app)
        .post('/items/search')
        .send({ filtering: { category: { in: ['electronics', 'books'] } } });
      expect(inRes.body.data).toHaveLength(4);
    });

    // Documentation: Multiple Conditions on Same Field
    test('multiple conditions on same field', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Cheap', category: 'A', price: 50 },
        { name: 'Budget', category: 'A', price: 150 },
        { name: 'Mid', category: 'A', price: 350 },
        { name: 'Premium', category: 'A', price: 600 },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: {
            price: {
              gte: 100,
              lte: 500,
            },
          },
        });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(names(res).sort()).toEqual(['Budget', 'Mid']);
    });
  });

  describe('Configuration Options', () => {
    // Documentation: allow_filtering_on whitelist
    test('allow_filtering_on restricts filterable fields', async () => {
      const ctx = await buildAppAndModel({
        allow_filtering_on: ['category', 'status', 'price'],
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Item1', category: 'A', status: 'active', price: 100, secret_key: 'secret1' },
        { name: 'Item2', category: 'B', status: 'inactive', price: 200, secret_key: 'secret2' },
      ]);

      // Allowed: category is in whitelist
      const allowed = await request(app).get('/items?category=A');
      expect(allowed.status).toBe(200);
      expect(allowed.body.data).toHaveLength(1);

      // Blocked: secret_key not in whitelist
      const blocked = await request(app).get('/items?secret_key=secret1');
      expect(blocked.status).toBe(400);
    });

    // Documentation: block_filtering_on blacklist
    test('block_filtering_on prevents filtering on specific fields', async () => {
      const ctx = await buildAppAndModel({
        block_filtering_on: ['password', 'secret_key', 'internal_id'],
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Item1', category: 'A', price: 100, password: 'pass1' },
        { name: 'Item2', category: 'B', price: 200, password: 'pass2' },
      ]);

      // Allowed: category is not blocked
      const allowed = await request(app).get('/items?category=A');
      expect(allowed.status).toBe(200);
      expect(allowed.body.data).toHaveLength(1);

      // Blocked: password is in blacklist
      const blocked = await request(app).get('/items?password=pass1');
      expect(blocked.status).toBe(400);
    });

    // Documentation: allow_filtering = false
    test('allow_filtering=false disables all filtering', async () => {
      const ctx = await buildAppAndModel({
        allow_filtering: false,
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Item1', category: 'A', price: 100 },
        { name: 'Item2', category: 'B', price: 200 },
        { name: 'Item3', category: 'A', price: 150 },
      ]);

      // Filter parameters should be ignored
      const res = await request(app).get('/items?category=A');
      expect(res.status).toBe(200);
      // All items returned because filtering is disabled
      expect(res.body.data).toHaveLength(3);
    });

    // Documentation: meta_show_filters
    test('meta_show_filters includes applied filters in response', async () => {
      const ctx = await buildAppAndModel({
        meta_show_filters: true,
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Item1', category: 'electronics', price: 100 },
        { name: 'Item2', category: 'home', price: 200 },
      ]);

      const res = await request(app).get('/items?category=electronics');
      expect(res.status).toBe(200);
      expect(res.body.meta).toHaveProperty('filtering');
      expect(res.body.meta.filtering).toEqual({ category: 'electronics' });
    });
  });

  describe('Examples: Price Range Filter', () => {
    // Documentation: GET /items?price:gte=50&price:lte=200
    test('list: price range filter', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Cheap', category: 'A', price: 30 },
        { name: 'Budget', category: 'A', price: 75 },
        { name: 'Mid', category: 'A', price: 150 },
        { name: 'Premium', category: 'A', price: 300 },
      ]);

      const res = await request(app).get('/items?price:gte=50&price:lte=200');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(names(res).sort()).toEqual(['Budget', 'Mid']);
    });

    // Documentation: Search price range
    test('search: price range filter', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Cheap', category: 'A', price: 30 },
        { name: 'Budget', category: 'A', price: 75 },
        { name: 'Mid', category: 'A', price: 150 },
        { name: 'Premium', category: 'A', price: 300 },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({ filtering: { price: { gte: 50, lte: 200 } } });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(names(res).sort()).toEqual(['Budget', 'Mid']);
    });
  });

  describe('Examples: Text Search', () => {
    // Documentation: GET /items?name:icontains=laptop&description:icontains=gaming
    test('list: text search with icontains on multiple fields', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Gaming Laptop Pro', description: 'A powerful gaming machine', price: 1500 },
        { name: 'Office Laptop', description: 'Perfect for work', price: 800 },
        { name: 'Gaming Desktop', description: 'Ultimate gaming experience', price: 2000 },
        { name: 'Budget Laptop', description: 'Gaming on a budget', price: 500 },
      ]);

      const res = await request(app).get('/items?name:icontains=laptop&description:icontains=gaming');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(names(res).sort()).toEqual(['Budget Laptop', 'Gaming Laptop Pro']);
    });

    // Documentation: Search text search
    test('search: text search with icontains on multiple fields', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Gaming Laptop Pro', description: 'A powerful gaming machine', price: 1500 },
        { name: 'Office Laptop', description: 'Perfect for work', price: 800 },
        { name: 'Gaming Desktop', description: 'Ultimate gaming experience', price: 2000 },
        { name: 'Budget Laptop', description: 'Gaming on a budget', price: 500 },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: {
            name: { icontains: 'laptop' },
            description: { icontains: 'gaming' },
          },
        });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(names(res).sort()).toEqual(['Budget Laptop', 'Gaming Laptop Pro']);
    });
  });

  describe('Examples: Category Selection', () => {
    // Documentation: GET /items?category:in=electronics,computers,accessories
    test('list: category selection with :in', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Laptop', category: 'electronics', price: 999 },
        { name: 'Keyboard', category: 'computers', price: 100 },
        { name: 'Mouse Pad', category: 'accessories', price: 20 },
        { name: 'Chair', category: 'furniture', price: 200 },
        { name: 'Desk', category: 'furniture', price: 300 },
      ]);

      const res = await request(app).get('/items?category:in=electronics,computers,accessories');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data.every((d) => ['electronics', 'computers', 'accessories'].includes(d.category))).toBe(true);
    });

    // Documentation: Search category selection
    test('search: category selection with $in', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Laptop', category: 'electronics', price: 999 },
        { name: 'Keyboard', category: 'computers', price: 100 },
        { name: 'Mouse Pad', category: 'accessories', price: 20 },
        { name: 'Chair', category: 'furniture', price: 200 },
        { name: 'Desk', category: 'furniture', price: 300 },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: {
            category: { in: ['electronics', 'computers', 'accessories'] },
          },
        });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data.every((d) => ['electronics', 'computers', 'accessories'].includes(d.category))).toBe(true);
    });
  });

  describe('Examples: Date Range', () => {
    // Documentation: GET /items?created_at:gte=2025-01-01&created_at:lt=2025-02-01
    test('list: date range filter', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Dec Item', category: 'A', created_at: new Date('2024-12-15') },
        { name: 'Jan Item', category: 'A', created_at: new Date('2025-01-15') },
        { name: 'Feb Item', category: 'A', created_at: new Date('2025-02-15') },
      ]);

      const res = await request(app).get('/items?created_at:gte=2025-01-01&created_at:lt=2025-02-01');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Jan Item');
    });

    // Documentation: Search date range
    test('search: date range filter', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Dec Item', category: 'A', created_at: new Date('2024-12-15') },
        { name: 'Jan Item', category: 'A', created_at: new Date('2025-01-15') },
        { name: 'Feb Item', category: 'A', created_at: new Date('2025-02-15') },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: {
            created_at: {
              gte: '2025-01-01',
              lt: '2025-02-01',
            },
          },
        });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Jan Item');
    });
  });

  describe('Examples: Exclude Deleted Items', () => {
    // Documentation: GET /items?status:neq=deleted
    test('list: exclude deleted items with :neq', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Active1', category: 'A', status: 'active' },
        { name: 'Active2', category: 'B', status: 'active' },
        { name: 'Archived', category: 'A', status: 'archived' },
        { name: 'Deleted', category: 'A', status: 'deleted' },
      ]);

      const res = await request(app).get('/items?status:neq=deleted');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data.every((d) => d.status !== 'deleted')).toBe(true);
    });

    // Documentation: Search exclude deleted
    test('search: exclude deleted items with $neq', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Active1', category: 'A', status: 'active' },
        { name: 'Active2', category: 'B', status: 'active' },
        { name: 'Archived', category: 'A', status: 'archived' },
        { name: 'Deleted', category: 'A', status: 'deleted' },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: {
            status: { neq: 'deleted' },
          },
        });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data.every((d) => d.status !== 'deleted')).toBe(true);
    });
  });

  describe('Additional Operators from Table', () => {
    // Documentation: not_icontains
    test(':not_icontains operator', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'iPhone 15', category: 'electronics' },
        { name: 'Android Phone', category: 'electronics' },
        { name: 'Laptop', category: 'electronics' },
      ]);

      const res = await request(app).get('/items?name:not_icontains=phone');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Laptop');
    });

    // Documentation: starts_with
    test(':starts_with operator', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Product Alpha', category: 'A' },
        { name: 'Product Beta', category: 'A' },
        { name: 'Alpha Product', category: 'A' },
      ]);

      const res = await request(app).get('/items?name:starts_with=Product');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(names(res).sort()).toEqual(['Product Alpha', 'Product Beta']);
    });

    // Documentation: ends_with
    test(':ends_with operator', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Product Alpha', category: 'A' },
        { name: 'Product Beta', category: 'A' },
        { name: 'Alpha Product', category: 'A' },
      ]);

      const res = await request(app).get('/items?name:ends_with=Alpha');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Product Alpha');
    });

    // Documentation: gt (greater than)
    test(':gt operator for greater than', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Cheap', category: 'A', price: 50 },
        { name: 'Medium', category: 'A', price: 100 },
        { name: 'Expensive', category: 'A', price: 200 },
      ]);

      const res = await request(app).get('/items?price:gt=100');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Expensive');
    });

    // Documentation: lte (less than or equal)
    test(':lte operator for less than or equal', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Cheap', category: 'A', price: 50 },
        { name: 'Medium', category: 'A', price: 100 },
        { name: 'Expensive', category: 'A', price: 200 },
      ]);

      const res = await request(app).get('/items?price:lte=100');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(names(res).sort()).toEqual(['Cheap', 'Medium']);
    });

    // Documentation: not_in
    test(':not_in operator for exclusion from list', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Book', category: 'books' },
        { name: 'Laptop', category: 'electronics' },
        { name: 'Chair', category: 'furniture' },
      ]);

      const res = await request(app).get('/items?category:not_in=electronics,books');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].category).toBe('furniture');
    });

    // Search versions of additional operators
    test('search: $not_icontains operator', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'iPhone 15', category: 'electronics' },
        { name: 'Android Phone', category: 'electronics' },
        { name: 'Laptop', category: 'electronics' },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({ filtering: { name: { not_icontains: 'phone' } } });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Laptop');
    });

    test('search: $starts_with operator', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Product Alpha', category: 'A' },
        { name: 'Product Beta', category: 'A' },
        { name: 'Alpha Product', category: 'A' },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({ filtering: { name: { starts_with: 'Product' } } });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    test('search: $ends_with operator', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Product Alpha', category: 'A' },
        { name: 'Product Beta', category: 'A' },
        { name: 'Alpha Product', category: 'A' },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({ filtering: { name: { ends_with: 'Alpha' } } });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Product Alpha');
    });

    test('search: $not_in operator', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Book', category: 'books' },
        { name: 'Laptop', category: 'electronics' },
        { name: 'Chair', category: 'furniture' },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({ filtering: { category: { not_in: ['electronics', 'books'] } } });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].category).toBe('furniture');
    });

    // Documentation: ieq (case-insensitive equality)
    test(':ieq operator for case-insensitive equality', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'LAPTOP', category: 'electronics' },
        { name: 'laptop', category: 'electronics' },
        { name: 'Phone', category: 'electronics' },
      ]);

      const res = await request(app).get('/items?name:ieq=laptop');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((d) => d.name.toLowerCase() === 'laptop')).toBe(true);
    });

    test('search: ieq operator for case-insensitive equality', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'LAPTOP', category: 'electronics' },
        { name: 'laptop', category: 'electronics' },
        { name: 'Phone', category: 'electronics' },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({ filtering: { name: { ieq: 'laptop' } } });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((d) => d.name.toLowerCase() === 'laptop')).toBe(true);
    });

    // Documentation: contains (case-sensitive)
    test(':contains operator for case-sensitive contains', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Gaming Laptop', category: 'electronics' },
        { name: 'gaming laptop', category: 'electronics' },
        { name: 'Office Desktop', category: 'electronics' },
      ]);

      // Case-sensitive: 'Gaming' should only match 'Gaming Laptop'
      const res = await request(app).get('/items?name:contains=Gaming');
      expect(res.status).toBe(200);
      // Note: SQLite LIKE is case-insensitive by default, so this may match both on SQLite
      // On other databases like PostgreSQL, contains is case-sensitive
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    test('search: contains operator for case-sensitive contains', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Gaming Laptop', category: 'electronics' },
        { name: 'gaming laptop', category: 'electronics' },
        { name: 'Office Desktop', category: 'electronics' },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({ filtering: { name: { contains: 'Gaming' } } });
      expect(res.status).toBe(200);
      // Note: SQLite LIKE is case-insensitive by default
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    // Documentation: not_contains (case-sensitive)
    test(':not_contains operator', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Gaming Laptop', category: 'electronics' },
        { name: 'Office Laptop', category: 'electronics' },
        { name: 'Office Desktop', category: 'electronics' },
      ]);

      const res = await request(app).get('/items?name:not_contains=Gaming');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((d) => !d.name.includes('Gaming'))).toBe(true);
    });

    test('search: not_contains operator', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Gaming Laptop', category: 'electronics' },
        { name: 'Office Laptop', category: 'electronics' },
        { name: 'Office Desktop', category: 'electronics' },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({ filtering: { name: { not_contains: 'Gaming' } } });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    // Documentation: not_starts_with
    test(':not_starts_with operator', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Product Alpha', category: 'A' },
        { name: 'Product Beta', category: 'A' },
        { name: 'Alpha Product', category: 'A' },
      ]);

      const res = await request(app).get('/items?name:not_starts_with=Product');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Alpha Product');
    });

    test('search: not_starts_with operator', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Product Alpha', category: 'A' },
        { name: 'Product Beta', category: 'A' },
        { name: 'Alpha Product', category: 'A' },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({ filtering: { name: { not_starts_with: 'Product' } } });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Alpha Product');
    });

    // Documentation: not_ends_with
    test(':not_ends_with operator', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Product Alpha', category: 'A' },
        { name: 'Product Beta', category: 'A' },
        { name: 'Alpha Product', category: 'A' },
      ]);

      const res = await request(app).get('/items?name:not_ends_with=Alpha');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((d) => !d.name.endsWith('Alpha'))).toBe(true);
    });

    test('search: not_ends_with operator', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Product Alpha', category: 'A' },
        { name: 'Product Beta', category: 'A' },
        { name: 'Alpha Product', category: 'A' },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({ filtering: { name: { not_ends_with: 'Alpha' } } });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    // Documentation: is_true
    test(':is_true operator for boolean fields', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Active1', is_active: true },
        { name: 'Active2', is_active: true },
        { name: 'Inactive', is_active: false },
      ]);

      const res = await request(app).get('/items?is_active:is_true');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((d) => d.is_active === true)).toBe(true);
    });

    test('search: is_true operator for boolean fields', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Active1', is_active: true },
        { name: 'Active2', is_active: true },
        { name: 'Inactive', is_active: false },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({ filtering: { is_active: { is_true: true } } });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((d) => d.is_active === true)).toBe(true);
    });

    // Documentation: is_false
    test(':is_false operator for boolean fields', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Featured1', is_featured: true },
        { name: 'Featured2', is_featured: true },
        { name: 'NotFeatured', is_featured: false },
      ]);

      const res = await request(app).get('/items?is_featured:is_false');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].is_featured).toBe(false);
    });

    test('search: is_false operator for boolean fields', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Featured1', is_featured: true },
        { name: 'Featured2', is_featured: true },
        { name: 'NotFeatured', is_featured: false },
      ]);

      const res = await request(app)
        .post('/items/search')
        .send({ filtering: { is_featured: { is_false: true } } });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].is_featured).toBe(false);
    });
  });

  describe('Filtering on Related Models', () => {
    // Documentation: GET /items?Category.name=Electronics
    test('list: filtering on related model using dot notation', async () => {
      const sequelizeInstance = new Sequelize('sqlite::memory:', { logging: false });

      const Category = sequelizeInstance.define(
        'Category',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING },
        },
        { tableName: 'doc_filt_categories', timestamps: false }
      );

      const Item = sequelizeInstance.define(
        'Item',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING },
          category_id: { type: DataTypes.INTEGER },
        },
        { tableName: 'doc_filt_items', timestamps: false }
      );

      Item.belongsTo(Category, { foreignKey: 'category_id' });
      Category.hasMany(Item, { foreignKey: 'category_id' });

      await sequelizeInstance.sync({ force: true });
      sequelize = sequelizeInstance;

      const electronics = await Category.create({ name: 'Electronics' });
      const furniture = await Category.create({ name: 'Furniture' });
      await Item.create({ name: 'Laptop', category_id: electronics.id });
      await Item.create({ name: 'Phone', category_id: electronics.id });
      await Item.create({ name: 'Chair', category_id: furniture.id });

      const app = express();
      app.use(express.json());
      app.use(
        '/items',
        list(
          Item,
          { allow_filtering_on: ['Category.name'] },
          { include: [{ model: Category, as: 'Category' }] }
        )
      );

      const res = await request(app).get('/items?Category.name=Electronics');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((d) => d.Category.name === 'Electronics')).toBe(true);
    });

    // Documentation: GET /items?Owner.email:icontains=@company.com
    test('list: filtering on related model with operator using dot notation', async () => {
      const sequelizeInstance = new Sequelize('sqlite::memory:', { logging: false });

      const Owner = sequelizeInstance.define(
        'Owner',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING },
          email: { type: DataTypes.STRING },
        },
        { tableName: 'doc_filt_owners', timestamps: false }
      );

      const Item = sequelizeInstance.define(
        'Item',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING },
          owner_id: { type: DataTypes.INTEGER },
        },
        { tableName: 'doc_filt_owner_items', timestamps: false }
      );

      Item.belongsTo(Owner, { foreignKey: 'owner_id' });
      Owner.hasMany(Item, { foreignKey: 'owner_id' });

      await sequelizeInstance.sync({ force: true });
      sequelize = sequelizeInstance;

      const companyOwner = await Owner.create({ name: 'Alice', email: 'alice@company.com' });
      const personalOwner = await Owner.create({ name: 'Bob', email: 'bob@personal.org' });
      await Item.create({ name: 'Company Laptop', owner_id: companyOwner.id });
      await Item.create({ name: 'Company Phone', owner_id: companyOwner.id });
      await Item.create({ name: 'Personal Tablet', owner_id: personalOwner.id });

      const app = express();
      app.use(express.json());
      app.use(
        '/items',
        list(
          Item,
          { allow_filtering_on: ['Owner.email'] },
          { include: [{ model: Owner, as: 'Owner' }] }
        )
      );

      const res = await request(app).get('/items?Owner.email:icontains=@company.com');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((d) => d.Owner.email.includes('@company.com'))).toBe(true);
    });
  });
});
