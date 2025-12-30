/**
 * Tests for documentation examples in single_member_routes.md
 * Verifies all code examples work correctly
 */
const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { single, create } = require('../src');

describe('Documentation: single_member_routes.md examples', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  describe('Record Loading - inherits single() configuration', () => {
    test('member routes use modelOptions from parent single()', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          external_id: { type: DataTypes.STRING(64), allowNull: false, unique: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
          email: { type: DataTypes.STRING(100), allowNull: false },
          password: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      const Department = sequelize.define(
        'Department',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'departments', timestamps: false }
      );
      User.belongsTo(Department, { foreignKey: 'department_id', as: 'department' });

      await sequelize.sync({ force: true });
      const dept = await Department.create({ name: 'Engineering' });
      await User.create({
        external_id: 'ext-123',
        name: 'John',
        email: 'john@example.com',
        password: 'secret',
        department_id: dept.id,
      });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(
          User,
          {
            id_mapping: 'external_id',
            member_routes: [
              {
                path: 'profile',
                method: 'get',
                async handler(req) {
                  // Record should have department included due to modelOptions
                  return {
                    success: true,
                    name: req.apialize.record.name,
                    hasDepartment: !!req.apialize.record.department,
                    // Password should NOT be in record due to limited attributes
                    hasPassword: !!req.apialize.record.password,
                  };
                },
              },
            ],
          },
          {
            attributes: ['id', 'external_id', 'name', 'email'],
            include: [{ model: Department, as: 'department' }],
          }
        )
      );

      // Use external_id in URL
      const res = await request(app).get('/users/ext-123/profile');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('John');
      expect(res.body.hasDepartment).toBe(true);
      expect(res.body.hasPassword).toBe(false);
    });
  });

  describe('Basic Usage', () => {
    test('basic member route returns custom payload', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      await sequelize.sync({ force: true });
      await User.create({ name: 'Alice' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          member_routes: [
            {
              path: 'profile',
              method: 'get',
              async handler(req, res) {
                return { success: true, userName: req.apialize.record.name };
              },
            },
          ],
        })
      );

      const res = await request(app).get('/users/1/profile');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, userName: 'Alice' });
    });
  });

  describe('Path Configuration', () => {
    test('path with and without leading slash', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      await sequelize.sync({ force: true });
      await User.create({ name: 'Alice' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          member_routes: [
            {
              path: 'profile',
              method: 'get',
              async handler(req) {
                return { path: 'profile' };
              },
            },
            {
              path: '/stats',
              method: 'get',
              async handler(req) {
                return { path: '/stats' };
              },
            },
          ],
        })
      );

      const res1 = await request(app).get('/users/1/profile');
      expect(res1.status).toBe(200);
      expect(res1.body.path).toBe('profile');

      const res2 = await request(app).get('/users/1/stats');
      expect(res2.status).toBe(200);
      expect(res2.body.path).toBe('/stats');
    });
  });

  describe('Handler Function - Return Value Behavior', () => {
    test('returning a value sends JSON response', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      await sequelize.sync({ force: true });
      await User.create({ name: 'Alice' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          member_routes: [
            {
              path: 'custom',
              method: 'get',
              async handler(req, res) {
                return { success: true, data: 'some data' };
              },
            },
          ],
        })
      );

      const res = await request(app).get('/users/1/custom');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: 'some data' });
    });

    test('returning undefined uses default single payload', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
          viewed_at: { type: DataTypes.DATE, allowNull: true },
        },
        { tableName: 'users', timestamps: false }
      );
      await sequelize.sync({ force: true });
      await User.create({ name: 'Alice' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          member_routes: [
            {
              path: 'touch',
              method: 'post',
              async handler(req, res) {
                await req.apialize.rawRecord.update({ viewed_at: new Date() });
                // Returns undefined - should use default single payload
              },
            },
          ],
        })
      );

      const res = await request(app).post('/users/1/touch').send({});
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.record).toBeDefined();
      expect(res.body.record.name).toBe('Alice');
    });

    test('sending response directly', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      await sequelize.sync({ force: true });
      await User.create({ name: 'Alice' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          member_routes: [
            {
              path: 'send',
              method: 'get',
              async handler(req, res) {
                res.status(202).json({ custom: true });
              },
            },
          ],
        })
      );

      const res = await request(app).get('/users/1/send');
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ custom: true });
    });
  });

  describe('HTTP Methods', () => {
    test('supports all HTTP methods (GET, POST, PUT, PATCH, DELETE)', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
          settings: { type: DataTypes.STRING(255), allowNull: true },
          archived: { type: DataTypes.BOOLEAN, defaultValue: false },
        },
        { tableName: 'users', timestamps: false }
      );
      await sequelize.sync({ force: true });
      await User.create({ name: 'Alice', settings: '{}' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          member_routes: [
            {
              path: 'profile',
              method: 'get',
              async handler(req) {
                return { name: req.apialize.record.name };
              },
            },
            {
              path: 'action',
              method: 'post',
              async handler(req) {
                return { success: true, action: req.body.action };
              },
            },
            {
              path: 'replace-settings',
              method: 'put',
              async handler(req) {
                const inst = req.apialize.rawRecord;
                await inst.update({ settings: JSON.stringify(req.body) });
                return { success: true };
              },
            },
            {
              path: 'update-settings',
              method: 'patch',
              async handler(req) {
                const inst = req.apialize.rawRecord;
                await inst.update({ name: inst.get('name') + '-patched' });
                return { success: true };
              },
            },
            {
              path: 'archive',
              method: 'delete',
              async handler(req) {
                await req.apialize.rawRecord.update({ archived: true });
                return { success: true, archived: true };
              },
            },
          ],
        })
      );

      // GET
      const getRes = await request(app).get('/users/1/profile');
      expect(getRes.status).toBe(200);
      expect(getRes.body).toEqual({ name: 'Alice' });

      // POST
      const postRes = await request(app).post('/users/1/action').send({ action: 'test' });
      expect(postRes.status).toBe(200);
      expect(postRes.body).toEqual({ success: true, action: 'test' });

      // PUT
      const putRes = await request(app).put('/users/1/replace-settings').send({ key: 'value' });
      expect(putRes.status).toBe(200);
      expect(putRes.body).toEqual({ success: true });

      // PATCH
      const patchRes = await request(app).patch('/users/1/update-settings').send({});
      expect(patchRes.status).toBe(200);

      // DELETE
      const deleteRes = await request(app).delete('/users/1/archive');
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body).toEqual({ success: true, archived: true });

      // Verify user was archived
      const user = await User.findByPk(1);
      expect(user.archived).toBe(true);
    });
  });

  describe('Middleware - Single-Level Middleware', () => {
    test('single middleware applies to all member routes', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      await sequelize.sync({ force: true });
      await User.create({ name: 'Alice' });

      const authMiddleware = (req, res, next) => {
        if (!req.headers['x-auth']) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        req.user = { authenticated: true };
        next();
      };

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          middleware: [authMiddleware],
          member_routes: [
            {
              path: 'profile',
              method: 'get',
              async handler(req) {
                return { user: req.apialize.record };
              },
            },
          ],
        })
      );

      // Without auth header - should be 401
      const res1 = await request(app).get('/users/1/profile');
      expect(res1.status).toBe(401);

      // With auth header - should succeed
      const res2 = await request(app).get('/users/1/profile').set('x-auth', 'token');
      expect(res2.status).toBe(200);
    });
  });

  describe('Middleware - Route-Specific Middleware', () => {
    test('route-specific middleware only applies to that route', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      await sequelize.sync({ force: true });
      await User.create({ name: 'Alice' });

      const adminOnly = (req, res, next) => {
        if (!req.headers['x-admin']) {
          return res.status(403).json({ error: 'Admin access required' });
        }
        next();
      };

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          member_routes: [
            {
              path: 'public-action',
              method: 'get',
              async handler(req) {
                return { public: true };
              },
            },
            {
              path: 'admin-action',
              method: 'post',
              middleware: [adminOnly],
              async handler(req) {
                return { success: true };
              },
            },
          ],
        })
      );

      // Public action - no middleware required
      const res1 = await request(app).get('/users/1/public-action');
      expect(res1.status).toBe(200);
      expect(res1.body.public).toBe(true);

      // Admin action without header - should be 403
      const res2 = await request(app).post('/users/1/admin-action').send({});
      expect(res2.status).toBe(403);

      // Admin action with header - should succeed
      const res3 = await request(app)
        .post('/users/1/admin-action')
        .set('x-admin', 'true')
        .send({});
      expect(res3.status).toBe(200);
    });
  });

  describe('Context Access', () => {
    test('handler has access to record, rawRecord, id, where, models', async () => {
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
      await User.create({ name: 'Alice' });
      await Post.create({ user_id: 1, title: 'First Post' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          member_routes: [
            {
              path: 'context-test',
              method: 'get',
              async handler(req, res, context) {
                // Verify context === req.apialize
                expect(context).toBe(req.apialize);

                // Test record (plain object)
                expect(typeof req.apialize.record).toBe('object');
                expect(req.apialize.record.name).toBe('Alice');

                // Test rawRecord (Sequelize instance)
                expect(typeof req.apialize.rawRecord.get).toBe('function');
                expect(req.apialize.rawRecord.get('name')).toBe('Alice');

                // Test id
                expect(req.apialize.id).toBe('1');

                // Test where
                expect(req.apialize.where).toBeDefined();

                // Test models (if available)
                if (req.apialize.models) {
                  expect(req.apialize.models.Post).toBeDefined();
                }

                // Test singlePayload
                expect(req.apialize.singlePayload).toBeDefined();
                expect(req.apialize.singlePayload.success).toBe(true);

                return { contextValid: true };
              },
            },
          ],
        })
      );

      const res = await request(app).get('/users/1/context-test');
      expect(res.status).toBe(200);
      expect(res.body.contextValid).toBe(true);
    });

    test('rawRecord can be used to update the record', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      await sequelize.sync({ force: true });
      await User.create({ name: 'Alice' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          member_routes: [
            {
              path: 'rename',
              method: 'patch',
              async handler(req) {
                await req.apialize.rawRecord.update({ name: req.body.newName });
                const plainData = req.apialize.rawRecord.get({ plain: true });
                return { newName: plainData.name };
              },
            },
          ],
        })
      );

      const res = await request(app).patch('/users/1/rename').send({ newName: 'Bob' });
      expect(res.status).toBe(200);
      expect(res.body.newName).toBe('Bob');

      // Verify in DB
      const user = await User.findByPk(1);
      expect(user.name).toBe('Bob');
    });
  });

  describe('Examples - Profile Endpoint', () => {
    test('profile endpoint transforms record data', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
          avatar_url: { type: DataTypes.STRING(255), allowNull: true },
        },
        { tableName: 'users', timestamps: true }
      );
      await sequelize.sync({ force: true });
      await User.create({ name: 'Alice', avatar_url: 'http://example.com/avatar.png' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          member_routes: [
            {
              path: 'profile',
              method: 'get',
              async handler(req) {
                const user = req.apialize.record;
                return {
                  success: true,
                  profile: {
                    id: user.id,
                    name: user.name,
                    avatar: user.avatar_url,
                    memberSince: user.createdAt,
                  },
                };
              },
            },
          ],
        })
      );

      const res = await request(app).get('/users/1/profile');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.profile.name).toBe('Alice');
      expect(res.body.profile.avatar).toBe('http://example.com/avatar.png');
      expect(res.body.profile.memberSince).toBeDefined();
    });
  });

  describe('Examples - Statistics Endpoint', () => {
    test('stats endpoint accesses other models', async () => {
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
          text: { type: DataTypes.STRING(255), allowNull: false },
        },
        { tableName: 'comments', timestamps: false }
      );
      User.hasMany(Post, { foreignKey: 'user_id' });
      User.hasMany(Comment, { foreignKey: 'user_id' });

      await sequelize.sync({ force: true });
      await User.create({ name: 'Alice' });
      await Post.create({ user_id: 1, title: 'Post 1' });
      await Post.create({ user_id: 1, title: 'Post 2' });
      await Comment.create({ user_id: 1, text: 'Comment 1' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          member_routes: [
            {
              path: 'stats',
              method: 'get',
              async handler(req) {
                const userId = req.apialize.record.id;
                // Access models via sequelize instance
                const postCount = await Post.count({ where: { user_id: userId } });
                const commentCount = await Comment.count({ where: { user_id: userId } });

                return {
                  success: true,
                  stats: {
                    posts: postCount,
                    comments: commentCount,
                    total_activity: postCount + commentCount,
                  },
                };
              },
            },
          ],
        })
      );

      const res = await request(app).get('/users/1/stats');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.stats.posts).toBe(2);
      expect(res.body.stats.comments).toBe(1);
      expect(res.body.stats.total_activity).toBe(3);
    });
  });

  describe('Error Handling - 404 When Record Not Found', () => {
    test('returns 404 before handler when record does not exist', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      await sequelize.sync({ force: true });

      let handlerCalled = false;

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          member_routes: [
            {
              path: 'profile',
              method: 'get',
              async handler(req) {
                handlerCalled = true;
                return { shouldNot: 'reach' };
              },
            },
          ],
        })
      );

      const res = await request(app).get('/users/999/profile');
      expect(res.status).toBe(404);
      expect(handlerCalled).toBe(false);
    });
  });

  describe('Custom Error Handling', () => {
    test('handler can send custom error response', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      await sequelize.sync({ force: true });
      await User.create({ name: 'Alice' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          member_routes: [
            {
              path: 'risky-action',
              method: 'post',
              async handler(req, res) {
                try {
                  if (req.body.fail) {
                    throw new Error('Something went wrong');
                  }
                  return { success: true };
                } catch (error) {
                  res.status(400).json({
                    success: false,
                    error: error.message,
                  });
                }
              },
            },
          ],
        })
      );

      // Success case
      const res1 = await request(app).post('/users/1/risky-action').send({ fail: false });
      expect(res1.status).toBe(200);
      expect(res1.body.success).toBe(true);

      // Error case
      const res2 = await request(app).post('/users/1/risky-action').send({ fail: true });
      expect(res2.status).toBe(400);
      expect(res2.body.success).toBe(false);
      expect(res2.body.error).toBe('Something went wrong');
    });
  });

  describe('Soft Delete Example', () => {
    test('soft-delete member route updates record', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
          deleted_at: { type: DataTypes.DATE, allowNull: true },
          deleted_by: { type: DataTypes.INTEGER, allowNull: true },
        },
        { tableName: 'users', timestamps: false }
      );
      await sequelize.sync({ force: true });
      await User.create({ name: 'Alice' });

      const app = express();
      app.use(bodyParser.json());
      // Simulate user being set by auth middleware
      app.use((req, res, next) => {
        req.user = { id: 42 };
        next();
      });
      app.use(
        '/users',
        single(User, {
          member_routes: [
            {
              path: 'soft-delete',
              method: 'delete',
              async handler(req) {
                await req.apialize.rawRecord.update({
                  deleted_at: new Date(),
                  deleted_by: req.user.id,
                });
                return { success: true, deleted: true };
              },
            },
          ],
        })
      );

      const res = await request(app).delete('/users/1/soft-delete');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.deleted).toBe(true);

      // Verify in DB
      const user = await User.findByPk(1);
      expect(user.deleted_at).not.toBeNull();
      expect(user.deleted_by).toBe(42);
    });
  });

  describe('Path Configuration - Nested Paths', () => {
    test('path with nested segments works correctly', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
          email_settings: { type: DataTypes.STRING(255), allowNull: true },
        },
        { tableName: 'users', timestamps: false }
      );
      await sequelize.sync({ force: true });
      await User.create({ name: 'Alice', email_settings: '{}' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          member_routes: [
            {
              path: 'settings/email',
              method: 'put',
              async handler(req) {
                const inst = req.apialize.rawRecord;
                await inst.update({ email_settings: JSON.stringify(req.body) });
                return { success: true };
              },
            },
          ],
        })
      );

      const res = await request(app)
        .put('/users/1/settings/email')
        .send({ notifications: true });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Examples - Activity Endpoint (Accessing Other Models)', () => {
    test('activity endpoint accesses ActivityLog model', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      const ActivityLog = sequelize.define(
        'ActivityLog',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          user_id: { type: DataTypes.INTEGER, allowNull: false },
          action: { type: DataTypes.STRING(100), allowNull: false },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        },
        { tableName: 'activity_logs', timestamps: false }
      );
      User.hasMany(ActivityLog, { foreignKey: 'user_id' });

      await sequelize.sync({ force: true });
      await User.create({ name: 'Alice' });
      await ActivityLog.create({ user_id: 1, action: 'login' });
      await ActivityLog.create({ user_id: 1, action: 'view_profile' });
      await ActivityLog.create({ user_id: 1, action: 'logout' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          member_routes: [
            {
              path: 'activity',
              method: 'get',
              async handler(req) {
                const userId = req.apialize.record.id;
                // Access ActivityLog model directly
                const activities = await ActivityLog.findAll({
                  where: { user_id: userId },
                  order: [['created_at', 'DESC']],
                  limit: 10,
                });

                return {
                  success: true,
                  activities: activities.map((a) => a.get({ plain: true })),
                };
              },
            },
          ],
        })
      );

      const res = await request(app).get('/users/1/activity');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.activities).toHaveLength(3);
      expect(res.body.activities[0].action).toBeDefined();
    });
  });

  describe('Validation - Invalid Configuration', () => {
    test('throws error for empty path', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      await sequelize.sync({ force: true });

      const app = express();
      app.use(bodyParser.json());

      expect(() => {
        app.use(
          '/users',
          single(User, {
            member_routes: [{ path: '', method: 'get', handler: () => {} }],
          })
        );
      }).toThrow();
    });

    test('throws error for invalid method', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      await sequelize.sync({ force: true });

      const app = express();
      app.use(bodyParser.json());

      expect(() => {
        app.use(
          '/users',
          single(User, {
            member_routes: [{ path: 'test', method: 'OPTIONS', handler: () => {} }],
          })
        );
      }).toThrow();
    });

    test('throws error for missing handler', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      await sequelize.sync({ force: true });

      const app = express();
      app.use(bodyParser.json());

      expect(() => {
        app.use(
          '/users',
          single(User, {
            member_routes: [{ path: 'test', method: 'get' }],
          })
        );
      }).toThrow();
    });
  });
});
