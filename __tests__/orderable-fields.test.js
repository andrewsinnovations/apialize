const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list, search } = require('../src');

describe('Ordering Field Controls', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  async function buildAppAndModel(listOptions = {}, searchOptions = {}) {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    const Item = sequelize.define(
      'Item',
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        external_id: {
          type: DataTypes.STRING(50),
          allowNull: false,
          unique: true,
        },
        name: {
          type: DataTypes.STRING(100),
          allowNull: false,
        },
        category: {
          type: DataTypes.STRING(50),
          allowNull: true,
        },
        price: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: true,
        },
        score: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        status: {
          type: DataTypes.STRING(20),
          allowNull: true,
        },
      },
      {
        tableName: 'items',
        timestamps: false,
      }
    );

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());

    app.use('/items', list(Item, listOptions));
    app.use('/items', search(Item, searchOptions));

    return { Item, app };
  }

  async function seedData(Item) {
    await Item.bulkCreate([
      {
        external_id: 'item-1',
        name: 'Product A',
        category: 'electronics',
        price: 99.99,
        score: 85,
        status: 'active',
      },
      {
        external_id: 'item-2',
        name: 'Product B',
        category: 'books',
        price: 19.99,
        score: 92,
        status: 'inactive',
      },
      {
        external_id: 'item-3',
        name: 'Product C',
        category: 'electronics',
        price: 149.99,
        score: 78,
        status: 'active',
      },
    ]);
  }

  describe('List endpoint with allow_ordering_on', () => {
    test('allows ordering on fields in allow_ordering_on list', async () => {
      const { Item, app } = await buildAppAndModel({
        allow_ordering_on: ['name', 'score'],
      });
      await seedData(Item);

      // Order by name (allowed)
      const res1 = await request(app).get('/items?api:order_by=name');
      expect(res1.status).toBe(200);
      expect(res1.body.data.length).toBe(3);
      expect(res1.body.data[0].name).toBe('Product A');
      expect(res1.body.data[1].name).toBe('Product B');
      expect(res1.body.data[2].name).toBe('Product C');

      // Order by score (allowed)
      const res2 = await request(app).get(
        '/items?api:order_by=score&api:order_dir=DESC'
      );
      expect(res2.status).toBe(200);
      expect(res2.body.data.length).toBe(3);
      expect(res2.body.data[0].score).toBe(92);
      expect(res2.body.data[1].score).toBe(85);
      expect(res2.body.data[2].score).toBe(78);
    });

    test('returns 400 when ordering on field not in allow_ordering_on list', async () => {
      const { Item, app } = await buildAppAndModel({
        allow_ordering_on: ['name', 'score'],
      });
      await seedData(Item);

      // Try to order by category (not allowed)
      const res = await request(app).get('/items?api:order_by=category');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Bad request');
    });

    test('returns 400 when ordering on field with direction prefix not in allow list', async () => {
      const { Item, app } = await buildAppAndModel({
        allow_ordering_on: ['name'],
      });
      await seedData(Item);

      // Try to order by -price (not allowed)
      const res = await request(app).get('/items?api:order_by=-price');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('allows all fields when allow_ordering_on is null (default)', async () => {
      const { Item, app } = await buildAppAndModel({
        allow_ordering_on: null,
      });
      await seedData(Item);

      // Should allow ordering on any field
      const res1 = await request(app).get('/items?api:order_by=price');
      expect(res1.status).toBe(200);
      expect(res1.body.data.length).toBe(3);

      const res2 = await request(app).get('/items?api:order_by=category');
      expect(res2.status).toBe(200);
      expect(res2.body.data.length).toBe(3);
    });

    test('allows all fields when allow_ordering_on is not specified', async () => {
      const { Item, app } = await buildAppAndModel({});
      await seedData(Item);

      // Should allow ordering on any field
      const res = await request(app).get('/items?api:order_by=status');
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(3);
    });

    test('allows multiple order fields if all are in allow list', async () => {
      const { Item, app } = await buildAppAndModel({
        allow_ordering_on: ['category', 'name'],
      });
      await seedData(Item);

      const res = await request(app).get('/items?api:order_by=category,name');
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(3);
      // electronics products should come before books
      expect(res.body.data[0].category).toBe('books');
      expect(res.body.data[1].category).toBe('electronics');
    });

    test('returns 400 when one field in multi-field order is not allowed', async () => {
      const { Item, app } = await buildAppAndModel({
        allow_ordering_on: ['category'],
      });
      await seedData(Item);

      // category is allowed, but name is not
      const res = await request(app).get('/items?api:order_by=category,name');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('blocks ordering when allow_ordering_on is empty array', async () => {
      const { Item, app } = await buildAppAndModel({
        allow_ordering_on: [],
      });
      await seedData(Item);

      const res = await request(app).get('/items?api:order_by=name');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('default ordering still works when not specified in query', async () => {
      const { Item, app } = await buildAppAndModel({
        allow_ordering_on: ['name', 'score'],
        default_order_by: 'score',
        default_order_dir: 'DESC',
      });
      await seedData(Item);

      // No order_by in query, should use default
      const res = await request(app).get('/items');
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(3);
      // Should be ordered by score DESC
      expect(res.body.data[0].score).toBe(92);
      expect(res.body.data[1].score).toBe(85);
      expect(res.body.data[2].score).toBe(78);
    });
  });

  describe('Search endpoint with allow_ordering_on', () => {
    test('allows ordering on fields in allow_ordering_on list', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {
          allow_ordering_on: ['name', 'price'],
        }
      );
      await seedData(Item);

      const res = await request(app)
        .post('/items/search')
        .send({
          ordering: [{ order_by: 'price', direction: 'ASC' }],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(3);
      expect(parseFloat(res.body.data[0].price)).toBe(19.99);
      expect(parseFloat(res.body.data[1].price)).toBe(99.99);
      expect(parseFloat(res.body.data[2].price)).toBe(149.99);
    });

    test('returns 400 when ordering on field not in allow_ordering_on list', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {
          allow_ordering_on: ['name', 'price'],
        }
      );
      await seedData(Item);

      const res = await request(app)
        .post('/items/search')
        .send({
          ordering: [{ order_by: 'category', direction: 'ASC' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Bad request');
    });

    test('allows multiple order fields if all are in allow list', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {
          allow_ordering_on: ['category', 'score'],
        }
      );
      await seedData(Item);

      const res = await request(app)
        .post('/items/search')
        .send({
          ordering: [
            { order_by: 'category', direction: 'ASC' },
            { order_by: 'score', direction: 'DESC' },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(3);
    });

    test('returns 400 when one field in multi-field ordering not allowed', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {
          allow_ordering_on: ['category'],
        }
      );
      await seedData(Item);

      const res = await request(app)
        .post('/items/search')
        .send({
          ordering: [
            { order_by: 'category', direction: 'ASC' },
            { order_by: 'score', direction: 'DESC' },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('allows all fields when allow_ordering_on is null', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {
          allow_ordering_on: null,
        }
      );
      await seedData(Item);

      const res = await request(app)
        .post('/items/search')
        .send({
          ordering: [{ order_by: 'status', direction: 'DESC' }],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(3);
    });

    test('blocks all ordering when allow_ordering_on is empty array', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {
          allow_ordering_on: [],
        }
      );
      await seedData(Item);

      const res = await request(app)
        .post('/items/search')
        .send({
          ordering: [{ order_by: 'name', direction: 'ASC' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('ordering can be combined with filtering', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {
          allow_ordering_on: ['price'],
          allow_filtering_on: ['category'],
        }
      );
      await seedData(Item);

      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: {
            category: 'electronics',
          },
          ordering: [{ order_by: 'price', direction: 'DESC' }],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(parseFloat(res.body.data[0].price)).toBe(149.99);
      expect(parseFloat(res.body.data[1].price)).toBe(99.99);
    });
  });

  describe('Block ordering configuration', () => {
    describe('List endpoint with block_ordering_on', () => {
      test('blocks ordering on fields in block_ordering_on list', async () => {
        const { Item, app } = await buildAppAndModel({
          block_ordering_on: ['price', 'score'],
        });
        await seedData(Item);

        // Try to order by price (blocked)
        const res1 = await request(app).get('/items?api:order_by=price');
        expect(res1.status).toBe(400);
        expect(res1.body.success).toBe(false);

        // Try to order by score (blocked)
        const res2 = await request(app).get('/items?api:order_by=score');
        expect(res2.status).toBe(400);
        expect(res2.body.success).toBe(false);
      });

      test('allows ordering on fields not in block_ordering_on list', async () => {
        const { Item, app } = await buildAppAndModel({
          block_ordering_on: ['price', 'score'],
        });
        await seedData(Item);

        // Order by name (allowed)
        const res1 = await request(app).get('/items?api:order_by=name');
        expect(res1.status).toBe(200);
        expect(res1.body.data.length).toBe(3);

        // Order by category (allowed)
        const res2 = await request(app).get('/items?api:order_by=category');
        expect(res2.status).toBe(200);
        expect(res2.body.data.length).toBe(3);
      });

      test('allows all fields when block_ordering_on is null', async () => {
        const { Item, app } = await buildAppAndModel({
          block_ordering_on: null,
        });
        await seedData(Item);

        const res = await request(app).get('/items?api:order_by=price');
        expect(res.status).toBe(200);
        expect(res.body.data.length).toBe(3);
      });

      test('allows all fields when block_ordering_on is empty array', async () => {
        const { Item, app } = await buildAppAndModel({
          block_ordering_on: [],
        });
        await seedData(Item);

        const res = await request(app).get('/items?api:order_by=score');
        expect(res.status).toBe(200);
        expect(res.body.data.length).toBe(3);
      });
    });

    describe('Search endpoint with block_ordering_on', () => {
      test('blocks ordering on fields in block_ordering_on list', async () => {
        const { Item, app } = await buildAppAndModel(
          {},
          {
            block_ordering_on: ['name', 'status'],
          }
        );
        await seedData(Item);

        // Try to order by name (blocked)
        const res1 = await request(app)
          .post('/items/search')
          .send({
            ordering: [{ order_by: 'name', direction: 'ASC' }],
          });
        expect(res1.status).toBe(400);
        expect(res1.body.success).toBe(false);

        // Try to order by status (blocked)
        const res2 = await request(app)
          .post('/items/search')
          .send({
            ordering: [{ order_by: 'status', direction: 'DESC' }],
          });
        expect(res2.status).toBe(400);
        expect(res2.body.success).toBe(false);
      });

      test('allows ordering on fields not in block_ordering_on list', async () => {
        const { Item, app } = await buildAppAndModel(
          {},
          {
            block_ordering_on: ['name', 'status'],
          }
        );
        await seedData(Item);

        const res = await request(app)
          .post('/items/search')
          .send({
            ordering: [
              { order_by: 'category', direction: 'ASC' },
              { order_by: 'price', direction: 'DESC' },
            ],
          });

        expect(res.status).toBe(200);
        expect(res.body.data.length).toBe(3);
      });

      test('blocks field in multi-field ordering', async () => {
        const { Item, app } = await buildAppAndModel(
          {},
          {
            block_ordering_on: ['score'],
          }
        );
        await seedData(Item);

        const res = await request(app)
          .post('/items/search')
          .send({
            ordering: [
              { order_by: 'category', direction: 'ASC' },
              { order_by: 'score', direction: 'DESC' },
            ],
          });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });
    });

    describe('Interaction between allow_ordering_on and block_ordering_on', () => {
      test('block_ordering_on takes precedence when both are configured', async () => {
        const { Item, app } = await buildAppAndModel(
          {},
          {
            allow_ordering_on: ['name', 'category', 'price'],
            block_ordering_on: ['price'], // price is in both - block wins
          }
        );
        await seedData(Item);

        // name and category are allowed
        const res1 = await request(app)
          .post('/items/search')
          .send({
            ordering: [{ order_by: 'name', direction: 'ASC' }],
          });
        expect(res1.status).toBe(200);

        // price is blocked even though it's in allow list
        const res2 = await request(app)
          .post('/items/search')
          .send({
            ordering: [{ order_by: 'price', direction: 'DESC' }],
          });
        expect(res2.status).toBe(400);
        expect(res2.body.success).toBe(false);
      });

      test('only fields in allow list and not in block list can be ordered', async () => {
        const { Item, app } = await buildAppAndModel(
          {},
          {
            allow_ordering_on: ['name', 'category', 'price'],
            block_ordering_on: ['price'],
          }
        );
        await seedData(Item);

        // score is not in allow list
        const res1 = await request(app)
          .post('/items/search')
          .send({
            ordering: [{ order_by: 'score', direction: 'DESC' }],
          });
        expect(res1.status).toBe(400);

        // name and category are in allow list and not in block list
        const res2 = await request(app)
          .post('/items/search')
          .send({
            ordering: [
              { order_by: 'category', direction: 'ASC' },
              { order_by: 'name', direction: 'DESC' },
            ],
          });
        expect(res2.status).toBe(200);
        expect(res2.body.data.length).toBe(3);
      });
    });
  });

  describe('Combined filtering and ordering controls', () => {
    test('allow_filtering_on and allow_ordering_on work independently', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {
          allow_filtering_on: ['category'],
          allow_ordering_on: ['price'],
        }
      );
      await seedData(Item);

      // Can filter by category and order by price
      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: {
            category: 'electronics',
          },
          ordering: [{ order_by: 'price', direction: 'ASC' }],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(parseFloat(res.body.data[0].price)).toBe(99.99);
    });

    test('cannot filter by ordering field and cannot order by filtering field', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {
          allow_filtering_on: ['category'],
          allow_ordering_on: ['price'],
        }
      );
      await seedData(Item);

      // Cannot filter by price
      const res1 = await request(app)
        .post('/items/search')
        .send({
          filtering: {
            price: { gte: 50 },
          },
        });
      expect(res1.status).toBe(400);

      // Cannot order by category
      const res2 = await request(app)
        .post('/items/search')
        .send({
          ordering: [{ order_by: 'category', direction: 'ASC' }],
        });
      expect(res2.status).toBe(400);
    });
  });
});
