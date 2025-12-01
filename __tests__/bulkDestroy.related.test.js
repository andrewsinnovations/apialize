const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { single, create } = require('../src');

// This suite verifies DELETE on a related collection without :id
// - Dry run: confirm missing or false returns ids only
// - Confirmed: confirm=true performs deletion and returns deleted count and ids
// - id_mapping override is respected for returned ids

describe('bulk delete on related collections', () => {
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
      },
      { tableName: 'bd_users', timestamps: false }
    );

    Post = sequelize.define(
      'Post',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        title: { type: DataTypes.STRING(200), allowNull: false },
        user_id: { type: DataTypes.INTEGER, allowNull: false },
      },
      { tableName: 'bd_posts', timestamps: false }
    );

    Comment = sequelize.define(
      'Comment',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        comment_key: {
          type: DataTypes.STRING(64),
          allowNull: false,
          unique: true,
        },
        text: { type: DataTypes.STRING(255), allowNull: false },
        post_id: { type: DataTypes.INTEGER, allowNull: false },
      },
      { tableName: 'bd_comments', timestamps: false }
    );

    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    await Comment.destroy({ where: {} });
    await Post.destroy({ where: {} });
    await User.destroy({ where: {} });

    app = express();
    app.use(bodyParser.json());

    // Mount endpoints with comments related under posts
    app.use('/users', create(User));
    app.use(
      '/users',
      single(User, {
        related: [
          {
            model: Post,
            operations: ['list', 'post', 'get'],
            related: [
              {
                model: Comment,
                operations: ['list', 'post', 'get', 'delete'],
                // Per-op override to use custom id mapping for DELETE operations
                perOperation: {
                  delete: {
                    id_mapping: 'comment_key',
                    allow_bulk_delete: true,
                  },
                },
              },
            ],
          },
        ],
      })
    );
  });

  afterAll(async () => {
    await sequelize.close();
  });

  test('dry run returns ids (no confirm)', async () => {
    const u = await request(app).post('/users').send({ name: 'U' });
    const userId = u.body.id;
    const p = await request(app)
      .post(`/users/${userId}/posts`)
      .send({ title: 'T', user_id: userId });
    const postId = p.body.id;

    // create 3 comments
    const c1 = await request(app)
      .post(`/users/${userId}/posts/${postId}/comments`)
      .send({ text: 'A', comment_key: 'k1', post_id: postId });
    const c2 = await request(app)
      .post(`/users/${userId}/posts/${postId}/comments`)
      .send({ text: 'B', comment_key: 'k2', post_id: postId });
    const c3 = await request(app)
      .post(`/users/${userId}/posts/${postId}/comments`)
      .send({ text: 'C', comment_key: 'k3', post_id: postId });
    expect(c1.status).toBe(201);
    expect(c2.status).toBe(201);
    expect(c3.status).toBe(201);

    const dry = await request(app).delete(
      `/users/${userId}/posts/${postId}/comments`
    );
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ success: true, confirm_required: true });
    // ids reflect id_mapping override (comment_key) as strings
    expect(dry.body.ids.sort()).toEqual(['k1', 'k2', 'k3']);

    // Ensure records still exist
    const list = await request(app).get(
      `/users/${userId}/posts/${postId}/comments`
    );
    expect(list.body.data).toHaveLength(3);
  });

  test('confirmed bulk delete removes records and returns ids + count', async () => {
    const u = await request(app).post('/users').send({ name: 'U2' });
    const userId = u.body.id;
    const p = await request(app)
      .post(`/users/${userId}/posts`)
      .send({ title: 'T2', user_id: userId });
    const postId = p.body.id;

    await request(app)
      .post(`/users/${userId}/posts/${postId}/comments`)
      .send({ text: 'A', comment_key: 'd1', post_id: postId });
    await request(app)
      .post(`/users/${userId}/posts/${postId}/comments`)
      .send({ text: 'B', comment_key: 'd2', post_id: postId });

    const ok = await request(app).delete(
      `/users/${userId}/posts/${postId}/comments?confirm=true`
    );
    expect(ok.status).toBe(200);
    expect(ok.body.success).toBe(true);
    expect(ok.body.ids.sort()).toEqual(['d1', 'd2']);
    expect(ok.body.deleted).toBe(2);

    const list = await request(app).get(
      `/users/${userId}/posts/${postId}/comments`
    );
    expect(list.body.data).toHaveLength(0);
  });

  test("scoping: other parent's records are untouched", async () => {
    const u1 = await request(app).post('/users').send({ name: 'A' });
    const u2 = await request(app).post('/users').send({ name: 'B' });
    const p1 = await request(app)
      .post(`/users/${u1.body.id}/posts`)
      .send({ title: 'X', user_id: u1.body.id });
    const p2 = await request(app)
      .post(`/users/${u2.body.id}/posts`)
      .send({ title: 'Y', user_id: u2.body.id });

    await request(app)
      .post(`/users/${u1.body.id}/posts/${p1.body.id}/comments`)
      .send({ text: '1', comment_key: 'x1', post_id: p1.body.id });
    await request(app)
      .post(`/users/${u2.body.id}/posts/${p2.body.id}/comments`)
      .send({ text: '2', comment_key: 'y1', post_id: p2.body.id });

    const ok = await request(app).delete(
      `/users/${u1.body.id}/posts/${p1.body.id}/comments?confirm=true`
    );
    expect(ok.status).toBe(200);

    const remains = await request(app).get(
      `/users/${u2.body.id}/posts/${p2.body.id}/comments`
    );
    expect(remains.body.data.map((r) => r.comment_key)).toEqual(['y1']);
  });
});
