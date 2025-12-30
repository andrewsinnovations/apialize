/**
 * Documentation Examples Test: hooks.md
 *
 * This test file validates that the code examples in documentation/hooks.md
 * work as expected and produce the documented outputs.
 */

const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list, search, single, create, update, patch, destroy } = require('../src');

describe('Documentation Examples: hooks.md', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  // Helper to build app with Item model
  async function buildItemApp() {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    const Item = sequelize.define(
      'Item',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
        category: { type: DataTypes.STRING(50), allowNull: true },
        price: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
        status: { type: DataTypes.STRING(20), defaultValue: 'active' },
        created_by: { type: DataTypes.INTEGER, allowNull: true },
      },
      { tableName: 'doc_hooks_items', timestamps: false }
    );

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
        email: { type: DataTypes.STRING(100), allowNull: true },
      },
      { tableName: 'doc_hooks_users', timestamps: false }
    );

    const UserProfile = sequelize.define(
      'UserProfile',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        user_id: { type: DataTypes.INTEGER, allowNull: false },
        theme: { type: DataTypes.STRING(50), defaultValue: 'default' },
      },
      { tableName: 'doc_hooks_profiles', timestamps: false }
    );

    const Post = sequelize.define(
      'Post',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        user_id: { type: DataTypes.INTEGER, allowNull: false },
        title: { type: DataTypes.STRING(200), allowNull: false },
      },
      { tableName: 'doc_hooks_posts', timestamps: false }
    );

    User.hasOne(UserProfile, { foreignKey: 'user_id', as: 'profile' });
    UserProfile.belongsTo(User, { foreignKey: 'user_id' });
    User.hasMany(Post, { foreignKey: 'user_id', as: 'posts' });
    Post.belongsTo(User, { foreignKey: 'user_id' });

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());

    return { User, UserProfile, Post, app };
  }

  // Helper to build app with AuditLog for audit trail testing
  async function buildItemWithAuditApp() {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    const Item = sequelize.define(
      'Item',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
        category: { type: DataTypes.STRING(50), allowNull: true },
      },
      { tableName: 'doc_hooks_audit_items', timestamps: false }
    );

    const AuditLog = sequelize.define(
      'AuditLog',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        action: { type: DataTypes.STRING(50), allowNull: false },
        model: { type: DataTypes.STRING(50), allowNull: false },
        recordId: { type: DataTypes.INTEGER, allowNull: true },
        userId: { type: DataTypes.INTEGER, allowNull: true },
        timestamp: { type: DataTypes.DATE, allowNull: false },
      },
      { tableName: 'doc_hooks_audit_logs', timestamps: false }
    );

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());

    return { Item, AuditLog, app };
  }

  async function seedItems(Item) {
    await Item.bulkCreate([
      { name: 'Laptop', category: 'electronics', price: 999.99 },
      { name: 'Phone', category: 'electronics', price: 699.99 },
      { name: 'Book', category: 'books', price: 19.99 },
    ]);
  }

  describe('Hook Types', () => {
    describe('Pre Hooks', () => {
      // Documentation: Pre hooks run before the main database operation
      test('pre hook runs before database operation', async () => {
        const { Item, app } = await buildItemApp();

        let preHookRan = false;
        let preHookBody = null;

        app.use(
          '/items',
          create(Item, {
            pre: async (context) => {
              preHookRan = true;
              preHookBody = context.req.body;
              return { startTime: Date.now() };
            },
          })
        );

        const res = await request(app)
          .post('/items')
          .send({ name: 'Test Item', category: 'test' });

        expect(res.status).toBe(201);
        expect(preHookRan).toBe(true);
        expect(preHookBody).toEqual({ name: 'Test Item', category: 'test' });
      });
    });

    describe('Post Hooks', () => {
      // Documentation: Post hooks run after the main database operation
      test('post hook runs after database operation and can access created record', async () => {
        const { Item, app } = await buildItemApp();

        let postHookRan = false;
        let createdRecord = null;

        app.use(
          '/items',
          create(Item, {
            post: async (context) => {
              postHookRan = true;
              createdRecord = context.created;
              context.payload.customField = 'added in post hook';
            },
          })
        );

        const res = await request(app)
          .post('/items')
          .send({ name: 'Test Item', category: 'test' });

        expect(res.status).toBe(201);
        expect(postHookRan).toBe(true);
        expect(createdRecord).toBeDefined();
        expect(createdRecord.name).toBe('Test Item');
        expect(res.body.customField).toBe('added in post hook');
      });
    });
  });

  describe('Context Object', () => {
    describe('Common Properties', () => {
      test('context.model is the Sequelize model', async () => {
        const { Item, app } = await buildItemApp();

        let capturedModel = null;

        app.use(
          '/items',
          create(Item, {
            pre: async (context) => {
              capturedModel = context.model;
            },
          })
        );

        await request(app).post('/items').send({ name: 'Test', category: 'test' });

        expect(capturedModel).toBe(Item);
      });

      test('context.models contains all Sequelize models', async () => {
        const { User, UserProfile, Post, app } = await buildUserWithRelationsApp();

        let capturedModels = null;

        app.use(
          '/users',
          create(User, {
            pre: async (context) => {
              capturedModels = context.models;
            },
          })
        );

        await request(app).post('/users').send({ name: 'Test User' });

        expect(capturedModels).toBeDefined();
        expect(capturedModels.User).toBe(User);
        expect(capturedModels.UserProfile).toBe(UserProfile);
        expect(capturedModels.Post).toBe(Post);
      });

      test('context.req and context.res are Express objects', async () => {
        const { Item, app } = await buildItemApp();

        let hasReq = false;
        let hasRes = false;

        app.use(
          '/items',
          create(Item, {
            pre: async (context) => {
              hasReq = typeof context.req.method === 'string';
              hasRes = typeof context.res.status === 'function';
            },
          })
        );

        await request(app).post('/items').send({ name: 'Test', category: 'test' });

        expect(hasReq).toBe(true);
        expect(hasRes).toBe(true);
      });

      test('context.preResult is available in post hooks', async () => {
        const { Item, app } = await buildItemApp();

        let capturedPreResult = null;

        app.use(
          '/items',
          create(Item, {
            pre: async (context) => {
              return { startTime: 12345, custom: 'data' };
            },
            post: async (context) => {
              capturedPreResult = context.preResult;
            },
          })
        );

        await request(app).post('/items').send({ name: 'Test', category: 'test' });

        expect(capturedPreResult).toEqual({ startTime: 12345, custom: 'data' });
      });

      test('context.payload can be modified in post hooks', async () => {
        const { Item, app } = await buildItemApp();

        app.use(
          '/items',
          create(Item, {
            post: async (context) => {
              context.payload.extra = 'custom data';
              context.payload.timestamp = '2025-01-01';
            },
          })
        );

        const res = await request(app)
          .post('/items')
          .send({ name: 'Test', category: 'test' });

        expect(res.body.extra).toBe('custom data');
        expect(res.body.timestamp).toBe('2025-01-01');
      });

      test('context.idMapping and context.id_mapping are available', async () => {
        const { Item, app } = await buildItemApp();

        let capturedIdMapping = null;
        let capturedIdMappingSnake = null;

        app.use(
          '/items',
          create(Item, {
            pre: async (context) => {
              capturedIdMapping = context.idMapping;
              capturedIdMappingSnake = context.id_mapping;
            },
          })
        );

        await request(app).post('/items').send({ name: 'Test', category: 'test' });

        expect(capturedIdMapping).toBe('id');
        expect(capturedIdMappingSnake).toBe('id');
      });
    });

    describe('Create Operation Properties', () => {
      test('context.req.body contains the request body', async () => {
        const { Item, app } = await buildItemApp();

        let capturedBody = null;

        app.use(
          '/items',
          create(Item, {
            pre: async (context) => {
              capturedBody = context.req.body;
            },
          })
        );

        await request(app)
          .post('/items')
          .send({ name: 'Widget', category: 'gadgets', price: 49.99 });

        expect(capturedBody).toEqual({
          name: 'Widget',
          category: 'gadgets',
          price: 49.99,
        });
      });

      test('context.transaction is available in create hooks', async () => {
        const { Item, app } = await buildItemApp();

        let hasTransaction = false;
        let transactionHasCommit = false;

        app.use(
          '/items',
          create(Item, {
            pre: async (context) => {
              hasTransaction = context.transaction !== undefined;
              transactionHasCommit =
                typeof context.transaction?.commit === 'function';
            },
          })
        );

        await request(app).post('/items').send({ name: 'Test', category: 'test' });

        expect(hasTransaction).toBe(true);
        expect(transactionHasCommit).toBe(true);
      });

      test('context.created is available in post hooks', async () => {
        const { Item, app } = await buildItemApp();

        let createdId = null;
        let createdName = null;

        app.use(
          '/items',
          create(Item, {
            post: async (context) => {
              createdId = context.created.id;
              createdName = context.created.name;
            },
          })
        );

        const res = await request(app)
          .post('/items')
          .send({ name: 'Created Item', category: 'test' });

        expect(createdId).toBe(res.body.id);
        expect(createdName).toBe('Created Item');
      });
    });

    describe('Patch Operation Properties', () => {
      test('context.req.params contains the record ID from URL', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        let capturedId = null;

        app.use(
          '/items',
          patch(Item, {
            pre: async (context) => {
              capturedId = context.req.params.id;
            },
          })
        );

        await request(app).patch('/items/1').send({ name: 'Updated' });

        expect(capturedId).toBe('1');
      });

      test('context.transaction is available in patch hooks', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        let hasTransaction = false;

        app.use(
          '/items',
          patch(Item, {
            pre: async (context) => {
              hasTransaction = context.transaction !== undefined;
            },
          })
        );

        await request(app).patch('/items/1').send({ name: 'Updated' });

        expect(hasTransaction).toBe(true);
      });
    });

    describe('Destroy Operation Properties', () => {
      test('context.id and context.where are available', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        let capturedId = null;
        let capturedWhere = null;

        app.use(
          '/items',
          destroy(Item, {
            pre: async (context) => {
              capturedId = context.id;
              capturedWhere = context.where;
            },
          })
        );

        await request(app).delete('/items/1');

        expect(capturedId).toBe('1');
        expect(capturedWhere).toBeDefined();
      });

      test('context.transaction is available in destroy hooks', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        let hasTransaction = false;

        app.use(
          '/items',
          destroy(Item, {
            pre: async (context) => {
              hasTransaction = context.transaction !== undefined;
            },
          })
        );

        await request(app).delete('/items/1');

        expect(hasTransaction).toBe(true);
      });
    });

    describe('List Operation Properties', () => {
      test('context.payload contains data and meta after database operation', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        let capturedPayload = null;

        app.use(
          '/items',
          list(Item, {
            post: async (context) => {
              capturedPayload = context.payload;
            },
          })
        );

        await request(app).get('/items');

        expect(capturedPayload).toBeDefined();
        expect(capturedPayload.data).toHaveLength(3);
        expect(capturedPayload.meta.paging.count).toBe(3);
      });
    });

    describe('Single Operation Properties', () => {
      test('context.record is available in post hooks', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        let capturedRecord = null;

        app.use(
          '/items',
          single(Item, {
            post: async (context) => {
              capturedRecord = context.record;
            },
          })
        );

        await request(app).get('/items/1');

        expect(capturedRecord).toBeDefined();
        expect(capturedRecord.name).toBe('Laptop');
      });

      test('context.transaction is undefined for single (read-only)', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        let transactionValue = 'not-checked';

        app.use(
          '/items',
          single(Item, {
            pre: async (context) => {
              transactionValue = context.transaction;
            },
          })
        );

        await request(app).get('/items/1');

        expect(transactionValue).toBeUndefined();
      });
    });
  });

  describe('Basic Usage', () => {
    test('pre hook can return data to pass to post hooks', async () => {
      const { Item, app } = await buildItemApp();

      app.use(
        '/items',
        create(Item, {
          pre: async (context) => {
            return { startTime: Date.now() };
          },
          post: async (context) => {
            const duration = Date.now() - context.preResult.startTime;
            context.payload.duration = `${duration}ms`;
          },
        })
      );

      const res = await request(app)
        .post('/items')
        .send({ name: 'Test', category: 'test' });

      expect(res.body.duration).toMatch(/^\d+ms$/);
    });
  });

  describe('Multiple Hooks', () => {
    test('pre hooks execute in order, last return value becomes preResult', async () => {
      const { Item, app } = await buildItemApp();

      const executionOrder = [];
      let capturedPreResult = null;

      app.use(
        '/items',
        create(Item, {
          pre: [
            async (context) => {
              executionOrder.push('pre1');
              return { step: 1 };
            },
            async (context) => {
              executionOrder.push('pre2');
              return { step: 2, finalPre: true };
            },
          ],
          post: async (context) => {
            capturedPreResult = context.preResult;
          },
        })
      );

      await request(app).post('/items').send({ name: 'Test', category: 'test' });

      expect(executionOrder).toEqual(['pre1', 'pre2']);
      expect(capturedPreResult).toEqual({ step: 2, finalPre: true });
    });

    test('post hooks execute in order and can modify payload', async () => {
      const { Item, app } = await buildItemApp();

      const executionOrder = [];

      app.use(
        '/items',
        create(Item, {
          post: [
            async (context) => {
              executionOrder.push('post1');
              context.payload.hook1 = true;
            },
            async (context) => {
              executionOrder.push('post2');
              context.payload.hook2 = true;
            },
          ],
        })
      );

      const res = await request(app)
        .post('/items')
        .send({ name: 'Test', category: 'test' });

      expect(executionOrder).toEqual(['post1', 'post2']);
      expect(res.body.hook1).toBe(true);
      expect(res.body.hook2).toBe(true);
    });

    test('both pre and post can be arrays', async () => {
      const { Item, app } = await buildItemApp();

      const executionOrder = [];

      app.use(
        '/items',
        create(Item, {
          pre: [
            async () => {
              executionOrder.push('pre1');
            },
            async () => {
              executionOrder.push('pre2');
            },
          ],
          post: [
            async () => {
              executionOrder.push('post1');
            },
            async () => {
              executionOrder.push('post2');
            },
          ],
        })
      );

      await request(app).post('/items').send({ name: 'Test', category: 'test' });

      expect(executionOrder).toEqual(['pre1', 'pre2', 'post1', 'post2']);
    });
  });

  describe('Common Use Cases', () => {
    describe('1. Logging and Timing', () => {
      test('can measure operation duration', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        let duration = null;

        app.use(
          '/items',
          list(Item, {
            pre: async (context) => {
              return { startTime: Date.now() };
            },
            post: async (context) => {
              duration = Date.now() - context.preResult.startTime;
            },
          })
        );

        await request(app).get('/items');

        expect(typeof duration).toBe('number');
        expect(duration).toBeGreaterThanOrEqual(0);
      });
    });

    describe('2. Audit Trail', () => {
      test('can create audit log entry after create', async () => {
        const { Item, AuditLog, app } = await buildItemWithAuditApp();

        app.use(
          '/items',
          create(Item, {
            post: async (context) => {
              await AuditLog.create(
                {
                  action: 'CREATE',
                  model: 'Item',
                  recordId: context.created.id,
                  userId: context.req.headers['x-user-id']
                    ? parseInt(context.req.headers['x-user-id'])
                    : null,
                  timestamp: new Date(),
                },
                { transaction: context.transaction }
              );
            },
          })
        );

        const res = await request(app)
          .post('/items')
          .set('x-user-id', '42')
          .send({ name: 'Audited Item', category: 'test' });

        expect(res.status).toBe(201);

        const logs = await AuditLog.findAll();
        expect(logs).toHaveLength(1);
        expect(logs[0].action).toBe('CREATE');
        expect(logs[0].model).toBe('Item');
        expect(logs[0].recordId).toBe(res.body.id);
        expect(logs[0].userId).toBe(42);
      });
    });

    describe('3. Automatic Field Population', () => {
      test('pre hook can add created_by from request using set_value', async () => {
        const { Item, app } = await buildItemApp();

        // Simulate auth middleware
        app.use((req, res, next) => {
          req.user = { id: 123 };
          next();
        });

        app.use(
          '/items',
          create(Item, {
            pre: async (context) => {
              context.set_value('created_by', context.req.user?.id);
            },
          })
        );

        const res = await request(app)
          .post('/items')
          .send({ name: 'Auto-populated Item', category: 'test' });

        expect(res.status).toBe(201);

        const item = await Item.findByPk(res.body.id);
        expect(item.created_by).toBe(123);
      });
    });

    describe('4. Side Effects (Notifications)', () => {
      test('post hook can trigger side effects like notifications', async () => {
        sequelize = new Sequelize('sqlite::memory:', { logging: false });

        const Order = sequelize.define(
          'Order',
          {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            customer_email: { type: DataTypes.STRING(100), allowNull: false },
            total: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
          },
          { tableName: 'doc_hooks_orders', timestamps: false }
        );

        await sequelize.sync({ force: true });

        const app = express();
        app.use(bodyParser.json());

        let notificationSent = false;
        let notifiedOrder = null;

        // Mock notification function
        const sendOrderConfirmation = async (order) => {
          notificationSent = true;
          notifiedOrder = order;
        };

        app.use(
          '/orders',
          create(Order, {
            post: async (context) => {
              // Send notification after order is created
              await sendOrderConfirmation(context.created);
            },
          })
        );

        const res = await request(app)
          .post('/orders')
          .send({ customer_email: 'test@example.com', total: 99.99 });

        expect(res.status).toBe(201);
        expect(notificationSent).toBe(true);
        expect(notifiedOrder.customer_email).toBe('test@example.com');
      });
    });

    describe('5. Cascading Operations', () => {
      test('can create related records in post hook using transaction', async () => {
        const { User, UserProfile, app } = await buildUserWithRelationsApp();

        app.use(
          '/users',
          create(User, {
            post: async (context) => {
              await context.models.UserProfile.create(
                {
                  user_id: context.created.id,
                  theme: 'dark',
                },
                { transaction: context.transaction }
              );
            },
          })
        );

        const res = await request(app).post('/users').send({ name: 'New User' });

        expect(res.status).toBe(201);

        const profiles = await UserProfile.findAll({
          where: { user_id: res.body.id },
        });
        expect(profiles).toHaveLength(1);
        expect(profiles[0].theme).toBe('dark');
      });
    });

    describe('6. Response Enrichment', () => {
      test('post hook can add computed fields to response', async () => {
        const { Item, app } = await buildItemApp();
        await Item.create({ name: 'Expensive Item', price: 1500 });

        app.use(
          '/items',
          single(Item, {
            post: async (context) => {
              context.payload.record.isExpensive =
                parseFloat(context.record.price) > 1000;
              context.payload.meta = { fetchedAt: '2025-01-01' };
            },
          })
        );

        const res = await request(app).get('/items/1');

        expect(res.body.record.isExpensive).toBe(true);
        expect(res.body.meta.fetchedAt).toBe('2025-01-01');
      });
    });

    describe('7. Validation', () => {
      test('pre hook can cancel operation and return error response', async () => {
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
    });

    describe('8. Cleanup on Delete', () => {
      test('post hook runs after deletion', async () => {
        const { Item, app } = await buildItemApp();
        await seedItems(Item);

        let deletedId = null;

        app.use(
          '/items',
          destroy(Item, {
            post: async (context) => {
              deletedId = context.id;
              context.payload.cleanedUp = true;
            },
          })
        );

        const res = await request(app).delete('/items/1');

        expect(res.status).toBe(200);
        expect(deletedId).toBe('1');
        expect(res.body.cleanedUp).toBe(true);
      });
    });
  });

  describe('Transaction Handling', () => {
    test('related record creation in same transaction rolls back on error', async () => {
      const { User, UserProfile, app } = await buildUserWithRelationsApp();

      app.use(
        '/users',
        create(User, {
          post: async (context) => {
            // Create profile
            await context.models.UserProfile.create(
              {
                user_id: context.created.id,
                theme: 'dark',
              },
              { transaction: context.transaction }
            );
            // Force an error to trigger rollback
            throw new Error('Simulated error after profile creation');
          },
        })
      );

      const res = await request(app).post('/users').send({ name: 'Test User' });

      expect(res.status).toBe(500);

      // Both user and profile should be rolled back
      const users = await User.findAll();
      const profiles = await UserProfile.findAll();
      expect(users).toHaveLength(0);
      expect(profiles).toHaveLength(0);
    });
  });

  describe('Accessing Related Models', () => {
    test('context.models provides access to all models', async () => {
      const { User, UserProfile, Post, app } = await buildUserWithRelationsApp();

      let modelsAvailable = null;

      app.use(
        '/users',
        create(User, {
          post: async (context) => {
            modelsAvailable = {
              hasUser: !!context.models.User,
              hasUserProfile: !!context.models.UserProfile,
              hasPost: !!context.models.Post,
            };

            // Create related records using context.models
            await context.models.Post.create(
              {
                title: 'Welcome Post',
                user_id: context.created.id,
              },
              { transaction: context.transaction }
            );
          },
        })
      );

      const res = await request(app).post('/users').send({ name: 'Test User' });

      expect(res.status).toBe(201);
      expect(modelsAvailable).toEqual({
        hasUser: true,
        hasUserProfile: true,
        hasPost: true,
      });

      const posts = await Post.findAll();
      expect(posts).toHaveLength(1);
      expect(posts[0].title).toBe('Welcome Post');
    });
  });

  describe('Error Handling', () => {
    test('throwing error in pre hook aborts operation', async () => {
      const { Item, app } = await buildItemApp();

      app.use(
        '/items',
        create(Item, {
          pre: async (context) => {
            throw new Error('Pre hook validation failed');
          },
        })
      );

      const res = await request(app)
        .post('/items')
        .send({ name: 'Test', category: 'test' });

      expect(res.status).toBe(500);

      const count = await Item.count();
      expect(count).toBe(0);
    });

    test('throwing error when limit reached aborts operation', async () => {
      const { Item, app } = await buildItemApp();

      // Create some items first to simulate existing records
      await Item.bulkCreate([
        { name: 'Item 1', category: 'limited' },
        { name: 'Item 2', category: 'limited' },
      ]);

      app.use(
        '/items',
        create(Item, {
          pre: async (context) => {
            const count = await Item.count({
              where: { category: context.req.body.category },
            });
            if (count >= 2) {
              throw new Error('Category limit reached');
            }
          },
        })
      );

      const res = await request(app)
        .post('/items')
        .send({ name: 'New Item', category: 'limited' });

      expect(res.status).toBe(500);

      // Verify no new item was created
      const count = await Item.count({ where: { category: 'limited' } });
      expect(count).toBe(2);
    });

    test('graceful error handling in post hook', async () => {
      const { Item, app } = await buildItemApp();

      let notificationAttempted = false;

      app.use(
        '/items',
        create(Item, {
          post: async (context) => {
            try {
              // Simulate notification that fails
              notificationAttempted = true;
              throw new Error('Notification service unavailable');
            } catch (error) {
              // Log error but don't fail the request
              context.payload.warning = 'Notification could not be sent';
            }
          },
        })
      );

      const res = await request(app)
        .post('/items')
        .send({ name: 'Test', category: 'test' });

      expect(res.status).toBe(201);
      expect(notificationAttempted).toBe(true);
      expect(res.body.warning).toBe('Notification could not be sent');
    });
  });

  describe('Hooks Across Different Operations', () => {
    test('hooks work with list operation', async () => {
      const { Item, app } = await buildItemApp();
      await seedItems(Item);

      let preRan = false;
      let postRan = false;

      app.use(
        '/items',
        list(Item, {
          pre: async () => {
            preRan = true;
          },
          post: async (context) => {
            postRan = true;
            context.payload.meta.hookRan = true;
          },
        })
      );

      const res = await request(app).get('/items');

      expect(res.status).toBe(200);
      expect(preRan).toBe(true);
      expect(postRan).toBe(true);
      expect(res.body.meta.hookRan).toBe(true);
    });

    test('hooks work with search operation', async () => {
      const { Item, app } = await buildItemApp();
      await seedItems(Item);

      let preRan = false;
      let postRan = false;

      app.use(
        '/items',
        search(Item, {
          pre: async () => {
            preRan = true;
          },
          post: async (context) => {
            postRan = true;
            context.payload.meta.searchHookRan = true;
          },
        })
      );

      const res = await request(app).post('/items/search').send({});

      expect(res.status).toBe(200);
      expect(preRan).toBe(true);
      expect(postRan).toBe(true);
      expect(res.body.meta.searchHookRan).toBe(true);
    });

    test('hooks work with update operation', async () => {
      const { Item, app } = await buildItemApp();
      await seedItems(Item);

      let preRan = false;
      let postRan = false;

      app.use(
        '/items',
        update(Item, {
          pre: async () => {
            preRan = true;
          },
          post: async (context) => {
            postRan = true;
            context.payload.updateHookRan = true;
          },
        })
      );

      const res = await request(app)
        .put('/items/1')
        .send({ name: 'Updated Item' });

      expect(res.status).toBe(200);
      expect(preRan).toBe(true);
      expect(postRan).toBe(true);
      expect(res.body.updateHookRan).toBe(true);
    });
  });

  describe('Context Helpers Combined Example', () => {
    test('can use apply_where, set_value, and cancel_operation together', async () => {
      const { Item, app } = await buildItemApp();

      // Simulate auth middleware
      app.use((req, res, next) => {
        req.user = { id: 42, tenantId: 100 };
        next();
      });

      app.use(
        '/items',
        create(Item, {
          pre: async (context) => {
            // Apply tenant filter
            context.apply_where({ created_by: context.req.user.tenantId });

            // Auto-populate fields
            context.set_value('created_by', context.req.user.id);

            // Validation
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

      // Test successful creation with auto-populated field
      const successRes = await request(app)
        .post('/items')
        .send({ name: 'Valid Item', category: 'test', price: 10 });

      expect(successRes.status).toBe(201);

      // Verify the created_by was set in the database
      const item = await Item.findByPk(successRes.body.id);
      expect(item.created_by).toBe(42);

      // Test validation failure
      const failRes = await request(app)
        .post('/items')
        .send({ name: 'Bad Item', price: -5 });

      expect(failRes.status).toBe(400);
      expect(failRes.body.success).toBe(false);
      expect(failRes.body.error).toBe('Price cannot be negative');
    });
  });

  describe('Best Practices', () => {
    test('pre hooks for validation, post hooks for side effects', async () => {
      const { Item, app } = await buildItemApp();

      let validationRan = false;
      let sideEffectsRan = false;

      // Helper functions
      const isValid = (body) => body.name && body.name.length > 0;
      const sendNotification = async () => {
        sideEffectsRan = true;
      };
      const updateCache = async () => {
        // Cache update logic
      };

      app.use(
        '/items',
        create(Item, {
          // Validation in pre hook
          pre: async (context) => {
            validationRan = true;
            if (!isValid(context.req.body)) {
              context.cancel_operation(400, { error: 'Validation failed' });
              return;
            }
          },
          // Side effects in post hook
          post: async (context) => {
            await sendNotification(context.created);
            await updateCache(context.created);
          },
        })
      );

      // Test successful flow
      const successRes = await request(app)
        .post('/items')
        .send({ name: 'Valid Item', category: 'test' });

      expect(successRes.status).toBe(201);
      expect(validationRan).toBe(true);
      expect(sideEffectsRan).toBe(true);

      // Reset flags
      validationRan = false;
      sideEffectsRan = false;

      // Test validation failure - side effects should not run
      const failRes = await request(app)
        .post('/items')
        .send({ name: '', category: 'test' });

      expect(failRes.status).toBe(400);
      expect(validationRan).toBe(true);
      expect(sideEffectsRan).toBe(false);
    });
  });
});
