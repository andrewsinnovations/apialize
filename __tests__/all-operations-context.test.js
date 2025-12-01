const { Sequelize, DataTypes } = require('sequelize');
const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const {
  create,
  update,
  patch,
  destroy,
  list,
  search,
  single,
} = require('../src');

describe('All operations with apialize_context', () => {
  let sequelize;
  let TestModel;
  let app;

  beforeAll(async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    TestModel = sequelize.define(
      'TestModel',
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        external_id: {
          type: DataTypes.STRING(50),
          allowNull: false,
        },
        alt_id: {
          type: DataTypes.STRING(50),
          allowNull: false,
        },
        name: {
          type: DataTypes.STRING(100),
          allowNull: false,
        },
      },
      {
        tableName: 'test_models',
        timestamps: false,
        apialize: {
          default: {
            id_mapping: 'external_id',
          },
          create: {
            default: {
              validate: true,
            },
            admin: {
              validate: false,
            },
          },
          single: {
            default: {
              param_name: 'external_id',
            },
            alternate: {
              id_mapping: 'alt_id',
              param_name: 'alt_id',
            },
          },
          update: {
            default: {
              validate: true,
            },
            admin: {
              validate: false,
            },
          },
          patch: {
            default: {
              validate: true,
            },
            admin: {
              validate: false,
            },
          },
          destroy: {
            default: {
              pre: [],
            },
            admin: {
              pre: [
                (ctx) => {
                  ctx._adminDestroy = true;
                },
              ],
            },
          },
          list: {
            default: {
              default_page_size: 10,
            },
            large: {
              default_page_size: 100,
            },
          },
          search: {
            default: {
              default_page_size: 10,
            },
            large: {
              default_page_size: 100,
            },
          },
        },
      }
    );

    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    await TestModel.destroy({ where: {} });
    app = express();
    app.use(bodyParser.json());
  });

  afterAll(async () => {
    await sequelize.close();
  });

  test('create operation should support apialize_context', async () => {
    const hooksCalled = { default: false, admin: false };

    // Default context
    app.use(
      '/items',
      create(TestModel, {
        post: () => {
          hooksCalled.default = true;
        },
      })
    );

    // Admin context
    app.use(
      '/admin-items',
      create(TestModel, {
        apialize_context: 'admin',
        post: () => {
          hooksCalled.admin = true;
        },
      })
    );

    // Create with default context
    const defaultRes = await request(app)
      .post('/items')
      .send({ name: 'Item 1', external_id: 'EXT-001', alt_id: 'ALT-001' });
    expect(defaultRes.status).toBe(201);
    expect(hooksCalled.default).toBe(true);

    // Create with admin context
    const adminRes = await request(app)
      .post('/admin-items')
      .send({ name: 'Item 2', external_id: 'EXT-002', alt_id: 'ALT-002' });
    expect(adminRes.status).toBe(201);
    expect(hooksCalled.admin).toBe(true);
  });

  test('single operation should support apialize_context', async () => {
    await TestModel.create({
      name: 'Test Item',
      external_id: 'EXT-001',
      alt_id: 'ALT-001',
    });

    // Default context
    app.use('/items', single(TestModel));

    // Alternate context
    app.use('/alt-items', single(TestModel, { apialize_context: 'alternate' }));

    // Fetch with default context
    const defaultRes = await request(app).get('/items/EXT-001');
    expect(defaultRes.status).toBe(200);
    expect(defaultRes.body.record.id).toBe('EXT-001');

    // Fetch with alternate context
    const altRes = await request(app).get('/alt-items/ALT-001');
    expect(altRes.status).toBe(200);
    expect(altRes.body.record.id).toBe('ALT-001');
  });

  test('update operation should support apialize_context', async () => {
    const item = await TestModel.create({
      name: 'Original',
      external_id: 'EXT-001',
      alt_id: 'ALT-001',
    });

    const hooksCalled = { default: false, admin: false };

    // Default context
    app.use(
      '/items',
      update(TestModel, {
        post: () => {
          hooksCalled.default = true;
        },
      })
    );

    // Admin context
    app.use(
      '/admin-items',
      update(TestModel, {
        apialize_context: 'admin',
        post: () => {
          hooksCalled.admin = true;
        },
      })
    );

    // Update with default context
    const defaultRes = await request(app).put('/items/EXT-001').send({
      name: 'Updated Default',
      external_id: 'EXT-001',
      alt_id: 'ALT-001',
    });
    expect(defaultRes.status).toBe(200);
    expect(hooksCalled.default).toBe(true);

    // Update with admin context
    hooksCalled.default = false;
    const adminRes = await request(app).put('/admin-items/EXT-001').send({
      name: 'Updated Admin',
      external_id: 'EXT-001',
      alt_id: 'ALT-001',
    });
    expect(adminRes.status).toBe(200);
    expect(hooksCalled.admin).toBe(true);
  });

  test('patch operation should support apialize_context', async () => {
    await TestModel.create({
      name: 'Original',
      external_id: 'EXT-001',
      alt_id: 'ALT-001',
    });

    const hooksCalled = { default: false, admin: false };

    // Default context
    app.use(
      '/items',
      patch(TestModel, {
        post: () => {
          hooksCalled.default = true;
        },
      })
    );

    // Admin context
    app.use(
      '/admin-items',
      patch(TestModel, {
        apialize_context: 'admin',
        post: () => {
          hooksCalled.admin = true;
        },
      })
    );

    // Patch with default context
    const defaultRes = await request(app)
      .patch('/items/EXT-001')
      .send({ name: 'Patched Default' });
    expect(defaultRes.status).toBe(200);
    expect(hooksCalled.default).toBe(true);

    // Patch with admin context
    hooksCalled.default = false;
    const adminRes = await request(app)
      .patch('/admin-items/EXT-001')
      .send({ name: 'Patched Admin' });
    expect(adminRes.status).toBe(200);
    expect(hooksCalled.admin).toBe(true);
  });

  test('destroy operation should support apialize_context', async () => {
    await TestModel.create({
      name: 'To Delete 1',
      external_id: 'EXT-001',
      alt_id: 'ALT-001',
    });
    await TestModel.create({
      name: 'To Delete 2',
      external_id: 'EXT-002',
      alt_id: 'ALT-002',
    });

    const hooksCalled = { default: false, admin: false };

    // Default context
    app.use(
      '/items',
      destroy(TestModel, {
        post: (ctx) => {
          hooksCalled.default = true;
          hooksCalled.defaultAdminFlag = ctx._adminDestroy;
        },
      })
    );

    // Admin context
    app.use(
      '/admin-items',
      destroy(TestModel, {
        apialize_context: 'admin',
        post: (ctx) => {
          hooksCalled.admin = true;
          hooksCalled.adminAdminFlag = ctx._adminDestroy;
        },
      })
    );

    // Destroy with default context
    const defaultRes = await request(app).delete('/items/EXT-001');
    expect(defaultRes.status).toBe(200);
    expect(hooksCalled.default).toBe(true);
    expect(hooksCalled.defaultAdminFlag).toBeUndefined();

    // Destroy with admin context
    const adminRes = await request(app).delete('/admin-items/EXT-002');
    expect(adminRes.status).toBe(200);
    expect(hooksCalled.admin).toBe(true);
    expect(hooksCalled.adminAdminFlag).toBe(true);
  });

  test('list operation should support apialize_context', async () => {
    // Create 50 test records
    for (let i = 1; i <= 50; i++) {
      await TestModel.create({
        name: `Item ${i}`,
        external_id: `EXT-${String(i).padStart(3, '0')}`,
        alt_id: `ALT-${String(i).padStart(3, '0')}`,
      });
    }

    // Default context (page size 10)
    app.use('/items', list(TestModel));

    // Large context (page size 100)
    app.use('/large-items', list(TestModel, { apialize_context: 'large' }));

    // List with default context
    const defaultRes = await request(app).get('/items');
    expect(defaultRes.status).toBe(200);
    expect(defaultRes.body.data.length).toBe(10);

    // List with large context
    const largeRes = await request(app).get('/large-items');
    expect(largeRes.status).toBe(200);
    expect(largeRes.body.data.length).toBe(50);
  });

  test('search operation should support apialize_context', async () => {
    // Create 50 test records
    for (let i = 1; i <= 50; i++) {
      await TestModel.create({
        name: `Item ${i}`,
        external_id: `EXT-${String(i).padStart(3, '0')}`,
        alt_id: `ALT-${String(i).padStart(3, '0')}`,
      });
    }

    // Default context (page size 10)
    app.use('/items', search(TestModel));

    // Large context (page size 100)
    app.use('/large-items', search(TestModel, { apialize_context: 'large' }));

    // Search with default context
    const defaultRes = await request(app)
      .post('/items/search')
      .send({ filtering: {} });
    expect(defaultRes.status).toBe(200);
    expect(defaultRes.body.data.length).toBe(10);

    // Search with large context
    const largeRes = await request(app)
      .post('/large-items/search')
      .send({ filtering: {} });
    expect(largeRes.status).toBe(200);
    expect(largeRes.body.data.length).toBe(50);
  });
});
