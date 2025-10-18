const express = require("express");
const bodyParser = require("body-parser");
const request = require("supertest");
const { Sequelize, DataTypes } = require("sequelize");
const { single, create } = require("../src");

describe("single() recursion with three levels (users -> posts -> comments)", () => {
  let sequelize;
  let User;
  let Post;
  let Comment;
  let app;

  beforeAll(async () => {
    sequelize = new Sequelize("sqlite::memory:", { logging: false });

    User = sequelize.define(
      "User",
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
        email: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      },
      { tableName: "users", timestamps: false },
    );

    Post = sequelize.define(
      "Post",
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        title: { type: DataTypes.STRING(200), allowNull: false },
        content: { type: DataTypes.TEXT, allowNull: true },
        user_id: { type: DataTypes.INTEGER, allowNull: false },
      },
      { tableName: "posts", timestamps: false },
    );

    Comment = sequelize.define(
      "Comment",
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        text: { type: DataTypes.STRING(255), allowNull: false },
        post_id: { type: DataTypes.INTEGER, allowNull: false },
        user_id: { type: DataTypes.INTEGER, allowNull: false },
      },
      { tableName: "comments", timestamps: false },
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
    app.use("/users", create(User));
    app.use(
      "/users",
      single(User, {
        related: [
          {
            model: Post,
            // Recursively attach comments under each post
            related: [{ model: Comment }],
          },
        ],
      }),
    );

    // Convenience endpoints for creating top-level resources
    app.use("/posts", create(Post));
    app.use("/comments", create(Comment));
  });

  afterAll(async () => {
    await sequelize.close();
  });

  test("supports list/get/post at each level and scopes correctly to parents", async () => {
    // Create a user
    const uRes = await request(app)
      .post("/users")
      .send({ name: "Alice", email: "alice@example.com" });
    expect(uRes.status).toBe(201);
    const userId = uRes.body.id;

    // Create two posts for the user via related POST (FK auto-injected)
    const p1 = await request(app)
      .post(`/users/${userId}/posts`)
      .send({ title: "Hello", content: "One" });
    const p2 = await request(app)
      .post(`/users/${userId}/posts`)
      .send({ title: "World", content: "Two" });
    expect(p1.status).toBe(201);
    expect(p2.status).toBe(201);
    const post1Id = p1.body.id;
    const post2Id = p2.body.id;

    // List posts for user
    const listPosts = await request(app).get(`/users/${userId}/posts`);
    expect(listPosts.status).toBe(200);
    expect(listPosts.body.success).toBe(true);
    expect(listPosts.body.data.map((r) => r.title).sort()).toEqual([
      "Hello",
      "World",
    ]);

    // Create comments under the first post via nested related POST
    const c1 = await request(app)
      .post(`/users/${userId}/posts/${post1Id}/comments`)
      .send({ text: "Nice!", user_id: userId });
    const c2 = await request(app)
      .post(`/users/${userId}/posts/${post1Id}/comments`)
      .send({ text: "Agreed", user_id: userId });
    expect(c1.status).toBe(201);
    expect(c2.status).toBe(201);

    // List comments for first post
    const listComments1 = await request(app).get(
      `/users/${userId}/posts/${post1Id}/comments`,
    );
    expect(listComments1.status).toBe(200);
    expect(listComments1.body.success).toBe(true);
    expect(listComments1.body.data.map((r) => r.text).sort()).toEqual([
      "Agreed",
      "Nice!",
    ]);

    // Ensure comments do not appear under the second post
    const listComments2 = await request(app).get(
      `/users/${userId}/posts/${post2Id}/comments`,
    );
    expect(listComments2.status).toBe(200);
    expect(listComments2.body.data).toHaveLength(0);

    // GET single comment via nested route
    const commentId = c1.body.id;
    const getComment = await request(app).get(
      `/users/${userId}/posts/${post1Id}/comments/${commentId}`,
    );
    expect(getComment.status).toBe(200);
    expect(getComment.body.success).toBe(true);
    expect(getComment.body.record.text).toBe("Nice!");

    // UPDATE third-level comment via PUT (must include required fields)
    const putComment = await request(app)
      .put(`/users/${userId}/posts/${post1Id}/comments/${commentId}`)
      .send({ text: "Updated comment", user_id: userId });
    expect(putComment.status).toBe(200);
    expect(putComment.body.success).toBe(true);

    // Verify the update took effect
    const getAfterPut = await request(app).get(
      `/users/${userId}/posts/${post1Id}/comments/${commentId}`,
    );
    expect(getAfterPut.status).toBe(200);
    expect(getAfterPut.body.success).toBe(true);
    expect(getAfterPut.body.record.text).toBe("Updated comment");
    expect(getAfterPut.body.record.user_id).toBe(userId);
    expect(getAfterPut.body.record.post_id).toBe(post1Id);

    // PATCH third-level comment (partial update)
    const patchComment = await request(app)
      .patch(`/users/${userId}/posts/${post1Id}/comments/${commentId}`)
      .send({ text: "Patched comment" });
    expect(patchComment.status).toBe(200);
    expect(patchComment.body.success).toBe(true);
    expect(patchComment.body.id).toBe(String(commentId));

    // Verify the patch took effect
    const getAfterPatch = await request(app).get(
      `/users/${userId}/posts/${post1Id}/comments/${commentId}`,
    );
    expect(getAfterPatch.status).toBe(200);
    expect(getAfterPatch.body.record.text).toBe("Patched comment");

    // DELETE third-level comment
    const delComment = await request(app).delete(
      `/users/${userId}/posts/${post1Id}/comments/${commentId}`,
    );
    expect(delComment.status).toBe(200);
    expect(delComment.body.success).toBe(true);
    expect(delComment.body.id).toBe(String(commentId));

    // Ensure it's gone from the list
    const listCommentsAfterDelete = await request(app).get(
      `/users/${userId}/posts/${post1Id}/comments`,
    );
    expect(listCommentsAfterDelete.status).toBe(200);
    expect(listCommentsAfterDelete.body.data.map((r) => r.text).sort()).toEqual(
      ["Agreed"],
    );
  });
});
