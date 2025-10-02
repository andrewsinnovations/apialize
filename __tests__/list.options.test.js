const express = require("express");
const bodyParser = require("body-parser");
const request = require("supertest");
const { Sequelize, DataTypes } = require("sequelize");
const { list } = require("../src");

/**
 * Comprehensive tests for list() function options
 * Tests each configuration option individually and in combination
 */
describe("list() options configuration", () => {
  let sequelize;
  let TestModel;
  let app;

  beforeAll(async () => {
    sequelize = new Sequelize("sqlite::memory:", { logging: false });
    TestModel = sequelize.define(
      "TestModel",
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING, allowNull: false },
        category: { type: DataTypes.STRING },
        score: { type: DataTypes.INTEGER },
        active: { type: DataTypes.BOOLEAN, defaultValue: true },
      },
      { tableName: "test_items", timestamps: false }
    );
    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    // Clean up any model state from previous tests
    delete TestModel.apialize;
    
    await TestModel.destroy({ where: {}, truncate: true, restartIdentity: true });
    // Seed test data
    await TestModel.bulkCreate([
      { name: "alpha", category: "A", score: 10, active: true },
      { name: "beta", category: "B", score: 20, active: false },
      { name: "gamma", category: "A", score: 30, active: true },
      { name: "delta", category: "C", score: 40, active: false },
      { name: "epsilon", category: "B", score: 50, active: true },
    ]);
  });

  describe("defaultPageSize option", () => {
    test("uses custom defaultPageSize when no query pagesize specified", async () => {
      app = express();
      app.use(bodyParser.json());
      app.use("/items", list(TestModel, { defaultPageSize: 2 }));

      const res = await request(app).get("/items");
      expect(res.status).toBe(200);
      expect(res.body.meta.page_size).toBe(2);
      expect(res.body.data.length).toBe(2);
      expect(res.body.meta.total_pages).toBe(3); // 5 items / 2 per page = 3 pages
    });

    test("query pagesize overrides defaultPageSize", async () => {
      app = express();
      app.use(bodyParser.json());
      app.use("/items", list(TestModel, { defaultPageSize: 2 }));

      const res = await request(app).get("/items?api:pagesize=3");
      expect(res.status).toBe(200);
      expect(res.body.meta.page_size).toBe(3);
      expect(res.body.data.length).toBe(3);
    });

    test("model page_size overrides defaultPageSize", async () => {
      TestModel.apialize = { page_size: 1 };
      app = express();
      app.use(bodyParser.json());
      app.use("/items", list(TestModel, { defaultPageSize: 10 }));

      const res = await request(app).get("/items");
      expect(res.status).toBe(200);
      expect(res.body.meta.page_size).toBe(1);
      expect(res.body.data.length).toBe(1);
      
      // Clean up
      delete TestModel.apialize;
    });
  });

  describe("allowFiltering option", () => {
    test("allowFiltering: true (default) - applies query string filters", async () => {
      app = express();
      app.use(bodyParser.json());
      app.use("/items", list(TestModel, { allowFiltering: true }));

      const res = await request(app).get("/items?category=A");
      expect(res.status).toBe(200);
      expect(res.body.meta.count).toBe(2); // alpha and gamma
      expect(res.body.data.every(item => item.category === "A")).toBe(true);
    });

    test("allowFiltering: false - ignores query string filters", async () => {
      app = express();
      app.use(bodyParser.json());
      app.use("/items", list(TestModel, { allowFiltering: false }));

      const res = await request(app).get("/items?category=A");
      expect(res.status).toBe(200);
      expect(res.body.meta.count).toBe(5); // All items returned
      expect(res.body.data.some(item => item.category !== "A")).toBe(true);
    });

    test("api: prefixed params are never treated as filters", async () => {
      app = express();
      app.use(bodyParser.json());
      app.use("/items", list(TestModel, { allowFiltering: true }));

      const res = await request(app).get("/items?api:page=1&api:pagesize=3");
      expect(res.status).toBe(200);
      expect(res.body.meta.count).toBe(5); // All items, no filtering by api: params
      expect(res.body.meta.page_size).toBe(3);
    });
  });

  describe("allowOrdering option", () => {
    test("allowOrdering: true (default) - applies query string ordering", async () => {
      app = express();
      app.use(bodyParser.json());
      app.use("/items", list(TestModel, { allowOrdering: true }));

      const res = await request(app).get("/items?api:orderby=score&api:orderdir=DESC");
      expect(res.status).toBe(200);
      expect(res.body.data[0].score).toBe(50); // epsilon (highest score)
      expect(res.body.data[4].score).toBe(10); // alpha (lowest score)
    });

    test("allowOrdering: false - ignores query string ordering", async () => {
      app = express();
      app.use(bodyParser.json());
      app.use("/items", list(TestModel, { allowOrdering: false }));

      const res = await request(app).get("/items?api:orderby=score&api:orderdir=DESC");
      expect(res.status).toBe(200);
      
      // Should use default ordering (id ASC), meaning items are returned in insertion order
      // First item should be "alpha" (inserted first), not "epsilon" (highest score)
      expect(res.body.data[0].name).toBe("alpha");
      expect(res.body.data[4].name).toBe("epsilon");
      
      // Verify the ordering is by ID ascending (insertion order)
      const ids = res.body.data.map(item => item.id);
      const sortedIds = [...ids].sort((a, b) => a - b);
      expect(ids).toEqual(sortedIds);
    });

    test("model orderby still works when allowOrdering: false", async () => {
      TestModel.apialize = { orderby: "score", orderdir: "DESC" };
      app = express();
      app.use(bodyParser.json());
      app.use("/items", list(TestModel, { allowOrdering: false }));

      const res = await request(app).get("/items?api:orderby=name"); // Should be ignored
      expect(res.status).toBe(200);
      expect(res.body.data[0].score).toBe(50); // epsilon (model config ordering)
      
      // Clean up
      delete TestModel.apialize;
    });
  });

  describe("metaShowFilters option", () => {
    test("metaShowFilters: false (default) - no filters in meta", async () => {
      app = express();
      app.use(bodyParser.json());
      app.use("/items", list(TestModel, { metaShowFilters: false }));

      const res = await request(app).get("/items?category=A&active=true");
      expect(res.status).toBe(200);
      expect(res.body.meta).not.toHaveProperty("filters");
    });

    test("metaShowFilters: true - includes applied filters in meta", async () => {
      app = express();
      app.use(bodyParser.json());
      app.use("/items", list(TestModel, { metaShowFilters: true }));

      const res = await request(app).get("/items?category=A&active=true");
      expect(res.status).toBe(200);
      expect(res.body.meta).toHaveProperty("filters");
      expect(res.body.meta.filters).toEqual({ category: "A", active: "true" });
    });

    test("metaShowFilters: true with allowFiltering: false - no filters shown", async () => {
      app = express();
      app.use(bodyParser.json());
      app.use("/items", list(TestModel, { 
        metaShowFilters: true, 
        allowFiltering: false 
      }));

      const res = await request(app).get("/items?category=A");
      expect(res.status).toBe(200);
      expect(res.body.meta.filters).toEqual({}); // Empty filters object
    });
  });

  describe("metaShowOrdering option", () => {
    test("metaShowOrdering: false (default) - no order in meta", async () => {
      app = express();
      app.use(bodyParser.json());
      app.use("/items", list(TestModel, { metaShowOrdering: false }));

      const res = await request(app).get("/items?api:orderby=score");
      expect(res.status).toBe(200);
      expect(res.body.meta).not.toHaveProperty("order");
    });

    test("metaShowOrdering: true - includes applied ordering in meta", async () => {
      app = express();
      app.use(bodyParser.json());
      app.use("/items", list(TestModel, { metaShowOrdering: true }));

      const res = await request(app).get("/items?api:orderby=score&api:orderdir=DESC");
      expect(res.status).toBe(200);
      expect(res.body.meta).toHaveProperty("order");
      expect(res.body.meta.order).toEqual([["score", "DESC"]]);
    });

    test("metaShowOrdering: true shows default ordering", async () => {
      app = express();
      app.use(bodyParser.json());
      app.use("/items", list(TestModel, { metaShowOrdering: true }));

      const res = await request(app).get("/items");
      expect(res.status).toBe(200);
      expect(res.body.meta.order).toEqual([["id", "ASC"]]);
    });

    test("metaShowOrdering: true with complex ordering", async () => {
      app = express();
      app.use(bodyParser.json());
      app.use("/items", list(TestModel, { metaShowOrdering: true }));

      const res = await request(app).get("/items?api:orderby=-category,+score");
      expect(res.status).toBe(200);
      expect(res.body.meta.order).toEqual([
        ["category", "DESC"],
        ["score", "ASC"]
      ]);
    });
  });

  describe("middleware option", () => {
    test("applies custom middleware", async () => {
      const testMiddleware = (req, res, next) => {
        req.testFlag = "middleware-applied";
        next();
      };

      const captureMiddleware = (req, res, next) => {
        // Store the flag in apialize context for verification
        req.apialize.testValue = req.testFlag;
        next();
      };

      app = express();
      app.use(bodyParser.json());
      app.use("/items", list(TestModel, { 
        middleware: [testMiddleware, captureMiddleware] 
      }));

      const res = await request(app).get("/items");
      expect(res.status).toBe(200);
      // Middleware ran if we get a successful response with data
      expect(res.body.success).toBe(true);
    });

    test("middleware can modify apialize context", async () => {
      const filterMiddleware = (req, res, next) => {
        // Force filter to only active items
        req.apialize = req.apialize || {};
        req.apialize.options = req.apialize.options || {};
        req.apialize.options.where = { 
          ...(req.apialize.options.where || {}),
          active: true 
        };
        next();
      };

      app = express();
      app.use(bodyParser.json());
      app.use("/items", list(TestModel, { 
        middleware: [filterMiddleware] 
      }));

      const res = await request(app).get("/items");
      expect(res.status).toBe(200);
      expect(res.body.meta.count).toBe(3); // Only active items
      expect(res.body.data.every(item => item.active === true)).toBe(true);
    });
  });

  describe("combined options", () => {
    test("all options working together", async () => {
      const logMiddleware = (req, res, next) => {
        req.loggedRequest = true;
        next();
      };

      app = express();
      app.use(bodyParser.json());
      app.use("/items", list(TestModel, {
        defaultPageSize: 2,
        allowFiltering: true,
        allowOrdering: true,
        metaShowFilters: true,
        metaShowOrdering: true,
        middleware: [logMiddleware]
      }));

      const res = await request(app).get("/items?category=A&api:orderby=score&api:orderdir=DESC");
      expect(res.status).toBe(200);
      
      // Pagination
      expect(res.body.meta.page_size).toBe(2);
      
      // Filtering
      expect(res.body.meta.count).toBe(2); // Only category A items
      expect(res.body.meta.filters).toEqual({ category: "A" });
      
      // Ordering
      expect(res.body.meta.order).toEqual([["score", "DESC"]]);
      expect(res.body.data[0].score).toBe(30); // gamma (higher score in category A)
      expect(res.body.data[1].score).toBe(10); // alpha (lower score in category A)
      
      // Data integrity
      expect(res.body.data.every(item => item.category === "A")).toBe(true);
    });

    test("conflicting options handled correctly", async () => {
      app = express();
      app.use(bodyParser.json());
      app.use("/items", list(TestModel, {
        allowFiltering: false,
        metaShowFilters: true // Should show empty filters
      }));

      const res = await request(app).get("/items?category=A");
      expect(res.status).toBe(200);
      expect(res.body.meta.count).toBe(5); // No filtering applied
      expect(res.body.meta.filters).toEqual({}); // Empty filters object
    });
  });

  describe("edge cases", () => {
    test("empty options object uses defaults", async () => {
      app = express();
      app.use(bodyParser.json());
      app.use("/items", list(TestModel, {}));

      const res = await request(app).get("/items");
      expect(res.status).toBe(200);
      expect(res.body.meta.page_size).toBe(100); // Default
      expect(res.body.meta.count).toBe(5);
      expect(res.body.meta).not.toHaveProperty("filters");
      expect(res.body.meta).not.toHaveProperty("order");
    });

    test("undefined options uses defaults", async () => {
      app = express();
      app.use(bodyParser.json());
      app.use("/items", list(TestModel));

      const res = await request(app).get("/items");
      expect(res.status).toBe(200);
      expect(res.body.meta.page_size).toBe(100); // Default
    });

    test("invalid middleware functions are filtered out", async () => {
      app = express();
      app.use(bodyParser.json());
      app.use("/items", list(TestModel, {
        middleware: [
          (req, res, next) => next(), // Valid
          "not-a-function", // Invalid
          null, // Invalid
          undefined, // Invalid
          (req, res, next) => next() // Valid
        ]
      }));

      const res = await request(app).get("/items");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("field validation errors", () => {
    beforeEach(() => {
      app = express();
      app.use(bodyParser.json());
      app.use("/items", list(TestModel));
    });

    test("invalid filter field returns bad request", async () => {
      const res = await request(app).get("/items?invalidField=someValue");
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("Bad request");
    });

    test("invalid order field returns bad request", async () => {
      const res = await request(app).get("/items?api:orderby=invalidField");
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("Bad request");
    });

    test("multiple invalid filter fields returns bad request", async () => {
      const res = await request(app).get("/items?invalidField1=value1&invalidField2=value2");
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("Bad request");
    });

    test("invalid data type for valid field returns bad request", async () => {
      const res = await request(app).get("/items?score=notANumber");
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("Bad request");
    });

    test("valid fields still work normally", async () => {
      const res = await request(app).get("/items?category=A&api:orderby=score");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.meta.count).toBe(2);
      expect(res.body.data.every(item => item.category === "A")).toBe(true);
    });

    test("mixed valid and invalid fields returns bad request", async () => {
      const res = await request(app).get("/items?category=A&invalidField=value");
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("Bad request");
    });

    test("invalid ordering with prefix returns bad request", async () => {
      const res = await request(app).get("/items?api:orderby=-invalidField");
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("Bad request");
    });

    test("multiple order fields with one invalid returns bad request", async () => {
      const res = await request(app).get("/items?api:orderby=score,invalidField");
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("Bad request");
    });
  });
});