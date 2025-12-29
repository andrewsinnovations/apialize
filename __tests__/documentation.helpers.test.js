/**
 * Documentation Examples Test: context_helpers.md
 *
 * This test file validates that the code examples in documentation/context_helpers.md
 * work as expected and produce the documented outputs.
 */

const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes, Op } = require('sequelize');
const { list, search, single, create, update, patch, destroy } = require('../src');

describe('Documentation Examples: context_helpers.md', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  // Helper to build app with Item model
  async function buildItemApp(options = {}) {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    const Item = sequelize.define(
      'Item',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
        category: { type: DataTypes.STRING(50), allowNull: true },
        price: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
        status: { type: DataTypes.STRING(20), defaultValue: 'active' },
        tenant_id: { type: DataTypes.INTEGER, allowNull: true },
        owner_id: { type: DataTypes.INTEGER, allowNull: true },
        created_by: { type: DataTypes.INTEGER, allowNull: true },
        updated_by: { type: DataTypes.INTEGER, allowNull: true },
        approved: { type: DataTypes.BOOLEAN, defaultValue: false },
        priority: { type: DataTypes.INTEGER, defaultValue: 1 },
        deleted_at: { type: DataTypes.DATE, allowNull: true },
      },
      { tableName: 'doc_helpers_items', timestamps: false }
    );

    // Add scopes for testing
    if (options.addScopes !== false) {
      Item.addScope('byTenant', (tenantId) => ({
        where: { tenant_id: tenantId },
      }));

      Item.addScope('activeOnly', {
        where: { status: 'active' },
      });

      Item.addScope('expensive', {
        where: { price: { [Op.gte]: 1000 } },
      });
    }

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());

    return { Item, app };
  }

  // Helper to build app with User and related models
  async function buildUserWithRelationsApp() {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    const User = sequelize.define(
      'User',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
        role: { type: DataTypes.STRING(20), defaultValue: 'user' },
        permissions: { type: DataTypes.STRING(200), allowNull: true },
        is_admin: { type: DataTypes.BOOLEAN, defaultValue: false },
      },
      { tableName: 'doc_helpers_users', timestamps: false }
    );

    const UserProfile = sequelize.define(
      'UserProfile',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        user_id: { type: DataTypes.INTEGER, allowNull: false },
        theme: { type: DataTypes.STRING(50), defaultValue: 'default' },
      },
      { tableName: 'doc_helpers_profiles', timestamps: false }
    );

    const AuditLog = sequelize.define(
      'AuditLog',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        action: { type: DataTypes.STRING(50), allowNull: false },
        record_id: { type: DataTypes.INTEGER, allowNull: true },
      },
      { tableName: 'doc_helpers_audit', timestamps: false }
    );

    User.hasOne(UserProfile, { foreignKey: 'user_id', as: 'profile' });
    UserProfile.belongsTo(User, { foreignKey: 'user_id' });

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());

    return { User, UserProfile, AuditLog, app };
  }

  async function seedItems(Item, items = null) {
    const defaultItems = [
      { name: 'Laptop', category: 'electronics', price: 1200, status: 'active', tenant_id: 1 },
      { name: 'Phone', category: 'electronics', price: 800, status: 'active', tenant_id: 1 },
      { name: 'Book', category: 'books', price: 25, status: 'inactive', tenant_id: 1 },
      { name: 'Tablet', category: 'electronics', price: 500, status: 'active', tenant_id: 2 },
      { name: 'Desk', category: 'furniture', price: 300, status: 'active', tenant_id: 1 },
    ];
    await Item.bulkCreate(items || defaultItems);
  }

  describe('Query Helpers', () => {
    describe('apply_where', () => {
      test('simple equality filter', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        app.use(
          '/items',
          list(Item, {
            pre: async (context) => {
              context.apply_where({ status: 'active' });
            },
          })
        );

        const res = await request(app).get('/items');
        expect(res.status).toBe(200);
        expect(res.body.data.every((item) => item.status === 'active')).toBe(true);
        expect(res.body.data).toHaveLength(4);
      });

      test('multiple conditions in single call', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        app.use(
          '/items',
          list(Item, {
            pre: async (context) => {
              context.apply_where({ tenant_id: 1, category: 'electronics' });
            },
          })
        );

        const res = await request(app).get('/items');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(2);
        expect(res.body.data.every((item) => item.tenant_id === 1 && item.category === 'electronics')).toBe(true);
      });

      test('Sequelize operators', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        app.use(
          '/items',
          list(Item, {
            pre: async (context) => {
              context.apply_where({ price: { [Op.gte]: 100 } });
            },
          })
        );

        const res = await request(app).get('/items');
        expect(res.status).toBe(200);
        expect(res.body.data.every((item) => parseFloat(item.price) >= 100)).toBe(true);
      });

      test('merging behavior - multiple calls merge conditions', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        app.use(
          '/items',
          list(Item, {
            pre: async (context) => {
              context.apply_where({ tenant_id: 1 });
              context.apply_where({ status: 'active' });
              // Result: WHERE tenant_id = 1 AND status = 'active'
            },
          })
        );

        const res = await request(app).get('/items');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(3); // Laptop, Phone, Desk
        expect(res.body.data.every((item) => item.tenant_id === 1 && item.status === 'active')).toBe(true);
      });

      test('merging behavior - duplicate keys are overwritten', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        app.use(
          '/items',
          list(Item, {
            pre: async (context) => {
              context.apply_where({ tenant_id: 1 });
              context.apply_where({ status: 'active' });
              context.apply_where({ status: 'inactive' }); // Overwrites active
            },
          })
        );

        const res = await request(app).get('/items');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1); // Only Book
        expect(res.body.data[0].name).toBe('Book');
        expect(res.body.data[0].status).toBe('inactive');
      });
    });

    describe('apply_multiple_where', () => {
      test('applies multiple conditions from array', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        app.use(
          '/items',
          list(Item, {
            pre: async (context) => {
              context.apply_multiple_where([
                { tenant_id: 1 },
                { status: 'active' },
                { price: { [Op.gte]: 50 } },
              ]);
            },
          })
        );

        const res = await request(app).get('/items');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(3); // Laptop, Phone, Desk
        expect(
          res.body.data.every(
            (item) =>
              item.tenant_id === 1 &&
              item.status === 'active' &&
              parseFloat(item.price) >= 50
          )
        ).toBe(true);
      });
    });

    describe('apply_where_if_not_exists', () => {
      test('adds condition only if key does not exist', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        app.use(
          '/items',
          list(Item, {
            pre: async (context) => {
              context.apply_where({ tenant_id: 1 });
              // This will NOT be applied (tenant_id already exists)
              context.apply_where_if_not_exists({ tenant_id: 2 });
              // This WILL be applied (status doesn't exist)
              context.apply_where_if_not_exists({ status: 'active' });
            },
          })
        );

        const res = await request(app).get('/items');
        expect(res.status).toBe(200);
        // Should have tenant_id=1 (not 2) and status=active
        expect(res.body.data.every((item) => item.tenant_id === 1 && item.status === 'active')).toBe(true);
        expect(res.body.data).toHaveLength(3);
      });

      test('use case - default filters via middleware', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        // Middleware sets a default
        const defaultStatusMiddleware = (req, res, next) => {
          req.apialize.apply_where_if_not_exists({ status: 'active' });
          next();
        };

        app.use(
          '/items',
          list(Item, {
            middleware: [defaultStatusMiddleware],
            pre: async (context) => {
              // Override the default
              context.apply_where({ status: 'inactive' });
            },
          })
        );

        const res = await request(app).get('/items');
        expect(res.status).toBe(200);
        // Hook overrode the middleware default
        expect(res.body.data.every((item) => item.status === 'inactive')).toBe(true);
      });
    });

    describe('remove_where', () => {
      test('removes single key from where clause', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        app.use(
          '/items',
          list(Item, {
            pre: async (context) => {
              context.apply_where({
                tenant_id: 1,
                status: 'active',
                category: 'electronics',
              });
              context.remove_where('category');
            },
          })
        );

        const res = await request(app).get('/items');
        expect(res.status).toBe(200);
        // Category filter removed, so all active tenant_id=1 items
        expect(res.body.data).toHaveLength(3);
      });

      test('removes multiple keys from where clause', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        app.use(
          '/items',
          list(Item, {
            pre: async (context) => {
              context.apply_where({
                tenant_id: 1,
                status: 'active',
                category: 'electronics',
              });
              context.remove_where(['tenant_id', 'status']);
            },
          })
        );

        const res = await request(app).get('/items');
        expect(res.status).toBe(200);
        // Only category filter remains
        expect(res.body.data.every((item) => item.category === 'electronics')).toBe(true);
      });
    });

    describe('replace_where', () => {
      test('completely replaces where clause', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        app.use(
          '/items',
          list(Item, {
            pre: async (context) => {
              context.apply_where({ tenant_id: 1, status: 'active' });
              context.replace_where({ category: 'books' });
            },
          })
        );

        const res = await request(app).get('/items');
        expect(res.status).toBe(200);
        // Previous conditions removed, only category='books'
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].category).toBe('books');
      });

      test('clears all conditions with empty object', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        app.use(
          '/items',
          list(Item, {
            pre: async (context) => {
              context.apply_where({ tenant_id: 1, status: 'active' });
              context.replace_where({});
            },
          })
        );

        const res = await request(app).get('/items');
        expect(res.status).toBe(200);
        // No filters, all items returned
        expect(res.body.data).toHaveLength(5);
      });
    });
  });

  describe('Scope Helpers', () => {
    describe('apply_scope', () => {
      test('applies simple scope without arguments', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        app.use(
          '/items',
          list(Item, {
            pre: async (context) => {
              context.apply_scope('activeOnly');
            },
          })
        );

        const res = await request(app).get('/items');
        expect(res.status).toBe(200);
        expect(res.body.data.every((item) => item.status === 'active')).toBe(true);
      });

      test('applies parameterized scope', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        // Simulate user middleware
        app.use((req, res, next) => {
          req.user = { tenantId: 1 };
          next();
        });

        app.use(
          '/items',
          list(Item, {
            pre: async (context) => {
              context.apply_scope('byTenant', context.req.user.tenantId);
            },
          })
        );

        const res = await request(app).get('/items');
        expect(res.status).toBe(200);
        expect(res.body.data.every((item) => item.tenant_id === 1)).toBe(true);
      });

      test('applies multiple scopes', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        app.use((req, res, next) => {
          req.user = { tenantId: 1 };
          next();
        });

        app.use(
          '/items',
          list(Item, {
            pre: async (context) => {
              context.apply_scope('activeOnly');
              context.apply_scope('byTenant', context.req.user.tenantId);
            },
          })
        );

        const res = await request(app).get('/items');
        expect(res.status).toBe(200);
        expect(
          res.body.data.every(
            (item) => item.status === 'active' && item.tenant_id === 1
          )
        ).toBe(true);
      });
    });

    describe('apply_scopes', () => {
      test('applies multiple scopes with mixed syntax', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        app.use((req, res, next) => {
          req.user = { tenantId: 1 };
          next();
        });

        app.use(
          '/items',
          list(Item, {
            pre: async (context) => {
              context.apply_scopes([
                // String scope
                'activeOnly',

                // Parameterized scope with object syntax
                { name: 'byTenant', args: [context.req.user.tenantId] },

                // Another string scope
                'expensive',
              ]);
            },
          })
        );

        const res = await request(app).get('/items');
        expect(res.status).toBe(200);
        // Only Laptop matches: active, tenant_id=1, price >= 1000
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].name).toBe('Laptop');
        expect(
          res.body.data.every(
            (item) =>
              item.status === 'active' &&
              item.tenant_id === 1 &&
              parseFloat(item.price) >= 1000
          )
        ).toBe(true);
      });
    });
  });

  describe('Body Helpers', () => {
    describe('set_value', () => {
      test('auto-populate fields', async () => {
        const { Item, app } = await buildItemApp();

        app.use((req, res, next) => {
          req.user = { id: 42, tenantId: 1 };
          next();
        });

        app.use(
          '/items',
          create(Item, {
            pre: async (context) => {
              context.set_value('created_by', context.req.user.id);
              context.set_value('status', 'pending');
              context.set_value('tenant_id', context.req.user.tenantId);
            },
          })
        );

        const res = await request(app)
          .post('/items')
          .send({ name: 'New Item', price: 100 });

        expect(res.status).toBe(201);
        const item = await Item.findByPk(res.body.id);
        expect(item.created_by).toBe(42);
        expect(item.status).toBe('pending');
        expect(item.tenant_id).toBe(1);
      });

      test('overriding user input', async () => {
        const { Item, app } = await buildItemApp();

        app.use(
          '/items',
          create(Item, {
            pre: async (context) => {
              context.set_value('status', 'pending');
              context.set_value('approved', false);
            },
          })
        );

        const res = await request(app).post('/items').send({
          name: 'New Item',
          status: 'approved', // User tries to set approved
          approved: true, // User tries to set approved
        });

        expect(res.status).toBe(201);
        const item = await Item.findByPk(res.body.id);
        expect(item.status).toBe('pending'); // Forced to pending
        expect(item.approved).toBe(false); // Forced to false
      });
    });

    describe('set_multiple_values', () => {
      test('with object syntax', async () => {
        const { Item, app } = await buildItemApp();

        app.use((req, res, next) => {
          req.user = { id: 42, tenantId: 1 };
          next();
        });

        app.use(
          '/items',
          create(Item, {
            pre: async (context) => {
              context.set_multiple_values({
                tenant_id: context.req.user.tenantId,
                created_by: context.req.user.id,
                status: 'active',
                priority: 1,
              });
            },
          })
        );

        const res = await request(app)
          .post('/items')
          .send({ name: 'New Item', price: 100 });

        expect(res.status).toBe(201);
        const item = await Item.findByPk(res.body.id);
        expect(item.tenant_id).toBe(1);
        expect(item.created_by).toBe(42);
        expect(item.status).toBe('active');
        expect(item.priority).toBe(1);
      });

      test('with array syntax', async () => {
        const { Item, app } = await buildItemApp();

        app.use((req, res, next) => {
          req.user = { id: 42, tenantId: 1 };
          next();
        });

        app.use(
          '/items',
          create(Item, {
            pre: async (context) => {
              const defaults = [
                ['tenant_id', context.req.user.tenantId],
                ['created_by', context.req.user.id],
                ['status', 'active'],
              ];
              context.set_multiple_values(defaults);
            },
          })
        );

        const res = await request(app)
          .post('/items')
          .send({ name: 'New Item', price: 100 });

        expect(res.status).toBe(201);
        const item = await Item.findByPk(res.body.id);
        expect(item.tenant_id).toBe(1);
        expect(item.created_by).toBe(42);
        expect(item.status).toBe('active');
      });
    });

    describe('remove_value', () => {
      test('remove single sensitive field', async () => {
        const { Item, app } = await buildItemApp();

        app.use(
          '/items',
          create(Item, {
            pre: async (context) => {
              context.remove_value('tenant_id');
            },
          })
        );

        const res = await request(app).post('/items').send({
          name: 'New Item',
          tenant_id: 999, // User tries to set tenant_id
        });

        expect(res.status).toBe(201);
        const item = await Item.findByPk(res.body.id);
        expect(item.tenant_id).toBeNull();
      });

      test('remove multiple fields', async () => {
        const { Item, app } = await buildItemApp();

        app.use(
          '/items',
          create(Item, {
            pre: async (context) => {
              context.remove_value(['tenant_id', 'created_by', 'approved']);
            },
          })
        );

        const res = await request(app).post('/items').send({
          name: 'New Item',
          tenant_id: 999,
          created_by: 999,
          approved: true,
        });

        expect(res.status).toBe(201);
        const item = await Item.findByPk(res.body.id);
        expect(item.tenant_id).toBeNull();
        expect(item.created_by).toBeNull();
        expect(item.approved).toBe(false); // default
      });

      test('use case - sanitizing user input', async () => {
        const { User, app } = await buildUserWithRelationsApp();

        app.use(
          '/users',
          create(User, {
            pre: async (context) => {
              context.remove_value(['role', 'permissions', 'is_admin']);
            },
          })
        );

        const res = await request(app).post('/users').send({
          name: 'New User',
          role: 'admin', // Should be removed
          permissions: 'all', // Should be removed
          is_admin: true, // Should be removed
        });

        expect(res.status).toBe(201);
        const user = await User.findByPk(res.body.id);
        expect(user.role).toBe('user'); // default
        expect(user.permissions).toBeNull();
        expect(user.is_admin).toBe(false); // default
      });
    });

    describe('replace_body', () => {
      test('construct body from scratch', async () => {
        const { Item, app } = await buildItemApp();

        app.use((req, res, next) => {
          req.user = { id: 42, tenantId: 1 };
          next();
        });

        app.use(
          '/items',
          create(Item, {
            pre: async (context) => {
              context.replace_body({
                name: context.req.body.name, // Only keep name from user
                tenant_id: context.req.user.tenantId,
                created_by: context.req.user.id,
                status: 'pending',
              });
            },
          })
        );

        const res = await request(app).post('/items').send({
          name: 'New Item',
          price: 999999, // Should be ignored
          status: 'approved', // Should be ignored
        });

        expect(res.status).toBe(201);
        const item = await Item.findByPk(res.body.id);
        expect(item.name).toBe('New Item');
        expect(item.price).toBeNull(); // Not in replaced body
        expect(item.status).toBe('pending');
        expect(item.tenant_id).toBe(1);
      });

      test('use case - whitelist approach', async () => {
        const { Item, app } = await buildItemApp();

        app.use((req, res, next) => {
          req.user = { tenantId: 1 };
          next();
        });

        app.use(
          '/items',
          create(Item, {
            pre: async (context) => {
              const userInput = context.req.body;
              // Only allow specific fields
              context.replace_body({
                name: userInput.name,
                category: userInput.category,
                price: userInput.price,
              });
              // Then add system fields
              context.set_value('tenant_id', context.req.user.tenantId);
            },
          })
        );

        const res = await request(app).post('/items').send({
          name: 'New Item',
          category: 'electronics',
          price: 100,
          status: 'approved', // Not whitelisted
          approved: true, // Not whitelisted
        });

        expect(res.status).toBe(201);
        const item = await Item.findByPk(res.body.id);
        expect(item.name).toBe('New Item');
        expect(item.category).toBe('electronics');
        expect(item.price).toBe(100);
        expect(item.tenant_id).toBe(1);
        expect(item.status).toBe('active'); // default
        expect(item.approved).toBe(false); // default
      });
    });
  });

  describe('Operation Control', () => {
    describe('cancel_operation', () => {
      test('validates input and returns error', async () => {
        const { Item, app } = await buildItemApp();

        app.use(
          '/items',
          create(Item, {
            pre: async (context) => {
              if (context.req.body.price < 0) {
                context.cancel_operation(400, {
                  success: false,
                  error: 'Price cannot be negative',
                });
                return;
              }
            },
          })
        );

        const res = await request(app)
          .post('/items')
          .send({ name: 'Bad Item', price: -10 });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Price cannot be negative');

        // Verify item was not created
        const count = await Item.count();
        expect(count).toBe(0);
      });

      test('checks business rules', async () => {
        const { Item, app } = await buildItemApp();
        // Create 3 items in 'electronics' category
        await Item.bulkCreate([
          { name: 'Item 1', category: 'electronics' },
          { name: 'Item 2', category: 'electronics' },
          { name: 'Item 3', category: 'electronics' },
        ]);

        app.use(
          '/items',
          create(Item, {
            pre: async (context) => {
              const count = await Item.count({
                where: { category: context.req.body.category },
              });
              if (count >= 3) {
                context.cancel_operation(422, {
                  success: false,
                  error: 'Category limit reached',
                });
                return;
              }
            },
          })
        );

        const res = await request(app)
          .post('/items')
          .send({ name: 'New Electronics', category: 'electronics' });

        expect(res.status).toBe(422);
        expect(res.body.error).toBe('Category limit reached');
      });

      test('transaction rollback in post hook', async () => {
        const { Item, app } = await buildItemApp();

        app.use(
          '/items',
          create(Item, {
            post: async (context) => {
              // Simulate payment failure after item creation
              context.cancel_operation(402, {
                success: false,
                error: 'Payment failed',
              });
              return;
            },
          })
        );

        const res = await request(app)
          .post('/items')
          .send({ name: 'Order Item', price: 100 });

        expect(res.status).toBe(402);
        expect(res.body.error).toBe('Payment failed');

        // Item should be rolled back
        const count = await Item.count();
        expect(count).toBe(0);
      });

      test('default status code is 400', async () => {
        const { Item, app } = await buildItemApp();

        app.use(
          '/items',
          create(Item, {
            pre: async (context) => {
              context.cancel_operation(undefined, {
                success: false,
                error: 'Validation error',
              });
              return;
            },
          })
        );

        const res = await request(app)
          .post('/items')
          .send({ name: 'Item' });

        expect(res.status).toBe(400);
      });
    });
  });

  describe('Additional Properties', () => {
    describe('models', () => {
      test('access other models via context.models', async () => {
        const { User, UserProfile, AuditLog, app } = await buildUserWithRelationsApp();

        app.use(
          '/users',
          create(User, {
            post: async (context) => {
              await context.models.UserProfile.create(
                {
                  user_id: context.created.id,
                  theme: 'default',
                },
                { transaction: context.transaction }
              );

              await context.models.AuditLog.create(
                {
                  action: 'user_created',
                  record_id: context.created.id,
                },
                { transaction: context.transaction }
              );
            },
          })
        );

        const res = await request(app).post('/users').send({ name: 'New User' });

        expect(res.status).toBe(201);

        const profile = await UserProfile.findOne({
          where: { user_id: res.body.id },
        });
        expect(profile).not.toBeNull();
        expect(profile.theme).toBe('default');

        const log = await AuditLog.findOne({
          where: { record_id: res.body.id },
        });
        expect(log).not.toBeNull();
        expect(log.action).toBe('user_created');
      });
    });
  });

  describe('Helper Availability by Operation', () => {
    test('body helpers work in update operation', async () => {
      const { Item, app } = await buildItemApp();
      const item = await Item.create({ name: 'Original', status: 'active' });

      app.use((req, res, next) => {
        req.user = { id: 99 };
        next();
      });

      app.use(
        '/items',
        update(Item, {
          pre: async (context) => {
            context.set_value('updated_by', context.req.user.id);
          },
        })
      );

      const res = await request(app)
        .put(`/items/${item.id}`)
        .send({ name: 'Updated' });

      expect(res.status).toBe(200);
      await item.reload();
      expect(item.updated_by).toBe(99);
    });

    test('body helpers work in patch operation', async () => {
      const { Item, app } = await buildItemApp();
      const item = await Item.create({ name: 'Original', status: 'active' });

      app.use((req, res, next) => {
        req.user = { id: 88 };
        next();
      });

      app.use(
        '/items',
        patch(Item, {
          pre: async (context) => {
            context.set_value('updated_by', context.req.user.id);
          },
        })
      );

      const res = await request(app)
        .patch(`/items/${item.id}`)
        .send({ name: 'Patched' });

      expect(res.status).toBe(200);
      await item.reload();
      expect(item.updated_by).toBe(88);
    });

    test('query helpers work in single operation', async () => {
      const { Item, app } = await buildItemApp();
      await Item.create({ name: 'Item 1', tenant_id: 1 });
      await Item.create({ name: 'Item 2', tenant_id: 2 });

      app.use((req, res, next) => {
        req.user = { tenantId: 2 };
        next();
      });

      app.use(
        '/items',
        single(Item, {
          pre: async (context) => {
            context.apply_where({ tenant_id: context.req.user.tenantId });
          },
        })
      );

      // Try to access item 1 (tenant_id=1), should get 404
      const res1 = await request(app).get('/items/1');
      expect(res1.status).toBe(404);

      // Access item 2 (tenant_id=2), should work
      const res2 = await request(app).get('/items/2');
      expect(res2.status).toBe(200);
      expect(res2.body.record.name).toBe('Item 2');
    });

    test('query helpers work in destroy operation', async () => {
      const { Item, app } = await buildItemApp();
      const item1 = await Item.create({ name: 'Item 1', tenant_id: 1 });
      const item2 = await Item.create({ name: 'Item 2', tenant_id: 2 });

      app.use((req, res, next) => {
        req.user = { tenantId: 1 };
        next();
      });

      app.use(
        '/items',
        destroy(Item, {
          pre: async (context) => {
            context.apply_where({ tenant_id: context.req.user.tenantId });
          },
        })
      );

      // Try to delete item 2 (tenant_id=2), should get 404
      const res1 = await request(app).delete(`/items/${item2.id}`);
      expect(res1.status).toBe(404);

      // Delete item 1 (tenant_id=1), should work
      const res2 = await request(app).delete(`/items/${item1.id}`);
      expect(res2.status).toBe(200);
    });

    test('cancel_operation works in search operation', async () => {
      const { Item, app } = await buildItemApp();
      await seedItems(Item);

      app.use(
        '/items',
        search(Item, {
          pre: async (context) => {
            context.cancel_operation(403, {
              success: false,
              error: 'Search disabled',
            });
            return;
          },
        })
      );

      const res = await request(app).post('/items/search').send({});

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Search disabled');
    });
  });

  describe('Common Patterns', () => {
    describe('Multi-Tenant Filtering', () => {
      test('enforces tenant isolation', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        app.use((req, res, next) => {
          req.user = { tenantId: 1 };
          next();
        });

        app.use(
          '/items',
          list(Item, {
            pre: async (context) => {
              context.apply_where({ tenant_id: context.req.user.tenantId });
            },
          })
        );

        const res = await request(app).get('/items');
        expect(res.status).toBe(200);
        expect(res.body.data.every((item) => item.tenant_id === 1)).toBe(true);
      });
    });

    describe('Audit Trail', () => {
      test('creates audit fields on create', async () => {
        const { Item, app } = await buildItemApp();

        app.use((req, res, next) => {
          req.user = { id: 42 };
          next();
        });

        app.use(
          '/items',
          create(Item, {
            pre: async (context) => {
              context.set_multiple_values({
                created_by: context.req.user.id,
              });
            },
          })
        );

        const res = await request(app)
          .post('/items')
          .send({ name: 'Audited Item' });

        expect(res.status).toBe(201);
        const item = await Item.findByPk(res.body.id);
        expect(item.created_by).toBe(42);
      });

      test('updates audit fields on patch', async () => {
        const { Item, app } = await buildItemApp();
        const item = await Item.create({ name: 'Original', created_by: 1 });

        app.use((req, res, next) => {
          req.user = { id: 99 };
          next();
        });

        app.use(
          '/items',
          patch(Item, {
            pre: async (context) => {
              context.set_multiple_values({
                updated_by: context.req.user.id,
              });
            },
          })
        );

        const res = await request(app)
          .patch(`/items/${item.id}`)
          .send({ name: 'Updated' });

        expect(res.status).toBe(200);
        await item.reload();
        expect(item.updated_by).toBe(99);
      });
    });

    describe('Soft Delete Filtering', () => {
      test('defaults to showing only non-deleted items', async () => {
        const { Item, app } = await buildItemApp();
        await Item.create({ name: 'Active Item', deleted_at: null });
        await Item.create({ name: 'Deleted Item', deleted_at: new Date() });

        app.use(
          '/items',
          list(Item, {
            pre: async (context) => {
              context.apply_where_if_not_exists({ deleted_at: null });
            },
          })
        );

        const res = await request(app).get('/items');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].name).toBe('Active Item');
      });
    });

    describe('Input Sanitization', () => {
      test('removes fields and forces values', async () => {
        const { Item, app } = await buildItemApp();

        app.use(
          '/items',
          create(Item, {
            pre: async (context) => {
              context.remove_value(['tenant_id', 'created_by']);
              context.set_value('status', 'pending');
            },
          })
        );

        const res = await request(app).post('/items').send({
          name: 'Sanitized Item',
          tenant_id: 999, // Should be removed
          created_by: 999, // Should be removed
          status: 'approved', // Should be overwritten
        });

        expect(res.status).toBe(201);
        const item = await Item.findByPk(res.body.id);
        expect(item.tenant_id).toBeNull();
        expect(item.created_by).toBeNull();
        expect(item.status).toBe('pending');
      });
    });

    describe('Conditional Logic Based on User Role', () => {
      test('admins see everything', async () => {
        const { Item, app } = await buildItemApp();
        await Item.create({ name: 'Item 1', owner_id: 1 });
        await Item.create({ name: 'Item 2', owner_id: 2 });
        await Item.create({ name: 'Item 3', owner_id: 3 });

        app.use((req, res, next) => {
          req.user = { id: 1, role: 'admin' };
          next();
        });

        app.use(
          '/items',
          list(Item, {
            pre: async (context) => {
              if (context.req.user.role === 'admin') {
                return; // Admins see everything
              }
              context.apply_where({ owner_id: context.req.user.id });
            },
          })
        );

        const res = await request(app).get('/items');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(3);
      });

      test('regular users only see their own items', async () => {
        const { Item, app } = await buildItemApp();
        await Item.create({ name: 'Item 1', owner_id: 1 });
        await Item.create({ name: 'Item 2', owner_id: 2 });
        await Item.create({ name: 'Item 3', owner_id: 1 });

        app.use((req, res, next) => {
          req.user = { id: 1, role: 'user' };
          next();
        });

        app.use(
          '/items',
          list(Item, {
            pre: async (context) => {
              if (context.req.user.role === 'admin') {
                return;
              }
              context.apply_where({ owner_id: context.req.user.id });
            },
          })
        );

        const res = await request(app).get('/items');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(2);
        expect(res.body.data.every((item) => item.owner_id === 1)).toBe(true);
      });
    });
  });
});
