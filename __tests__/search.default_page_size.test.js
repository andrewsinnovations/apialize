const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { search } = require('../src');

describe('search operation: snake_case configuration backward compatibility', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  async function setupTestApp(config) {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });
    const Item = sequelize.define(
      'Item',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
      },
      { tableName: 'items', timestamps: false }
    );

    await sequelize.sync({ force: true });

    // Create 25 items
    const items = [];
    for (let i = 1; i <= 25; i++) {
      items.push({ name: `Item ${i}` });
    }
    await Item.bulkCreate(items);

    const app = express();
    app.use(bodyParser.json());
    app.use('/items', search(Item, config));

    return { Item, app };
  }

  test('should accept defaultPageSize (camelCase)', async () => {
    const { app } = await setupTestApp({ defaultPageSize: 5 });

    const res = await request(app).post('/items/search').send({});
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.meta.page_size).toBe(5);
    expect(res.body.meta.total_pages).toBe(5);
    expect(res.body.meta.count).toBe(25);
  });

  test('should accept default_page_size (snake_case)', async () => {
    const { app } = await setupTestApp({ default_page_size: 7 });

    const res = await request(app).post('/items/search').send({});
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(7);
    expect(res.body.meta.page_size).toBe(7);
    expect(res.body.meta.total_pages).toBe(4);
    expect(res.body.meta.count).toBe(25);
  });

  test('should prioritize default_page_size over defaultPageSize when both provided', async () => {
    const { app } = await setupTestApp({ 
      defaultPageSize: 10,
      default_page_size: 3 
    });

    const res = await request(app).post('/items/search').send({});
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.meta.page_size).toBe(3);
    expect(res.body.meta.total_pages).toBe(9);
  });

  test('should use default of 100 when neither is provided', async () => {
    const { app } = await setupTestApp({});

    const res = await request(app).post('/items/search').send({});
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(25);
    expect(res.body.meta.page_size).toBe(100);
    expect(res.body.meta.total_pages).toBe(1);
  });

  test('should validate that default_page_size is a positive number', async () => {
    expect(() => {
      const app = express();
      app.use(bodyParser.json());
      
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const Item = sequelize.define('Item', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      });
      
      app.use('/items', search(Item, { default_page_size: -5 }));
    }).toThrow('defaultPageSize must be a positive number');
  });

  test('should validate that default_page_size is a number', async () => {
    expect(() => {
      const app = express();
      app.use(bodyParser.json());
      
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const Item = sequelize.define('Item', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      });
      
      app.use('/items', search(Item, { default_page_size: 'invalid' }));
    }).toThrow('defaultPageSize must be a positive number');
  });

  test('should accept default_order_by (snake_case)', async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });
    const Item = sequelize.define(
      'Item',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
      },
      { tableName: 'items', timestamps: false }
    );

    await sequelize.sync({ force: true });
    await Item.bulkCreate([
      { name: 'Zebra' },
      { name: 'Apple' },
      { name: 'Mango' },
    ]);

    const app = express();
    app.use(bodyParser.json());
    app.use('/items', search(Item, { default_order_by: 'name' }));

    const res = await request(app).post('/items/search').send({});
    
    expect(res.status).toBe(200);
    expect(res.body.data[0].name).toBe('Apple');
    expect(res.body.data[1].name).toBe('Mango');
    expect(res.body.data[2].name).toBe('Zebra');
  });

  test('should accept default_order_dir (snake_case)', async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });
    const Item = sequelize.define(
      'Item',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
      },
      { tableName: 'items', timestamps: false }
    );

    await sequelize.sync({ force: true });
    await Item.bulkCreate([
      { name: 'Apple' },
      { name: 'Mango' },
      { name: 'Zebra' },
    ]);

    const app = express();
    app.use(bodyParser.json());
    app.use('/items', search(Item, { 
      default_order_by: 'name',
      default_order_dir: 'DESC' 
    }));

    const res = await request(app).post('/items/search').send({});
    
    expect(res.status).toBe(200);
    expect(res.body.data[0].name).toBe('Zebra');
    expect(res.body.data[1].name).toBe('Mango');
    expect(res.body.data[2].name).toBe('Apple');
  });

  test('should accept meta_show_ordering (snake_case)', async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });
    const Item = sequelize.define(
      'Item',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
      },
      { tableName: 'items', timestamps: false }
    );

    await sequelize.sync({ force: true });
    await Item.bulkCreate([{ name: 'Test' }]);

    const app = express();
    app.use(bodyParser.json());
    app.use('/items', search(Item, { meta_show_ordering: true }));

    const res = await request(app).post('/items/search').send({});
    
    expect(res.status).toBe(200);
    expect(res.body.meta.order).toBeDefined();
  });

  test('should accept meta_show_filters (snake_case)', async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });
    const Item = sequelize.define(
      'Item',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
      },
      { tableName: 'items', timestamps: false }
    );

    await sequelize.sync({ force: true });
    await Item.bulkCreate([{ name: 'Test' }]);

    const app = express();
    app.use(bodyParser.json());
    app.use('/items', search(Item, { meta_show_filters: true }));

    const res = await request(app).post('/items/search').send({});
    
    expect(res.status).toBe(200);
    expect(res.body.meta.filters).toBeDefined();
  });

  test('should accept disable_subquery (snake_case)', async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });
    const Item = sequelize.define(
      'Item',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
      },
      { tableName: 'items', timestamps: false }
    );

    await sequelize.sync({ force: true });
    await Item.bulkCreate([{ name: 'Test' }]);

    const app = express();
    app.use(bodyParser.json());
    // Just verify the config is accepted without error
    app.use('/items', search(Item, { disable_subquery: false }));

    const res = await request(app).post('/items/search').send({});
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('should prioritize snake_case over camelCase when both provided', async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });
    const Item = sequelize.define(
      'Item',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
        score: { type: DataTypes.INTEGER, allowNull: false },
      },
      { tableName: 'items', timestamps: false }
    );

    await sequelize.sync({ force: true });
    await Item.bulkCreate([
      { name: 'C', score: 3 },
      { name: 'A', score: 1 },
      { name: 'B', score: 2 },
    ]);

    const app = express();
    app.use(bodyParser.json());
    app.use('/items', search(Item, { 
      defaultOrderBy: 'name',
      default_order_by: 'score',  // This should take precedence
      defaultOrderDir: 'ASC',
      default_order_dir: 'DESC',  // This should take precedence
      metaShowOrdering: false,
      meta_show_ordering: true    // This should take precedence
    }));

    const res = await request(app).post('/items/search').send({});
    
    expect(res.status).toBe(200);
    // Should be ordered by score DESC
    expect(res.body.data[0].score).toBe(3);
    expect(res.body.data[1].score).toBe(2);
    expect(res.body.data[2].score).toBe(1);
    // Should show ordering in meta
    expect(res.body.meta.order).toBeDefined();
  });

  test('should accept all snake_case options together', async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });
    const Item = sequelize.define(
      'Item',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
      },
      { tableName: 'items', timestamps: false }
    );

    await sequelize.sync({ force: true });
    const items = [];
    for (let i = 1; i <= 15; i++) {
      items.push({ name: `Item ${String.fromCharCode(90 - i)}` }); // Z, Y, X...
    }
    await Item.bulkCreate(items);

    const app = express();
    app.use(bodyParser.json());
    app.use('/items', search(Item, { 
      default_page_size: 5,
      default_order_by: 'name',
      default_order_dir: 'ASC',
      meta_show_ordering: true
    }));

    const res = await request(app).post('/items/search').send({});
    
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.meta.page_size).toBe(5);
    expect(res.body.meta.total_pages).toBe(3);
    expect(res.body.meta.order).toBeDefined();
    // First item should start with lowest letter (alphabetically)
    expect(res.body.data[0].name).toMatch(/^Item [K-O]/);
  });
});

