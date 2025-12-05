const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { create, update, patch, destroy, list, single } = require('../src');

describe('Context snake_case aliases', () => {
  let sequelize;
  let Item;
  let app;

  beforeAll(async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    Item = sequelize.define(
      'Item',
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
        status: {
          type: DataTypes.STRING(50),
          allowNull: true,
        },
      },
      { tableName: 'items', timestamps: false }
    );

    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    if (sequelize) {
      await sequelize.close();
    }
  });

  beforeEach(async () => {
    await Item.destroy({ where: {} });
    app = express();
    app.use(bodyParser.json());
  });

  describe('id_mapping snake_case alias', () => {
    test('should be available in create pre hook', async () => {
      let capturedIdMapping;

      app.use(
        '/items',
        create(Item, {
          id_mapping: 'external_id',
          pre: async (context) => {
            capturedIdMapping = context.id_mapping;
            expect(context.id_mapping).toBe('external_id');
            expect(context.idMapping).toBe('external_id');
            expect(context.id_mapping).toBe(context.idMapping);
          },
        })
      );

      const res = await request(app)
        .post('/items')
        .send({ external_id: 'ext-1', name: 'Test Item' });

      expect(res.status).toBe(201);
      expect(capturedIdMapping).toBe('external_id');
    });

    test('should be available in create post hook', async () => {
      let capturedIdMapping;

      app.use(
        '/items',
        create(Item, {
          id_mapping: 'external_id',
          post: async (context) => {
            capturedIdMapping = context.id_mapping;
            expect(context.id_mapping).toBe('external_id');
            expect(context.idMapping).toBe('external_id');
            expect(context.id_mapping).toBe(context.idMapping);
          },
        })
      );

      const res = await request(app)
        .post('/items')
        .send({ external_id: 'ext-2', name: 'Test Item' });

      expect(res.status).toBe(201);
      expect(capturedIdMapping).toBe('external_id');
    });

    test('should be available in update pre hook', async () => {
      const created = await Item.create({
        external_id: 'ext-3',
        name: 'Original',
      });

      let capturedIdMapping;

      app.use(
        '/items',
        update(Item, {
          id_mapping: 'external_id',
          pre: async (context) => {
            capturedIdMapping = context.id_mapping;
            expect(context.id_mapping).toBe('external_id');
            expect(context.idMapping).toBe('external_id');
          },
        })
      );

      const res = await request(app)
        .put('/items/ext-3')
        .send({ external_id: 'ext-3', name: 'Updated' });

      expect(res.status).toBe(200);
      expect(capturedIdMapping).toBe('external_id');
    });

    test('should be available in patch pre and post hooks', async () => {
      const created = await Item.create({
        external_id: 'ext-4',
        name: 'Original',
      });

      let preIdMapping;
      let postIdMapping;

      app.use(
        '/items',
        patch(Item, {
          id_mapping: 'external_id',
          pre: async (context) => {
            preIdMapping = context.id_mapping;
            expect(context.id_mapping).toBe('external_id');
          },
          post: async (context) => {
            postIdMapping = context.id_mapping;
            expect(context.id_mapping).toBe('external_id');
          },
        })
      );

      const res = await request(app)
        .patch('/items/ext-4')
        .send({ name: 'Patched' });

      expect(res.status).toBe(200);
      expect(preIdMapping).toBe('external_id');
      expect(postIdMapping).toBe('external_id');
    });

    test('should be available in destroy pre and post hooks', async () => {
      const created = await Item.create({
        external_id: 'ext-5',
        name: 'To Delete',
      });

      let preIdMapping;
      let postIdMapping;

      app.use(
        '/items',
        destroy(Item, {
          id_mapping: 'external_id',
          pre: async (context) => {
            preIdMapping = context.id_mapping;
            expect(context.id_mapping).toBe('external_id');
          },
          post: async (context) => {
            postIdMapping = context.id_mapping;
            expect(context.id_mapping).toBe('external_id');
          },
        })
      );

      const res = await request(app).delete('/items/ext-5');

      expect(res.status).toBe(200);
      expect(preIdMapping).toBe('external_id');
      expect(postIdMapping).toBe('external_id');
    });

    test('should be available in list pre and post hooks', async () => {
      await Item.bulkCreate([
        { external_id: 'ext-6', name: 'Item 1' },
        { external_id: 'ext-7', name: 'Item 2' },
      ]);

      let preIdMapping;
      let postIdMapping;

      app.use(
        '/items',
        list(Item, {
          id_mapping: 'external_id',
          pre: async (context) => {
            preIdMapping = context.id_mapping;
            expect(context.id_mapping).toBe('external_id');
          },
          post: async (context) => {
            postIdMapping = context.id_mapping;
            expect(context.id_mapping).toBe('external_id');
          },
        })
      );

      const res = await request(app).get('/items');

      expect(res.status).toBe(200);
      expect(preIdMapping).toBe('external_id');
      expect(postIdMapping).toBe('external_id');
    });

    test('should be available in single pre and post hooks', async () => {
      const created = await Item.create({
        external_id: 'ext-8',
        name: 'Single Item',
      });

      let preIdMapping;
      let postIdMapping;

      app.use(
        '/items',
        single(Item, {
          id_mapping: 'external_id',
          param_name: 'id',
          pre: async (context) => {
            preIdMapping = context.id_mapping;
            expect(context.id_mapping).toBe('external_id');
          },
          post: async (context) => {
            postIdMapping = context.id_mapping;
            expect(context.id_mapping).toBe('external_id');
          },
        })
      );

      const res = await request(app).get('/items/ext-8');

      expect(res.status).toBe(200);
      expect(preIdMapping).toBe('external_id');
      expect(postIdMapping).toBe('external_id');
    });

    test('should default to "id" when no id_mapping specified', async () => {
      let capturedIdMapping;

      app.use(
        '/items',
        create(Item, {
          pre: async (context) => {
            capturedIdMapping = context.id_mapping;
            expect(context.id_mapping).toBe('id');
            expect(context.idMapping).toBe('id');
          },
        })
      );

      const res = await request(app)
        .post('/items')
        .send({ external_id: 'ext-9', name: 'Default ID' });

      expect(res.status).toBe(201);
      expect(capturedIdMapping).toBe('id');
    });
  });

  describe('model_options snake_case alias', () => {
    test('should be available in create pre hook', async () => {
      let capturedModelOptions;

      const testModelOptions = {
        attributes: ['id', 'external_id', 'name'],
      };

      app.use(
        '/items',
        create(
          Item,
          {
            pre: async (context) => {
              capturedModelOptions = context.model_options;
              expect(context.model_options).toBeDefined();
              expect(context.modelOptions).toBeDefined();
              expect(context.model_options).toBe(context.modelOptions);
              expect(context.model_options.attributes).toEqual([
                'id',
                'external_id',
                'name',
              ]);
            },
          },
          testModelOptions
        )
      );

      const res = await request(app)
        .post('/items')
        .send({ external_id: 'ext-10', name: 'Test' });

      expect(res.status).toBe(201);
      expect(capturedModelOptions).toBeDefined();
      expect(capturedModelOptions.attributes).toEqual([
        'id',
        'external_id',
        'name',
      ]);
    });

    test('should be available in update post hook', async () => {
      const created = await Item.create({
        external_id: 'ext-11',
        name: 'Original',
        status: 'active',
      });

      let capturedModelOptions;

      const testModelOptions = {
        attributes: ['id', 'name'],
      };

      app.use(
        '/items',
        update(
          Item,
          {
            post: async (context) => {
              capturedModelOptions = context.model_options;
              expect(context.model_options).toBeDefined();
              expect(context.modelOptions).toBeDefined();
              expect(context.model_options).toBe(context.modelOptions);
            },
          },
          testModelOptions
        )
      );

      const res = await request(app)
        .put(`/items/${created.id}`)
        .send({ external_id: 'ext-11', name: 'Updated' });

      expect(res.status).toBe(200);
      expect(capturedModelOptions).toBeDefined();
    });

    test('should be available in list pre and post hooks with scopes', async () => {
      await Item.bulkCreate([
        { external_id: 'ext-12', name: 'Item 1', status: 'active' },
        { external_id: 'ext-13', name: 'Item 2', status: 'inactive' },
      ]);

      let preModelOptions;
      let postModelOptions;

      const testModelOptions = {
        attributes: ['id', 'name', 'status'],
        where: { status: 'active' },
      };

      app.use(
        '/items',
        list(
          Item,
          {
            pre: async (context) => {
              preModelOptions = context.model_options;
              expect(context.model_options).toBeDefined();
              expect(context.model_options.attributes).toEqual([
                'id',
                'name',
                'status',
              ]);
            },
            post: async (context) => {
              postModelOptions = context.model_options;
              expect(context.model_options).toBeDefined();
            },
          },
          testModelOptions
        )
      );

      const res = await request(app).get('/items');

      expect(res.status).toBe(200);
      expect(preModelOptions).toBeDefined();
      expect(postModelOptions).toBeDefined();
    });

    test('should be available in single hooks', async () => {
      const created = await Item.create({
        external_id: 'ext-14',
        name: 'Single Test',
        status: 'active',
      });

      let preModelOptions;
      let postModelOptions;

      const testModelOptions = {
        attributes: ['id', 'external_id', 'name'],
      };

      app.use(
        '/items',
        single(
          Item,
          {
            pre: async (context) => {
              preModelOptions = context.model_options;
              expect(context.model_options).toBeDefined();
              expect(context.model_options).toBe(context.modelOptions);
            },
            post: async (context) => {
              postModelOptions = context.model_options;
              expect(context.model_options).toBeDefined();
            },
          },
          testModelOptions
        )
      );

      const res = await request(app).get(`/items/${created.id}`);

      expect(res.status).toBe(200);
      expect(preModelOptions).toBeDefined();
      expect(postModelOptions).toBeDefined();
    });

    test('should handle empty model_options', async () => {
      let capturedModelOptions;

      app.use(
        '/items',
        create(Item, {
          pre: async (context) => {
            capturedModelOptions = context.model_options;
            expect(context.model_options).toBeDefined();
            expect(context.modelOptions).toBeDefined();
            expect(context.model_options).toBe(context.modelOptions);
            // Empty object is valid
            expect(typeof context.model_options).toBe('object');
          },
        })
      );

      const res = await request(app)
        .post('/items')
        .send({ external_id: 'ext-15', name: 'Empty ModelOptions' });

      expect(res.status).toBe(201);
      expect(capturedModelOptions).toBeDefined();
    });
  });

  describe('both aliases together', () => {
    test('should both be available in same hook', async () => {
      let preCaptures = {};
      let postCaptures = {};

      const testModelOptions = {
        attributes: ['id', 'external_id', 'name'],
      };

      app.use(
        '/items',
        create(
          Item,
          {
            id_mapping: 'external_id',
            pre: async (context) => {
              preCaptures.id_mapping = context.id_mapping;
              preCaptures.idMapping = context.idMapping;
              preCaptures.model_options = context.model_options;
              preCaptures.modelOptions = context.modelOptions;

              expect(context.id_mapping).toBe('external_id');
              expect(context.idMapping).toBe('external_id');
              expect(context.id_mapping).toBe(context.idMapping);

              expect(context.model_options).toBeDefined();
              expect(context.modelOptions).toBeDefined();
              expect(context.model_options).toBe(context.modelOptions);
            },
            post: async (context) => {
              postCaptures.id_mapping = context.id_mapping;
              postCaptures.idMapping = context.idMapping;
              postCaptures.model_options = context.model_options;
              postCaptures.modelOptions = context.modelOptions;

              expect(context.id_mapping).toBe('external_id');
              expect(context.idMapping).toBe('external_id');
              expect(context.model_options).toBe(context.modelOptions);
            },
          },
          testModelOptions
        )
      );

      const res = await request(app)
        .post('/items')
        .send({ external_id: 'ext-16', name: 'Both Aliases' });

      expect(res.status).toBe(201);
      expect(preCaptures.id_mapping).toBe('external_id');
      expect(preCaptures.idMapping).toBe('external_id');
      expect(preCaptures.model_options).toBeDefined();
      expect(postCaptures.id_mapping).toBe('external_id');
      expect(postCaptures.model_options).toBeDefined();
    });

    test('should work in array of hooks', async () => {
      const captures = [];

      app.use(
        '/items',
        create(Item, {
          id_mapping: 'external_id',
          pre: [
            async (context) => {
              captures.push({
                hook: 'pre1',
                id_mapping: context.id_mapping,
                model_options: context.model_options,
              });
              expect(context.id_mapping).toBe('external_id');
              expect(context.model_options).toBeDefined();
            },
            async (context) => {
              captures.push({
                hook: 'pre2',
                id_mapping: context.id_mapping,
                model_options: context.model_options,
              });
              expect(context.id_mapping).toBe('external_id');
              expect(context.model_options).toBeDefined();
            },
          ],
          post: [
            async (context) => {
              captures.push({
                hook: 'post1',
                id_mapping: context.id_mapping,
                model_options: context.model_options,
              });
              expect(context.id_mapping).toBe('external_id');
            },
            async (context) => {
              captures.push({
                hook: 'post2',
                id_mapping: context.id_mapping,
                model_options: context.model_options,
              });
              expect(context.id_mapping).toBe('external_id');
            },
          ],
        })
      );

      const res = await request(app)
        .post('/items')
        .send({ external_id: 'ext-17', name: 'Array Hooks' });

      expect(res.status).toBe(201);
      expect(captures).toHaveLength(4);
      expect(captures[0].hook).toBe('pre1');
      expect(captures[0].id_mapping).toBe('external_id');
      expect(captures[1].hook).toBe('pre2');
      expect(captures[2].hook).toBe('post1');
      expect(captures[3].hook).toBe('post2');
    });
  });
});
