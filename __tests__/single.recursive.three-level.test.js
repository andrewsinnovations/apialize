const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { single, create } = require('../src');

describe('single() recursion with three levels (users -> posts -> comments)', () => {
  let sequelize;
  let User;
  let Post;
  let Comment;
  let app;

  beforeAll(async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    User = sequelize.define(
      'User',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
        email: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      },
      { tableName: 'users', timestamps: false }
    );

    Post = sequelize.define(
      'Post',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        title: { type: DataTypes.STRING(200), allowNull: false },
        content: { type: DataTypes.TEXT, allowNull: true },
        user_id: { type: DataTypes.INTEGER, allowNull: false },
      },
      { tableName: 'posts', timestamps: false }
    );

    Comment = sequelize.define(
      'Comment',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        text: { type: DataTypes.STRING(255), allowNull: false },
        post_id: { type: DataTypes.INTEGER, allowNull: false },
        user_id: { type: DataTypes.INTEGER, allowNull: false },
      },
      { tableName: 'comments', timestamps: false }
    );

    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    await Comment.destroy({ where: {} });
    await Post.destroy({ where: {} });
    await User.destroy({ where: {} });
    app = express();
    app.use(bodyParser.json());

    // Mount endpoints with recursive related configuration
    app.use('/users', create(User));
    app.use(
      '/users',
      single(User, {
        related: [
          {
            model: Post,
            operations: ['list', 'post', 'get'],
            // Recursively attach comments under each post
            related: [
              {
                model: Comment,
                operations: ['list', 'post', 'get', 'put', 'patch', 'delete'],
              },
            ],
          },
        ],
      })
    );

    // Convenience endpoints for creating top-level resources
    app.use('/posts', create(Post));
    app.use('/comments', create(Comment));
  });

  afterAll(async () => {
    await sequelize.close();
  });

  test('supports list/get/post at each level and scopes correctly to parents', async () => {
    // Create a user
    const uRes = await request(app)
      .post('/users')
      .send({ name: 'Alice', email: 'alice@example.com' });
    expect(uRes.status).toBe(201);
    const userId = uRes.body.id;

    // Create two posts for the user via related POST (FK auto-injected)
    const p1 = await request(app)
      .post(`/users/${userId}/posts`)
      .send({ title: 'Hello', content: 'One', user_id: userId });
    const p2 = await request(app)
      .post(`/users/${userId}/posts`)
      .send({ title: 'World', content: 'Two', user_id: userId });
    expect(p1.status).toBe(201);
    expect(p2.status).toBe(201);
    const post1Id = p1.body.id;
    const post2Id = p2.body.id;

    // List posts for user
    const listPosts = await request(app).get(`/users/${userId}/posts`);
    expect(listPosts.status).toBe(200);
    expect(listPosts.body.success).toBe(true);
    expect(listPosts.body.data.map((r) => r.title).sort()).toEqual([
      'Hello',
      'World',
    ]);

    // Create comments under the first post via nested related POST
    const c1 = await request(app)
      .post(`/users/${userId}/posts/${post1Id}/comments`)
      .send({ text: 'Nice!', user_id: userId, post_id: post1Id });
    const c2 = await request(app)
      .post(`/users/${userId}/posts/${post1Id}/comments`)
      .send({ text: 'Agreed', user_id: userId, post_id: post1Id });
    expect(c1.status).toBe(201);
    expect(c2.status).toBe(201);

    // List comments for first post
    const listComments1 = await request(app).get(
      `/users/${userId}/posts/${post1Id}/comments`
    );
    expect(listComments1.status).toBe(200);
    expect(listComments1.body.success).toBe(true);
    expect(listComments1.body.data.map((r) => r.text).sort()).toEqual([
      'Agreed',
      'Nice!',
    ]);

    // Ensure comments do not appear under the second post
    const listComments2 = await request(app).get(
      `/users/${userId}/posts/${post2Id}/comments`
    );
    expect(listComments2.status).toBe(200);
    expect(listComments2.body.data).toHaveLength(0);

    // GET single comment via nested route
    const commentId = c1.body.id;
    const getComment = await request(app).get(
      `/users/${userId}/posts/${post1Id}/comments/${commentId}`
    );
    expect(getComment.status).toBe(200);
    expect(getComment.body.success).toBe(true);
    expect(getComment.body.record.text).toBe('Nice!');

    // UPDATE third-level comment via PUT (must include required fields)
    const putComment = await request(app)
      .put(`/users/${userId}/posts/${post1Id}/comments/${commentId}`)
      .send({ text: 'Updated comment', user_id: userId, post_id: post1Id });
    expect(putComment.status).toBe(200);
    expect(putComment.body.success).toBe(true);

    // Verify the update took effect
    const getAfterPut = await request(app).get(
      `/users/${userId}/posts/${post1Id}/comments/${commentId}`
    );
    expect(getAfterPut.status).toBe(200);
    expect(getAfterPut.body.success).toBe(true);
    expect(getAfterPut.body.record.text).toBe('Updated comment');
    expect(getAfterPut.body.record.user_id).toBe(userId);
    expect(getAfterPut.body.record.post_id).toBe(post1Id);

    // PATCH third-level comment (partial update)
    const patchComment = await request(app)
      .patch(`/users/${userId}/posts/${post1Id}/comments/${commentId}`)
      .send({ text: 'Patched comment', user_id: userId, post_id: post1Id });
    expect(patchComment.status).toBe(200);
    expect(patchComment.body.success).toBe(true);
    expect(patchComment.body.id).toBe(String(commentId));

    // Verify the patch took effect
    const getAfterPatch = await request(app).get(
      `/users/${userId}/posts/${post1Id}/comments/${commentId}`
    );
    expect(getAfterPatch.status).toBe(200);
    expect(getAfterPatch.body.record.text).toBe('Patched comment');

    // DELETE third-level comment
    const delComment = await request(app).delete(
      `/users/${userId}/posts/${post1Id}/comments/${commentId}`
    );
    expect(delComment.status).toBe(200);
    expect(delComment.body.success).toBe(true);
    expect(delComment.body.id).toBe(String(commentId));

    // Ensure it's gone from the list
    const listCommentsAfterDelete = await request(app).get(
      `/users/${userId}/posts/${post1Id}/comments`
    );
    expect(listCommentsAfterDelete.status).toBe(200);
    expect(listCommentsAfterDelete.body.data.map((r) => r.text).sort()).toEqual(
      ['Agreed']
    );
  });

  test('middleware execution order: parent filter -> child pre -> operation -> child post', async () => {
    // Track execution order
    const executionLog = [];

    // Reset app with hooks to track execution order
    app = express();
    app.use(bodyParser.json());

    // Mount endpoints with hooks and middleware to track execution
    app.use('/users', create(User));
    app.use(
      '/users',
      single(User, {
        related: [
          {
            model: Post,
            operations: ['list', 'post', 'get', 'put'],
            // Options apply to all operations for posts
            options: {
              // Additional middleware for posts (runs after parent filter, before hooks)
              middleware: [
                (req, res, next) => {
                  executionLog.push('post-additional-middleware');
                  next();
                },
              ],
              // Hooks for posts
              pre: async (ctx) => {
                executionLog.push('post-pre-hook');
              },
              post: async (ctx) => {
                executionLog.push('post-post-hook');
              },
            },
            // Recursively attach comments under each post
            related: [
              {
                model: Comment,
                operations: ['list', 'post', 'get', 'put'],
                // Options apply to all operations for comments
                options: {
                  // Additional middleware for comments (runs after parent filter, before hooks)
                  middleware: [
                    (req, res, next) => {
                      executionLog.push('comment-additional-middleware');
                      next();
                    },
                  ],
                  // Hooks for comments
                  pre: async (ctx) => {
                    executionLog.push('comment-pre-hook');
                  },
                  post: async (ctx) => {
                    executionLog.push('comment-post-hook');
                  },
                },
              },
            ],
          },
        ],
      })
    );

    // Create test data
    const userRes = await request(app)
      .post('/users')
      .send({ name: 'Bob', email: 'bob@example.com' });
    const userId = userRes.body.id;

    // Test 1: Create a post (should execute post hooks only)
    executionLog.length = 0;
    const postRes = await request(app)
      .post(`/users/${userId}/posts`)
      .send({ title: 'Test Post', content: 'Content', user_id: userId });
    expect(postRes.status).toBe(201);

    // Expected order: additional middleware -> pre hook -> operation -> post hook
    // Note: parent filter middleware is automatically added and runs first, but we don't track it
    expect(executionLog).toEqual([
      'post-additional-middleware',
      'post-pre-hook',
      'post-post-hook',
    ]);

    const postId = postRes.body.id;

    // Test 2: Create a comment (three-level nesting)
    executionLog.length = 0;
    const commentRes = await request(app)
      .post(`/users/${userId}/posts/${postId}/comments`)
      .send({ text: 'Test Comment', user_id: userId, post_id: postId });
    expect(commentRes.status).toBe(201);

    // Expected order:
    // 1. Parent filter middleware (auto-generated, validates user owns post) - not tracked
    // 2. Comment additional middleware
    // 3. Comment pre hook
    // 4. Comment operation (create)
    // 5. Comment post hook
    expect(executionLog).toEqual([
      'comment-additional-middleware',
      'comment-pre-hook',
      'comment-post-hook',
    ]);

    const commentId = commentRes.body.id;

    // Test 3: GET a comment (validates parent filters run before child hooks)
    executionLog.length = 0;
    const getCommentRes = await request(app).get(
      `/users/${userId}/posts/${postId}/comments/${commentId}`
    );
    expect(getCommentRes.status).toBe(200);

    // Expected: additional middleware -> pre hook -> operation -> post hook
    expect(executionLog).toEqual([
      'comment-additional-middleware',
      'comment-pre-hook',
      'comment-post-hook',
    ]);

    // Test 4: PUT update a comment (validates write operation hooks)
    executionLog.length = 0;
    const putRes = await request(app)
      .put(`/users/${userId}/posts/${postId}/comments/${commentId}`)
      .send({ text: 'Updated', user_id: userId, post_id: postId });
    expect(putRes.status).toBe(200);

    // Expected: additional middleware -> pre hook -> operation -> post hook
    expect(executionLog).toEqual([
      'comment-additional-middleware',
      'comment-pre-hook',
      'comment-post-hook',
    ]);

    // Test 5: Verify parent filters prevent access to non-existent parent
    executionLog.length = 0;
    const invalidRes = await request(app).get(
      `/users/${userId}/posts/99999/comments/${commentId}`
    );
    expect(invalidRes.status).toBe(404);

    // Parent filter middleware runs at router level, then additional middleware and pre hook run,
    // but the operation fails to find the parent resource, so post hook doesn't run
    expect(executionLog).toEqual([
      'comment-additional-middleware',
      'comment-pre-hook',
    ]);

    // Test 6: List comments (validates list operation execution order)
    executionLog.length = 0;
    const listRes = await request(app).get(
      `/users/${userId}/posts/${postId}/comments`
    );
    expect(listRes.status).toBe(200);

    // Expected: additional middleware -> pre hook -> operation -> post hook
    expect(executionLog).toEqual([
      'comment-additional-middleware',
      'comment-pre-hook',
      'comment-post-hook',
    ]);
  });
});
