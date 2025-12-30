/**
 * Documentation Examples Test: index.md - Default Configuration
 *
 * This test file validates that the default configuration values shown in
 * documentation/index.md are accurate and match the actual library behavior.
 */

const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list, search, single, create, update, patch, destroy } = require('../src');

describe('Documentation: Default Configuration Table', () => {
  let sequelize;
  let Item;
  let Category;

  beforeEach(async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    Category = sequelize.define(
      'Category',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        external_id: { type: DataTypes.STRING(50), unique: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
      },
      {
        tableName: 'doc_default_categories',
        timestamps: false,
        apialize: {
          apialize_id: 'external_id',
        },
      }
    );

    Item = sequelize.define(
      'Item',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
        price: { type: DataTypes.DECIMAL(10, 2) },
        category_id: { type: DataTypes.INTEGER },
        status: { type: DataTypes.STRING(20), defaultValue: 'active' },
      },
      {
        tableName: 'doc_default_items',
        timestamps: false,
      }
    );

    Item.belongsTo(Category, { as: 'category', foreignKey: 'category_id' });
    Category.hasMany(Item, { as: 'items', foreignKey: 'category_id' });

    await sequelize.sync({ force: true });
  });

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  async function seedItems() {
    const category = await Category.create({
      external_id: 'cat-electronics',
      name: 'Electronics',
    });

    // Create more than 100 items to test default page size
    const items = [];
    for (let i = 1; i <= 150; i++) {
      items.push({
        name: `Item ${String(i).padStart(3, '0')}`,
        price: i * 10,
        category_id: category.id,
        status: i % 2 === 0 ? 'active' : 'inactive',
      });
    }
    await Item.bulkCreate(items);
    return { category };
  }

  describe('list operation defaults', () => {
    test('default_page_size: 100', async () => {
      await seedItems();
      const app = express();
      app.use('/items', list(Item));

      const res = await request(app).get('/items');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(100);
      expect(res.body.meta.paging.size).toBe(100);
    });

    test('default_order_by: id', async () => {
      await seedItems();
      const app = express();
      app.use('/items', list(Item));

      const res = await request(app).get('/items');
      expect(res.status).toBe(200);
      // Items should be ordered by id ascending
      expect(res.body.data[0].id).toBe(1);
      expect(res.body.data[1].id).toBe(2);
      expect(res.body.data[99].id).toBe(100);
    });

    test('default_order_dir: ASC', async () => {
      await seedItems();
      const app = express();
      app.use('/items', list(Item));

      const res = await request(app).get('/items');
      expect(res.status).toBe(200);
      // First item should have lowest id (ascending order)
      expect(res.body.data[0].id).toBeLessThan(res.body.data[1].id);
    });

    test('allow_filtering: true (filtering works by default)', async () => {
      await seedItems();
      const app = express();
      app.use('/items', list(Item));

      const res = await request(app).get('/items?status=active');
      expect(res.status).toBe(200);
      expect(res.body.data.every((item) => item.status === 'active')).toBe(true);
    });

    test('allow_ordering: true (ordering works by default)', async () => {
      await seedItems();
      const app = express();
      app.use('/items', list(Item));

      const res = await request(app).get('/items?api:order_by=-price');
      expect(res.status).toBe(200);
      // Should be ordered by price descending
      expect(parseFloat(res.body.data[0].price)).toBeGreaterThan(
        parseFloat(res.body.data[1].price)
      );
    });

    test('allow_filtering_on: null (all fields filterable)', async () => {
      await seedItems();
      const app = express();
      app.use('/items', list(Item));

      // Should be able to filter on any field
      const res1 = await request(app).get('/items?name=Item 001');
      expect(res1.status).toBe(200);

      const res2 = await request(app).get('/items?price=100');
      expect(res2.status).toBe(200);

      const res3 = await request(app).get('/items?status=active');
      expect(res3.status).toBe(200);
    });

    test('allow_ordering_on: null (all fields orderable)', async () => {
      await seedItems();
      const app = express();
      app.use('/items', list(Item));

      // Should be able to order by any field
      const res1 = await request(app).get('/items?api:order_by=name');
      expect(res1.status).toBe(200);

      const res2 = await request(app).get('/items?api:order_by=price');
      expect(res2.status).toBe(200);

      const res3 = await request(app).get('/items?api:order_by=status');
      expect(res3.status).toBe(200);
    });

    test('meta_show_filters: false (filters not in meta by default)', async () => {
      await seedItems();
      const app = express();
      app.use('/items', list(Item));

      const res = await request(app).get('/items?status=active');
      expect(res.status).toBe(200);
      expect(res.body.meta.filters).toBeUndefined();
    });

    test('meta_show_ordering: false (ordering not in meta by default)', async () => {
      await seedItems();
      const app = express();
      app.use('/items', list(Item));

      const res = await request(app).get('/items?api:order_by=name');
      expect(res.status).toBe(200);
      expect(res.body.meta.ordering).toBeUndefined();
    });

    test('id_mapping: id (uses id field by default)', async () => {
      await seedItems();
      const app = express();
      app.use('/items', list(Item));

      const res = await request(app).get('/items');
      expect(res.status).toBe(200);
      // Should have numeric id field
      expect(typeof res.body.data[0].id).toBe('number');
      expect(res.body.data[0].id).toBe(1);
    });

    test('auto_relation_id_mapping: true (foreign keys mapped automatically)', async () => {
      await seedItems();
      const app = express();
      app.use(
        '/items',
        list(
          Item,
          {},
          {
            include: [{ model: Category, as: 'category' }],
          }
        )
      );

      const res = await request(app).get('/items');
      expect(res.status).toBe(200);
      // category_id should be mapped to external_id
      expect(res.body.data[0].category_id).toBe('cat-electronics');
    });

    test('flattening: null (no flattening by default)', async () => {
      await seedItems();
      const app = express();
      app.use(
        '/items',
        list(
          Item,
          {},
          {
            include: [{ model: Category, as: 'category' }],
          }
        )
      );

      const res = await request(app).get('/items');
      expect(res.status).toBe(200);
      // Category should be nested, not flattened
      expect(res.body.data[0].category).toBeDefined();
      expect(res.body.data[0].category.name).toBe('Electronics');
      expect(res.body.data[0].category_name).toBeUndefined();
    });

    test('aliases: null (no field aliasing by default)', async () => {
      await seedItems();
      const app = express();
      app.use('/items', list(Item));

      const res = await request(app).get('/items');
      expect(res.status).toBe(200);
      // Fields should use their database names
      expect(res.body.data[0]).toHaveProperty('name');
      expect(res.body.data[0]).toHaveProperty('price');
      expect(res.body.data[0]).toHaveProperty('status');
    });
  });

  describe('search operation defaults', () => {
    test('path: /search (mounted at /search by default)', async () => {
      await seedItems();
      const app = express();
      app.use(bodyParser.json());
      app.use('/items', search(Item));

      // Should work at /items/search
      const res = await request(app).post('/items/search').send({});
      expect(res.status).toBe(200);
    });

    test('default_page_size: 100', async () => {
      await seedItems();
      const app = express();
      app.use(bodyParser.json());
      app.use('/items', search(Item));

      const res = await request(app).post('/items/search').send({});
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(100);
      expect(res.body.meta.paging.size).toBe(100);
    });

    test('default_order_by: id, default_order_dir: ASC', async () => {
      await seedItems();
      const app = express();
      app.use(bodyParser.json());
      app.use('/items', search(Item));

      const res = await request(app).post('/items/search').send({});
      expect(res.status).toBe(200);
      expect(res.body.data[0].id).toBe(1);
      expect(res.body.data[0].id).toBeLessThan(res.body.data[1].id);
    });

    test('allow_filtering_on: null (all fields filterable)', async () => {
      await seedItems();
      const app = express();
      app.use(bodyParser.json());
      app.use('/items', search(Item));

      const res = await request(app).post('/items/search').send({
        filtering: { status: 'active' },
      });
      expect(res.status).toBe(200);
      expect(res.body.data.every((item) => item.status === 'active')).toBe(true);
    });

    test('allow_ordering_on: null (all fields orderable)', async () => {
      await seedItems();
      const app = express();
      app.use(bodyParser.json());
      app.use('/items', search(Item));

      // Should be able to order by any field
      const res1 = await request(app).post('/items/search').send({
        ordering: [{ order_by: 'name', direction: 'ASC' }],
      });
      expect(res1.status).toBe(200);

      const res2 = await request(app).post('/items/search').send({
        ordering: [{ order_by: 'price', direction: 'DESC' }],
      });
      expect(res2.status).toBe(200);
    });

    test('meta_show_filters: false', async () => {
      await seedItems();
      const app = express();
      app.use(bodyParser.json());
      app.use('/items', search(Item));

      const res = await request(app).post('/items/search').send({
        filtering: { status: 'active' },
      });
      expect(res.status).toBe(200);
      expect(res.body.meta.filters).toBeUndefined();
    });

    test('meta_show_ordering: false', async () => {
      await seedItems();
      const app = express();
      app.use(bodyParser.json());
      app.use('/items', search(Item));

      const res = await request(app).post('/items/search').send({
        ordering: [{ order_by: 'name', direction: 'ASC' }],
      });
      expect(res.status).toBe(200);
      expect(res.body.meta.ordering).toBeUndefined();
    });

    test('id_mapping: id', async () => {
      await seedItems();
      const app = express();
      app.use(bodyParser.json());
      app.use('/items', search(Item));

      const res = await request(app).post('/items/search').send({});
      expect(res.status).toBe(200);
      expect(typeof res.body.data[0].id).toBe('number');
    });

    test('flattening: null (no flattening by default)', async () => {
      await seedItems();
      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/items',
        search(
          Item,
          {},
          {
            include: [{ model: Category, as: 'category' }],
          }
        )
      );

      const res = await request(app).post('/items/search').send({});
      expect(res.status).toBe(200);
      // Category should be nested, not flattened
      expect(res.body.data[0].category).toBeDefined();
      expect(res.body.data[0].category.name).toBe('Electronics');
      expect(res.body.data[0].category_name).toBeUndefined();
    });

    test('auto_relation_id_mapping: true', async () => {
      await seedItems();
      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/items',
        search(
          Item,
          {},
          {
            include: [{ model: Category, as: 'category' }],
          }
        )
      );

      const res = await request(app).post('/items/search').send({});
      expect(res.status).toBe(200);
      // category_id should be mapped to external_id
      expect(res.body.data[0].category_id).toBe('cat-electronics');
    });

    test('aliases: null (no field aliasing by default)', async () => {
      await seedItems();
      const app = express();
      app.use(bodyParser.json());
      app.use('/items', search(Item));

      const res = await request(app).post('/items/search').send({});
      expect(res.status).toBe(200);
      // Fields should use their database names
      expect(res.body.data[0]).toHaveProperty('name');
      expect(res.body.data[0]).toHaveProperty('price');
      expect(res.body.data[0]).toHaveProperty('status');
    });
  });

  describe('single operation defaults', () => {
    test('id_mapping: id (fetches by numeric id)', async () => {
      await seedItems();
      const app = express();
      app.use('/items', single(Item));

      const res = await request(app).get('/items/1');
      expect(res.status).toBe(200);
      expect(res.body.record.id).toBe(1);
      expect(res.body.record.name).toBe('Item 001');
    });

    test('param_name: id (uses :id route parameter)', async () => {
      await seedItems();
      const app = express();
      app.use('/items', single(Item));

      // Should work with /items/:id
      const res = await request(app).get('/items/5');
      expect(res.status).toBe(200);
      expect(res.body.record.id).toBe(5);
    });

    test('flattening: null (no flattening)', async () => {
      await seedItems();
      const app = express();
      app.use(
        '/items',
        single(
          Item,
          {},
          {
            include: [{ model: Category, as: 'category' }],
          }
        )
      );

      const res = await request(app).get('/items/1');
      expect(res.status).toBe(200);
      expect(res.body.record.category).toBeDefined();
      expect(res.body.record.category.name).toBe('Electronics');
    });

    test('auto_relation_id_mapping: true', async () => {
      await seedItems();
      const app = express();
      app.use(
        '/items',
        single(
          Item,
          {},
          {
            include: [{ model: Category, as: 'category' }],
          }
        )
      );

      const res = await request(app).get('/items/1');
      expect(res.status).toBe(200);
      expect(res.body.record.category_id).toBe('cat-electronics');
    });

    test('aliases: null (no field aliasing by default)', async () => {
      await seedItems();
      const app = express();
      app.use('/items', single(Item));

      const res = await request(app).get('/items/1');
      expect(res.status).toBe(200);
      // Fields should use their database names
      expect(res.body.record).toHaveProperty('name');
      expect(res.body.record).toHaveProperty('price');
      expect(res.body.record).toHaveProperty('status');
    });

    test('member_routes: [] (no member routes by default)', async () => {
      await seedItems();
      const app = express();
      app.use('/items', single(Item));

      // Standard single endpoint works
      const res = await request(app).get('/items/1');
      expect(res.status).toBe(200);

      // But no custom member routes exist (would return 404 or similar)
      const memberRes = await request(app).get('/items/1/custom-action');
      expect(memberRes.status).toBe(404);
    });

    test('related: [] (no related endpoints by default)', async () => {
      await seedItems();
      const app = express();
      app.use('/items', single(Item));

      // Standard single endpoint works
      const res = await request(app).get('/items/1');
      expect(res.status).toBe(200);

      // But no related model endpoints exist
      const relatedRes = await request(app).get('/items/1/related-model');
      expect(relatedRes.status).toBe(404);
    });
  });

  describe('create operation defaults', () => {
    test('id_mapping: id (returns numeric id)', async () => {
      const app = express();
      app.use(bodyParser.json());
      app.use('/items', create(Item));

      const res = await request(app).post('/items').send({
        name: 'New Item',
        price: 99.99,
      });
      expect(res.status).toBe(201);
      expect(typeof res.body.id).toBe('number');
    });

    test('allow_bulk_create: false (bulk create disabled by default)', async () => {
      const app = express();
      app.use(bodyParser.json());
      app.use('/items', create(Item));

      const res = await request(app)
        .post('/items')
        .send([
          { name: 'Item A', price: 10 },
          { name: 'Item B', price: 20 },
        ]);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Cannot insert multiple records');
    });

    test('validate: true (validation enabled by default)', async () => {
      const app = express();
      app.use(bodyParser.json());
      app.use('/items', create(Item));

      // name is required (allowNull: false)
      const res = await request(app).post('/items').send({
        price: 99.99,
      });
      expect(res.status).toBe(400);
    });

    test('allowed_fields: null (all fields allowed)', async () => {
      const app = express();
      app.use(bodyParser.json());
      app.use('/items', create(Item));

      const res = await request(app).post('/items').send({
        name: 'New Item',
        price: 99.99,
        status: 'inactive',
      });
      expect(res.status).toBe(201);

      const item = await Item.findByPk(res.body.id);
      expect(item.status).toBe('inactive');
    });

    test('auto_relation_id_mapping: true (resolves external IDs on create)', async () => {
      const category = await Category.create({
        external_id: 'cat-test',
        name: 'Test Category',
      });

      const app = express();
      app.use(bodyParser.json());
      app.use('/items', create(Item));

      const res = await request(app).post('/items').send({
        name: 'New Item',
        price: 99.99,
        category_id: 'cat-test', // Using external ID
      });
      expect(res.status).toBe(201);

      const item = await Item.findByPk(res.body.id);
      expect(item.category_id).toBe(category.id); // Should be stored as internal ID
    });

    test('aliases: null (no field aliasing by default)', async () => {
      const app = express();
      app.use(bodyParser.json());
      app.use('/items', create(Item));

      // Fields should use their database names in request
      const res = await request(app).post('/items').send({
        name: 'New Item',
        price: 99.99,
        status: 'active',
      });
      expect(res.status).toBe(201);

      const item = await Item.findByPk(res.body.id);
      expect(item.name).toBe('New Item');
      expect(parseFloat(item.price)).toBe(99.99);
      expect(item.status).toBe('active');
    });

    test('blocked_fields: null (no fields blocked by default)', async () => {
      const app = express();
      app.use(bodyParser.json());
      app.use('/items', create(Item));

      // Should be able to set any field
      const res = await request(app).post('/items').send({
        name: 'New Item',
        price: 99.99,
        status: 'custom-status',
      });
      expect(res.status).toBe(201);

      const item = await Item.findByPk(res.body.id);
      expect(item.status).toBe('custom-status');
    });
  });

  describe('update operation defaults', () => {
    test('id_mapping: id', async () => {
      const item = await Item.create({ name: 'Test Item', price: 50 });

      const app = express();
      app.use(bodyParser.json());
      app.use('/items', update(Item));

      const res = await request(app).put(`/items/${item.id}`).send({
        name: 'Updated Item',
        price: 100,
      });
      expect(res.status).toBe(200);
    });

    test('validate: true', async () => {
      const item = await Item.create({ name: 'Test Item', price: 50 });

      const app = express();
      app.use(bodyParser.json());
      app.use('/items', update(Item));

      // name is required
      const res = await request(app).put(`/items/${item.id}`).send({
        price: 100,
      });
      expect(res.status).toBe(400);
    });

    test('allowed_fields: null (all fields allowed)', async () => {
      const item = await Item.create({ name: 'Test Item', price: 50 });

      const app = express();
      app.use(bodyParser.json());
      app.use('/items', update(Item));

      const res = await request(app).put(`/items/${item.id}`).send({
        name: 'Updated Item',
        price: 200,
        status: 'archived',
      });
      expect(res.status).toBe(200);

      await item.reload();
      expect(item.status).toBe('archived');
    });

    test('auto_relation_id_mapping: true (resolves external IDs on update)', async () => {
      const category1 = await Category.create({
        external_id: 'cat-update-1',
        name: 'Category 1',
      });
      const category2 = await Category.create({
        external_id: 'cat-update-2',
        name: 'Category 2',
      });
      const item = await Item.create({
        name: 'Test Item',
        price: 50,
        category_id: category1.id,
      });

      const app = express();
      app.use(bodyParser.json());
      app.use('/items', update(Item));

      const res = await request(app).put(`/items/${item.id}`).send({
        name: 'Updated Item',
        price: 100,
        category_id: 'cat-update-2', // Using external ID
      });
      expect(res.status).toBe(200);

      await item.reload();
      expect(item.category_id).toBe(category2.id);
    });

    test('aliases: null (no field aliasing by default)', async () => {
      const item = await Item.create({ name: 'Test Item', price: 50 });

      const app = express();
      app.use(bodyParser.json());
      app.use('/items', update(Item));

      // Fields should use their database names in request
      const res = await request(app).put(`/items/${item.id}`).send({
        name: 'Updated Item',
        price: 100,
        status: 'updated',
      });
      expect(res.status).toBe(200);

      await item.reload();
      expect(item.name).toBe('Updated Item');
      expect(parseFloat(item.price)).toBe(100);
      expect(item.status).toBe('updated');
    });

    test('blocked_fields: null (no fields blocked by default)', async () => {
      const item = await Item.create({ name: 'Test Item', price: 50, status: 'active' });

      const app = express();
      app.use(bodyParser.json());
      app.use('/items', update(Item));

      // Should be able to update any field
      const res = await request(app).put(`/items/${item.id}`).send({
        name: 'Updated Item',
        price: 200,
        status: 'special-status',
      });
      expect(res.status).toBe(200);

      await item.reload();
      expect(item.status).toBe('special-status');
    });
  });

  describe('patch operation defaults', () => {
    test('id_mapping: id', async () => {
      const item = await Item.create({ name: 'Test Item', price: 50 });

      const app = express();
      app.use(bodyParser.json());
      app.use('/items', patch(Item));

      const res = await request(app).patch(`/items/${item.id}`).send({
        price: 75,
      });
      expect(res.status).toBe(200);
    });

    test('validate: true', async () => {
      const item = await Item.create({ name: 'Test Item', price: 50 });

      const app = express();
      app.use(bodyParser.json());
      app.use('/items', patch(Item));

      // Patching with invalid data should fail validation
      const res = await request(app).patch(`/items/${item.id}`).send({
        name: null, // name is required
      });
      expect(res.status).toBe(400);
    });

    test('allowed_fields: null (all fields allowed)', async () => {
      const item = await Item.create({
        name: 'Test Item',
        price: 50,
        status: 'active',
      });

      const app = express();
      app.use(bodyParser.json());
      app.use('/items', patch(Item));

      const res = await request(app).patch(`/items/${item.id}`).send({
        status: 'inactive',
      });
      expect(res.status).toBe(200);

      await item.reload();
      expect(item.status).toBe('inactive');
    });

    test('auto_relation_id_mapping: true (resolves external IDs on patch)', async () => {
      const category1 = await Category.create({
        external_id: 'cat-1',
        name: 'Category 1',
      });
      const category2 = await Category.create({
        external_id: 'cat-2',
        name: 'Category 2',
      });
      const item = await Item.create({
        name: 'Test Item',
        price: 50,
        category_id: category1.id,
      });

      const app = express();
      app.use(bodyParser.json());
      app.use('/items', patch(Item));

      const res = await request(app).patch(`/items/${item.id}`).send({
        category_id: 'cat-2', // Using external ID
      });
      expect(res.status).toBe(200);

      await item.reload();
      expect(item.category_id).toBe(category2.id);
    });

    test('aliases: null (no field aliasing by default)', async () => {
      const item = await Item.create({ name: 'Test Item', price: 50, status: 'active' });

      const app = express();
      app.use(bodyParser.json());
      app.use('/items', patch(Item));

      // Fields should use their database names in request
      const res = await request(app).patch(`/items/${item.id}`).send({
        name: 'Patched Item',
      });
      expect(res.status).toBe(200);

      await item.reload();
      expect(item.name).toBe('Patched Item');
    });

    test('blocked_fields: null (no fields blocked by default)', async () => {
      const item = await Item.create({ name: 'Test Item', price: 50, status: 'active' });

      const app = express();
      app.use(bodyParser.json());
      app.use('/items', patch(Item));

      // Should be able to patch any field
      const res = await request(app).patch(`/items/${item.id}`).send({
        status: 'patched-status',
      });
      expect(res.status).toBe(200);

      await item.reload();
      expect(item.status).toBe('patched-status');
    });
  });

  describe('destroy operation defaults', () => {
    test('id_mapping: id', async () => {
      const item = await Item.create({ name: 'Test Item', price: 50 });

      const app = express();
      app.use('/items', destroy(Item));

      const res = await request(app).delete(`/items/${item.id}`);
      expect(res.status).toBe(200);

      const deletedItem = await Item.findByPk(item.id);
      expect(deletedItem).toBeNull();
    });
  });

  describe('middleware default: [] (no middleware)', () => {
    test('list works without middleware', async () => {
      await seedItems();
      const app = express();
      app.use('/items', list(Item));

      const res = await request(app).get('/items');
      expect(res.status).toBe(200);
    });

    test('search works without middleware', async () => {
      await seedItems();
      const app = express();
      app.use(bodyParser.json());
      app.use('/items', search(Item));

      const res = await request(app).post('/items/search').send({});
      expect(res.status).toBe(200);
    });

    test('single works without middleware', async () => {
      await seedItems();
      const app = express();
      app.use('/items', single(Item));

      const res = await request(app).get('/items/1');
      expect(res.status).toBe(200);
    });

    test('create works without middleware', async () => {
      const app = express();
      app.use(bodyParser.json());
      app.use('/items', create(Item));

      const res = await request(app).post('/items').send({
        name: 'New Item',
        price: 10,
      });
      expect(res.status).toBe(201);
    });

    test('update works without middleware', async () => {
      const item = await Item.create({ name: 'Test', price: 10 });
      const app = express();
      app.use(bodyParser.json());
      app.use('/items', update(Item));

      const res = await request(app).put(`/items/${item.id}`).send({
        name: 'Updated',
        price: 20,
      });
      expect(res.status).toBe(200);
    });

    test('patch works without middleware', async () => {
      const item = await Item.create({ name: 'Test', price: 10 });
      const app = express();
      app.use(bodyParser.json());
      app.use('/items', patch(Item));

      const res = await request(app).patch(`/items/${item.id}`).send({
        price: 20,
      });
      expect(res.status).toBe(200);
    });

    test('destroy works without middleware', async () => {
      const item = await Item.create({ name: 'Test', price: 10 });
      const app = express();
      app.use('/items', destroy(Item));

      const res = await request(app).delete(`/items/${item.id}`);
      expect(res.status).toBe(200);
    });
  });

  describe('pre/post hooks default: null (no hooks)', () => {
    test('operations work without pre/post hooks', async () => {
      await seedItems();
      const app = express();
      app.use(bodyParser.json());
      app.use('/items', list(Item));
      app.use('/items', single(Item));
      app.use('/items', create(Item));

      // All should work without hooks configured
      const listRes = await request(app).get('/items');
      expect(listRes.status).toBe(200);

      const singleRes = await request(app).get('/items/1');
      expect(singleRes.status).toBe(200);

      const createRes = await request(app).post('/items').send({
        name: 'New',
        price: 10,
      });
      expect(createRes.status).toBe(201);
    });
  });

  describe('block_filtering_on/block_ordering_on default: null', () => {
    test('no fields blocked by default', async () => {
      await seedItems();
      const app = express();
      app.use('/items', list(Item));

      // Should be able to filter/order on any field including id
      const res1 = await request(app).get('/items?id=1');
      expect(res1.status).toBe(200);

      const res2 = await request(app).get('/items?api:order_by=id');
      expect(res2.status).toBe(200);
    });
  });

  describe('relation_id_mapping default: null', () => {
    test('no explicit relation_id_mapping needed when auto is enabled', async () => {
      await seedItems();
      const app = express();
      // No relation_id_mapping specified, but auto_relation_id_mapping is true by default
      app.use(
        '/items',
        list(
          Item,
          {},
          {
            include: [{ model: Category, as: 'category' }],
          }
        )
      );

      const res = await request(app).get('/items');
      expect(res.status).toBe(200);
      // Should still map foreign keys due to auto_relation_id_mapping
      expect(res.body.data[0].category_id).toBe('cat-electronics');
    });
  });

  describe('disable_subquery default: true', () => {
    test('list operation uses disable_subquery by default', async () => {
      await seedItems();
      const app = express();
      app.use(
        '/items',
        list(
          Item,
          {},
          {
            include: [{ model: Category, as: 'category' }],
          }
        )
      );

      // With disable_subquery: true (default), pagination with includes should work correctly
      const res = await request(app).get('/items?api:page_size=10');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(10);
      // Each item should have its category included
      expect(res.body.data[0].category).toBeDefined();
    });

    test('search operation uses disable_subquery by default', async () => {
      await seedItems();
      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/items',
        search(
          Item,
          {},
          {
            include: [{ model: Category, as: 'category' }],
          }
        )
      );

      // With disable_subquery: true (default), pagination with includes should work correctly
      const res = await request(app).post('/items/search').send({
        paging: { page: 1, size: 10 },
      });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(10);
      // Each item should have its category included
      expect(res.body.data[0].category).toBeDefined();
    });
  });
});
