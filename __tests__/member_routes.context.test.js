const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { single, create } = require('../src');

describe('member_routes - context parameter', () => {
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
        external_id: { type: DataTypes.STRING, unique: true },
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

    const Comment = sequelize.define(
      'Comment',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        text: { type: DataTypes.STRING },
        post_id: { type: DataTypes.INTEGER },
      },
      { timestamps: false, tableName: 'comments' }
    );

    User.hasMany(Post, { foreignKey: 'user_id', as: 'posts' });
    Post.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

    Post.hasMany(Comment, { foreignKey: 'post_id', as: 'comments' });
    Comment.belongsTo(Post, { foreignKey: 'post_id', as: 'post' });

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());

    return { User, Post, Comment, app };
  }

  test('context parameter is passed to member_route handler', async () => {
    const { User, app } = await buildAppAndModels();

    let capturedContext = null;

    app.use(
      '/users',
      single(User, {
        member_routes: [
          {
            path: 'test-context',
            method: 'get',
            async handler(req, res, context) {
              // Capture the context for verification
              capturedContext = context;
              return { success: true, hasContext: !!context };
            },
          },
        ],
      })
    );

    await User.create({ external_id: 'user-1', name: 'Alice' });

    const res = await request(app).get('/users/1/test-context');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.hasContext).toBe(true);

    // Verify context contains expected properties
    expect(capturedContext).toBeDefined();
    expect(capturedContext.record).toBeDefined();
    expect(capturedContext.record.name).toBe('Alice');
    expect(capturedContext.rawRecord).toBeDefined();
  });

  test('context.models provides access to all Sequelize models', async () => {
    const { User, Post, Comment, app } = await buildAppAndModels();

    let capturedModels = null;

    app.use(
      '/users',
      single(User, {
        member_routes: [
          {
            path: 'check-models',
            method: 'get',
            async handler(req, res, context) {
              capturedModels = context.models;
              return {
                success: true,
                hasModels: !!context.models,
                modelNames: context.models
                  ? Object.keys(context.models)
                  : [],
              };
            },
          },
        ],
      })
    );

    await User.create({ external_id: 'user-1', name: 'Alice' });

    const res = await request(app).get('/users/1/check-models');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.hasModels).toBe(true);
    expect(res.body.modelNames).toContain('User');
    expect(res.body.modelNames).toContain('Post');
    expect(res.body.modelNames).toContain('Comment');

    // Verify we can access the actual models
    expect(capturedModels).toBeDefined();
    expect(capturedModels.User).toBe(User);
    expect(capturedModels.Post).toBe(Post);
    expect(capturedModels.Comment).toBe(Comment);
  });

  test('member_route can query other models using context.models', async () => {
    const { User, Post, Comment, app } = await buildAppAndModels();

    app.use(
      '/users',
      single(User, {
        member_routes: [
          {
            path: 'stats',
            method: 'get',
            async handler(req, res, context) {
              const userId = context.rawRecord.id;

              // Use context.models to access other models
              const postCount = await context.models.Post.count({
                where: { user_id: userId },
              });

              const posts = await context.models.Post.findAll({
                where: { user_id: userId },
              });

              let totalComments = 0;
              for (let post of posts) {
                const commentCount = await context.models.Comment.count({
                  where: { post_id: post.id },
                });
                totalComments += commentCount;
              }

              return {
                success: true,
                userName: context.record.name,
                postCount,
                totalComments,
              };
            },
          },
        ],
      })
    );

    // Create test data
    const user = await User.create({ external_id: 'user-1', name: 'Alice' });
    const post1 = await Post.create({
      title: 'Post 1',
      user_id: user.id,
    });
    const post2 = await Post.create({
      title: 'Post 2',
      user_id: user.id,
    });
    await Comment.create({ text: 'Comment 1', post_id: post1.id });
    await Comment.create({ text: 'Comment 2', post_id: post1.id });
    await Comment.create({ text: 'Comment 3', post_id: post2.id });

    const res = await request(app).get('/users/1/stats');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      userName: 'Alice',
      postCount: 2,
      totalComments: 3,
    });
  });

  test('context parameter is backward compatible - handlers with 2 params still work', async () => {
    const { User, app } = await buildAppAndModels();

    app.use(
      '/users',
      single(User, {
        member_routes: [
          {
            path: 'legacy',
            method: 'get',
            async handler(req, res) {
              // Old signature - only req and res
              return {
                success: true,
                name: req.apialize.record.name,
                backward: 'compatible',
              };
            },
          },
        ],
      })
    );

    await User.create({ external_id: 'user-1', name: 'Bob' });

    const res = await request(app).get('/users/1/legacy');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.name).toBe('Bob');
    expect(res.body.backward).toBe('compatible');
  });

  test('context helpers are available in member_route', async () => {
    const { User, app } = await buildAppAndModels();

    app.use(
      '/users',
      single(User, {
        member_routes: [
          {
            path: 'helpers',
            method: 'get',
            async handler(req, res, context) {
              return {
                success: true,
                hasApplyWhere: typeof context.applyWhere === 'function',
                hasApply_where: typeof context.apply_where === 'function',
                hasSetValue: typeof context.set_value === 'function',
                hasCancelOperation:
                  typeof context.cancel_operation === 'function',
                hasModels: !!context.models,
              };
            },
          },
        ],
      })
    );

    await User.create({ external_id: 'user-1', name: 'Charlie' });

    const res = await request(app).get('/users/1/helpers');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.hasApplyWhere).toBe(true);
    expect(res.body.hasApply_where).toBe(true);
    expect(res.body.hasSetValue).toBe(true);
    expect(res.body.hasCancelOperation).toBe(true);
    expect(res.body.hasModels).toBe(true);
  });

  test('POST member_route receives context parameter', async () => {
    const { User, Post, app } = await buildAppAndModels();

    app.use(
      '/users',
      single(User, {
        member_routes: [
          {
            path: 'create-post',
            method: 'post',
            async handler(req, res, context) {
              const userId = context.rawRecord.id;
              const { title } = req.body;

              // Use context.models to create a post
              const post = await context.models.Post.create({
                title,
                user_id: userId,
              });

              return {
                success: true,
                postId: post.id,
                postTitle: post.title,
                userName: context.record.name,
              };
            },
          },
        ],
      })
    );

    const user = await User.create({ external_id: 'user-1', name: 'Dave' });

    const res = await request(app)
      .post('/users/1/create-post')
      .send({ title: 'My New Post' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.postTitle).toBe('My New Post');
    expect(res.body.userName).toBe('Dave');

    // Verify the post was actually created
    const posts = await Post.findAll({ where: { user_id: user.id } });
    expect(posts).toHaveLength(1);
    expect(posts[0].title).toBe('My New Post');
  });
});
