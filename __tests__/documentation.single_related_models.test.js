/**
 * Tests for documentation examples in single_related_models.md
 * Verifies all code examples work correctly
 */
const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { single, create, list } = require('../src');

describe('Documentation: single_related_models.md examples', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  describe('Basic Usage', () => {
    test('creates related endpoints for list and get operations', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      const Post = sequelize.define(
        'Post',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          user_id: { type: DataTypes.INTEGER, allowNull: false },
          title: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'posts', timestamps: false }
      );

      User.hasMany(Post, { foreignKey: 'user_id' });
      Post.belongsTo(User, { foreignKey: 'user_id' });

      await sequelize.sync({ force: true });

      const app = express();
      app.use(bodyParser.json());
      app.use('/users', create(User));
      app.use(
        '/users',
        single(User, {
          related: [{ model: Post, operations: ['list', 'get'] }],
        })
      );
      app.use('/posts', create(Post));

      // Create user and posts
      const userRes = await request(app).post('/users').send({ name: 'John' });
      const userId = userRes.body.id;

      await request(app).post('/posts').send({ user_id: userId, title: 'First Post' });
      await request(app).post('/posts').send({ user_id: userId, title: 'Second Post' });

      // GET /users/:id - single user
      const singleRes = await request(app).get(`/users/${userId}`);
      expect(singleRes.status).toBe(200);

      // GET /users/:id/posts - list user's posts
      const listRes = await request(app).get(`/users/${userId}/posts`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data).toHaveLength(2);

      // GET /users/:id/posts/:postId - single post
      const postId = listRes.body.data[0].id;
      const getRes = await request(app).get(`/users/${userId}/posts/${postId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.record.user_id).toBe(userId);
    });
  });

  describe('Operations Array', () => {
    test('all CRUD operations work when configured', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      const Post = sequelize.define(
        'Post',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          user_id: { type: DataTypes.INTEGER, allowNull: false },
          title: { type: DataTypes.STRING(100), allowNull: false },
          content: { type: DataTypes.TEXT, allowNull: true },
        },
        { tableName: 'posts', timestamps: false }
      );

      User.hasMany(Post, { foreignKey: 'user_id' });
      Post.belongsTo(User, { foreignKey: 'user_id' });

      await sequelize.sync({ force: true });

      const app = express();
      app.use(bodyParser.json());
      app.use('/users', create(User));
      app.use(
        '/users',
        single(User, {
          related: [
            {
              model: Post,
              operations: ['list', 'search', 'get', 'post', 'put', 'patch', 'delete'],
            },
          ],
        })
      );

      // Create user
      const userRes = await request(app).post('/users').send({ name: 'John' });
      const userId = userRes.body.id;

      // POST - create post (user_id auto-set from parent)
      const createRes = await request(app)
        .post(`/users/${userId}/posts`)
        .send({ title: 'New Post', content: 'Content' });
      expect(createRes.status).toBe(201);
      const postId = createRes.body.id;

      // LIST
      const listRes = await request(app).get(`/users/${userId}/posts`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data).toHaveLength(1);

      // SEARCH
      const searchRes = await request(app)
        .post(`/users/${userId}/posts/search`)
        .send({ filtering: { title: 'New Post' } });
      expect(searchRes.status).toBe(200);
      expect(searchRes.body.data).toHaveLength(1);

      // GET
      const getRes = await request(app).get(`/users/${userId}/posts/${postId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.record.title).toBe('New Post');

      // PUT - full update
      const putRes = await request(app)
        .put(`/users/${userId}/posts/${postId}`)
        .send({ title: 'Updated', content: 'New content' });
      expect(putRes.status).toBe(200);

      // PATCH - partial update
      const patchRes = await request(app)
        .patch(`/users/${userId}/posts/${postId}`)
        .send({ title: 'Patched' });
      expect(patchRes.status).toBe(200);

      // Verify patch
      const verifyRes = await request(app).get(`/users/${userId}/posts/${postId}`);
      expect(verifyRes.body.record.title).toBe('Patched');

      // DELETE
      const deleteRes = await request(app).delete(`/users/${userId}/posts/${postId}`);
      expect(deleteRes.status).toBe(200);

      // Verify deletion
      const afterDeleteRes = await request(app).get(`/users/${userId}/posts`);
      expect(afterDeleteRes.body.data).toHaveLength(0);
    });
  });

  describe('Path Generation', () => {
    test('auto-generates path from model name (snake_case + pluralize)', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      const RelatedThing = sequelize.define(
        'RelatedThing',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          user_id: { type: DataTypes.INTEGER, allowNull: false },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'related_things', timestamps: false }
      );

      User.hasMany(RelatedThing, { foreignKey: 'user_id' });

      await sequelize.sync({ force: true });
      const user = await User.create({ name: 'John' });
      await RelatedThing.create({ user_id: user.id, name: 'Thing 1' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          related: [{ model: RelatedThing, operations: ['list'] }],
        })
      );

      // Path should be /related_things (snake_case + pluralized)
      const res = await request(app).get(`/users/${user.id}/related_things`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    test('custom path overrides auto-generated path', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      const Post = sequelize.define(
        'Post',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          user_id: { type: DataTypes.INTEGER, allowNull: false },
          title: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'posts', timestamps: false }
      );

      User.hasMany(Post, { foreignKey: 'user_id' });

      await sequelize.sync({ force: true });
      const user = await User.create({ name: 'John' });
      await Post.create({ user_id: user.id, title: 'Post 1' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          related: [
            {
              model: Post,
              path: 'articles', // Custom path
              operations: ['list', 'get'],
            },
          ],
        })
      );

      // Custom path /articles should work
      const res = await request(app).get(`/users/${user.id}/articles`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('Foreign Key Configuration', () => {
    test('custom foreignKey is used for filtering', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      const Post = sequelize.define(
        'Post',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          author_id: { type: DataTypes.INTEGER, allowNull: false }, // Custom FK name
          title: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'posts', timestamps: false }
      );

      User.hasMany(Post, { foreignKey: 'author_id' });
      Post.belongsTo(User, { foreignKey: 'author_id' });

      await sequelize.sync({ force: true });
      const user = await User.create({ name: 'John' });
      await Post.create({ author_id: user.id, title: 'Post 1' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          related: [
            {
              model: Post,
              foreignKey: 'author_id',
              operations: ['list', 'get'],
            },
          ],
        })
      );

      const res = await request(app).get(`/users/${user.id}/posts`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('Per-Operation Configuration', () => {
    test('global options apply to all operations', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      const Post = sequelize.define(
        'Post',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          user_id: { type: DataTypes.INTEGER, allowNull: false },
          title: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'posts', timestamps: false }
      );

      User.hasMany(Post, { foreignKey: 'user_id' });

      await sequelize.sync({ force: true });
      const user = await User.create({ name: 'John' });
      // Create 15 posts
      for (let i = 1; i <= 15; i++) {
        await Post.create({ user_id: user.id, title: `Post ${i}` });
      }

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          related: [
            {
              model: Post,
              options: {
                default_page_size: 5, // Limit to 5 per page
                default_order_by: 'title',
                default_order_dir: 'DESC',
              },
              operations: ['list'],
            },
          ],
        })
      );

      const res = await request(app).get(`/users/${user.id}/posts`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(5);
      expect(res.body.meta.paging.size).toBe(5);
      expect(res.body.meta.paging.total_pages).toBe(3);
    });
  });

  describe('Nested Related Models', () => {
    test('nested related models create deep endpoints', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      const Post = sequelize.define(
        'Post',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          user_id: { type: DataTypes.INTEGER, allowNull: false },
          title: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'posts', timestamps: false }
      );
      const Comment = sequelize.define(
        'Comment',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          post_id: { type: DataTypes.INTEGER, allowNull: false },
          text: { type: DataTypes.TEXT, allowNull: false },
        },
        { tableName: 'comments', timestamps: false }
      );

      User.hasMany(Post, { foreignKey: 'user_id' });
      Post.belongsTo(User, { foreignKey: 'user_id' });
      Post.hasMany(Comment, { foreignKey: 'post_id' });
      Comment.belongsTo(Post, { foreignKey: 'post_id' });

      await sequelize.sync({ force: true });
      const user = await User.create({ name: 'John' });
      const post = await Post.create({ user_id: user.id, title: 'Post 1' });
      await Comment.create({ post_id: post.id, text: 'Comment 1' });
      await Comment.create({ post_id: post.id, text: 'Comment 2' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          related: [
            {
              model: Post,
              operations: ['list', 'get'],
              related: [
                {
                  model: Comment,
                  operations: ['list', 'get', 'post'],
                },
              ],
            },
          ],
        })
      );

      // GET /users/:userId/posts
      const postsRes = await request(app).get(`/users/${user.id}/posts`);
      expect(postsRes.status).toBe(200);
      expect(postsRes.body.data).toHaveLength(1);

      // GET /users/:userId/posts/:postId
      const postRes = await request(app).get(`/users/${user.id}/posts/${post.id}`);
      expect(postRes.status).toBe(200);

      // GET /users/:userId/posts/:postId/comments
      const commentsRes = await request(app).get(
        `/users/${user.id}/posts/${post.id}/comments`
      );
      expect(commentsRes.status).toBe(200);
      expect(commentsRes.body.data).toHaveLength(2);

      // GET /users/:userId/posts/:postId/comments/:commentId
      const commentId = commentsRes.body.data[0].id;
      const commentRes = await request(app).get(
        `/users/${user.id}/posts/${post.id}/comments/${commentId}`
      );
      expect(commentRes.status).toBe(200);

      // POST /users/:userId/posts/:postId/comments (post_id auto-set)
      const createCommentRes = await request(app)
        .post(`/users/${user.id}/posts/${post.id}/comments`)
        .send({ text: 'New Comment' });
      expect(createCommentRes.status).toBe(201);

      // Verify new comment was created with correct post_id
      const newComment = await Comment.findByPk(createCommentRes.body.id);
      expect(newComment.post_id).toBe(post.id);
    });
  });

  describe('Parent ID Mapping', () => {
    test('related endpoints work with custom parent id_mapping', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          external_id: { type: DataTypes.STRING(64), allowNull: false, unique: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      const Post = sequelize.define(
        'Post',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          user_id: { type: DataTypes.INTEGER, allowNull: false },
          title: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'posts', timestamps: false }
      );

      User.hasMany(Post, { foreignKey: 'user_id' });

      await sequelize.sync({ force: true });
      const user = await User.create({ name: 'John', external_id: 'uuid-abc-123' });
      await Post.create({ user_id: user.id, title: 'Post 1' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          id_mapping: 'external_id', // Use UUID
          related: [
            {
              model: Post,
              operations: ['list', 'get', 'post'],
            },
          ],
        })
      );

      // Use external_id in URL
      const listRes = await request(app).get('/users/uuid-abc-123/posts');
      expect(listRes.status).toBe(200);
      expect(listRes.body.data).toHaveLength(1);

      // Create post using external_id
      const createRes = await request(app)
        .post('/users/uuid-abc-123/posts')
        .send({ title: 'New Post' });
      expect(createRes.status).toBe(201);

      // Verify post was created with correct internal user_id
      const newPost = await Post.findByPk(createRes.body.id);
      expect(newPost.user_id).toBe(user.id);
    });
  });

  describe('Foreign Key in Create', () => {
    test('foreign key is automatically set from parent ID', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      const Post = sequelize.define(
        'Post',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          user_id: { type: DataTypes.INTEGER, allowNull: false },
          title: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'posts', timestamps: false }
      );

      User.hasMany(Post, { foreignKey: 'user_id' });

      await sequelize.sync({ force: true });
      const user = await User.create({ name: 'John' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          related: [
            {
              model: Post,
              operations: ['post'],
            },
          ],
        })
      );

      // POST without user_id in body - FK should be auto-set
      const createRes = await request(app)
        .post(`/users/${user.id}/posts`)
        .send({ title: 'My Post' }); // NO user_id in body!
      expect(createRes.status).toBe(201);

      // Verify user_id was set automatically from parent
      const post = await Post.findByPk(createRes.body.id);
      expect(post.user_id).toBe(user.id);
    });
  });

  describe('Related Model ID Mapping', () => {
    test('custom id_mapping for related model via options', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      const Post = sequelize.define(
        'Post',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          external_id: { type: DataTypes.STRING(64), allowNull: false, unique: true },
          user_id: { type: DataTypes.INTEGER, allowNull: false },
          title: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'posts', timestamps: false }
      );

      User.hasMany(Post, { foreignKey: 'user_id' });

      await sequelize.sync({ force: true });
      const user = await User.create({ name: 'John' });
      await Post.create({ user_id: user.id, external_id: 'post-uuid-123', title: 'Post 1' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          related: [
            {
              model: Post,
              // id_mapping is set via options, not directly on related config
              options: { id_mapping: 'external_id' },
              operations: ['list', 'get'],
            },
          ],
        })
      );

      // GET post by external_id
      const res = await request(app).get(`/users/${user.id}/posts/post-uuid-123`);
      expect(res.status).toBe(200);
      expect(res.body.record.title).toBe('Post 1');
    });
  });

  describe('Ownership Validation', () => {
    test('returns 404 when child does not belong to parent', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      const Post = sequelize.define(
        'Post',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          user_id: { type: DataTypes.INTEGER, allowNull: false },
          title: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'posts', timestamps: false }
      );

      User.hasMany(Post, { foreignKey: 'user_id' });

      await sequelize.sync({ force: true });
      const user1 = await User.create({ name: 'Alice' });
      const user2 = await User.create({ name: 'Bob' });
      const post1 = await Post.create({ user_id: user1.id, title: 'Alice Post' });
      const post2 = await Post.create({ user_id: user2.id, title: 'Bob Post' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          related: [{ model: Post, operations: ['list', 'get'] }],
        })
      );

      // User 1's post - should work
      const res1 = await request(app).get(`/users/${user1.id}/posts/${post1.id}`);
      expect(res1.status).toBe(200);

      // User 2's post through User 1's endpoint - should 404
      const res2 = await request(app).get(`/users/${user1.id}/posts/${post2.id}`);
      expect(res2.status).toBe(404);
    });
  });

  describe('Multiple Related Models', () => {
    test('multiple related models can be configured', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      const Post = sequelize.define(
        'Post',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          user_id: { type: DataTypes.INTEGER, allowNull: false },
          title: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'posts', timestamps: false }
      );
      const Comment = sequelize.define(
        'Comment',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          user_id: { type: DataTypes.INTEGER, allowNull: false },
          text: { type: DataTypes.TEXT, allowNull: false },
        },
        { tableName: 'comments', timestamps: false }
      );
      const Notification = sequelize.define(
        'Notification',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          user_id: { type: DataTypes.INTEGER, allowNull: false },
          message: { type: DataTypes.STRING(255), allowNull: false },
        },
        { tableName: 'notifications', timestamps: false }
      );

      User.hasMany(Post, { foreignKey: 'user_id' });
      User.hasMany(Comment, { foreignKey: 'user_id' });
      User.hasMany(Notification, { foreignKey: 'user_id' });

      await sequelize.sync({ force: true });
      const user = await User.create({ name: 'John' });
      await Post.create({ user_id: user.id, title: 'Post 1' });
      await Comment.create({ user_id: user.id, text: 'Comment 1' });
      await Notification.create({ user_id: user.id, message: 'Notification 1' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          related: [
            { model: Post, operations: ['list', 'get', 'post'] },
            { model: Comment, operations: ['list', 'get'] },
            {
              model: Notification,
              path: 'notifications',
              operations: ['list'],
              options: { default_page_size: 20 },
            },
          ],
        })
      );

      // GET /users/:id/posts
      const postsRes = await request(app).get(`/users/${user.id}/posts`);
      expect(postsRes.status).toBe(200);
      expect(postsRes.body.data).toHaveLength(1);

      // GET /users/:id/comments
      const commentsRes = await request(app).get(`/users/${user.id}/comments`);
      expect(commentsRes.status).toBe(200);
      expect(commentsRes.body.data).toHaveLength(1);

      // GET /users/:id/notifications (custom path)
      const notificationsRes = await request(app).get(`/users/${user.id}/notifications`);
      expect(notificationsRes.status).toBe(200);
      expect(notificationsRes.body.data).toHaveLength(1);
      expect(notificationsRes.body.meta.paging.size).toBe(20);
    });
  });

  describe('Read-Only Related Endpoint', () => {
    test('only specified operations are available', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      const AuditLog = sequelize.define(
        'AuditLog',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          user_id: { type: DataTypes.INTEGER, allowNull: false },
          action: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'audit_logs', timestamps: false }
      );

      User.hasMany(AuditLog, { foreignKey: 'user_id' });

      await sequelize.sync({ force: true });
      const user = await User.create({ name: 'John' });
      await AuditLog.create({ user_id: user.id, action: 'login' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          related: [
            {
              model: AuditLog,
              path: 'activity',
              operations: ['list'], // Read-only
            },
          ],
        })
      );

      // LIST should work
      const listRes = await request(app).get(`/users/${user.id}/activity`);
      expect(listRes.status).toBe(200);

      // POST should not exist (404)
      const postRes = await request(app)
        .post(`/users/${user.id}/activity`)
        .send({ action: 'test' });
      expect(postRes.status).toBe(404);

      // DELETE should not exist (404)
      const deleteRes = await request(app).delete(`/users/${user.id}/activity/1`);
      expect(deleteRes.status).toBe(404);
    });
  });
});
