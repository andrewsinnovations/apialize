/**
 * Tests for documentation examples in single.md
 * Verifies all code examples work correctly
 */
const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { single, create } = require('../src');

describe('Documentation: single.md examples', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  describe('Basic Usage', () => {
    test('basic single endpoint returns record', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
          email: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: true }
      );
      await sequelize.sync({ force: true });

      const app = express();
      app.use(bodyParser.json());
      app.use('/users', create(User));
      app.use('/users', single(User));

      // Create a user
      const createRes = await request(app)
        .post('/users')
        .send({ name: 'John Doe', email: 'john@example.com' });

      expect(createRes.status).toBe(201);

      // GET /users/:id
      const res = await request(app).get(`/users/${createRes.body.id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.record).toMatchObject({
        id: createRes.body.id,
        name: 'John Doe',
        email: 'john@example.com',
      });
    });
  });

  describe('ID Mapping - id_mapping option', () => {
    test('id_mapping uses external_id for lookup and normalizes response', async () => {
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
      await sequelize.sync({ force: true });

      const app = express();
      app.use(bodyParser.json());
      app.use('/users', create(User));
      app.use('/users', single(User, { id_mapping: 'external_id' }));

      // Create a user
      await request(app)
        .post('/users')
        .send({ name: 'John', external_id: 'uuid-123' });

      // GET /users/uuid-123
      const res = await request(app).get('/users/uuid-123');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.record.id).toBe('uuid-123');
      expect(res.body.record.name).toBe('John');
      // external_id should be removed from response (replaced by id)
      expect(res.body.record.external_id).toBeUndefined();
    });

    test('param_name customizes URL parameter name', async () => {
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
      const user = await User.create({ name: 'John' });

      const app = express();
      app.use(bodyParser.json());
      app.use('/users', single(User, { param_name: 'userId' }));

      // Creates route: GET /users/:userId
      const res = await request(app).get(`/users/${user.id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.record.name).toBe('John');
    });
  });

  describe('Middleware - middleware option', () => {
    test('middleware can apply_where to scope records', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
          organization_id: { type: DataTypes.INTEGER, allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      await sequelize.sync({ force: true });

      // Create users
      const user1 = await User.create({ name: 'Alice', organization_id: 1 });
      const user2 = await User.create({ name: 'Bob', organization_id: 2 });

      const scopeToOrganization = (req, res, next) => {
        // Simulate req.user.org_id being set by auth middleware
        req.user = { org_id: 1 };
        req.apialize.apply_where({ organization_id: req.user.org_id });
        next();
      };

      const app = express();
      app.use(bodyParser.json());
      app.use('/users', single(User, { middleware: [scopeToOrganization] }));

      // User in org 1 - should be accessible
      const res1 = await request(app).get(`/users/${user1.id}`);
      expect(res1.status).toBe(200);
      expect(res1.body.record.name).toBe('Alice');

      // User in org 2 - should be 404 due to scope
      const res2 = await request(app).get(`/users/${user2.id}`);
      expect(res2.status).toBe(404);
    });
  });

  describe('Hooks - pre and post options', () => {
    test('pre hook is called before query execution', async () => {
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
      await User.create({ name: 'John' });

      let preHookCalled = false;

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          pre: async (context) => {
            preHookCalled = true;
            expect(context.transaction).toBeUndefined(); // Read-only, no transaction
            return { startTime: Date.now() };
          },
        })
      );

      const res = await request(app).get('/users/1');
      expect(res.status).toBe(200);
      expect(preHookCalled).toBe(true);
    });

    test('post hook can access preResult and modify payload', async () => {
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
      await User.create({ name: 'John' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          pre: async (context) => {
            return { startTime: Date.now() };
          },
          post: async (context) => {
            expect(context.preResult).toBeDefined();
            expect(context.preResult.startTime).toBeDefined();
            expect(context.record).toBeDefined();
            context.payload.meta = { fetchTime: Date.now() };
          },
        })
      );

      const res = await request(app).get('/users/1');
      expect(res.status).toBe(200);
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.fetchTime).toBeDefined();
    });

    test('multiple pre hooks execute in order, last result becomes preResult', async () => {
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
      await User.create({ name: 'John' });

      const executionOrder = [];

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          pre: [
            async (context) => {
              executionOrder.push('pre1');
              return { step: 1 };
            },
            async (context) => {
              executionOrder.push('pre2');
              return { step: 2, finalPre: true };
            },
          ],
          post: async (context) => {
            expect(context.preResult).toEqual({ step: 2, finalPre: true });
          },
        })
      );

      const res = await request(app).get('/users/1');
      expect(res.status).toBe(200);
      expect(executionOrder).toEqual(['pre1', 'pre2']);
    });
  });

  describe('Field Aliases - aliases option', () => {
    test('aliases transform internal field names to external names', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          user_name: { type: DataTypes.STRING(100), allowNull: false },
          email: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      await sequelize.sync({ force: true });
      await User.create({ user_name: 'John', email: 'john@example.com' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          aliases: {
            userName: 'user_name',
            emailAddress: 'email',
          },
        })
      );

      const res = await request(app).get('/users/1');
      expect(res.status).toBe(200);
      // Response should use external names
      expect(res.body.record.userName).toBe('John');
      expect(res.body.record.emailAddress).toBe('john@example.com');
      // Internal names should not be present
      expect(res.body.record.user_name).toBeUndefined();
      expect(res.body.record.email).toBeUndefined();
    });
  });

  describe('Flattening - flattening option', () => {
    test('flattening brings nested association fields to top level', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          email: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      const UserProfile = sequelize.define(
        'UserProfile',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          user_id: { type: DataTypes.INTEGER, allowNull: false },
          first_name: { type: DataTypes.STRING(50), allowNull: true },
          last_name: { type: DataTypes.STRING(50), allowNull: true },
          avatar_url: { type: DataTypes.STRING(255), allowNull: true },
        },
        { tableName: 'user_profiles', timestamps: false }
      );

      User.hasOne(UserProfile, { foreignKey: 'user_id', as: 'Profile' });
      UserProfile.belongsTo(User, { foreignKey: 'user_id' });

      await sequelize.sync({ force: true });
      const user = await User.create({ email: 'john@example.com' });
      await UserProfile.create({
        user_id: user.id,
        first_name: 'John',
        last_name: 'Doe',
        avatar_url: 'http://example.com/avatar.png',
      });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          flattening: {
            model: UserProfile,
            as: 'Profile',
            attributes: ['first_name', 'last_name', 'avatar_url'],
          },
        })
      );

      const res = await request(app).get('/users/1');
      expect(res.status).toBe(200);
      // Flattened fields should be at top level
      expect(res.body.record.first_name).toBe('John');
      expect(res.body.record.last_name).toBe('Doe');
      expect(res.body.record.avatar_url).toBe('http://example.com/avatar.png');
      // Nested object should be removed
      expect(res.body.record.Profile).toBeUndefined();
    });

    test('flattening with attribute aliasing', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          email: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      const UserProfile = sequelize.define(
        'UserProfile',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          user_id: { type: DataTypes.INTEGER, allowNull: false },
          first_name: { type: DataTypes.STRING(50), allowNull: true },
          last_name: { type: DataTypes.STRING(50), allowNull: true },
        },
        { tableName: 'user_profiles', timestamps: false }
      );

      User.hasOne(UserProfile, { foreignKey: 'user_id', as: 'Profile' });
      UserProfile.belongsTo(User, { foreignKey: 'user_id' });

      await sequelize.sync({ force: true });
      const user = await User.create({ email: 'john@example.com' });
      await UserProfile.create({
        user_id: user.id,
        first_name: 'John',
        last_name: 'Doe',
      });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          flattening: {
            model: UserProfile,
            as: 'Profile',
            attributes: ['first_name', ['last_name', 'surname']],
          },
        })
      );

      const res = await request(app).get('/users/1');
      expect(res.status).toBe(200);
      expect(res.body.record.first_name).toBe('John');
      expect(res.body.record.surname).toBe('Doe');
      expect(res.body.record.last_name).toBeUndefined();
    });
  });

  describe('Model Options Parameter', () => {
    test('modelOptions attributes limits returned fields', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
          email: { type: DataTypes.STRING(100), allowNull: false },
          password: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      await sequelize.sync({ force: true });
      await User.create({ name: 'John', email: 'john@example.com', password: 'secret' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(
          User,
          {},
          {
            attributes: ['id', 'name', 'email'], // Only return these fields
          }
        )
      );

      const res = await request(app).get('/users/1');
      expect(res.status).toBe(200);
      expect(res.body.record.id).toBe(1);
      expect(res.body.record.name).toBe('John');
      expect(res.body.record.email).toBe('john@example.com');
      expect(res.body.record.password).toBeUndefined();
    });

    test('modelOptions include adds associations', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
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
      await User.create({ name: 'John', department_id: dept.id });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(
          User,
          {},
          {
            include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
          }
        )
      );

      const res = await request(app).get('/users/1');
      expect(res.status).toBe(200);
      expect(res.body.record.department).toMatchObject({
        id: dept.id,
        name: 'Engineering',
      });
    });

    test('modelOptions where adds additional filter', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
          active: { type: DataTypes.BOOLEAN, defaultValue: true },
        },
        { tableName: 'users', timestamps: false }
      );
      await sequelize.sync({ force: true });
      const activeUser = await User.create({ name: 'Active', active: true });
      const inactiveUser = await User.create({ name: 'Inactive', active: false });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(
          User,
          {},
          {
            where: { active: true },
          }
        )
      );

      // Active user should be found
      const res1 = await request(app).get(`/users/${activeUser.id}`);
      expect(res1.status).toBe(200);

      // Inactive user should not be found (404)
      const res2 = await request(app).get(`/users/${inactiveUser.id}`);
      expect(res2.status).toBe(404);
    });
  });

  describe('Response Format', () => {
    test('success response format', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
          email: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: true }
      );
      await sequelize.sync({ force: true });
      await User.create({ name: 'John Doe', email: 'john@example.com' });

      const app = express();
      app.use(bodyParser.json());
      app.use('/users', single(User));

      const res = await request(app).get('/users/1');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        record: {
          id: 1,
          name: 'John Doe',
          email: 'john@example.com',
        },
      });
      expect(res.body.record.createdAt).toBeDefined();
      expect(res.body.record.updatedAt).toBeDefined();
    });

    test('404 response when record not found', async () => {
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
      app.use('/users', single(User));

      const res = await request(app).get('/users/999');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Not Found');
    });
  });

  describe('Query String Filtering', () => {
    test('query string adds WHERE conditions', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
          organization_id: { type: DataTypes.INTEGER, allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      await sequelize.sync({ force: true });
      const user = await User.create({ name: 'John', organization_id: 5 });

      const app = express();
      app.use(bodyParser.json());
      app.use('/users', single(User));

      // Match - should return user
      const res1 = await request(app).get(`/users/${user.id}?organization_id=5`);
      expect(res1.status).toBe(200);
      expect(res1.body.record.name).toBe('John');

      // No match - should 404
      const res2 = await request(app).get(`/users/${user.id}?organization_id=999`);
      expect(res2.status).toBe(404);
    });
  });

  describe('Examples from Documentation', () => {
    test('authentication scoping middleware example', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
          organization_id: { type: DataTypes.INTEGER, allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      await sequelize.sync({ force: true });
      const user1 = await User.create({ name: 'Alice', organization_id: 1 });
      const user2 = await User.create({ name: 'Bob', organization_id: 2 });

      const authMiddleware = (req, res, next) => {
        if (!req.user) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        req.apialize.apply_where({ organization_id: req.user.org_id });
        next();
      };

      const app = express();
      app.use(bodyParser.json());
      // Simulate authenticated user
      app.use((req, res, next) => {
        req.user = { org_id: 1 }; // Simulate auth
        next();
      });
      app.use('/users', single(User, { middleware: [authMiddleware] }));

      // User in org 1 should be accessible
      const res1 = await request(app).get(`/users/${user1.id}`);
      expect(res1.status).toBe(200);
      expect(res1.body.record.name).toBe('Alice');

      // User in org 2 should be 404 due to scoping
      const res2 = await request(app).get(`/users/${user2.id}`);
      expect(res2.status).toBe(404);
    });

    test('pre and post hooks with computed fields example', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          first_name: { type: DataTypes.STRING(100), allowNull: false },
          last_name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      await sequelize.sync({ force: true });
      await User.create({ first_name: 'John', last_name: 'Doe' });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(User, {
          pre: async (context) => {
            console.log(`Fetching user: ${context.req.params.id}`);
            return { startTime: Date.now() };
          },
          post: async (context) => {
            const duration = Date.now() - context.preResult.startTime;
            context.payload.meta = { queryTime: `${duration}ms` };

            // Optionally modify the record
            context.payload.record.fullName = `${context.payload.record.first_name} ${context.payload.record.last_name}`;
          },
        })
      );

      const res = await request(app).get('/users/1');
      expect(res.status).toBe(200);
      expect(res.body.record.fullName).toBe('John Doe');
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.queryTime).toMatch(/^\d+ms$/);
    });

    test('associations and flattening combined example', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          email: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'users', timestamps: false }
      );
      const UserProfile = sequelize.define(
        'UserProfile',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          user_id: { type: DataTypes.INTEGER, allowNull: false },
          first_name: { type: DataTypes.STRING(50), allowNull: true },
          last_name: { type: DataTypes.STRING(50), allowNull: true },
          bio: { type: DataTypes.TEXT, allowNull: true },
        },
        { tableName: 'user_profiles', timestamps: false }
      );
      const Department = sequelize.define(
        'Department',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'departments', timestamps: false }
      );

      User.hasOne(UserProfile, { foreignKey: 'user_id', as: 'Profile' });
      User.belongsTo(Department, { foreignKey: 'department_id', as: 'department' });

      await sequelize.sync({ force: true });
      const dept = await Department.create({ name: 'Engineering' });
      const user = await User.create({ email: 'john@example.com', department_id: dept.id });
      await UserProfile.create({
        user_id: user.id,
        first_name: 'John',
        last_name: 'Doe',
        bio: 'Software engineer',
      });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(
          User,
          {
            flattening: {
              model: UserProfile,
              as: 'Profile',
              attributes: ['first_name', 'last_name', 'bio'],
            },
          },
          {
            include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
          }
        )
      );

      const res = await request(app).get('/users/1');
      expect(res.status).toBe(200);
      // Flattened profile fields
      expect(res.body.record.first_name).toBe('John');
      expect(res.body.record.last_name).toBe('Doe');
      expect(res.body.record.bio).toBe('Software engineer');
      // Nested department
      expect(res.body.record.department).toMatchObject({
        id: dept.id,
        name: 'Engineering',
      });
      // Profile should be removed
      expect(res.body.record.Profile).toBeUndefined();
    });
  });

  describe('Relation ID Mapping', () => {
    test('relation_id_mapping normalizes foreign key and nested model IDs', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
          category_id: { type: DataTypes.INTEGER, allowNull: true },
        },
        { tableName: 'users', timestamps: false }
      );
      const Category = sequelize.define(
        'Category',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          external_id: { type: DataTypes.STRING(64), allowNull: false, unique: true },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        { tableName: 'categories', timestamps: false }
      );
      User.belongsTo(Category, { foreignKey: 'category_id', as: 'category' });

      await sequelize.sync({ force: true });
      const cat = await Category.create({ external_id: 'cat-uuid-123', name: 'Tech' });
      await User.create({ name: 'John', category_id: cat.id });

      const app = express();
      app.use(bodyParser.json());
      app.use(
        '/users',
        single(
          User,
          {
            // Array format with model reference
            relation_id_mapping: [
              {
                model: Category,
                id_field: 'external_id',
              },
            ],
          },
          {
            include: [{ model: Category, as: 'category' }],
          }
        )
      );

      const res = await request(app).get('/users/1');
      expect(res.status).toBe(200);
      // Foreign key should be mapped to external_id
      expect(res.body.record.category_id).toBe('cat-uuid-123');
      // Nested object's id should also be mapped
      expect(res.body.record.category.id).toBe('cat-uuid-123');
    });
  });
});
