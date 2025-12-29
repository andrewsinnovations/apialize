/**
 * Documentation Examples Test
 *
 * This test file validates that the code examples in documentation/list.md
 * work as expected and produce the documented outputs.
 */

const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list } = require('../src');

// Helper to build app with given list options and modelOptions
async function buildAppAndModel({
  listOptions = {},
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
      { tableName: 'doc_items', timestamps: false }
    );

  Item.apialize = { ...(modelApialize || {}) };

  await sequelize.sync({ force: true });

  const app = express();
  app.use(bodyParser.json());
  app.use('/items', list(Item, listOptions, modelOptions));

  return { sequelize, Item, app };
}

async function seed(Item, rows) {
  await Item.bulkCreate(rows);
}

describe('Documentation Examples: list.md', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  describe('Basic Usage', () => {
    // Documentation: "This creates a GET /items endpoint"
    test('list(Item) creates a GET /items endpoint', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Test Item', category: 'test', price: 10.0 },
      ]);

      const res = await request(app).get('/items');
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

      const res = await request(app).get('/items');
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

      const res = await request(app).get('/items');
      expect(res.body.meta.paging.size).toBe(100);
      // Items returned in insertion order (by id ASC)
      expect(res.body.data.map((d) => d.name)).toEqual([
        'Third',
        'First',
        'Second',
      ]);
    });

    // Documentation example: GET /items?category=electronics&api:order_by=-price&api:page_size=10
    test('query params: filter, order descending, custom page size', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Laptop', category: 'electronics', price: 999.99 },
        { name: 'Headphones', category: 'electronics', price: 149.99 },
        { name: 'Coffee Maker', category: 'home', price: 79.99 },
      ]);

      const res = await request(app).get(
        '/items?category=electronics&api:order_by=-price&api:page_size=10'
      );

      expect(res.status).toBe(200);
      expect(res.body.meta.paging.count).toBe(2); // Only electronics
      expect(res.body.meta.paging.size).toBe(10);
      // Ordered by price DESC
      expect(res.body.data.map((d) => d.name)).toEqual(['Laptop', 'Headphones']);
      expect(parseFloat(res.body.data[0].price)).toBeGreaterThan(
        parseFloat(res.body.data[1].price)
      );
    });
  });

  describe('Configuration Options: Filtering', () => {
    // Documentation: allow_filtering_on whitelist
    test('allow_filtering_on restricts filterable fields', async () => {
      const ctx = await buildAppAndModel({
        listOptions: { allow_filtering_on: ['category', 'status'] },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Item1', category: 'A', status: 'active', price: 100 },
        { name: 'Item2', category: 'B', status: 'active', price: 200 },
      ]);

      // Allowed: category is in whitelist
      const allowed = await request(app).get('/items?category=A');
      expect(allowed.status).toBe(200);
      expect(allowed.body.data).toHaveLength(1);

      // Blocked: name is not in whitelist
      const blocked = await request(app).get('/items?name=Item1');
      expect(blocked.status).toBe(400);
    });

    // Documentation: block_filtering_on blacklist
    test('block_filtering_on blocks specific fields', async () => {
      const ctx = await buildAppAndModel({
        listOptions: { block_filtering_on: ['password', 'secret_key'] },
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
      const blockedPassword = await request(app).get('/items?password=secret123');
      expect(blockedPassword.status).toBe(400);

      const blockedKey = await request(app).get('/items?secret_key=key123');
      expect(blockedKey.status).toBe(400);

      // Other fields still work
      const allowed = await request(app).get('/items?category=A');
      expect(allowed.status).toBe(200);
    });

    // Documentation: allow_filtering: false disables all filtering
    test('allow_filtering: false disables query string filtering', async () => {
      const ctx = await buildAppAndModel({
        listOptions: { allow_filtering: false },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Item1', category: 'A', price: 100 },
        { name: 'Item2', category: 'B', price: 200 },
      ]);

      // Filter params are ignored, returns all records
      const res = await request(app).get('/items?category=A');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });
  });

  describe('Configuration Options: Ordering', () => {
    // Documentation: allow_ordering_on whitelist
    test('allow_ordering_on restricts orderable fields', async () => {
      const ctx = await buildAppAndModel({
        listOptions: { allow_ordering_on: ['name', 'created_at'] },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Zeta', category: 'A', price: 100 },
        { name: 'Alpha', category: 'B', price: 200 },
      ]);

      // Allowed
      const allowed = await request(app).get('/items?api:order_by=name');
      expect(allowed.status).toBe(200);
      expect(allowed.body.data.map((d) => d.name)).toEqual(['Alpha', 'Zeta']);

      // Blocked: price not in whitelist
      const blocked = await request(app).get('/items?api:order_by=price');
      expect(blocked.status).toBe(400);
    });

    // Documentation: block_ordering_on blacklist
    test('block_ordering_on blocks specific ordering fields', async () => {
      const ctx = await buildAppAndModel({
        listOptions: { block_ordering_on: ['password', 'secret_key'] },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Item1', category: 'A', password: 'secret', secret_key: 'key' },
        { name: 'Item2', category: 'B', password: 'pass', secret_key: 'key2' },
      ]);

      // Blocked fields return 400
      const blockedPassword = await request(app).get('/items?api:order_by=password');
      expect(blockedPassword.status).toBe(400);

      const blockedKey = await request(app).get('/items?api:order_by=secret_key');
      expect(blockedKey.status).toBe(400);

      // Other fields still work
      const allowed = await request(app).get('/items?api:order_by=name');
      expect(allowed.status).toBe(200);
    });

    // Documentation: allow_ordering: false disables ordering
    test('allow_ordering: false uses default order only', async () => {
      const ctx = await buildAppAndModel({
        listOptions: { allow_ordering: false },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Zeta', category: 'A', price: 100 },
        { name: 'Alpha', category: 'B', price: 200 },
      ]);

      // Order param is ignored
      const res = await request(app).get('/items?api:order_by=name');
      expect(res.status).toBe(200);
      // Returns in default order (id ASC = insertion order)
      expect(res.body.data.map((d) => d.name)).toEqual(['Zeta', 'Alpha']);
    });

    // Documentation: default_order_by and default_order_dir
    test('default_order_by and default_order_dir set defaults', async () => {
      const ctx = await buildAppAndModel({
        listOptions: {
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

      const res = await request(app).get('/items');
      expect(res.status).toBe(200);
      expect(res.body.data.map((d) => d.name)).toEqual([
        'Newest',
        'Middle',
        'Oldest',
      ]);
      expect(res.body.meta.ordering).toEqual([
        { order_by: 'created_at', direction: 'DESC' },
      ]);
    });
  });

  describe('Configuration Options: Pagination', () => {
    // Documentation: default_page_size
    test('default_page_size controls records per page', async () => {
      const ctx = await buildAppAndModel({
        listOptions: { default_page_size: 2 },
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

      const res = await request(app).get('/items');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.paging.size).toBe(2);
      expect(res.body.meta.paging.count).toBe(5);
      expect(res.body.meta.paging.total_pages).toBe(3);
    });
  });

  describe('Configuration Options: Metadata', () => {
    // Documentation: meta_show_filters includes filtering in meta
    test('meta_show_filters includes applied filters in response', async () => {
      const ctx = await buildAppAndModel({
        listOptions: { meta_show_filters: true },
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

    // Documentation: meta_show_ordering includes ordering in meta
    test('meta_show_ordering includes ordering info in response', async () => {
      const ctx = await buildAppAndModel({
        listOptions: { meta_show_ordering: true },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Zeta', category: 'A', price: 100 },
        { name: 'Alpha', category: 'B', price: 200 },
      ]);

      const res = await request(app).get('/items?api:order_by=name');
      expect(res.status).toBe(200);
      expect(res.body.meta).toHaveProperty('ordering');
      expect(res.body.meta.ordering).toEqual([
        { order_by: 'name', direction: 'ASC' },
      ]);
    });
  });

  describe('Query String Parameters: Filter Operators', () => {
    // Documentation: :icontains - Case-insensitive contains
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
      expect(res.body.data.map((d) => d.name).sort()).toEqual([
        'Android Phone',
        'iPhone 15',
      ]);
    });

    // Documentation: :not_icontains - Case-insensitive does not contain
    test(':not_icontains operator for case-insensitive exclusion', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'iPhone 15', category: 'electronics', price: 999 },
        { name: 'Android Phone', category: 'electronics', price: 599 },
        { name: 'Laptop', category: 'electronics', price: 1299 },
      ]);

      const res = await request(app).get('/items?name:not_icontains=phone');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Laptop');
    });

    // Documentation: :starts_with - Starts with
    test(':starts_with operator', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Product Alpha', category: 'A', price: 100 },
        { name: 'Product Beta', category: 'A', price: 200 },
        { name: 'Alpha Product', category: 'A', price: 300 },
      ]);

      const res = await request(app).get('/items?name:starts_with=Product');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.map((d) => d.name).sort()).toEqual([
        'Product Alpha',
        'Product Beta',
      ]);
    });

    // Documentation: :ends_with - Ends with
    test(':ends_with operator', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Product Alpha', category: 'A', price: 100 },
        { name: 'Product Beta', category: 'A', price: 200 },
        { name: 'Alpha Product', category: 'A', price: 300 },
      ]);

      const res = await request(app).get('/items?name:ends_with=Alpha');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Product Alpha');
    });

    // Documentation: :gte - Greater than or equal
    test(':gte operator for greater than or equal', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Cheap', category: 'A', price: 50 },
        { name: 'Mid', category: 'A', price: 100 },
        { name: 'Expensive', category: 'A', price: 200 },
      ]);

      const res = await request(app).get('/items?price:gte=100');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.map((d) => d.name).sort()).toEqual([
        'Expensive',
        'Mid',
      ]);
    });

    // Documentation: :in - In list (comma-separated)
    test(':in operator for list membership', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Book', category: 'books', price: 20 },
        { name: 'Laptop', category: 'electronics', price: 1000 },
        { name: 'Chair', category: 'furniture', price: 150 },
      ]);

      const res = await request(app).get(
        '/items?category:in=electronics,books'
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.map((d) => d.category).sort()).toEqual([
        'books',
        'electronics',
      ]);
    });

    // Documentation: :neq - Not equal
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

    // Documentation: :gt - Greater than
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

    // Documentation: :lt - Less than
    test(':lt operator for less than', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Cheap', category: 'A', price: 50 },
        { name: 'Medium', category: 'A', price: 100 },
        { name: 'Expensive', category: 'A', price: 200 },
      ]);

      const res = await request(app).get('/items?price:lt=100');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Cheap');
    });

    // Documentation: :lte - Less than or equal
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
      expect(res.body.data.map((d) => d.name).sort()).toEqual([
        'Cheap',
        'Medium',
      ]);
    });

    // Documentation: :not_in - Not in list
    test(':not_in operator for exclusion from list', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Book', category: 'books', price: 20 },
        { name: 'Laptop', category: 'electronics', price: 1000 },
        { name: 'Chair', category: 'furniture', price: 150 },
      ]);

      const res = await request(app).get(
        '/items?category:not_in=electronics,books'
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].category).toBe('furniture');
    });
  });

  describe('Query String Parameters: Ordering', () => {
    // Documentation: Single field with minus prefix for DESC
    test('ordering with minus prefix for DESC', async () => {
      const ctx = await buildAppAndModel({
        listOptions: { meta_show_ordering: true },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Alpha', category: 'A', price: 100 },
        { name: 'Zeta', category: 'B', price: 200 },
        { name: 'Mid', category: 'A', price: 150 },
      ]);

      const res = await request(app).get('/items?api:order_by=-name');
      expect(res.status).toBe(200);
      expect(res.body.data.map((d) => d.name)).toEqual(['Zeta', 'Mid', 'Alpha']);
      expect(res.body.meta.ordering).toEqual([
        { order_by: 'name', direction: 'DESC' },
      ]);
    });

    // Documentation: Multiple fields with global direction
    test('multiple fields with global direction', async () => {
      const ctx = await buildAppAndModel({
        listOptions: { meta_show_ordering: true },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Zeta', category: 'A', price: 100 },
        { name: 'Alpha', category: 'B', price: 200 },
        { name: 'Beta', category: 'A', price: 150 },
      ]);

      const res = await request(app).get(
        '/items?api:order_by=category,name&api:order_dir=ASC'
      );
      expect(res.status).toBe(200);
      // Category A first (Alpha order: Beta, Zeta), then B (Alpha)
      expect(res.body.data.map((d) => d.name)).toEqual([
        'Beta',
        'Zeta',
        'Alpha',
      ]);
      expect(res.body.meta.ordering).toEqual([
        { order_by: 'category', direction: 'ASC' },
        { order_by: 'name', direction: 'ASC' },
      ]);
    });
  });

  describe('Query String Parameters: Pagination', () => {
    // Documentation: api:page and api:page_size
    test('pagination with api:page and api:page_size', async () => {
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

      const page1 = await request(app).get('/items?api:page=1&api:page_size=2');
      expect(page1.status).toBe(200);
      expect(page1.body.data).toHaveLength(2);
      expect(page1.body.data.map((d) => d.name)).toEqual(['Item1', 'Item2']);
      expect(page1.body.meta.paging).toMatchObject({
        page: 1,
        size: 2,
        count: 5,
        total_pages: 3,
      });

      const page2 = await request(app).get('/items?api:page=2&api:page_size=2');
      expect(page2.status).toBe(200);
      expect(page2.body.data.map((d) => d.name)).toEqual(['Item3', 'Item4']);
    });
  });

  describe('Model Configuration', () => {
    // Documentation: Model.apialize for defaults
    test('model.apialize sets operation defaults', async () => {
      const ctx = await buildAppAndModel({
        modelApialize: {
          page_size: 2,
          orderby: 'name',
          orderdir: 'DESC',
        },
        listOptions: { meta_show_ordering: true },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Alpha', category: 'A', price: 100 },
        { name: 'Beta', category: 'B', price: 200 },
        { name: 'Gamma', category: 'A', price: 300 },
      ]);

      const res = await request(app).get('/items');
      expect(res.status).toBe(200);
      // Uses model default page_size
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.paging.size).toBe(2);
      // Uses model default ordering
      expect(res.body.data.map((d) => d.name)).toEqual(['Gamma', 'Beta']);
      expect(res.body.meta.ordering).toEqual([
        { order_by: 'name', direction: 'DESC' },
      ]);
    });
  });

  describe('Configuration Options: ID Mapping', () => {
    // Documentation: id_mapping transforms internal IDs to external format
    test('id_mapping uses external_id field as the identifier', async () => {
      const ctx = await buildAppAndModel({
        listOptions: {
          id_mapping: 'external_id',
        },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Item1', category: 'A', price: 100, external_id: 'ext-123' },
      ]);

      const res = await request(app).get('/items');
      expect(res.status).toBe(200);
      // When id_mapping is set, the external_id value is used as the 'id' field
      expect(res.body.data[0]).toHaveProperty('id', 'ext-123');
    });
  });

  describe('Configuration Options: Field Aliases', () => {
    // Documentation: aliases renames fields in the response
    // Format is { aliasName: 'originalDbColumnName' }
    test('aliases renames database fields to user-friendly names', async () => {
      const ctx = await buildAppAndModel({
        listOptions: {
          // Alias 'title' displays database field 'name'
          // Alias 'type' displays database field 'category'
          aliases: { title: 'name', type: 'category' },
        },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [{ name: 'Widget', category: 'gadget', price: 99 }]);

      const res = await request(app).get('/items');
      expect(res.status).toBe(200);
      expect(res.body.data[0]).toHaveProperty('title', 'Widget');
      expect(res.body.data[0]).toHaveProperty('type', 'gadget');
      expect(res.body.data[0]).not.toHaveProperty('name');
      expect(res.body.data[0]).not.toHaveProperty('category');
    });
  });

  describe('Configuration Options: Relation ID Mapping', () => {
    // Documentation: relation_id_mapping maps foreign keys to related model's external ID
    test('relation_id_mapping replaces foreign key with external ID from related model', async () => {
      const sequelizeInstance = new Sequelize('sqlite::memory:', {
        logging: false,
      });

      const Category = sequelizeInstance.define(
        'Category',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          name: { type: DataTypes.STRING },
          external_id: { type: DataTypes.STRING },
        },
        { tableName: 'doc_list_categories', timestamps: false }
      );

      const Product = sequelizeInstance.define(
        'Product',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          name: { type: DataTypes.STRING },
          price: { type: DataTypes.DECIMAL(10, 2) },
          category_id: { type: DataTypes.INTEGER },
        },
        { tableName: 'doc_list_products', timestamps: false }
      );

      Product.belongsTo(Category, { foreignKey: 'category_id' });
      Category.hasMany(Product, { foreignKey: 'category_id' });

      await sequelizeInstance.sync({ force: true });
      sequelize = sequelizeInstance;

      const category = await Category.create({
        name: 'Electronics',
        external_id: 'cat-ext-001',
      });
      await Product.create({
        name: 'Laptop',
        price: 999,
        category_id: category.id,
      });

      const app = express();
      app.use(express.json());

      app.use(
        '/products',
        list(Product, {
          relation_id_mapping: [{ model: Category, id_field: 'external_id' }],
        })
      );

      const res = await request(app).get('/products');
      expect(res.status).toBe(200);
      // relation_id_mapping replaces the foreign key value with the related model's external_id
      // The field name stays as category_id but the value is now the external_id
      expect(res.body.data[0]).toHaveProperty('category_id', 'cat-ext-001');
    });
  });

  describe('Configuration Options: modelOptions', () => {
    // Documentation: modelOptions.attributes to select specific fields
    test('modelOptions.attributes limits returned fields', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      // Re-mount with modelOptions
      const appWithOptions = express();
      appWithOptions.use(express.json());
      appWithOptions.use(
        '/items',
        list(ctx.Item, {}, { attributes: ['id', 'name', 'price'] })
      );

      await seed(Item, [
        { name: 'Laptop', category: 'electronics', price: 999 },
      ]);

      const res = await request(appWithOptions).get('/items');
      expect(res.status).toBe(200);
      expect(res.body.data[0]).toHaveProperty('name');
      expect(res.body.data[0]).toHaveProperty('price');
      expect(res.body.data[0]).toHaveProperty('id');
    });

    // Documentation: modelOptions.include for eager loading associations
    test('modelOptions.include for eager loading associations', async () => {
      const sequelizeInstance = new Sequelize('sqlite::memory:', {
        logging: false,
      });

      const Category = sequelizeInstance.define(
        'Category',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          name: { type: DataTypes.STRING },
        },
        { tableName: 'doc_list_inc_categories', timestamps: false }
      );

      const Product = sequelizeInstance.define(
        'Product',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          name: { type: DataTypes.STRING },
          price: { type: DataTypes.DECIMAL(10, 2) },
          category_id: { type: DataTypes.INTEGER },
        },
        { tableName: 'doc_list_inc_products', timestamps: false }
      );

      Product.belongsTo(Category, { foreignKey: 'category_id' });
      Category.hasMany(Product, { foreignKey: 'category_id' });

      await sequelizeInstance.sync({ force: true });
      sequelize = sequelizeInstance;

      const category = await Category.create({ name: 'Electronics' });
      await Product.create({
        name: 'Laptop',
        price: 999,
        category_id: category.id,
      });

      const app = express();
      app.use(express.json());

      // modelOptions is the second argument to list()
      app.use(
        '/products',
        list(Product, {}, { include: [{ model: Category, as: 'Category' }] })
      );

      const res = await request(app).get('/products');
      expect(res.status).toBe(200);
      expect(res.body.data[0]).toHaveProperty('Category');
      expect(res.body.data[0].Category.name).toBe('Electronics');
    });

    // Documentation: modelOptions.where for default query conditions
    test('modelOptions.where applies default query conditions', async () => {
      const ctx = await buildAppAndModel();
      sequelize = ctx.sequelize;
      const { Item } = ctx;

      await seed(Item, [
        { name: 'Laptop', category: 'electronics', price: 999 },
        { name: 'Chair', category: 'furniture', price: 199 },
        { name: 'Phone', category: 'electronics', price: 699 },
      ]);

      // Create app with modelOptions.where
      const appWithWhere = express();
      appWithWhere.use(express.json());
      appWithWhere.use(
        '/items',
        list(Item, {}, { where: { category: 'electronics' } })
      );

      const res = await request(appWithWhere).get('/items');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((d) => d.category === 'electronics')).toBe(
        true
      );
    });
  });

  describe('Filtering on Included Models', () => {
    // Documentation: Dot notation filtering on related model fields
    test('filtering on related model fields using dot notation', async () => {
      const sequelizeInstance = new Sequelize('sqlite::memory:', {
        logging: false,
      });

      const Author = sequelizeInstance.define(
        'Author',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          name: { type: DataTypes.STRING },
          country: { type: DataTypes.STRING },
        },
        { tableName: 'doc_list_filt_authors', timestamps: false }
      );

      const Book = sequelizeInstance.define(
        'Book',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          title: { type: DataTypes.STRING },
          author_id: { type: DataTypes.INTEGER },
        },
        { tableName: 'doc_list_filt_books', timestamps: false }
      );

      Book.belongsTo(Author, { foreignKey: 'author_id' });
      Author.hasMany(Book, { foreignKey: 'author_id' });

      await sequelizeInstance.sync({ force: true });
      sequelize = sequelizeInstance;

      const usAuthor = await Author.create({ name: 'John', country: 'USA' });
      const ukAuthor = await Author.create({ name: 'Jane', country: 'UK' });
      await Book.create({ title: 'American Novel', author_id: usAuthor.id });
      await Book.create({ title: 'British Novel', author_id: ukAuthor.id });

      const app = express();
      app.use(express.json());

      // Pass options and modelOptions with include for the association
      app.use(
        '/books',
        list(
          Book,
          { allow_filtering_on: ['Author.country'] },
          { include: [{ model: Author, as: 'Author' }] }
        )
      );

      const res = await request(app).get('/books?Author.country=USA');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].title).toBe('American Novel');
      expect(res.body.data[0].Author.country).toBe('USA');
    });
  });

  describe('Hooks', () => {
    // Documentation: pre and post hooks
    test('pre hook runs before query, post hook can modify payload', async () => {
      let preHookCalled = false;
      let postHookCalled = false;

      const ctx = await buildAppAndModel({
        listOptions: {
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

      const res = await request(app).get('/items');
      expect(res.status).toBe(200);
      expect(preHookCalled).toBe(true);
      expect(postHookCalled).toBe(true);
      expect(res.body.meta.custom).toBe('value');
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
        listOptions: { middleware: [scopeMiddleware] },
      });
      sequelize = ctx.sequelize;
      const { Item, app } = ctx;

      await seed(Item, [
        { name: 'Item1', category: 'A', price: 100 },
        { name: 'Item2', category: 'B', price: 200 },
        { name: 'Item3', category: 'A', price: 300 },
      ]);

      const res = await request(app).get('/items');
      expect(res.status).toBe(200);
      // Only category A items returned due to middleware
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((d) => d.category === 'A')).toBe(true);
    });
  });
});
