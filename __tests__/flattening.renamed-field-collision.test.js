const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list, search } = require('../src');

describe('Flattening Renamed Field Collision', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  async function buildAppAndModels() {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    const MainModel = sequelize.define(
      'MainModel',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING, allowNull: false },
        description: { type: DataTypes.STRING, allowNull: true },
      },
      {
        timestamps: false,
        tableName: 'main_models',
      }
    );

    const RelatedModel = sequelize.define(
      'RelatedModel',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        main_model_id: { type: DataTypes.INTEGER, allowNull: false },
        name: { type: DataTypes.STRING, allowNull: false },
        value: { type: DataTypes.STRING, allowNull: true },
      },
      {
        timestamps: false,
        tableName: 'related_models',
      }
    );

    // Associations - using hasMany to match the pattern in other tests
    MainModel.hasMany(RelatedModel, { foreignKey: 'main_model_id', as: 'Related' });
    RelatedModel.belongsTo(MainModel, { foreignKey: 'main_model_id', as: 'Main' });

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());

    return { sequelize, MainModel, RelatedModel, app };
  }

  async function seedData(MainModel, RelatedModel) {
    const main1 = await MainModel.create({
      name: 'Main One',
      description: 'First main model',
    });

    const main2 = await MainModel.create({
      name: 'Main Two',
      description: 'Second main model',
    });

    const main3 = await MainModel.create({
      name: 'Main Three',
      description: 'Third main model',
    });

    await RelatedModel.create({
      main_model_id: main1.id,
      name: 'Related One',
      value: 'value1',
    });

    await RelatedModel.create({
      main_model_id: main2.id,
      name: 'Related Two',
      value: 'value2',
    });

    await RelatedModel.create({
      main_model_id: main3.id,
      name: 'Related Three',
      value: 'value3',
    });

    return { main1, main2, main3 };
  }

  describe('Field Name Collision - List Endpoint', () => {
    test('should filter by renamed flattened field, not main model field with same name', async () => {
      const ctx = await buildAppAndModels();
      const { MainModel, RelatedModel, app } = ctx;
      await seedData(MainModel, RelatedModel);

      // Here we rename the related model's "name" field to "related_model_name"
      // The main model also has a "name" field
      app.use(
        '/main',
        list(
          MainModel,
          {
            flattening: {
              model: RelatedModel,
              as: 'Related',
              attributes: [
                ['name', 'related_model_name'], // Rename to avoid collision
                'value',
              ],
            },
          },
          {
            include: [{ model: RelatedModel, as: 'Related', required: true }],
          }
        )
      );

      // Test 1: Filter by the renamed field - should match related model's name
      const res1 = await request(app).get('/main?related_model_name=Related One');

      expect(res1.status).toBe(200);
      expect(res1.body.data).toHaveLength(1);
      expect(res1.body.data[0].related_model_name).toBe('Related One');
      expect(res1.body.data[0].name).toBe('Main One'); // Main model's name field

      // Test 2: Filter by main model's name field - should still work
      const res2 = await request(app).get('/main?name=Main Two');

      expect(res2.status).toBe(200);
      expect(res2.body.data).toHaveLength(1);
      expect(res2.body.data[0].name).toBe('Main Two');
      expect(res2.body.data[0].related_model_name).toBe('Related Two');

      // Test 3: Verify the issue - when filtering by related_model_name,
      // it should NOT match the main model's name field
      const res3 = await request(app).get('/main?related_model_name=Main One');

      // This should return 0 results because "Main One" is the main model's name,
      // not the related model's name
      expect(res3.status).toBe(200);
      expect(res3.body.data).toHaveLength(0); // Should be 0, not 1
    });

    test('should use icontains operator on renamed flattened field correctly', async () => {
      const ctx = await buildAppAndModels();
      const { MainModel, RelatedModel, app } = ctx;
      await seedData(MainModel, RelatedModel);

      app.use(
        '/main',
        list(
          MainModel,
          {
            flattening: {
              model: RelatedModel,
              as: 'Related',
              attributes: [['name', 'related_model_name']],
            },
          },
          {
            include: [{ model: RelatedModel, as: 'Related', required: true }],
          }
        )
      );

      // Filter using icontains on the renamed field
      const res = await request(app).get('/main?related_model_name:icontains=related');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3); // All three have "Related" in related model's name

      // Verify none of them match based on main model's name field
      const res2 = await request(app).get('/main?related_model_name:icontains=main');

      expect(res2.status).toBe(200);
      expect(res2.body.data).toHaveLength(0); // Should be 0, not 3
    });
  });

  describe('Field Name Collision - Search Endpoint', () => {
    test('should filter by renamed flattened field in search, not main model field', async () => {
      const ctx = await buildAppAndModels();
      const { MainModel, RelatedModel, app } = ctx;
      await seedData(MainModel, RelatedModel);

      app.use(
        '/main/search',
        search(
          MainModel,
          {
            path: '/',
            flattening: {
              model: RelatedModel,
              as: 'Related',
              attributes: [
                ['name', 'related_model_name'],
                'value',
              ],
            },
          },
          {
            include: [{ model: RelatedModel, as: 'Related', required: true }],
          }
        )
      );

      // Test 1: Filter by renamed field using exact match
      const res1 = await request(app)
        .post('/main/search')
        .send({
          filtering: {
            related_model_name: 'Related One',
          },
        });

      expect(res1.status).toBe(200);
      expect(res1.body.data).toHaveLength(1);
      expect(res1.body.data[0].related_model_name).toBe('Related One');
      expect(res1.body.data[0].name).toBe('Main One');

      // Test 2: Filter by renamed field using operator
      const res2 = await request(app)
        .post('/main/search')
        .send({
          filtering: {
            related_model_name: { icontains: 'related' },
          },
        });

      expect(res2.status).toBe(200);
      expect(res2.body.data).toHaveLength(3);

      // Test 3: Verify the issue - should NOT match main model's name
      const res3 = await request(app)
        .post('/main/search')
        .send({
          filtering: {
            related_model_name: 'Main One',
          },
        });

      expect(res3.status).toBe(200);
      expect(res3.body.data).toHaveLength(0); // Should be 0, not 1

      // Test 4: Verify icontains doesn't match main model field
      const res4 = await request(app)
        .post('/main/search')
        .send({
          filtering: {
            related_model_name: { icontains: 'main' },
          },
        });

      expect(res4.status).toBe(200);
      expect(res4.body.data).toHaveLength(0); // Should be 0, not 3
    });

    test('should combine filters on renamed flattened field and main model field', async () => {
      const ctx = await buildAppAndModels();
      const { MainModel, RelatedModel, app } = ctx;
      await seedData(MainModel, RelatedModel);

      app.use(
        '/main/search',
        search(
          MainModel,
          {
            path: '/',
            flattening: {
              model: RelatedModel,
              as: 'Related',
              attributes: [['name', 'related_model_name']],
            },
          },
          {
            include: [{ model: RelatedModel, as: 'Related', required: true }],
          }
        )
      );

      // Filter by both fields - each should reference the correct model
      const res = await request(app)
        .post('/main/search')
        .send({
          filtering: {
            name: 'Main One', // Main model's name
            related_model_name: 'Related One', // Related model's name (renamed)
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Main One');
      expect(res.body.data[0].related_model_name).toBe('Related One');
    });

    test('should support OR filters with both renamed flattened and main model fields', async () => {
      const ctx = await buildAppAndModels();
      const { MainModel, RelatedModel, app } = ctx;
      await seedData(MainModel, RelatedModel);

      app.use(
        '/main/search',
        search(
          MainModel,
          {
            path: '/',
            flattening: {
              model: RelatedModel,
              as: 'Related',
              attributes: [['name', 'related_model_name']],
            },
          },
          {
            include: [{ model: RelatedModel, as: 'Related', required: true }],
          }
        )
      );

      // OR filter: match either by main model's name OR related model's name
      const res = await request(app)
        .post('/main/search')
        .send({
          filtering: {
            or: [
              { related_model_name: 'Related One' }, // Should match Main One
              { name: 'Main Two' }, // Should match Main Two
            ],
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      
      const names = res.body.data.map(d => d.name).sort();
      expect(names).toEqual(['Main One', 'Main Two']);
    });

    test('should support complex nested AND/OR filters with renamed fields', async () => {
      const ctx = await buildAppAndModels();
      const { MainModel, RelatedModel, app } = ctx;
      await seedData(MainModel, RelatedModel);

      app.use(
        '/main/search',
        search(
          MainModel,
          {
            path: '/',
            flattening: {
              model: RelatedModel,
              as: 'Related',
              attributes: [['name', 'related_model_name'], 'value'],
            },
          },
          {
            include: [{ model: RelatedModel, as: 'Related', required: true }],
          }
        )
      );

      // Complex filter: (main.name contains "Two" OR related.name contains "One") 
      const res = await request(app)
        .post('/main/search')
        .send({
          filtering: {
            or: [
              { name: { icontains: 'Two' } }, // Main Two
              { related_model_name: { icontains: 'One' } }, // Related One (Main One)
            ],
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      
      const names = res.body.data.map(d => d.name).sort();
      expect(names).toEqual(['Main One', 'Main Two']);
    });

    test('should order by renamed flattened field correctly', async () => {
      const ctx = await buildAppAndModels();
      const { MainModel, RelatedModel, app } = ctx;
      await seedData(MainModel, RelatedModel);

      app.use(
        '/main/search',
        search(
          MainModel,
          {
            path: '/',
            flattening: {
              model: RelatedModel,
              as: 'Related',
              attributes: [['name', 'related_model_name']],
            },
          },
          {
            include: [{ model: RelatedModel, as: 'Related', required: true }],
          }
        )
      );

      // Order by the renamed flattened field
      const res = await request(app)
        .post('/main/search')
        .send({
          ordering: [
            {
              order_by: 'related_model_name',
              direction: 'DESC',
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      
      // DESC alphabetical order: Two > Three > One
      expect(res.body.data[0].related_model_name).toBe('Related Two');
      expect(res.body.data[1].related_model_name).toBe('Related Three');
      expect(res.body.data[2].related_model_name).toBe('Related One');
    });
  });
});
