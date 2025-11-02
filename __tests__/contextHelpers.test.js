const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const { Sequelize, DataTypes, Op } = require('sequelize');
const { list, create } = require('../src');

describe('req.apialize Helper Functions', () => {
  let sequelize;
  let Item;
  let app;

  beforeAll(async () => {
    sequelize = new Sequelize('sqlite::memory:', {
      logging: false,
    });

    // Define a simple model
    Item = sequelize.define('Item', {
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
    }, {
      tableName: 'context_helper_items',
      timestamps: false,
    });

    // Add a scope for testing
    Item.addScope('byTenant', (tenantId) => ({
      where: { tenant_id: tenantId }
    }));

    Item.addScope('activeOnly', {
      where: { status: 'active' }
    });

    await sequelize.sync({ force: true });

    // Seed test data
    await Item.bulkCreate([
      { external_id: 'item1', name: 'Laptop', category: 'electronics', status: 'active', tenant_id: 1, price: 999.99 },
      { external_id: 'item2', name: 'Book', category: 'books', status: 'inactive', tenant_id: 1, price: 15.99 },
      { external_id: 'item3', name: 'Phone', category: 'electronics', status: 'active', tenant_id: 2, price: 699.99 },
      { external_id: 'item4', name: 'Desk', category: 'furniture', status: 'active', tenant_id: 1, price: 299.99 },
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

  test('req.apialize.applyWhere should add where conditions', async () => {
    app.use('/items', list(Item, {
      pre: async (context) => {
        // Apply tenant filtering using req.apialize helper
        context.req.apialize.applyWhere({ tenant_id: 1 });
        return { tenantFiltered: true };
      }
    }));

    const response = await request(app).get('/items');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(3); // Only tenant 1 items
    expect(response.body.data.every(item => item.tenant_id === 1)).toBe(true);
  });

  test('req.apialize.applyWhere should merge multiple conditions', async () => {
    app.use('/items', list(Item, {
      pre: async (context) => {
        // Apply multiple conditions
        context.req.apialize.applyWhere({ tenant_id: 1 });
        context.req.apialize.applyWhere({ status: 'active' });
        context.req.apialize.applyWhere({ price: { [Op.gt]: 100 } });
        return { multipleFiltersApplied: true };
      }
    }));

    const response = await request(app).get('/items');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(2); // Laptop and Desk (active, tenant 1, price > 100)
    expect(response.body.data.map(item => item.name).sort()).toEqual(['Desk', 'Laptop']);
  });

  test('req.apialize.applyScope should apply Sequelize scopes', async () => {
    app.use('/items', list(Item, {
      pre: async (context) => {
        // Apply scopes using req.apialize helper
        context.req.apialize.applyScope('byTenant', 1);
        context.req.apialize.applyScope('activeOnly');
        return { scopesApplied: true };
      }
    }));

    const response = await request(app).get('/items');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(2); // Active items in tenant 1
    expect(response.body.data.every(item => item.tenant_id === 1 && item.status === 'active')).toBe(true);
  });

  test('req.apialize.applyWhereIfNotExists should only add non-existing conditions', async () => {
    app.use('/items', list(Item, {
      pre: async (context) => {
        // First add a condition
        context.req.apialize.applyWhere({ tenant_id: 1 });
        
        // Try to add the same condition - should not override
        context.req.apialize.applyWhereIfNotExists({ tenant_id: 2 });
        
        // Add a new condition - should work
        context.req.apialize.applyWhereIfNotExists({ status: 'active' });
        
        return { conditionalApplied: true };
      }
    }));

    const response = await request(app).get('/items');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(2); // tenant_id stays 1, status added as active
    expect(response.body.data.every(item => item.tenant_id === 1 && item.status === 'active')).toBe(true);
  });

  test('req.apialize.removeWhere should remove specified conditions', async () => {
    app.use('/items', list(Item, {
      pre: async (context) => {
        // Add some conditions
        context.req.apialize.applyWhere({ 
          tenant_id: 1,
          status: 'active',
          category: 'electronics'
        });
        
        // Remove one condition
        context.req.apialize.removeWhere('category');
        
        return { conditionRemoved: true };
      }
    }));

    const response = await request(app).get('/items');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(2); // Laptop and Desk (active, tenant 1, no category filter)
    expect(response.body.data.map(item => item.name).sort()).toEqual(['Desk', 'Laptop']);
  });

  test('req.apialize.replaceWhere should replace entire where clause', async () => {
    app.use('/items', list(Item, {
      pre: async (context) => {
        // Start with some conditions
        context.req.apialize.applyWhere({ 
          tenant_id: 1,
          status: 'active'
        });
        
        // Replace entire where clause
        context.req.apialize.replaceWhere({ 
          category: 'electronics'
        });
        
        return { whereReplaced: true };
      }
    }));

    const response = await request(app).get('/items');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(2); // Only electronics items (both tenants)
    expect(response.body.data.every(item => item.category === 'electronics')).toBe(true);
  });

  test('req.apialize.applyMultipleWhere should apply array of conditions', async () => {
    app.use('/items', list(Item, {
      pre: async (context) => {
        // Apply multiple conditions at once
        context.req.apialize.applyMultipleWhere([
          { tenant_id: 1 },
          { status: 'active' },
          { price: { [Op.gte]: 200 } }
        ]);
        
        return { multipleApplied: true };
      }
    }));

    const response = await request(app).get('/items');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(2); // Laptop and Desk
    expect(response.body.data.map(item => item.name).sort()).toEqual(['Desk', 'Laptop']);
  });

  test('req.apialize.applyWhere should overwrite existing conditions', async () => {
    app.use('/items', list(Item, {
      pre: async (context) => {
        // Apply initial condition
        context.req.apialize.applyWhere({ tenant_id: 1 });
        
        // Apply conflicting condition - should overwrite
        context.req.apialize.applyWhere({ tenant_id: 2 });
        
        return { overwriteTest: true };
      }
    }));

    const response = await request(app).get('/items');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1); // Only tenant 2 item (Phone)
    expect(response.body.data[0].tenant_id).toBe(2);
    expect(response.body.data[0].name).toBe('Phone');
  });

  test('req.apialize.applyWhere should handle sequential condition changes', async () => {
    app.use('/items', list(Item, {
      pre: async (context) => {
        // Apply multiple conditions in sequence
        context.req.apialize.applyWhere({ tenant_id: 1 });
        context.req.apialize.applyWhere({ status: 'active' });
        context.req.apialize.applyWhere({ status: 'inactive' }); // Should overwrite active
        
        return { sequentialTest: true };
      }
    }));

    const response = await request(app).get('/items');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1); // Only inactive item in tenant 1 (Book)
    expect(response.body.data[0].name).toBe('Book');
    expect(response.body.data[0].status).toBe('inactive');
    expect(response.body.data[0].tenant_id).toBe(1);
  });

  test('helper functions should work in middleware', async () => {
    // Custom middleware that uses req.apialize helpers
    const tenantMiddleware = (req, res, next) => {
      // This should work because apializeContext is automatically run by list()
      if (req.user && req.user.tenantId) {
        req.apialize.applyWhere({ tenant_id: req.user.tenantId });
      }
      next();
    };

    // Mock user object for this test
    const userMiddleware = (req, res, next) => {
      req.user = { tenantId: 1 };
      next();
    };

    // apializeContext is automatically included by the list operation
    app.use('/items', list(Item, {
      middleware: [userMiddleware, tenantMiddleware]
    }));

    const response = await request(app).get('/items');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(3); // Only tenant 1 items
    expect(response.body.data.every(item => item.tenant_id === 1)).toBe(true);
  });

  test('helper functions should work in create operations', async () => {
    app.use('/items', create(Item, {
      pre: async (context) => {
        // Auto-inject tenant ID for creates using helper
        if (!context.req.apialize.values) {
          context.req.apialize.values = {};
        }
        context.req.apialize.values.tenant_id = 1;
        context.req.apialize.values.status = 'active';
        
        return { autoFieldsInjected: true };
      }
    }));

    const response = await request(app)
      .post('/items')
      .send({ 
        external_id: 'test-create',
        name: 'Test Item',
        category: 'test'
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    
    // Verify the item was created with auto-injected fields
    const created = await Item.findOne({ where: { external_id: 'test-create' } });
    expect(created.tenant_id).toBe(1);
    expect(created.status).toBe('active');
  });

  test('helper functions should be available directly on context object', async () => {
    let contextHelperCheck = null;

    app.use('/items', list(Item, {
      pre: async (context) => {
        // Test that helper functions are available directly on context
        contextHelperCheck = {
          hasApplyWhere: typeof context.applyWhere === 'function',
          hasApplyScope: typeof context.applyScope === 'function',
          hasApplyMultipleWhere: typeof context.applyMultipleWhere === 'function',
          hasRemoveWhere: typeof context.removeWhere === 'function',
          hasReplaceWhere: typeof context.replaceWhere === 'function'
        };
        
        // Just filter to return something simple
        context.applyWhere({ tenant_id: 1 });
        
        return { contextCheck: true };
      }
    }));

    const response = await request(app).get('/items');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    
    // Verify the helper functions were available on context
    expect(contextHelperCheck).not.toBeNull();
    expect(contextHelperCheck.hasApplyWhere).toBe(true);
    expect(contextHelperCheck.hasApplyScope).toBe(true);
    expect(contextHelperCheck.hasApplyMultipleWhere).toBe(true);
    expect(contextHelperCheck.hasRemoveWhere).toBe(true);
    expect(contextHelperCheck.hasReplaceWhere).toBe(true);
  });


});