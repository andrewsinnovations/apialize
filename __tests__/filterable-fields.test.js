const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list, search } = require('../src');

describe('Filtering Field Controls', () => {
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

  describe('List endpoint with allow_filtering_on', () => {
    test('allows filtering on fields in allow_filtering_on list', async () => {
      const { Item, app } = await buildAppAndModel({
        allow_filtering_on: ['category', 'status'],
      });
      await seedData(Item);

      // Filter by category (allowed)
      const res1 = await request(app).get('/items?category=electronics');
      expect(res1.status).toBe(200);
      expect(res1.body.data.length).toBe(2);
      expect(
        res1.body.data.every((item) => item.category === 'electronics')
      ).toBe(true);

      // Filter by status (allowed)
      const res2 = await request(app).get('/items?status=active');
      expect(res2.status).toBe(200);
      expect(res2.body.data.length).toBe(2);
      expect(res2.body.data.every((item) => item.status === 'active')).toBe(
        true
      );
    });

    test('returns 400 when filtering on field not in allow_filtering_on list', async () => {
      const { Item, app } = await buildAppAndModel({
        allow_filtering_on: ['category', 'status'],
      });
      await seedData(Item);

      // Try to filter by name (not allowed)
      const res = await request(app).get('/items?name=Product A');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Bad request');
    });

    test('returns 400 when filtering with operators on disallowed field', async () => {
      const { Item, app } = await buildAppAndModel({
        allow_filtering_on: ['category'],
      });
      await seedData(Item);

      // Try to filter by score with operator (not allowed)
      const res = await request(app).get('/items?score:gt=80');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('allows all fields when allow_filtering_on is null (default)', async () => {
      const { Item, app } = await buildAppAndModel({
        allow_filtering_on: null,
      });
      await seedData(Item);

      // Should allow filtering on any field
      const res1 = await request(app).get('/items?name=Product A');
      expect(res1.status).toBe(200);
      expect(res1.body.data.length).toBe(1);

      const res2 = await request(app).get('/items?score:gte=90');
      expect(res2.status).toBe(200);
      expect(res2.body.data.length).toBe(1);
      expect(res2.body.data[0].score).toBe(92);
    });

    test('allows all fields when allow_filtering_on is not specified', async () => {
      const { Item, app } = await buildAppAndModel({});
      await seedData(Item);

      // Should allow filtering on any field
      const res = await request(app).get('/items?price:lt=50');
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(parseFloat(res.body.data[0].price)).toBe(19.99);
    });

    test('allows multiple filters on allowed fields', async () => {
      const { Item, app } = await buildAppAndModel({
        allow_filtering_on: ['category', 'status'],
      });
      await seedData(Item);

      const res = await request(app).get(
        '/items?category=electronics&status=active'
      );
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(
        res.body.data.every(
          (item) => item.category === 'electronics' && item.status === 'active'
        )
      ).toBe(true);
    });

    test('blocks filtering when allow_filtering_on is empty array', async () => {
      const { Item, app } = await buildAppAndModel({
        allow_filtering_on: [],
      });
      await seedData(Item);

      const res = await request(app).get('/items?category=electronics');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Search endpoint with allow_filtering_on', () => {
    test('allows filtering on fields in allow_filtering_on list', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {
          allow_filtering_on: ['category', 'status'],
        }
      );
      await seedData(Item);

      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: {
            category: 'electronics',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(
        res.body.data.every((item) => item.category === 'electronics')
      ).toBe(true);
    });

    test('returns 400 when filtering on field not in allow_filtering_on list', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {
          allow_filtering_on: ['category', 'status'],
        }
      );
      await seedData(Item);

      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: {
            name: 'Product A',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Bad request');
    });

    test('allows operators on allowed fields', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {
          allow_filtering_on: ['category', 'price'],
        }
      );
      await seedData(Item);

      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: {
            category: 'electronics',
            price: { lt: 120 },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].name).toBe('Product A');
    });

    test('returns 400 when using operators on disallowed field', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {
          allow_filtering_on: ['category'],
        }
      );
      await seedData(Item);

      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: {
            score: { gte: 80 },
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('allows all fields when allow_filtering_on is null', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {
          allow_filtering_on: null,
        }
      );
      await seedData(Item);

      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: {
            name: 'Product B',
            score: { gte: 90 },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].external_id).toBe('item-2');
    });

    test('works with AND/OR logical operators on allowed fields', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {
          allow_filtering_on: ['category', 'status'],
        }
      );
      await seedData(Item);

      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: {
            or: [{ category: 'electronics' }, { status: 'inactive' }],
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(3); // All items match
    });

    test('returns 400 when AND/OR contains disallowed field', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {
          allow_filtering_on: ['category'],
        }
      );
      await seedData(Item);

      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: {
            and: [{ category: 'electronics' }, { score: { gte: 80 } }],
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('blocks all filtering when allow_filtering_on is empty array', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {
          allow_filtering_on: [],
        }
      );
      await seedData(Item);

      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: {
            category: 'electronics',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Programmatic filters should still work', () => {
    test('middleware filters work regardless of allow_filtering_on', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {
          allow_filtering_on: ['category'],
          middleware: [
            (req, res, next) => {
              // Use built-in context helper to apply a programmatic filter
              // on a field not in allow_filtering_on
              req.apialize.apply_where({ status: 'active' });
              next();
            },
          ],
        }
      );
      await seedData(Item);

      // User can only filter by category, but middleware filter on status should work
      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: {
            category: 'electronics',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(
        res.body.data.every(
          (item) => item.category === 'electronics' && item.status === 'active'
        )
      ).toBe(true);
    });

    test('pre-hook filters work regardless of allow_filtering_on', async () => {
      const { Item, app } = await buildAppAndModel(
        {},
        {
          allow_filtering_on: ['category'],
          pre: async (req, context) => {
            // Use built-in context helper to apply filter on disallowed field
            const { Sequelize } = require('sequelize');
            req.apialize.apply_where({ score: { [Sequelize.Op.gte]: 80 } });
          },
        }
      );
      await seedData(Item);

      const res = await request(app)
        .post('/items/search')
        .send({
          filtering: {
            category: 'electronics',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].name).toBe('Product A');
      expect(res.body.data[0].score).toBe(85);
    });
  });

  describe('Block filtering configuration', () => {
    describe('List endpoint with block_filtering_on', () => {
      test('blocks filtering on fields in block_filtering_on list', async () => {
        const { Item, app } = await buildAppAndModel({
          block_filtering_on: ['name', 'price'],
        });
        await seedData(Item);

        // Try to filter by name (blocked)
        const res1 = await request(app).get('/items?name=Product A');
        expect(res1.status).toBe(400);
        expect(res1.body.success).toBe(false);

        // Try to filter by price (blocked)
        const res2 = await request(app).get('/items?price:lt=50');
        expect(res2.status).toBe(400);
        expect(res2.body.success).toBe(false);
      });

      test('allows filtering on fields not in block_filtering_on list', async () => {
        const { Item, app } = await buildAppAndModel({
          block_filtering_on: ['name', 'price'],
        });
        await seedData(Item);

        // Filter by category (allowed)
        const res1 = await request(app).get('/items?category=electronics');
        expect(res1.status).toBe(200);
        expect(res1.body.data.length).toBe(2);

        // Filter by status (allowed)
        const res2 = await request(app).get('/items?status=active');
        expect(res2.status).toBe(200);
        expect(res2.body.data.length).toBe(2);
      });

      test('allows all fields when block_filtering_on is null', async () => {
        const { Item, app } = await buildAppAndModel({
          block_filtering_on: null,
        });
        await seedData(Item);

        const res = await request(app).get('/items?name=Product A');
        expect(res.status).toBe(200);
        expect(res.body.data.length).toBe(1);
      });

      test('allows all fields when block_filtering_on is empty array', async () => {
        const { Item, app } = await buildAppAndModel({
          block_filtering_on: [],
        });
        await seedData(Item);

        const res = await request(app).get('/items?price:gte=100');
        expect(res.status).toBe(200);
        expect(res.body.data.length).toBe(1);
      });
    });

    describe('Search endpoint with block_filtering_on', () => {
      test('blocks filtering on fields in block_filtering_on list', async () => {
        const { Item, app } = await buildAppAndModel(
          {},
          {
            block_filtering_on: ['name', 'score'],
          }
        );
        await seedData(Item);

        // Try to filter by name (blocked)
        const res1 = await request(app)
          .post('/items/search')
          .send({
            filtering: {
              name: 'Product A',
            },
          });
        expect(res1.status).toBe(400);
        expect(res1.body.success).toBe(false);

        // Try to filter by score with operator (blocked)
        const res2 = await request(app)
          .post('/items/search')
          .send({
            filtering: {
              score: { gte: 80 },
            },
          });
        expect(res2.status).toBe(400);
        expect(res2.body.success).toBe(false);
      });

      test('allows filtering on fields not in block_filtering_on list', async () => {
        const { Item, app } = await buildAppAndModel(
          {},
          {
            block_filtering_on: ['name', 'score'],
          }
        );
        await seedData(Item);

        const res = await request(app)
          .post('/items/search')
          .send({
            filtering: {
              category: 'electronics',
              status: 'active',
            },
          });

        expect(res.status).toBe(200);
        expect(res.body.data.length).toBe(2);
      });

      test('blocks field in AND/OR logical operators', async () => {
        const { Item, app } = await buildAppAndModel(
          {},
          {
            block_filtering_on: ['score'],
          }
        );
        await seedData(Item);

        const res = await request(app)
          .post('/items/search')
          .send({
            filtering: {
              and: [{ category: 'electronics' }, { score: { gte: 80 } }],
            },
          });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });
    });

    describe('Interaction between allow_filtering_on and block_filtering_on', () => {
      test('block_filtering_on takes precedence when both are configured', async () => {
        const { Item, app } = await buildAppAndModel(
          {},
          {
            allow_filtering_on: ['category', 'status', 'price'],
            block_filtering_on: ['price'], // price is in both - block wins
          }
        );
        await seedData(Item);

        // category and status are allowed
        const res1 = await request(app)
          .post('/items/search')
          .send({
            filtering: {
              category: 'electronics',
            },
          });
        expect(res1.status).toBe(200);

        // price is blocked even though it's in allow list
        const res2 = await request(app)
          .post('/items/search')
          .send({
            filtering: {
              price: { lt: 100 },
            },
          });
        expect(res2.status).toBe(400);
        expect(res2.body.success).toBe(false);
      });

      test('only fields in allow list and not in block list can be filtered', async () => {
        const { Item, app } = await buildAppAndModel(
          {},
          {
            allow_filtering_on: ['category', 'status', 'price'],
            block_filtering_on: ['price'],
          }
        );
        await seedData(Item);

        // name is not in allow list
        const res1 = await request(app)
          .post('/items/search')
          .send({
            filtering: {
              name: 'Product A',
            },
          });
        expect(res1.status).toBe(400);

        // category is in allow list and not in block list
        const res2 = await request(app)
          .post('/items/search')
          .send({
            filtering: {
              category: 'electronics',
              status: 'active',
            },
          });
        expect(res2.status).toBe(200);
        expect(res2.body.data.length).toBe(2);
      });
    });
  });
});
