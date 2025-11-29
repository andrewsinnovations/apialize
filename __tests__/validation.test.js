const express = require('express');
const request = require('supertest');
const bodyParser = require('body-parser');
const { create } = require('../src');
const { Sequelize, DataTypes } = require('sequelize');

describe('validation middleware', () => {
  let sequelize;
  let TestModel;
  let app;

  beforeAll(async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    TestModel = sequelize.define(
      'TestModel',
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        name: {
          type: DataTypes.STRING,
          allowNull: false,
          validate: {
            notEmpty: {
              msg: 'Name cannot be empty',
            },
            len: {
              args: [3, 50],
              msg: 'Name must be between 3 and 50 characters',
            },
          },
        },
        email: {
          type: DataTypes.STRING,
          allowNull: false,
          validate: {
            isEmail: {
              msg: 'Must be a valid email address',
            },
          },
        },
        age: {
          type: DataTypes.INTEGER,
          validate: {
            min: {
              args: [0],
              msg: 'Age must be a positive number',
            },
            max: {
              args: [120],
              msg: 'Age must be less than 120',
            },
          },
        },
      },
      {
        tableName: 'test_models',
        timestamps: false,
      }
    );

    await sequelize.sync({ force: true });

    app = express();
    app.use(bodyParser.json());
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await TestModel.destroy({ where: {}, truncate: true });
  });

  describe('with validation enabled (default)', () => {
    beforeEach(() => {
      app.use('/test', create(TestModel, { allow_bulk_create: true })); // validation is enabled by default, allow bulk for testing
    });

    test('should reject invalid data with validation errors', async () => {
      const res = await request(app).post('/test').send({
        name: 'a', // Too short
        email: 'invalid-email', // Invalid email
        age: -5, // Negative age
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details).toBeInstanceOf(Array);
      expect(res.body.details.length).toBeGreaterThan(0);

      // Check that validation errors contain expected fields
      const errorFields = res.body.details.map((err) => err.field);
      expect(errorFields).toContain('name');
      expect(errorFields).toContain('email');
      expect(errorFields).toContain('age');
    });

    test('should accept valid data', async () => {
      const res = await request(app).post('/test').send({
        name: 'John Doe',
        email: 'john@example.com',
        age: 30,
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.id).toBeDefined();
    });

    test('should validate bulk create data', async () => {
      const res = await request(app)
        .post('/test')
        .send([
          {
            name: 'Valid User',
            email: 'valid@example.com',
            age: 25,
          },
          {
            name: 'x', // Invalid - too short
            email: 'invalid-email',
            age: 30,
          },
        ]);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Validation failed');
    });

    test('should handle missing required fields', async () => {
      const res = await request(app).post('/test').send({
        age: 30,
        // Missing required name and email
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Validation failed');

      const errorFields = res.body.details.map((err) => err.field);
      expect(errorFields).toContain('name');
      expect(errorFields).toContain('email');
    });
  });

  describe('with validation disabled', () => {
    beforeEach(() => {
      app.use('/test-no-validation', create(TestModel, { validate: false }));
    });

    test('should not run validation when explicitly disabled', async () => {
      // This would normally fail validation but should succeed
      // because validation is disabled
      const res = await request(app).post('/test-no-validation').send({
        name: 'Valid Name',
        email: 'valid@example.com',
        age: 30,
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.id).toBeDefined();
    });
  });
});
