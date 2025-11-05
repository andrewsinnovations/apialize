const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes, Op } = require('sequelize');
const {
  list,
  create,
  single,
  update,
  patch,
  destroy,
  search,
} = require('../src');

/**
 * Tests for modelOptions.scopes functionality across all operations
 */

describe('modelOptions scopes support', () => {
  let sequelize;
  let Item;
  let app;

  beforeAll(async () => {
    sequelize = new Sequelize('sqlite::memory:', {
      logging: false,
    });

    // Define a model with various scopes for testing
    Item = sequelize.define(
      'Item',
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        external_id: {
          type: DataTypes.STRING,
          allowNull: false,
          unique: true,
        },
        name: { type: DataTypes.STRING, allowNull: false },
        category: { type: DataTypes.STRING },
        status: { type: DataTypes.STRING, defaultValue: 'active' },
        tenant_id: { type: DataTypes.INTEGER },
        price: { type: DataTypes.DECIMAL(10, 2) },
        is_featured: { type: DataTypes.BOOLEAN, defaultValue: false },
      },
      {
        tableName: 'modeloptions_scopes_items',
        timestamps: false,
      }
    );

    // Add various scopes for testing
    Item.addScope('byTenant', (tenantId) => ({
      where: { tenant_id: tenantId },
    }));

    Item.addScope('activeOnly', {
      where: { status: 'active' },
    });

    Item.addScope('featured', {
      where: { is_featured: true },
    });

    Item.addScope('electronics', {
      where: { category: 'electronics' },
    });

    Item.addScope('expensive', {
      where: { price: { [Op.gte]: 500 } },
    });

    await sequelize.sync({ force: true });

    // Seed test data
    await Item.bulkCreate([
      {
        external_id: 'laptop1',
        name: 'Gaming Laptop',
        category: 'electronics',
        status: 'active',
        tenant_id: 1,
        price: 1299.99,
        is_featured: true,
      },
      {
        external_id: 'book1',
        name: 'JavaScript Guide',
        category: 'books',
        status: 'active',
        tenant_id: 1,
        price: 29.99,
        is_featured: false,
      },
      {
        external_id: 'phone1',
        name: 'Smartphone',
        category: 'electronics',
        status: 'inactive',
        tenant_id: 2,
        price: 699.99,
        is_featured: true,
      },
      {
        external_id: 'desk1',
        name: 'Office Desk',
        category: 'furniture',
        status: 'active',
        tenant_id: 1,
        price: 299.99,
        is_featured: false,
      },
      {
        external_id: 'tablet1',
        name: 'Tablet Pro',
        category: 'electronics',
        status: 'active',
        tenant_id: 2,
        price: 799.99,
        is_featured: true,
      },
    ]);
  });

  afterAll(async () => {
    if (sequelize) {
      await sequelize.close();
    }
  });

  beforeEach(() => {
    app = express();
    app.use(bodyParser.json());
  });

  describe('list operation with scopes', () => {
    test('should apply single scope from modelOptions', async () => {
      app.use(
        '/items',
        list(
          Item,
          {},
          {
            scopes: ['activeOnly'],
          }
        )
      );

      const response = await request(app).get('/items');
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(4); // Only active items
      expect(response.body.data.every((item) => item.status === 'active')).toBe(
        true
      );
    });

    test('should apply multiple scopes from modelOptions', async () => {
      app.use(
        '/items',
        list(
          Item,
          {},
          {
            scopes: ['activeOnly', 'electronics'],
          }
        )
      );

      const response = await request(app).get('/items');
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2); // Active electronics items (laptop1, tablet1)
      expect(
        response.body.data.every(
          (item) => item.status === 'active' && item.category === 'electronics'
        )
      ).toBe(true);
    });

    test('should apply parameterized scopes from modelOptions', async () => {
      app.use(
        '/items',
        list(
          Item,
          {},
          {
            scopes: [{ name: 'byTenant', args: [1] }, 'activeOnly'],
          }
        )
      );

      const response = await request(app).get('/items');
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3); // Active items in tenant 1
      expect(
        response.body.data.every(
          (item) => item.status === 'active' && item.tenant_id === 1
        )
      ).toBe(true);
    });

    test('should handle empty scopes array gracefully', async () => {
      app.use(
        '/items',
        list(
          Item,
          {},
          {
            scopes: [],
          }
        )
      );

      const response = await request(app).get('/items');
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(5); // All items
    });

    test('should combine scopes with regular modelOptions', async () => {
      app.use(
        '/items',
        list(
          Item,
          {},
          {
            scopes: ['activeOnly'],
            attributes: ['id', 'name', 'status'],
          }
        )
      );

      const response = await request(app).get('/items');
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(4); // Only active items
      expect(response.body.data.every((item) => item.status === 'active')).toBe(
        true
      );
      // Should only have the specified attributes
      expect(Object.keys(response.body.data[0])).toEqual(
        expect.arrayContaining(['id', 'name', 'status'])
      );
      expect(response.body.data[0]).not.toHaveProperty('category');
    });
  });

  describe('single operation with scopes', () => {
    test('should apply scopes when fetching single item', async () => {
      app.use(
        '/items',
        single(
          Item,
          {},
          {
            scopes: ['activeOnly'],
          }
        )
      );

      // Try to get an inactive item - should return 404
      const inactiveItem = await Item.findOne({
        where: { status: 'inactive' },
      });
      const response1 = await request(app).get(`/items/${inactiveItem.id}`);
      expect(response1.status).toBe(404);

      // Try to get an active item - should succeed
      const activeItem = await Item.findOne({ where: { status: 'active' } });
      const response2 = await request(app).get(`/items/${activeItem.id}`);
      expect(response2.status).toBe(200);
      expect(response2.body.success).toBe(true);
      expect(response2.body.record.status).toBe('active');
    });

    test('should apply multiple scopes when fetching single item', async () => {
      app.use(
        '/items',
        single(
          Item,
          {},
          {
            scopes: ['activeOnly', 'electronics', 'featured'],
          }
        )
      );

      // Should only be able to get active, electronics, featured items
      const laptopItem = await Item.findOne({
        where: { external_id: 'laptop1' },
      });
      const response1 = await request(app).get(`/items/${laptopItem.id}`);
      expect(response1.status).toBe(200);
      expect(response1.body.success).toBe(true);
      expect(response1.body.record.name).toBe('Gaming Laptop');

      // Try to get tablet (featured electronics but different tenant) - should work if active
      const tabletItem = await Item.findOne({
        where: { external_id: 'tablet1' },
      });
      const response2 = await request(app).get(`/items/${tabletItem.id}`);
      expect(response2.status).toBe(200);
      expect(response2.body.success).toBe(true);
      expect(response2.body.record.name).toBe('Tablet Pro');

      // Try to get desk (active but not electronics/featured) - should return 404
      const deskItem = await Item.findOne({ where: { external_id: 'desk1' } });
      const response3 = await request(app).get(`/items/${deskItem.id}`);
      expect(response3.status).toBe(404);
    });
  });

  describe('create operation with scopes', () => {
    test('should apply scopes that add default values during create', async () => {
      // This test simulates a scope that might set default values
      // Note: In practice, scopes in create operations mainly affect validation/filtering of related data
      app.use(
        '/items',
        create(
          Item,
          {},
          {
            scopes: ['activeOnly'], // This doesn't directly affect creation but tests the pipeline
          }
        )
      );

      const response = await request(app).post('/items').send({
        external_id: 'test-create-scope',
        name: 'Test Item with Scope',
        category: 'test',
        status: 'active',
      });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.id).toBeDefined();
    });
  });

  describe('update operation with scopes', () => {
    test('should apply scopes to limit which items can be updated', async () => {
      app.use(
        '/items',
        update(
          Item,
          {},
          {
            scopes: ['activeOnly'],
          }
        )
      );

      // Try to update an inactive item - should return 404
      const inactiveItem = await Item.findOne({
        where: { status: 'inactive' },
      });
      const response1 = await request(app)
        .put(`/items/${inactiveItem.id}`)
        .send({ name: 'Updated Name' });
      expect(response1.status).toBe(404);

      // Try to update an active item - should succeed
      const activeItem = await Item.findOne({ where: { status: 'active' } });
      const response2 = await request(app).put(`/items/${activeItem.id}`).send({
        external_id: activeItem.external_id,
        name: 'Updated Active Item',
        category: activeItem.category,
        status: activeItem.status,
        tenant_id: activeItem.tenant_id,
        price: activeItem.price,
        is_featured: activeItem.is_featured,
      });
      expect(response2.status).toBe(200);
      expect(response2.body.success).toBe(true);
    });

    test('should apply multiple scopes for updates', async () => {
      app.use(
        '/items',
        update(
          Item,
          {},
          {
            scopes: [{ name: 'byTenant', args: [1] }, 'activeOnly'],
          }
        )
      );

      // Try to update an active item from tenant 2 - should return 404
      const tenant2Item = await Item.findOne({
        where: { tenant_id: 2, status: 'active' },
      });
      const response1 = await request(app)
        .put(`/items/${tenant2Item.id}`)
        .send({ name: 'Should Not Update' });
      expect(response1.status).toBe(404);

      // Try to update an active item from tenant 1 - should succeed
      const tenant1Item = await Item.findOne({
        where: { tenant_id: 1, status: 'active' },
      });
      const response2 = await request(app)
        .put(`/items/${tenant1Item.id}`)
        .send({
          external_id: tenant1Item.external_id,
          name: 'Updated Tenant 1 Item',
          category: tenant1Item.category,
          status: tenant1Item.status,
          tenant_id: tenant1Item.tenant_id,
          price: tenant1Item.price,
          is_featured: tenant1Item.is_featured,
        });
      expect(response2.status).toBe(200);
      expect(response2.body.success).toBe(true);
    });
  });

  describe('patch operation with scopes', () => {
    test('should apply scopes to limit which items can be patched', async () => {
      app.use(
        '/items',
        patch(
          Item,
          {},
          {
            scopes: ['featured'],
          }
        )
      );

      // Try to patch a non-featured item - should return 404
      const nonFeaturedItem = await Item.findOne({
        where: { is_featured: false },
      });
      const response1 = await request(app)
        .patch(`/items/${nonFeaturedItem.id}`)
        .send({ name: 'Should Not Patch' });
      expect(response1.status).toBe(404);

      // Try to patch a featured item - should succeed
      const featuredItem = await Item.findOne({ where: { is_featured: true } });
      const response2 = await request(app)
        .patch(`/items/${featuredItem.id}`)
        .send({ name: 'Patched Featured Item' });
      expect(response2.status).toBe(200);
      expect(response2.body.success).toBe(true);
    });
  });

  describe('destroy operation with scopes', () => {
    test('should apply scopes to limit which items can be deleted', async () => {
      app.use(
        '/items',
        destroy(
          Item,
          {},
          {
            scopes: ['activeOnly'],
          }
        )
      );

      // Try to delete an inactive item - should return 404
      const inactiveItem = await Item.findOne({
        where: { status: 'inactive' },
      });
      const response1 = await request(app).delete(`/items/${inactiveItem.id}`);
      expect(response1.status).toBe(404);

      // Create a new active item to delete
      const newItem = await Item.create({
        external_id: 'delete-test',
        name: 'Item to Delete',
        category: 'test',
        status: 'active',
        tenant_id: 1,
      });

      // Try to delete the active item - should succeed
      const response2 = await request(app).delete(`/items/${newItem.id}`);
      expect(response2.status).toBe(200);
      expect(response2.body.success).toBe(true);
    });
  });

  describe('search operation with scopes', () => {
    test('should apply scopes to search results', async () => {
      app.use(
        '/items',
        search(
          Item,
          {},
          {
            scopes: ['electronics'],
          }
        )
      );

      const response = await request(app)
        .post('/items/search')
        .send({
          search: {
            name: { like: '%' }, // Search for all items
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3); // Only electronics items
      expect(
        response.body.data.every((item) => item.category === 'electronics')
      ).toBe(true);
    });

    test('should combine scopes with search filters', async () => {
      app.use(
        '/items',
        search(
          Item,
          {},
          {
            scopes: ['activeOnly', 'featured'],
          }
        )
      );

      const response = await request(app)
        .post('/items/search')
        .send({
          search: {
            category: 'electronics',
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2); // Active, featured electronics items
      expect(
        response.body.data.every(
          (item) =>
            item.status === 'active' &&
            item.is_featured === true &&
            item.category === 'electronics'
        )
      ).toBe(true);
    });
  });

  describe('error handling', () => {
    test('should throw error for invalid scope names', async () => {
      app.use(
        '/items',
        list(
          Item,
          {},
          {
            scopes: ['nonExistentScope'],
          }
        )
      );

      const response = await request(app).get('/items');
      // Should return 500 error since invalid scope will throw
      expect(response.status).toBe(500);
    });

    test('should handle non-array scopes gracefully', async () => {
      app.use(
        '/items',
        list(
          Item,
          {},
          {
            scopes: 'activeOnly', // Should be an array
          }
        )
      );

      const response = await request(app).get('/items');
      expect(response.status).toBe(200);
      // Should return all items since scopes is not an array (at least 5, maybe more from previous tests)
      expect(response.body.data.length).toBeGreaterThanOrEqual(5);
    });

    test('should work when scopes is undefined', async () => {
      app.use(
        '/items',
        list(
          Item,
          {},
          {
            // No scopes property
            attributes: ['id', 'name'],
          }
        )
      );

      const response = await request(app).get('/items');
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBeGreaterThanOrEqual(5); // All items (at least 5)
    });
  });

  describe('interaction with pre/post hooks', () => {
    test('should apply scopes before pre hooks run', async () => {
      let preHookItemCount = 0;

      app.use(
        '/items',
        list(
          Item,
          {
            pre: async (context) => {
              // Count items available in pre hook - should already be scoped
              const result = await Item.findAndCountAll(
                context.req.apialize.options
              );
              preHookItemCount = result.count;
              return { preHookRan: true };
            },
          },
          {
            scopes: ['activeOnly'],
          }
        )
      );

      const response = await request(app).get('/items');
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // Should be active items (at least 4, maybe more from previous tests)
      expect(response.body.data.length).toBeGreaterThanOrEqual(4);
      expect(response.body.data.every((item) => item.status === 'active')).toBe(
        true
      );
      expect(preHookItemCount).toBe(response.body.data.length); // Pre hook should see the same scoped count
    });

    test('should allow pre hooks to modify scoped query further', async () => {
      app.use(
        '/items',
        list(
          Item,
          {
            pre: async (context) => {
              // Add additional filtering on top of scopes
              context.applyWhere({ tenant_id: 1 });
              return { preHookFiltered: true };
            },
          },
          {
            scopes: ['activeOnly'],
          }
        )
      );

      const response = await request(app).get('/items');
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3); // Active items in tenant 1
      expect(
        response.body.data.every(
          (item) => item.status === 'active' && item.tenant_id === 1
        )
      ).toBe(true);
    });
  });
});
