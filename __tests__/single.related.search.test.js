const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { single, create, search } = require('../src');

describe('single() with related search operation', () => {
  let sequelize;
  let User;
  let Post;
  let app;

  beforeAll(async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    // User model
    User = sequelize.define(
      'User',
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        name: {
          type: DataTypes.STRING(100),
          allowNull: false,
        },
        email: {
          type: DataTypes.STRING(100),
          allowNull: false,
          unique: true,
        },
      },
      { tableName: 'users', timestamps: false }
    );

    // Post model
    Post = sequelize.define(
      'Post',
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        title: {
          type: DataTypes.STRING(200),
          allowNull: false,
        },
        content: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        status: {
          type: DataTypes.STRING(20),
          allowNull: false,
          defaultValue: 'draft',
        },
        user_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
      },
      { tableName: 'posts', timestamps: false }
    );

    // Define associations
    User.hasMany(Post, { foreignKey: 'user_id' });
    Post.belongsTo(User, { foreignKey: 'user_id' });

    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    await User.destroy({ where: {} });
    await Post.destroy({ where: {} });
    app = express();
    app.use(bodyParser.json());
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('search as a related operation', () => {
    test('should create search endpoint for related model', async () => {
      // Setup endpoints
      app.use('/users', create(User));
      app.use(
        '/users',
        single(User, {
          related: [{ model: Post, operations: ['search'] }],
        })
      );
      app.use('/posts', create(Post));

      // Create users
      const user1Res = await request(app)
        .post('/users')
        .send({ name: 'John Doe', email: 'john@example.com' });
      const userId1 = user1Res.body.id;

      const user2Res = await request(app)
        .post('/users')
        .send({ name: 'Jane Doe', email: 'jane@example.com' });
      const userId2 = user2Res.body.id;

      // Create posts for user1
      await request(app).post('/posts').send({
        title: 'First Post',
        content: 'Content about JavaScript',
        status: 'published',
        user_id: userId1,
      });

      await request(app).post('/posts').send({
        title: 'Second Post',
        content: 'Content about Python',
        status: 'draft',
        user_id: userId1,
      });

      await request(app).post('/posts').send({
        title: 'Third Post',
        content: 'More JavaScript content',
        status: 'published',
        user_id: userId1,
      });

      // Create posts for user2
      await request(app).post('/posts').send({
        title: 'User2 Post',
        content: 'Different user content',
        status: 'published',
        user_id: userId2,
      });

      // Test the related search endpoint - should only return user1's posts
      const searchRes = await request(app)
        .post(`/users/${userId1}/posts/search`)
        .send({
          filtering: {
            status: 'published',
          },
        });

      expect(searchRes.status).toBe(200);
      expect(searchRes.body.success).toBe(true);
      expect(searchRes.body.data).toHaveLength(2);
      expect(searchRes.body.data.every((p) => p.user_id === userId1)).toBe(
        true
      );
      expect(
        searchRes.body.data.every((p) => p.status === 'published')
      ).toBe(true);
    });

    test('should filter search results by parent', async () => {
      // Setup endpoints
      app.use('/users', create(User));
      app.use(
        '/users',
        single(User, {
          related: [{ model: Post, operations: ['search'] }],
        })
      );
      app.use('/posts', create(Post));

      // Create users
      const user1Res = await request(app)
        .post('/users')
        .send({ name: 'John Doe', email: 'john@example.com' });
      const userId1 = user1Res.body.id;

      const user2Res = await request(app)
        .post('/users')
        .send({ name: 'Jane Doe', email: 'jane@example.com' });
      const userId2 = user2Res.body.id;

      // Create posts
      await request(app).post('/posts').send({
        title: 'Post 1',
        content: 'Test content',
        user_id: userId1,
      });

      await request(app).post('/posts').send({
        title: 'Post 2',
        content: 'Test content',
        user_id: userId2,
      });

      // Search user1's posts
      const user1SearchRes = await request(app)
        .post(`/users/${userId1}/posts/search`)
        .send({
          filtering: {},
        });

      expect(user1SearchRes.status).toBe(200);
      expect(user1SearchRes.body.data).toHaveLength(1);
      expect(user1SearchRes.body.data[0].user_id).toBe(userId1);

      // Search user2's posts
      const user2SearchRes = await request(app)
        .post(`/users/${userId2}/posts/search`)
        .send({
          filtering: {},
        });

      expect(user2SearchRes.status).toBe(200);
      expect(user2SearchRes.body.data).toHaveLength(1);
      expect(user2SearchRes.body.data[0].user_id).toBe(userId2);
    });

    test('should support search with list and get operations', async () => {
      // Setup endpoints
      app.use('/users', create(User));
      app.use(
        '/users',
        single(User, {
          related: [{ model: Post, operations: ['list', 'search', 'get'] }],
        })
      );
      app.use('/posts', create(Post));

      // Create user
      const userRes = await request(app)
        .post('/users')
        .send({ name: 'John Doe', email: 'john@example.com' });
      const userId = userRes.body.id;

      // Create posts
      const post1Res = await request(app).post('/posts').send({
        title: 'Post 1',
        content: 'Content 1',
        user_id: userId,
      });
      const post1Id = post1Res.body.id;

      await request(app).post('/posts').send({
        title: 'Post 2',
        content: 'Content 2',
        user_id: userId,
      });

      // Test list endpoint
      const listRes = await request(app).get(`/users/${userId}/posts`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data).toHaveLength(2);

      // Test search endpoint
      const searchRes = await request(app)
        .post(`/users/${userId}/posts/search`)
        .send({
          filtering: { title: 'Post 1' },
        });
      expect(searchRes.status).toBe(200);
      expect(searchRes.body.data).toHaveLength(1);
      expect(searchRes.body.data[0].title).toBe('Post 1');

      // Test get endpoint
      const getRes = await request(app).get(`/users/${userId}/posts/${post1Id}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.record.id).toBe(post1Id);
    });

    test('should support custom search path', async () => {
      // Setup endpoints
      app.use('/users', create(User));
      app.use(
        '/users',
        single(User, {
          related: [
            {
              model: Post,
              operations: ['search'],
              perOperation: {
                search: {
                  path: '/custom-search',
                },
              },
            },
          ],
        })
      );
      app.use('/posts', create(Post));

      // Create user and post
      const userRes = await request(app)
        .post('/users')
        .send({ name: 'John Doe', email: 'john@example.com' });
      const userId = userRes.body.id;

      await request(app).post('/posts').send({
        title: 'Test Post',
        content: 'Test content',
        user_id: userId,
      });

      // Test custom search path
      const searchRes = await request(app)
        .post(`/users/${userId}/posts/custom-search`)
        .send({
          filtering: {},
        });

      expect(searchRes.status).toBe(200);
      expect(searchRes.body.success).toBe(true);
      expect(searchRes.body.data).toHaveLength(1);
    });

    test('should return empty array when parent has no matching posts', async () => {
      // Setup endpoints
      app.use('/users', create(User));
      app.use(
        '/users',
        single(User, {
          related: [{ model: Post, operations: ['search'] }],
        })
      );

      // Create user without posts
      const userRes = await request(app)
        .post('/users')
        .send({ name: 'John Doe', email: 'john@example.com' });
      const userId = userRes.body.id;

      // Search for posts
      const searchRes = await request(app)
        .post(`/users/${userId}/posts/search`)
        .send({
          filtering: {},
        });

      expect(searchRes.status).toBe(200);
      expect(searchRes.body.success).toBe(true);
      expect(searchRes.body.data).toHaveLength(0);
    });

    test('should not allow user to override parent filter via search filtering', async () => {
      // Setup endpoints
      app.use('/users', create(User));
      app.use(
        '/users',
        single(User, {
          related: [{ model: Post, operations: ['search'] }],
        })
      );
      app.use('/posts', create(Post));

      // Create two users
      const user1Res = await request(app)
        .post('/users')
        .send({ name: 'User One', email: 'user1@example.com' });
      const userId1 = user1Res.body.id;

      const user2Res = await request(app)
        .post('/users')
        .send({ name: 'User Two', email: 'user2@example.com' });
      const userId2 = user2Res.body.id;

      // Create posts for both users
      await request(app).post('/posts').send({
        title: 'User 1 Post',
        content: 'Content 1',
        user_id: userId1,
      });

      await request(app).post('/posts').send({
        title: 'User 2 Post',
        content: 'Content 2',
        user_id: userId2,
      });

      // Try to search user1's posts but attempt to override the filter to get user2's posts
      const searchRes = await request(app)
        .post(`/users/${userId1}/posts/search`)
        .send({
          filtering: {
            user_id: userId2, // Attempt to override parent filter
          },
        });

      expect(searchRes.status).toBe(200);
      expect(searchRes.body.success).toBe(true);
      // Should return 0 results because the parent filter takes precedence
      // The filtering requests user_id: userId2, but the parent filter enforces user_id: userId1
      // These are mutually exclusive, so no results should match
      expect(searchRes.body.data).toHaveLength(0);
    });

    test('should not allow user to override parent filter using operators', async () => {
      // Setup endpoints
      app.use('/users', create(User));
      app.use(
        '/users',
        single(User, {
          related: [{ model: Post, operations: ['search'] }],
        })
      );
      app.use('/posts', create(Post));

      // Create two users
      const user1Res = await request(app)
        .post('/users')
        .send({ name: 'User One', email: 'user1@example.com' });
      const userId1 = user1Res.body.id;

      const user2Res = await request(app)
        .post('/users')
        .send({ name: 'User Two', email: 'user2@example.com' });
      const userId2 = user2Res.body.id;

      // Create posts for both users
      await request(app).post('/posts').send({
        title: 'User 1 Post',
        content: 'Content 1',
        user_id: userId1,
      });

      await request(app).post('/posts').send({
        title: 'User 2 Post',
        content: 'Content 2',
        user_id: userId2,
      });

      // Try to search user1's posts but use 'in' operator to include user2's ID
      const searchRes = await request(app)
        .post(`/users/${userId1}/posts/search`)
        .send({
          filtering: {
            user_id: { in: [userId1, userId2] }, // Attempt to include both users
          },
        });

      expect(searchRes.status).toBe(200);
      expect(searchRes.body.success).toBe(true);
      // Should only return user1's post because parent filter takes precedence
      // The parent filter enforces user_id = userId1 (internal ID)
      // The user's filter specifies user_id in [userId1, userId2]
      // Both constraints must be satisfied (Op.and), so only userId1 posts match
      expect(searchRes.body.data).toHaveLength(1);
      expect(searchRes.body.data[0].user_id).toBe(userId1);
      expect(searchRes.body.data[0].title).toBe('User 1 Post');
    });

    test('should enforce parent filter even with complex filtering logic', async () => {
      // Setup endpoints
      app.use('/users', create(User));
      app.use(
        '/users',
        single(User, {
          related: [{ model: Post, operations: ['search'] }],
        })
      );
      app.use('/posts', create(Post));

      // Create two users
      const user1Res = await request(app)
        .post('/users')
        .send({ name: 'User One', email: 'user1@example.com' });
      const userId1 = user1Res.body.id;

      const user2Res = await request(app)
        .post('/users')
        .send({ name: 'User Two', email: 'user2@example.com' });
      const userId2 = user2Res.body.id;

      // Create posts for both users
      await request(app).post('/posts').send({
        title: 'Tech Post',
        content: 'Content about tech',
        status: 'published',
        user_id: userId1,
      });

      await request(app).post('/posts').send({
        title: 'Science Post',
        content: 'Content about science',
        status: 'published',
        user_id: userId2,
      });

      await request(app).post('/posts').send({
        title: 'Draft Post',
        content: 'Draft content',
        status: 'draft',
        user_id: userId1,
      });

      // Search with OR logic - should still only return user1's posts
      const searchRes = await request(app)
        .post(`/users/${userId1}/posts/search`)
        .send({
          filtering: {
            or: [
              { status: 'published' },
              { status: 'draft' },
            ],
          },
        });

      expect(searchRes.status).toBe(200);
      expect(searchRes.body.success).toBe(true);
      expect(searchRes.body.data).toHaveLength(2);
      // All results should belong to user1, not user2
      expect(searchRes.body.data.every((p) => p.user_id === userId1)).toBe(true);
      // Should have one published and one draft
      const statuses = searchRes.body.data.map((p) => p.status).sort();
      expect(statuses).toEqual(['draft', 'published']);
    });
  });
});
