const express = require("express");
const bodyParser = require("body-parser");
const request = require("supertest");
const { Sequelize, DataTypes } = require("sequelize");
const { single, create } = require("../src");

describe("bulk delete can be disabled per related config", () => {
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
      },
      { tableName: "bd_off_users", timestamps: false }
    );

    Post = sequelize.define(
      "Post",
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        title: { type: DataTypes.STRING(200), allowNull: false },
        user_id: { type: DataTypes.INTEGER, allowNull: false },
      },
      { tableName: "bd_off_posts", timestamps: false }
    );

    Comment = sequelize.define(
      "Comment",
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        keyx: { type: DataTypes.STRING(64), allowNull: false, unique: true },
        text: { type: DataTypes.STRING(255), allowNull: false },
        post_id: { type: DataTypes.INTEGER, allowNull: false },
      },
      { tableName: "bd_off_comments", timestamps: false }
    );

    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    await Comment.destroy({ where: {} });
    await Post.destroy({ where: {} });
    await User.destroy({ where: {} });

    app = express();
    app.use(bodyParser.json());

    // Mount with bulk delete disabled for comments
    app.use("/users", create(User));
    app.use(
      "/users",
      single(User, {
        related: [
          {
            model: Post,
            related: [
              {
                model: Comment,
                perOperation: {
                  delete: { allow_bulk_delete: false, id_mapping: "keyx" },
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

  test("DELETE collection returns 404 when disabled", async () => {
    const u = await request(app).post("/users").send({ name: "U" });
    const p = await request(app).post(`/users/${u.body.id}/posts`).send({ title: "T" });

    await request(app).post(`/users/${u.body.id}/posts/${p.body.id}/comments`).send({ text: "A", keyx: "k1" });
    await request(app).post(`/users/${u.body.id}/posts/${p.body.id}/comments`).send({ text: "B", keyx: "k2" });

    const dry = await request(app).delete(`/users/${u.body.id}/posts/${p.body.id}/comments`);
    expect(dry.status).toBe(404);

    const ok = await request(app).delete(`/users/${u.body.id}/posts/${p.body.id}/comments?confirm=true`);
    expect(ok.status).toBe(404);
  });
});
