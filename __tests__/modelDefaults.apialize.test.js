const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const {
  single,
  create,
  list,
  update,
  patch,
  destroy,
  search,
} = require('../src');

describe('Model-based apialize configuration', () => {
  let sequelize;
  let TestModel;
  let app;

  beforeAll(async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    // Test model with apialize configuration at the model level
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
      },
      {
        tableName: 'test_models',
        timestamps: false,
        apialize: {
          default: {
            // Applied to all operations by default
            id_mapping: 'external_id',
          },
          list: {
            default: {
              // Applied to list operations
              default_page_size: 50,
              default_order_by: 'name',
            },
          },
          single: {
            default: {
              // Applied to single operations
              param_name: 'external_id',
            },
          },
          create: {
            default: {
              validate: true,
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

  describe('default configuration (applied to all operations)', () => {
    test('should use id_mapping from model default for single operation', async () => {
      app.use('/items', create(TestModel));
      app.use('/items', single(TestModel));

      // Create a test record
      const createRes = await request(app)
        .post('/items')
        .send({ name: 'Test Item', external_id: 'ext-123' });

      expect(createRes.status).toBe(201);

      // Fetch the record using external_id (from model config)
      const getRes = await request(app).get('/items/ext-123');
      expect(getRes.status).toBe(200);
      expect(getRes.body).toMatchObject({
        success: true,
        record: { name: 'Test Item', id: 'ext-123' },
      });
      expect(
        Object.prototype.hasOwnProperty.call(getRes.body.record, 'external_id')
      ).toBe(false);
    });

    test('should use id_mapping from model default for update operation', async () => {
      app.use('/items', create(TestModel));
      app.use('/items', single(TestModel));
      app.use('/items', update(TestModel));

      // Create a test record
      const createRes = await request(app)
        .post('/items')
        .send({ name: 'Original Name', external_id: 'ext-456' });

      expect(createRes.status).toBe(201);

      // Update using external_id (from model config)
      const updateRes = await request(app)
        .put('/items/ext-456')
        .send({ name: 'Updated Name', external_id: 'ext-456' });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body).toMatchObject({
        success: true,
      });

      // Verify the update worked by fetching the record
      const getRes = await request(app).get('/items/ext-456');
      expect(getRes.status).toBe(200);
      expect(getRes.body.record.name).toBe('Updated Name');
    });

    test('should use id_mapping from model default for patch operation', async () => {
      app.use('/items', create(TestModel));
      app.use('/items', single(TestModel));
      app.use('/items', patch(TestModel));

      // Create a test record
      const createRes = await request(app)
        .post('/items')
        .send({ name: 'Original Name', external_id: 'ext-789', category: 'A' });

      expect(createRes.status).toBe(201);

      // Patch using external_id (from model config)
      const patchRes = await request(app)
        .patch('/items/ext-789')
        .send({ category: 'B' });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body).toMatchObject({
        success: true,
      });

      // Verify the patch worked by fetching the record
      const getRes = await request(app).get('/items/ext-789');
      expect(getRes.status).toBe(200);
      expect(getRes.body.record.category).toBe('B');
    });

    test('should use id_mapping from model default for destroy operation', async () => {
      app.use('/items', create(TestModel));
      app.use('/items', single(TestModel));
      app.use('/items', destroy(TestModel));

      // Create a test record
      const createRes = await request(app)
        .post('/items')
        .send({ name: 'To Delete', external_id: 'ext-delete' });

      expect(createRes.status).toBe(201);

      // Delete using external_id (from model config)
      const deleteRes = await request(app).delete('/items/ext-delete');

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body).toMatchObject({
        success: true,
        id: 'ext-delete',
      });

      // Verify deletion
      const getRes = await request(app).get('/items/ext-delete');
      expect(getRes.status).toBe(404);
    });
  });

  describe('operation-specific configuration', () => {
    test('should use default_page_size from model config for list operation', async () => {
      app.use('/items', create(TestModel));
      app.use('/items', list(TestModel));

      // Create multiple test records
      for (let i = 1; i <= 60; i++) {
        await request(app)
          .post('/items')
          .send({ name: `Item ${i}`, external_id: `ext-${i}` });
      }

      // List should use default_page_size: 50 from model config
      const listRes = await request(app).get('/items');
      expect(listRes.status).toBe(200);
      expect(listRes.body.success).toBe(true);
      expect(listRes.body.data.length).toBe(50);
      expect(listRes.body.meta.paging.count).toBe(60);
    });

    test('should use default_order_by from model config for list operation', async () => {
      app.use('/items', create(TestModel));
      app.use('/items', list(TestModel));

      // Create test records in random order
      await request(app)
        .post('/items')
        .send({ name: 'Zebra', external_id: 'ext-1' });
      await request(app)
        .post('/items')
        .send({ name: 'Apple', external_id: 'ext-2' });
      await request(app)
        .post('/items')
        .send({ name: 'Mango', external_id: 'ext-3' });

      // List should be ordered by name (from model config)
      const listRes = await request(app).get('/items');
      expect(listRes.status).toBe(200);
      expect(listRes.body.success).toBe(true);
      expect(listRes.body.data[0].name).toBe('Apple');
      expect(listRes.body.data[1].name).toBe('Mango');
      expect(listRes.body.data[2].name).toBe('Zebra');
    });

    test('should use param_name from model config for single operation', async () => {
      app.use('/items', create(TestModel));
      app.use('/items', single(TestModel));

      // Create a test record
      const createRes = await request(app)
        .post('/items')
        .send({ name: 'Test Item', external_id: 'ext-param-test' });

      expect(createRes.status).toBe(201);

      // Single should use param_name: 'external_id' from model config
      const getRes = await request(app).get('/items/ext-param-test');
      expect(getRes.status).toBe(200);
      expect(getRes.body).toMatchObject({
        success: true,
        record: { name: 'Test Item', id: 'ext-param-test' },
      });
    });
  });

  describe('user options override model configuration', () => {
    test('should allow user to override id_mapping from model config', async () => {
      // Override model config with explicit id_mapping: 'id' for both operations
      app.use('/items', create(TestModel, { id_mapping: 'id' }));
      app.use(
        '/items',
        single(TestModel, { id_mapping: 'id', param_name: 'id' })
      );

      // Create a test record
      const createRes = await request(app)
        .post('/items')
        .send({ name: 'Test Item', external_id: 'ext-override' });

      expect(createRes.status).toBe(201);
      const recordId = createRes.body.id;

      // Fetch using internal id instead of external_id
      const getRes = await request(app).get(`/items/${recordId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body).toMatchObject({
        success: true,
        record: {
          id: recordId,
          name: 'Test Item',
          external_id: 'ext-override',
        },
      });
    });

    test('should allow user to override default_page_size from model config', async () => {
      app.use('/items', create(TestModel));
      // Override model config with explicit default_page_size: 10
      app.use('/items', list(TestModel, { default_page_size: 10 }));

      // Create 20 test records
      for (let i = 1; i <= 20; i++) {
        await request(app)
          .post('/items')
          .send({ name: `Item ${i}`, external_id: `ext-${i}` });
      }

      // List should use user-provided default_page_size: 10
      const listRes = await request(app).get('/items');
      expect(listRes.status).toBe(200);
      expect(listRes.body.success).toBe(true);
      expect(listRes.body.data.length).toBe(10);
      expect(listRes.body.meta.paging.count).toBe(20);
    });

    test('should allow user to override param_name from model config', async () => {
      app.use(
        '/items',
        create(TestModel, { param_name: 'id', id_mapping: 'id' })
      );
      // Override model config with explicit param_name: 'id'
      app.use(
        '/items',
        single(TestModel, { param_name: 'id', id_mapping: 'id' })
      );

      // Create a test record
      const createRes = await request(app)
        .post('/items')
        .send({ name: 'Test Item', external_id: 'ext-param-override' });

      expect(createRes.status).toBe(201);
      const recordId = createRes.body.id;

      // Single should use param_name: 'id' from user options
      const getRes = await request(app).get(`/items/${recordId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body).toMatchObject({
        success: true,
        record: {
          id: recordId,
          name: 'Test Item',
          external_id: 'ext-param-override',
        },
      });
    });
  });

  describe('search operation with model config', () => {
    test('should use id_mapping from model config for search operation', async () => {
      app.use('/items', create(TestModel));
      app.use('/', search(TestModel, { path: '/search' }));

      // Create test records
      await request(app).post('/items').send({
        name: 'Apple',
        external_id: 'ext-search-1',
        category: 'Fruit',
      });
      await request(app).post('/items').send({
        name: 'Banana',
        external_id: 'ext-search-2',
        category: 'Fruit',
      });
      await request(app).post('/items').send({
        name: 'Carrot',
        external_id: 'ext-search-3',
        category: 'Vegetable',
      });

      // Search should normalize ids using external_id
      const searchRes = await request(app)
        .post('/search')
        .send({ filtering: { category: 'Fruit' } });

      expect(searchRes.status).toBe(200);
      expect(searchRes.body.success).toBe(true);
      expect(searchRes.body.data.length).toBe(2);
      expect(searchRes.body.data[0]).toHaveProperty('id');
      expect(searchRes.body.data[0]).not.toHaveProperty('external_id');
      expect(['ext-search-1', 'ext-search-2']).toContain(
        searchRes.body.data[0].id
      );
    });
  });

  describe('related models with three levels of nesting', () => {
    let Country;
    let State;
    let City;
    let Location;

    beforeAll(async () => {
      // Level 1: Country
      Country = sequelize.define(
        'Country',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          country_code: {
            type: DataTypes.STRING(10),
            unique: true,
            allowNull: false,
          },
          name: {
            type: DataTypes.STRING(100),
            allowNull: false,
          },
        },
        {
          tableName: 'countries',
          timestamps: false,
          apialize: {
            default: {
              id_mapping: 'country_code',
            },
          },
        }
      );

      // Level 2: State
      State = sequelize.define(
        'State',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          state_code: {
            type: DataTypes.STRING(10),
            unique: true,
            allowNull: false,
          },
          name: {
            type: DataTypes.STRING(100),
            allowNull: false,
          },
          country_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
          },
        },
        {
          tableName: 'states',
          timestamps: false,
          apialize: {
            default: {
              id_mapping: 'state_code',
            },
          },
        }
      );

      // Level 3: City
      City = sequelize.define(
        'City',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          city_code: {
            type: DataTypes.STRING(10),
            unique: true,
            allowNull: false,
          },
          name: {
            type: DataTypes.STRING(100),
            allowNull: false,
          },
          state_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
          },
        },
        {
          tableName: 'cities',
          timestamps: false,
          apialize: {
            default: {
              id_mapping: 'city_code',
            },
          },
        }
      );

      // Level 4: Location
      Location = sequelize.define(
        'Location',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          location_code: {
            type: DataTypes.STRING(20),
            unique: true,
            allowNull: false,
          },
          name: {
            type: DataTypes.STRING(100),
            allowNull: false,
          },
          city_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
          },
        },
        {
          tableName: 'locations',
          timestamps: false,
          apialize: {
            default: {
              id_mapping: 'location_code',
            },
            single: {
              default: {
                param_name: 'location_code',
              },
            },
          },
        }
      );

      // Define associations
      Country.hasMany(State, { foreignKey: 'country_id', as: 'states' });
      State.belongsTo(Country, { foreignKey: 'country_id', as: 'country' });

      State.hasMany(City, { foreignKey: 'state_id', as: 'cities' });
      City.belongsTo(State, { foreignKey: 'state_id', as: 'state' });

      City.hasMany(Location, { foreignKey: 'city_id', as: 'locations' });
      Location.belongsTo(City, { foreignKey: 'city_id', as: 'city' });

      await sequelize.sync({ force: true });
    });

    beforeEach(async () => {
      await Location.destroy({ where: {}, force: true });
      await City.destroy({ where: {}, force: true });
      await State.destroy({ where: {}, force: true });
      await Country.destroy({ where: {}, force: true });
    });

    test('should apply id_mapping to three levels of nested related models', async () => {
      const testApp = express();
      testApp.use(bodyParser.json());

      // Create endpoints - rely on model defaults for id_mapping
      testApp.use(
        '/locations',
        single(
          Location,
          {},
          {
            include: [
              {
                model: City,
                as: 'city',
                include: [
                  {
                    model: State,
                    as: 'state',
                    include: [
                      {
                        model: Country,
                        as: 'country',
                      },
                    ],
                  },
                ],
              },
            ],
          }
        )
      );

      // Create test data hierarchy
      const country = await Country.create({
        country_code: 'US',
        name: 'United States',
      });

      const state = await State.create({
        state_code: 'CA',
        name: 'California',
        country_id: country.id,
      });

      const city = await City.create({
        city_code: 'SF',
        name: 'San Francisco',
        state_id: state.id,
      });

      const location = await Location.create({
        location_code: 'LOC-001',
        name: 'Downtown Office',
        city_id: city.id,
      });

      // Fetch location with all nested relations
      const getRes = await request(testApp).get('/locations/LOC-001');

      expect(getRes.status).toBe(200);
      expect(getRes.body.success).toBe(true);

      // Check that location uses id_mapping
      expect(getRes.body.record.id).toBe('LOC-001');
      expect(getRes.body.record.name).toBe('Downtown Office');
      expect(getRes.body.record).not.toHaveProperty('location_code');

      // Check level 1: City uses id_mapping
      expect(getRes.body.record.city).toBeDefined();
      expect(getRes.body.record.city.id).toBe('SF');
      expect(getRes.body.record.city.name).toBe('San Francisco');
      expect(getRes.body.record.city).not.toHaveProperty('city_code');

      // Check level 2: State uses id_mapping
      expect(getRes.body.record.city.state).toBeDefined();
      expect(getRes.body.record.city.state.id).toBe('CA');
      expect(getRes.body.record.city.state.name).toBe('California');
      expect(getRes.body.record.city.state).not.toHaveProperty('state_code');

      // Check level 3: Country uses id_mapping
      expect(getRes.body.record.city.state.country).toBeDefined();
      expect(getRes.body.record.city.state.country.id).toBe('US');
      expect(getRes.body.record.city.state.country.name).toBe('United States');
      expect(getRes.body.record.city.state.country).not.toHaveProperty(
        'country_code'
      );
    });

    test('should handle missing nested relations gracefully', async () => {
      const testApp = express();
      testApp.use(bodyParser.json());

      testApp.use(
        '/locations',
        single(
          Location,
          {},
          {
            include: [
              {
                model: City,
                as: 'city',
                required: false,
                include: [
                  {
                    model: State,
                    as: 'state',
                    required: false,
                  },
                ],
              },
            ],
          }
        )
      );

      // Create hierarchy without using actual foreign key - just create records
      const country = await Country.create({
        country_code: 'AU',
        name: 'Australia',
      });

      const state = await State.create({
        state_code: 'NSW',
        name: 'New South Wales',
        country_id: country.id,
      });

      const city = await City.create({
        city_code: 'SYD',
        name: 'Sydney',
        state_id: state.id,
      });

      const location = await Location.create({
        location_code: 'LOC-002',
        name: 'Sydney Office',
        city_id: city.id,
      });

      const getRes = await request(testApp).get('/locations/LOC-002');

      expect(getRes.status).toBe(200);
      expect(getRes.body.success).toBe(true);
      expect(getRes.body.record.id).toBe('LOC-002');
      expect(getRes.body.record.city.id).toBe('SYD');
      expect(getRes.body.record.city.state.id).toBe('NSW');
    });
  });

  describe('middleware from model config', () => {
    test('should apply middleware from model default config', async () => {
      const middlewareRan = [];

      const ModelWithMiddleware = sequelize.define(
        'ModelWithMiddleware',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          name: {
            type: DataTypes.STRING(100),
            allowNull: false,
          },
        },
        {
          tableName: 'test_middleware',
          timestamps: false,
          apialize: {
            default: {
              middleware: [
                (req, res, next) => {
                  middlewareRan.push('model-default');
                  next();
                },
              ],
            },
          },
        }
      );

      await ModelWithMiddleware.sync({ force: true });

      const testApp = express();
      testApp.use(bodyParser.json());
      testApp.use('/items', create(ModelWithMiddleware));

      const createRes = await request(testApp)
        .post('/items')
        .send({ name: 'Test' });

      expect(createRes.status).toBe(201);
      expect(middlewareRan).toContain('model-default');
    });

    test('should merge middleware from model config with user middleware', async () => {
      const middlewareRan = [];

      const ModelWithMiddleware = sequelize.define(
        'ModelWithMiddleware2',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          name: {
            type: DataTypes.STRING(100),
            allowNull: false,
          },
        },
        {
          tableName: 'test_middleware2',
          timestamps: false,
          apialize: {
            default: {
              middleware: [
                (req, res, next) => {
                  middlewareRan.push('model-middleware');
                  next();
                },
              ],
            },
          },
        }
      );

      await ModelWithMiddleware.sync({ force: true });

      const testApp = express();
      testApp.use(bodyParser.json());
      testApp.use(
        '/items',
        create(ModelWithMiddleware, {
          middleware: [
            (req, res, next) => {
              middlewareRan.push('user-middleware');
              next();
            },
          ],
        })
      );

      const createRes = await request(testApp)
        .post('/items')
        .send({ name: 'Test' });

      expect(createRes.status).toBe(201);
      // User middleware should override model middleware (last one wins)
      expect(middlewareRan).toContain('user-middleware');
    });
  });

  describe('hooks from model config', () => {
    test('should apply pre/post hooks from model default config', async () => {
      const hooksRan = [];

      const ModelWithHooks = sequelize.define(
        'ModelWithHooks',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          name: {
            type: DataTypes.STRING(100),
            allowNull: false,
          },
        },
        {
          tableName: 'test_hooks',
          timestamps: false,
          apialize: {
            default: {
              pre: (context) => {
                hooksRan.push('model-pre');
              },
              post: (context) => {
                hooksRan.push('model-post');
              },
            },
          },
        }
      );

      await ModelWithHooks.sync({ force: true });

      const testApp = express();
      testApp.use(bodyParser.json());
      testApp.use('/items', create(ModelWithHooks));

      const createRes = await request(testApp)
        .post('/items')
        .send({ name: 'Test' });

      expect(createRes.status).toBe(201);
      expect(hooksRan).toEqual(['model-pre', 'model-post']);
    });
  });

  describe('custom apialize context', () => {
    test('should use non-default context when apialize_context is specified', async () => {
      const CustomContextModel = sequelize.define(
        'CustomContextModel',
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
          tableName: 'custom_context_model',
          timestamps: false,
          apialize: {
            default: {
              id_mapping: 'external_id',
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
          },
        }
      );

      await CustomContextModel.sync({ force: true });

      const testApp = express();
      testApp.use(bodyParser.json());

      // Create endpoint
      testApp.use('/items', create(CustomContextModel));

      // Single endpoint using default context
      testApp.use('/items', single(CustomContextModel));

      // Single endpoint using alternate context
      testApp.use(
        '/alt-items',
        single(CustomContextModel, { apialize_context: 'alternate' })
      );

      // Create a test record
      const item = await CustomContextModel.create({
        external_id: 'EXT-001',
        alt_id: 'ALT-001',
        name: 'Test Item',
      });

      // Fetch using default context (should use external_id)
      const defaultRes = await request(testApp).get('/items/EXT-001');
      expect(defaultRes.status).toBe(200);
      expect(defaultRes.body.record.id).toBe('EXT-001');
      expect(defaultRes.body.record.name).toBe('Test Item');

      // Fetch using alternate context (should use alt_id)
      const altRes = await request(testApp).get('/alt-items/ALT-001');
      expect(altRes.status).toBe(200);
      expect(altRes.body.record.id).toBe('ALT-001');
      expect(altRes.body.record.name).toBe('Test Item');

      // Verify default context doesn't work with alt_id
      const wrongRes = await request(testApp).get('/items/ALT-001');
      expect(wrongRes.status).toBe(404);
    });

    test('should use non-default context for list operation', async () => {
      const ListContextModel = sequelize.define(
        'ListContextModel',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          name: {
            type: DataTypes.STRING(100),
            allowNull: false,
          },
        },
        {
          tableName: 'list_context_model',
          timestamps: false,
          apialize: {
            list: {
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

      await ListContextModel.sync({ force: true });

      // Create 50 test records
      for (let i = 1; i <= 50; i++) {
        await ListContextModel.create({ name: `Item ${i}` });
      }

      const testApp = express();
      testApp.use(bodyParser.json());

      // List endpoint using default context
      testApp.use('/items', list(ListContextModel));

      // List endpoint using large context
      testApp.use(
        '/large-items',
        list(ListContextModel, { apialize_context: 'large' })
      );

      // Fetch using default context (should get 10 items)
      const defaultRes = await request(testApp).get('/items');
      expect(defaultRes.status).toBe(200);
      expect(defaultRes.body.data.length).toBe(10);

      // Fetch using large context (should get 50 items)
      const largeRes = await request(testApp).get('/large-items');
      expect(largeRes.status).toBe(200);
      expect(largeRes.body.data.length).toBe(50);
    });

    test('should use non-default context for create operation hooks', async () => {
      const hooksRan = [];

      const CreateContextModel = sequelize.define(
        'CreateContextModel',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          name: {
            type: DataTypes.STRING(100),
            allowNull: false,
          },
        },
        {
          tableName: 'create_context_model',
          timestamps: false,
          apialize: {
            create: {
              default: {
                pre: () => {
                  hooksRan.push('default-pre');
                },
                post: () => {
                  hooksRan.push('default-post');
                },
              },
              admin: {
                pre: () => {
                  hooksRan.push('admin-pre');
                },
                post: () => {
                  hooksRan.push('admin-post');
                },
              },
            },
          },
        }
      );

      await CreateContextModel.sync({ force: true });

      const testApp = express();
      testApp.use(bodyParser.json());

      // Create endpoint using default context
      testApp.use('/items', create(CreateContextModel));

      // Create endpoint using admin context
      testApp.use(
        '/admin-items',
        create(CreateContextModel, { apialize_context: 'admin' })
      );

      // Create using default context
      hooksRan.length = 0;
      const defaultRes = await request(testApp)
        .post('/items')
        .send({ name: 'Default Item' });
      expect(defaultRes.status).toBe(201);
      expect(hooksRan).toEqual(['default-pre', 'default-post']);

      // Create using admin context
      hooksRan.length = 0;
      const adminRes = await request(testApp)
        .post('/admin-items')
        .send({ name: 'Admin Item' });
      expect(adminRes.status).toBe(201);
      expect(hooksRan).toEqual(['admin-pre', 'admin-post']);
    });
  });
});
