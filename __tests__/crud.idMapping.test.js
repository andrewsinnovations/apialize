const express = require("express");
const bodyParser = require("body-parser");
const request = require("supertest");
const { Sequelize, DataTypes } = require("sequelize");
const { single, create, update, patch, destroy } = require("../src");

describe("CRUD operations with id_mapping option", () => {
  let sequelize;
  let TestModel;
  let app;

  beforeAll(async () => {
    sequelize = new Sequelize("sqlite::memory:", { logging: false });
    
    // Test model with both id and external_id fields
    TestModel = sequelize.define("TestModel", {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      external_id: {
        type: DataTypes.STRING(50),
        unique: true,
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    }, { tableName: "test_models", timestamps: false });

    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    await TestModel.destroy({ where: {} });
    app = express();
    app.use(bodyParser.json());
  });

  describe("single operation with id_mapping", () => {
    test("should work with external_id mapping", async () => {
      app.use("/items", create(TestModel));
      app.use("/items", single(TestModel, { id_mapping: 'external_id' }));

      // Create a test record
      const createRes = await request(app)
        .post("/items")
        .send({ name: "Test Item", external_id: "ext-single-123" });
      
      expect(createRes.status).toBe(201);

      // Fetch the record using external_id mapping
      const getRes = await request(app).get(`/items/ext-single-123`);
      expect(getRes.status).toBe(200);
      expect(getRes.body).toMatchObject({
        name: "Test Item",
        external_id: "ext-single-123"
      });
    });
  });

  describe("update operation with id_mapping", () => {
    test("should work with external_id mapping", async () => {
      app.use("/items", create(TestModel));
      app.use("/items", update(TestModel, { id_mapping: 'external_id' }));

      // Create a test record
      const createRes = await request(app)
        .post("/items")
        .send({ name: "Original Name", external_id: "ext-update-123", description: "Original desc" });
      
      expect(createRes.status).toBe(201);

      // Update the record using external_id mapping
      const updateRes = await request(app)
        .put(`/items/ext-update-123`)
        .send({ name: "Updated Name", external_id: "ext-update-123" });
      
      expect(updateRes.status).toBe(200);
      expect(updateRes.body).toMatchObject({
        name: "Updated Name",
        external_id: "ext-update-123",
        description: null // Should be null since not provided in update
      });
    });

    test("should return 404 when record not found with custom mapping", async () => {
      app.use("/items", update(TestModel, { id_mapping: 'external_id' }));

      const updateRes = await request(app)
        .put(`/items/nonexistent-id`)
        .send({ name: "Updated Name" });
      
      expect(updateRes.status).toBe(404);
    });
  });

  describe("patch operation with id_mapping", () => {
    test("should work with external_id mapping", async () => {
      app.use("/items", create(TestModel));
      app.use("/items", patch(TestModel, { id_mapping: 'external_id' }));

      // Create a test record
      const createRes = await request(app)
        .post("/items")
        .send({ name: "Original Name", external_id: "ext-patch-123", description: "Original desc" });
      
      expect(createRes.status).toBe(201);

      // Patch the record using external_id mapping
      const patchRes = await request(app)
        .patch(`/items/ext-patch-123`)
        .send({ description: "Updated description" });
      
      expect(patchRes.status).toBe(200);
      expect(patchRes.body).toMatchObject({
        success: true,
        id: "ext-patch-123"
      });

      // Verify the patch worked by fetching the record
      app.use("/items", single(TestModel, { id_mapping: 'external_id' }));
      const getRes = await request(app).get(`/items/ext-patch-123`);
      expect(getRes.status).toBe(200);
      expect(getRes.body).toMatchObject({
        name: "Original Name",
        external_id: "ext-patch-123",
        description: "Updated description"
      });
    });

    test("should handle empty patch gracefully", async () => {
      app.use("/items", create(TestModel));
      app.use("/items", patch(TestModel, { id_mapping: 'external_id' }));

      // Create a test record
      const createRes = await request(app)
        .post("/items")
        .send({ name: "Test Item", external_id: "ext-patch-empty-123" });
      
      expect(createRes.status).toBe(201);

      // Patch with no changes
      const patchRes = await request(app)
        .patch(`/items/ext-patch-empty-123`)
        .send({});
      
      expect(patchRes.status).toBe(200);
      expect(patchRes.body).toMatchObject({
        success: true,
        id: "ext-patch-empty-123"
      });
    });

    test("should return 404 when record not found with custom mapping", async () => {
      app.use("/items", patch(TestModel, { id_mapping: 'external_id' }));

      const patchRes = await request(app)
        .patch(`/items/nonexistent-id`)
        .send({ description: "Updated description" });
      
      expect(patchRes.status).toBe(404);
    });
  });

  describe("destroy operation with id_mapping", () => {
    test("should work with external_id mapping", async () => {
      app.use("/items", create(TestModel));
      app.use("/items", destroy(TestModel, { id_mapping: 'external_id' }));

      // Create a test record
      const createRes = await request(app)
        .post("/items")
        .send({ name: "Test Item", external_id: "ext-destroy-123" });
      
      expect(createRes.status).toBe(201);

      // Delete the record using external_id mapping
      const deleteRes = await request(app).delete(`/items/ext-destroy-123`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body).toMatchObject({
        success: true,
        id: "ext-destroy-123"
      });

      // Verify the record is gone
      const count = await TestModel.count({ where: { external_id: "ext-destroy-123" } });
      expect(count).toBe(0);
    });

    test("should return 404 when record not found with custom mapping", async () => {
      app.use("/items", destroy(TestModel, { id_mapping: 'external_id' }));

      const deleteRes = await request(app).delete(`/items/nonexistent-id`);
      expect(deleteRes.status).toBe(404);
    });
  });

  describe("integration tests with multiple operations", () => {
    test("should work consistently across all operations with external_id", async () => {
      // Mount all operations with external_id mapping
      app.use("/items", create(TestModel));
      app.use("/items", single(TestModel, { id_mapping: 'external_id' }));
      app.use("/items", update(TestModel, { id_mapping: 'external_id' }));
      app.use("/items", patch(TestModel, { id_mapping: 'external_id' }));
      app.use("/items", destroy(TestModel, { id_mapping: 'external_id' }));

      const externalId = "ext-integration-test-456";

      // Create
      const createRes = await request(app)
        .post("/items")
        .send({ name: "Integration Test", external_id: externalId, description: "Initial desc" });
      expect(createRes.status).toBe(201);

      // Read
      const getRes = await request(app).get(`/items/${externalId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.external_id).toBe(externalId);

      // Update
      const updateRes = await request(app)
        .put(`/items/${externalId}`)
        .send({ name: "Updated via PUT", external_id: externalId });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.name).toBe("Updated via PUT");

      // Patch
      const patchRes = await request(app)
        .patch(`/items/${externalId}`)
        .send({ description: "Patched description" });
      expect(patchRes.status).toBe(200);

      // Verify patch
      const getAfterPatchRes = await request(app).get(`/items/${externalId}`);
      expect(getAfterPatchRes.status).toBe(200);
      expect(getAfterPatchRes.body.description).toBe("Patched description");

      // Delete
      const deleteRes = await request(app).delete(`/items/${externalId}`);
      expect(deleteRes.status).toBe(200);

      // Verify deletion
      const getAfterDeleteRes = await request(app).get(`/items/${externalId}`);
      expect(getAfterDeleteRes.status).toBe(404);
    });
  });

  describe("default behavior (backwards compatibility)", () => {
    test("should work with default id mapping when no options provided", async () => {
      app.use("/items", create(TestModel));
      app.use("/items", single(TestModel));
      app.use("/items", update(TestModel));
      app.use("/items", patch(TestModel));
      app.use("/items", destroy(TestModel));

      // Create a test record
      const createRes = await request(app)
        .post("/items")
        .send({ name: "Default Test", external_id: "ext-default-123" });
      
      expect(createRes.status).toBe(201);
      const recordId = createRes.body.id;

      // Test all operations with numeric id
      const getRes = await request(app).get(`/items/${recordId}`);
      expect(getRes.status).toBe(200);

      const updateRes = await request(app)
        .put(`/items/${recordId}`)
        .send({ name: "Updated Default", external_id: "ext-default-123" });
      expect(updateRes.status).toBe(200);

      const patchRes = await request(app)
        .patch(`/items/${recordId}`)
        .send({ description: "Patched via default" });
      expect(patchRes.status).toBe(200);

      const deleteRes = await request(app).delete(`/items/${recordId}`);
      expect(deleteRes.status).toBe(200);
    });
  });
});