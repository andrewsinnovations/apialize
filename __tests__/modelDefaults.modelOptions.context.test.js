const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes, Op } = require('sequelize');
const {
  single,
  create,
  list,
  update,
  patch,
  destroy,
  search,
} = require('../src');

describe('Model-based apialize model_options in context', () => {
  let sequelize;
  let TestModel;
  let app;

  beforeAll(async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    // Test model with apialize configuration including model_options at the context level
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
          unique: true,
          allowNull: false,
        },
        name: {
          type: DataTypes.STRING(100),
          allowNull: false,
        },
        category: {
          type: DataTypes.STRING(50),
          allowNull: true,
        },
        status: {
          type: DataTypes.STRING(50),
          defaultValue: 'active',
        },
        is_featured: {
          type: DataTypes.BOOLEAN,
          defaultValue: false,
        },
      },
      {
        tableName: 'test_models_model_options_context',
        timestamps: false,
        apialize: {
          default: {
            id_mapping: 'external_id',
          },
          list: {
            default: {
              default_page_size: 50,
              default_order_by: 'name',
            },
            activeOnly: {
              // Active context with model_options
              model_options: {
                scopes: ['activeOnly'],
              },
            },
          },
          single: {
            default: {
              param_name: 'external_id',
            },
            featured: {
              // Featured context with model_options
              model_options: {
                scopes: ['featured'],
              },
            },
          },
        },
      }
    );

    // Add scopes for testing
    TestModel.addScope('activeOnly', {
      where: { status: 'active' },
    });

    TestModel.addScope('featured', {
      where: { is_featured: true },
    });

    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    await TestModel.destroy({ where: {} });
    app = express();
    app.use(bodyParser.json());
  });

  describe('model_options in list context', () => {
    test('should apply scopes from model_options in list activeOnly context', async () => {
      const testApp = express();
      testApp.use(bodyParser.json());
      testApp.use('/items', create(TestModel));
      testApp.use('/items', list(TestModel));
      testApp.use('/items-active', list(TestModel, { apialize_context: 'activeOnly' }));

      // Create test records
      await request(testApp)
        .post('/items')
        .send({ name: 'Active Item', external_id: 'active-1', status: 'active' });

      await request(testApp)
        .post('/items')
        .send({ name: 'Inactive Item', external_id: 'inactive-1', status: 'inactive' });

      // List all items without context
      const allRes = await request(testApp).get('/items?api:page_size=100');
      expect(allRes.status).toBe(200);
      expect(allRes.body.data).toHaveLength(2);

      // List with activeOnly context (should only show active items)
      const activeRes = await request(testApp).get('/items-active?api:page_size=100');
      expect(activeRes.status).toBe(200);
      expect(activeRes.body.data).toHaveLength(1);
      expect(activeRes.body.data[0].name).toBe('Active Item');
    });
  });

  describe('model_options in single context', () => {
    test('should apply scopes from model_options in single featured context', async () => {
      app.use('/items', create(TestModel));
      app.use('/items', single(TestModel));
      app.use('/featured-items', single(TestModel, { apialize_context: 'featured' }));

      // Create test records
      const activeRes = await request(app)
        .post('/items')
        .send({ name: 'Featured Item', external_id: 'feat-1', is_featured: true });
      expect(activeRes.status).toBe(201);

      const inactiveRes = await request(app)
        .post('/items')
        .send({ name: 'Not Featured Item', external_id: 'not-feat-1', is_featured: false });
      expect(inactiveRes.status).toBe(201);

      // Fetch featured item with default context (should work)
      const defaultRes = await request(app).get('/items/feat-1');
      expect(defaultRes.status).toBe(200);
      expect(defaultRes.body.record.name).toBe('Featured Item');

      // Fetch non-featured item with default context (should work)
      const nonFeaturedRes = await request(app).get('/items/not-feat-1');
      expect(nonFeaturedRes.status).toBe(200);
      expect(nonFeaturedRes.body.record.name).toBe('Not Featured Item');

      // Fetch featured item with featured context (should work)
      const featuredRes = await request(app).get('/featured-items/feat-1');
      expect(featuredRes.status).toBe(200);
      expect(featuredRes.body.record.name).toBe('Featured Item');

      // Fetch non-featured item with featured context (should NOT find it due to scope)
      const notFoundRes = await request(app).get('/featured-items/not-feat-1');
      expect(notFoundRes.status).toBe(404);
    });
  });

  describe('model_options override with user-provided model_options', () => {
    test('should allow user-provided model_options to override context model_options', async () => {
      const testApp = express();
      testApp.use(bodyParser.json());
      testApp.use('/items', create(TestModel));
      // List endpoint with user-provided model_options that overrides context
      testApp.use(
        '/items-override',
        list(TestModel, { apialize_context: 'activeOnly' }, { scopes: ['featured'] })
      );

      // Create test records
      await request(testApp)
        .post('/items')
        .send({
          name: 'Active Featured Item',
          external_id: 'active-feat-1',
          status: 'active',
          is_featured: true,
        });

      await request(testApp)
        .post('/items')
        .send({
          name: 'Active Not Featured Item',
          external_id: 'active-not-feat-1',
          status: 'active',
          is_featured: false,
        });

      await request(testApp)
        .post('/items')
        .send({
          name: 'Inactive Featured Item',
          external_id: 'inactive-feat-1',
          status: 'inactive',
          is_featured: true,
        });

      // User-provided model_options should override context model_options
      // So it should apply 'featured' scope instead of 'activeOnly'
      const overrideRes = await request(testApp).get('/items-override?api:page_size=100');
      expect(overrideRes.status).toBe(200);
      // Should only return featured items (2 items: both active and inactive featured)
      expect(overrideRes.body.data).toHaveLength(2);
      expect(overrideRes.body.data.every((r) => r.is_featured)).toBe(true);
    });
  });

  describe('model_options merge with default context', () => {
    test('should merge model_options from global default and operation default', async () => {
      const MergedModel = sequelize.define(
        'MergedModel',
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
          name: {
            type: DataTypes.STRING(100),
            allowNull: false,
          },
          status: {
            type: DataTypes.STRING(50),
            defaultValue: 'active',
          },
        },
        {
          tableName: 'merged_models',
          timestamps: false,
          apialize: {
            default: {
              id_mapping: 'external_id',
              model_options: {
                scopes: ['activeOnly'],
              },
            },
            list: {
              default: {
                // Can add more model_options here
              },
            },
          },
        }
      );

      MergedModel.addScope('activeOnly', {
        where: { status: 'active' },
      });

      await MergedModel.sync({ force: true });

      const mergedApp = express();
      mergedApp.use(bodyParser.json());

      mergedApp.use('/items', create(MergedModel));
      mergedApp.use('/items', list(MergedModel));

      // Create test records
      await request(mergedApp)
        .post('/items')
        .send({ name: 'Active Item', external_id: 'merged-active-1', status: 'active' });

      await request(mergedApp)
        .post('/items')
        .send({ name: 'Inactive Item', external_id: 'merged-inactive-1', status: 'inactive' });

      // Global default model_options should apply scope
      const listRes = await request(mergedApp).get('/items?api:page_size=100');
      expect(listRes.status).toBe(200);
      // Should only show active items due to global default scope
      expect(listRes.body.data).toHaveLength(1);
      expect(listRes.body.data[0].status).toBe('active');

      await MergedModel.destroy({ where: {} });
    });
  });

  describe('combined model_options and other apialize options', () => {
    test('should work with model_options alongside id_mapping and other options', async () => {
      const CombinedModel = sequelize.define(
        'CombinedModel',
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
          name: {
            type: DataTypes.STRING(100),
            allowNull: false,
          },
          status: {
            type: DataTypes.STRING(50),
            defaultValue: 'active',
          },
        },
        {
          tableName: 'combined_models',
          timestamps: false,
          apialize: {
            single: {
              default: {
                id_mapping: 'external_id',
                param_name: 'external_id',
              },
              filtered: {
                id_mapping: 'external_id',
                param_name: 'external_id',
                model_options: {
                  scopes: ['activeOnly'],
                },
              },
            },
          },
        }
      );

      CombinedModel.addScope('activeOnly', {
        where: { status: 'active' },
      });

      await CombinedModel.sync({ force: true });

      const combinedApp = express();
      combinedApp.use(bodyParser.json());

      combinedApp.use('/items', create(CombinedModel));
      combinedApp.use('/items', single(CombinedModel));
      combinedApp.use('/items-filtered', single(CombinedModel, { apialize_context: 'filtered' }));

      // Create test records
      await request(combinedApp)
        .post('/items')
        .send({ name: 'Active Item', external_id: 'comb-active-1', status: 'active' });

      await request(combinedApp)
        .post('/items')
        .send({ name: 'Inactive Item', external_id: 'comb-inactive-1', status: 'inactive' });

      // Default context should find both
      const activeRes = await request(combinedApp).get('/items/comb-active-1');
      expect(activeRes.status).toBe(200);

      const inactiveRes = await request(combinedApp).get('/items/comb-inactive-1');
      expect(inactiveRes.status).toBe(200);

      // Filtered context should only find active
      const filteredActiveRes = await request(combinedApp).get('/items-filtered/comb-active-1');
      expect(filteredActiveRes.status).toBe(200);

      const filteredInactiveRes = await request(combinedApp).get('/items-filtered/comb-inactive-1');
      expect(filteredInactiveRes.status).toBe(404);

      await CombinedModel.destroy({ where: {} });
    });
  });
});
