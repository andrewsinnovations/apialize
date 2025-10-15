const express = require("express");
const bodyParser = require("body-parser");
const request = require("supertest");
const { Sequelize, DataTypes } = require("sequelize");
const { single, create } = require("../src");

describe("single() with id_mapping option", () => {
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
    }, { tableName: "test_models", timestamps: false });

    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    await TestModel.destroy({ where: {} });
    app = express();
    app.use(bodyParser.json());
  });

  describe("default behavior (id_mapping = 'id')", () => {
    test("should work with default id mapping when no options provided", async () => {
      app.use("/items", create(TestModel));
      app.use("/items", single(TestModel));

      // Create a test record
      const createRes = await request(app)
        .post("/items")
        .send({ name: "Test Item", external_id: "ext-123" });
      
      expect(createRes.status).toBe(201);
      const recordId = createRes.body.id;

      // Fetch the record using default id mapping
      const getRes = await request(app).get(`/items/${recordId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body).toMatchObject({
        success: true,
        record: {
          id: recordId,
          name: "Test Item",
          external_id: "ext-123"
        }
      });
    });

    test("should work with explicit default id mapping", async () => {
      app.use("/items", create(TestModel));
      app.use("/items", single(TestModel, { id_mapping: 'id' }));

      // Create a test record
      const createRes = await request(app)
        .post("/items")
        .send({ name: "Test Item", external_id: "ext-456" });
      
      expect(createRes.status).toBe(201);
      const recordId = createRes.body.id;

      // Fetch the record using explicit id mapping
      const getRes = await request(app).get(`/items/${recordId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body).toMatchObject({
        success: true,
        record: {
          id: recordId,
          name: "Test Item",
          external_id: "ext-456"
        }
      });
    });
  });

  describe("custom id_mapping behavior", () => {
    test("should work with external_id mapping", async () => {
      app.use("/items", create(TestModel));
      app.use("/items", single(TestModel, { id_mapping: 'external_id' }));

      // Create a test record
      const createRes = await request(app)
        .post("/items")
        .send({ name: "Test Item", external_id: "ext-789" });
      
      expect(createRes.status).toBe(201);

      // Fetch the record using external_id mapping
      const getRes = await request(app).get(`/items/ext-789`);
      expect(getRes.status).toBe(200);
      expect(getRes.body).toMatchObject({
        success: true,
        record: {
          name: "Test Item",
          external_id: "ext-789"
        }
      });
    });

    test("should return 404 when record not found with custom mapping", async () => {
      app.use("/items", single(TestModel, { id_mapping: 'external_id' }));

      const getRes = await request(app).get(`/items/nonexistent-id`);
      expect(getRes.status).toBe(404);
    });

    test("should work with middleware and custom id_mapping", async () => {
      const testMiddleware = (req, res, next) => {
        req.testMiddlewareRan = true;
        next();
      };

      app.use("/items", create(TestModel));
      app.use("/items", single(TestModel, { 
        id_mapping: 'external_id',
        middleware: [testMiddleware]
      }));

      // Create a test record
      const createRes = await request(app)
        .post("/items")
        .send({ name: "Test Item", external_id: "ext-middleware-test" });
      
      expect(createRes.status).toBe(201);

      // Fetch the record using external_id mapping with middleware
      const getRes = await request(app).get(`/items/ext-middleware-test`);
      expect(getRes.status).toBe(200);
      expect(getRes.body).toMatchObject({
        success: true,
        record: {
          name: "Test Item",
          external_id: "ext-middleware-test"
        }
      });
    });
  });

  describe("edge cases", () => {
    test("should handle numeric external_id values", async () => {
      app.use("/items", create(TestModel));
      app.use("/items", single(TestModel, { id_mapping: 'external_id' }));

      // Create a test record with numeric external_id
      const createRes = await request(app)
        .post("/items")
        .send({ name: "Numeric External ID", external_id: "12345" });
      
      expect(createRes.status).toBe(201);

      // Fetch the record using numeric external_id
      const getRes = await request(app).get(`/items/12345`);
      expect(getRes.status).toBe(200);
      expect(getRes.body).toMatchObject({
        success: true,
        record: {
          name: "Numeric External ID",
          external_id: "12345"
        }
      });
    });

    test("should handle special characters in external_id", async () => {
      app.use("/items", create(TestModel));
      app.use("/items", single(TestModel, { id_mapping: 'external_id' }));

      const specialId = "ext-test_123";
      
      // Create a test record with special characters in external_id
      const createRes = await request(app)
        .post("/items")
        .send({ name: "Special ID", external_id: specialId });
      
      expect(createRes.status).toBe(201);

      // Fetch the record using external_id with special characters
      const getRes = await request(app).get(`/items/${specialId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body).toMatchObject({
        success: true,
        record: {
          name: "Special ID",
          external_id: specialId
        }
      });
    });
  });

  describe("interaction with apialize context", () => {
    test("should preserve req.params.id when using custom mapping", async () => {
      const contextCheckMiddleware = (req, res, next) => {
        // This middleware can check that the req.params.id is still the URL parameter
        expect(req.params.id).toBe("ext-context-test");
        next();
      };

      app.use("/items", create(TestModel));
      app.use("/items", single(TestModel, { 
        id_mapping: 'external_id',
        middleware: [contextCheckMiddleware]
      }));

      // Create a test record
      const createRes = await request(app)
        .post("/items")
        .send({ name: "Context Test", external_id: "ext-context-test" });
      
      expect(createRes.status).toBe(201);

      // Fetch the record - middleware will verify req.params.id
      const getRes = await request(app).get(`/items/ext-context-test`);
      expect(getRes.status).toBe(200);
    });

    test("should respect existing where conditions in apialize context", async () => {
      const addWhereMiddleware = (req, res, next) => {
        if (!req.apialize.where) req.apialize.where = {};
        req.apialize.where.name = "Context Test"; // Additional where condition
        next();
      };

      app.use("/items", create(TestModel));
      app.use("/items", single(TestModel, { 
        id_mapping: 'external_id',
        middleware: [addWhereMiddleware]
      }));

      // Create two records with same external_id but different names
      await request(app)
        .post("/items")
        .send({ name: "Context Test", external_id: "shared-ext-id" });
      
      await request(app)
        .post("/items")
        .send({ name: "Other Name", external_id: "other-ext-id" });

      // This should find the record because name matches the middleware condition
      const getRes1 = await request(app).get(`/items/shared-ext-id`);
      expect(getRes1.status).toBe(200);
      expect(getRes1.body.record.name).toBe("Context Test");

      // This should not find the record because name doesn't match
      const getRes2 = await request(app).get(`/items/other-ext-id`);
      expect(getRes2.status).toBe(404);
    });
  });
});