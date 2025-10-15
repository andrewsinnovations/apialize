const express = require("express");
const bodyParser = require("body-parser");
const request = require("supertest");
const { Sequelize, DataTypes, UUIDV4 } = require("sequelize");
const { single, create, list, update, patch, destroy } = require("../src");

// Helper to ensure responses never leak internal ids
function expectNoInternalIds(obj) {
  const recur = (v) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(recur);
    expect(v).not.toHaveProperty('id');
    Object.values(v).forEach(recur);
  };
  recur(obj);
}

describe("single() with related models using external_id only", () => {
  let sequelize;
  let User;
  let Post;
  let app;

  beforeAll(async () => {
    sequelize = new Sequelize("sqlite::memory:", { logging: false });

    User = sequelize.define(
      "User",
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        external_id: { type: DataTypes.UUID, defaultValue: UUIDV4, unique: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
        email: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      },
      { tableName: "users", timestamps: false }
    );

    Post = sequelize.define(
      "Post",
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        external_id: { type: DataTypes.UUID, defaultValue: UUIDV4, unique: true },
        title: { type: DataTypes.STRING(200), allowNull: false },
        content: { type: DataTypes.TEXT, allowNull: true },
        user_id: { type: DataTypes.INTEGER, allowNull: false }, // FK to users.id
      },
      { tableName: "posts", timestamps: false }
    );

    User.hasMany(Post, { foreignKey: 'user_id' });
    Post.belongsTo(User, { foreignKey: 'user_id' });

    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    await User.destroy({ where: {} });
    await Post.destroy({ where: {} });
    app = express();
    app.use(bodyParser.json());

  // Mount endpoints using external_id everywhere
  app.use("/users", create(User, { id_mapping: 'external_id' }));
    app.use(
      "/users",
      single(User, {
        id_mapping: 'external_id',
        related: [
          {
            model: Post,
            foreignKey: 'user_id',
            operations: ['list','get','post','put','patch','delete'],
            options: { id_mapping: 'external_id' }, // child uses external_id for its own ids
            perOperation: {
              list: { modelOptions: { attributes: { exclude: ['id'] } } },
              get:  { modelOptions: { attributes: { exclude: ['id'] } } },
            }
          },
        ],
      })
    );
  app.use("/posts", create(Post, { id_mapping: 'external_id' }));
  });

  afterAll(async () => {
    await sequelize.close();
  });

  test("should support full CRUD by external_id and never expose internal numeric ids", async () => {
    // Create a user
    const uRes = await request(app)
      .post("/users")
      .send({ name: "John Doe", email: "john-ext@example.com" });
    expect(uRes.status).toBe(201);
    const userExternalId = uRes.body.id; // create returns { id: created.id }
    expect(typeof userExternalId).toBe("string");

    // CREATE related post by parent external_id; child id should be external_id
    const createPostRes = await request(app)
      .post(`/users/${userExternalId}/posts`)
      .send({ title: "New Post", content: "By external id" });
    expect(createPostRes.status).toBe(201);
    const postExternalId = createPostRes.body.id; // child's external_id
    expect(typeof postExternalId).toBe("string");

    // LIST posts for user by external parent id
    const listRes = await request(app).get(`/users/${userExternalId}/posts`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.success).toBe(true);
    expect(Array.isArray(listRes.body.data)).toBe(true);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0].title).toBe("New Post");
    expect(listRes.body.data[0].user_id).toBeDefined(); // stored internal FK
    expectNoInternalIds(listRes.body); // no `.id` anywhere in payload

    // GET single post by external child id
    const getRes = await request(app).get(`/users/${userExternalId}/posts/${postExternalId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.success).toBe(true);
    expect(getRes.body.record.title).toBe("New Post");
    expectNoInternalIds(getRes.body);

    // PUT update via external child id (full replace semantics)
    const putRes = await request(app)
      .put(`/users/${userExternalId}/posts/${postExternalId}`)
      .send({ title: "Replaced", content: null });
    expect(putRes.status).toBe(200);
    expect(putRes.body.success).toBe(true);

    // PATCH part of record via external id
    const patchRes = await request(app)
      .patch(`/users/${userExternalId}/posts/${postExternalId}`)
      .send({ content: "Now patched" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.success).toBe(true);

    // Verify updates
    const verifyRes = await request(app).get(`/users/${userExternalId}/posts/${postExternalId}`);
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.record.title).toBe("Replaced");
    expect(verifyRes.body.record.content).toBe("Now patched");
    expectNoInternalIds(verifyRes.body);

    // DELETE by external child id
    const delRes = await request(app).delete(`/users/${userExternalId}/posts/${postExternalId}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);

    // LIST should be empty
    const afterList = await request(app).get(`/users/${userExternalId}/posts`);
    expect(afterList.status).toBe(200);
    expect(afterList.body.data).toHaveLength(0);
  });
});
