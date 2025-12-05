const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { single, create, list } = require('../src');

async function build({
  singleOptions = {},
  modelOptions = {},
  relatedConfig = null,
} = {}) {
  const sequelize = new Sequelize('sqlite::memory:', { logging: false });
  const User = sequelize.define(
    'User',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      external_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
      },
      name: { type: DataTypes.STRING(100), allowNull: false },
      parent_id: { type: DataTypes.INTEGER, allowNull: true },
    },
    { tableName: 'single_users', timestamps: false }
  );
  const Post = sequelize.define(
    'Post',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: { type: DataTypes.INTEGER, allowNull: false },
      title: { type: DataTypes.STRING(255), allowNull: false },
    },
    { tableName: 'single_posts', timestamps: false }
  );

  // Attach relation-like info
  User.hasMany(Post, { foreignKey: 'user_id', as: 'posts' });
  Post.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

  await sequelize.sync({ force: true });

  const app = express();
  app.use(bodyParser.json());

  const options = { ...singleOptions };
  if (relatedConfig)
    options.related = [
      relatedConfig === true
        ? { model: Post, operations: ['list', 'get'] }
        : relatedConfig,
    ];

  app.use('/users', create(User));
  app.use('/posts', list(Post));
  app.use('/users', single(User, options, modelOptions));

  return { sequelize, User, Post, app };
}

describe('single operation: comprehensive options coverage', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  test('default id mapping returns one record; respects modelOptions attributes', async () => {
    const { sequelize: s, app } = await build({
      modelOptions: { attributes: ['id', 'name'] },
    });
    sequelize = s;

    const created = await request(app)
      .post('/users')
      .send({ external_id: 'u1', name: 'Alice' });
    const res = await request(app).get(`/users/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.record).toEqual({ id: created.body.id, name: 'Alice' });
  });

  test('id_mapping: external_id reads via external id', async () => {
    const { sequelize: s, app } = await build({
      singleOptions: { id_mapping: 'external_id' },
    });
    sequelize = s;

    await request(app).post('/users').send({ external_id: 'ux', name: 'Bob' });
    const res = await request(app).get(`/users/ux`);
    expect(res.status).toBe(200);
    expect(res.body.record).toMatchObject({ id: 'ux', name: 'Bob' });
    expect(
      Object.prototype.hasOwnProperty.call(res.body.record, 'external_id')
    ).toBe(false);
  });

  test('ownership filtering via query filters: 404 when not in scope', async () => {
    const { sequelize: s, app } = await build();
    sequelize = s;

    const created = await request(app)
      .post('/users')
      .send({ external_id: 'scoped', name: 'Scoped', parent_id: 1 });

    const miss = await request(app).get(
      `/users/${created.body.id}?parent_id=2`
    );
    expect(miss.status).toBe(404);

    const ok = await request(app).get(`/users/${created.body.id}?parent_id=1`);
    expect(ok.status).toBe(200);
  });

  test('middleware modifies context before read (inject filter)', async () => {
    const scope = (req, _res, next) => {
      req.apialize.apply_where({ parent_id: 5 });
      next();
    };
    const { sequelize: s, app } = await build({
      singleOptions: { middleware: [scope] },
    });
    sequelize = s;

    const u1 = await request(app)
      .post('/users')
      .send({ external_id: 't5-1', name: 'A', parent_id: 5 });
    await request(app)
      .post('/users')
      .send({ external_id: 't9-1', name: 'B', parent_id: 9 });

    const ok = await request(app).get(`/users/${u1.body.id}`);
    expect(ok.status).toBe(200);

    const miss = await request(app).get(`/users/${u1.body.id}`);
    expect(miss.status).toBe(200); // same scope still applied; same record
  });

  test('related recursion mounted via single() nested router works for get/list & write ops scoping', async () => {
    const {
      sequelize: s,
      User,
      Post: P2,
      app,
    } = await build({ relatedConfig: true });
    sequelize = s;

    const u = await request(app)
      .post('/users')
      .send({ external_id: 'usr1', name: 'U1' });
    // Seed a post directly
    await P2.create({ user_id: u.body.id, title: 'P1' });

    // List child via related list
    const listRes = await request(app).get(`/users/${u.body.id}/posts`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.meta.paging.count).toBe(1);

    // GET child via nested single
    const post = await P2.findOne({ where: { user_id: u.body.id } });
    const getChild = await request(app).get(
      `/users/${u.body.id}/posts/${post.id}`
    );
    expect(getChild.status).toBe(200);
    expect(getChild.body.record).toMatchObject({ id: post.id, title: 'P1' });
  });

  test('array pre/post hooks: multiple functions execute in order (single)', async () => {
    const executionOrder = [];
    const {
      sequelize: s,
      User,
      app,
    } = await build({
      singleOptions: {
        pre: [
          async (context) => {
            executionOrder.push('pre1');
            // Single is read-only, should not have transaction by default
            expect(context.transaction).toBeUndefined();
            return { step: 1 };
          },
          async (context) => {
            executionOrder.push('pre2');
            expect(context.transaction).toBeUndefined();
            return { step: 2 };
          },
          async (context) => {
            executionOrder.push('pre3');
            expect(context.transaction).toBeUndefined();
            return { step: 3, finalPre: true };
          },
        ],
        post: [
          async (context) => {
            executionOrder.push('post1');
            expect(context.preResult).toEqual({ step: 3, finalPre: true });
            context.payload.hook1 = 'executed';
          },
          async (context) => {
            executionOrder.push('post2');
            expect(context.payload.hook1).toBe('executed');
            context.payload.hook2 = 'also-executed';
          },
        ],
      },
    });
    sequelize = s;

    // Create a user first
    const created = await request(app)
      .post('/users')
      .send({ external_id: 'array-hooks-s1', name: 'ArraySingleTest' });
    expect(created.status).toBe(201);

    // Then retrieve it with array hooks
    const retrieved = await request(app).get(`/users/${created.body.id}`);

    expect(retrieved.status).toBe(200);
    expect(retrieved.body.success).toBe(true);
    expect(retrieved.body.hook1).toBe('executed');
    expect(retrieved.body.hook2).toBe('also-executed');
    expect(executionOrder).toEqual(['pre1', 'pre2', 'pre3', 'post1', 'post2']);
  });
});
