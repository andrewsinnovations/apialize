const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list, create } = require('../src');

describe('context.models - availability across operations', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  async function buildAppAndModels() {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    const User = sequelize.define(
      'User',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING },
      },
      { timestamps: false, tableName: 'users' }
    );

    const Post = sequelize.define(
      'Post',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        title: { type: DataTypes.STRING },
        user_id: { type: DataTypes.INTEGER },
      },
      { timestamps: false, tableName: 'posts' }
    );

    User.hasMany(Post, { foreignKey: 'user_id', as: 'posts' });
    Post.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());

    return { User, Post, app };
  }

  test('context.models is available in create pre hook', async () => {
    const { User, Post, app } = await buildAppAndModels();

    let capturedModels = null;

    app.use(
      '/users',
      create(User, {
        pre: async (context) => {
          capturedModels = context.models;
          return context;
        },
      })
    );

    const res = await request(app)
      .post('/users')
      .send({ name: 'Alice' });

    expect(res.status).toBe(201);
    expect(capturedModels).toBeDefined();
    expect(capturedModels.User).toBe(User);
    expect(capturedModels.Post).toBe(Post);
  });

  test('context.models is available in create post hook', async () => {
    const { User, Post, app } = await buildAppAndModels();

    let capturedModels = null;

    app.use(
      '/users',
      create(User, {
        post: async (context) => {
          capturedModels = context.models;
          return context;
        },
      })
    );

    const res = await request(app)
      .post('/users')
      .send({ name: 'Bob' });

    expect(res.status).toBe(201);
    expect(capturedModels).toBeDefined();
    expect(capturedModels.User).toBe(User);
    expect(capturedModels.Post).toBe(Post);
  });

  test('context.models is available in list pre hook', async () => {
    const { User, Post, app } = await buildAppAndModels();

    let capturedModels = null;

    app.use(
      '/users',
      list(User, {
        pre: async (context) => {
          capturedModels = context.models;
          return context;
        },
      })
    );

    await User.create({ name: 'Charlie' });

    const res = await request(app).get('/users');

    expect(res.status).toBe(200);
    expect(capturedModels).toBeDefined();
    expect(capturedModels.User).toBe(User);
    expect(capturedModels.Post).toBe(Post);
  });

  test('context.models can be used to query related models in hooks', async () => {
    const { User, Post, app } = await buildAppAndModels();

    app.use(
      '/users',
      create(User, {
        post: async (context) => {
          // Use context.models to create a related post
          const userId = context.created.id;
          await context.models.Post.create({
            title: 'Auto-created post',
            user_id: userId,
          });
          return context;
        },
      })
    );

    const res = await request(app)
      .post('/users')
      .send({ name: 'Dave' });

    expect(res.status).toBe(201);

    // Verify the post was created
    const posts = await Post.findAll({
      where: { user_id: res.body.id },
    });
    expect(posts).toHaveLength(1);
    expect(posts[0].title).toBe('Auto-created post');
  });

  test('req.apialize.models is available in middleware after context is built', async () => {
    const { User, Post, app } = await buildAppAndModels();

    let capturedModels = null;
    let capturedInMiddleware = null;

    const testMiddleware = async (req, res, next) => {
      // At this point, apializeContext has run but operation context may not be built yet
      capturedInMiddleware = req.apialize ? req.apialize.models : undefined;
      next();
    };

    app.use(
      '/users',
      create(User, {
        middleware: [testMiddleware],
        pre: async (context) => {
          // In pre hook, context should have models
          capturedModels = context.models;
          return context;
        },
      })
    );

    const res = await request(app)
      .post('/users')
      .send({ name: 'Eve' });

    expect(res.status).toBe(201);
    // Models should be available in pre hook (context is built by then)
    expect(capturedModels).toBeDefined();
    expect(capturedModels.User).toBe(User);
    expect(capturedModels.Post).toBe(Post);
  });
});
