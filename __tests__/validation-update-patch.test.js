const express = require('express');
const request = require('supertest');
const bodyParser = require('body-parser');
const { update, patch } = require('../src');
const { Sequelize, DataTypes } = require('sequelize');

describe('validation middleware for update and patch operations', () => {
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

    // Create a test record
    await TestModel.create({
      id: 1,
      name: 'John Doe',
      email: 'john@example.com',
      age: 30,
    });
  });

  describe('update operation with validation (default)', () => {
    beforeEach(() => {
      app.use('/update-test', update(TestModel)); // validation enabled by default
    });

    test('should reject invalid data with validation errors', async () => {
      const res = await request(app).put('/update-test/1').send({
        name: 'a', // Too short
        email: 'invalid-email', // Invalid email
        age: -5, // Negative age
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details).toBeInstanceOf(Array);
      expect(res.body.details.length).toBeGreaterThan(0);
    });

    test('should accept valid data', async () => {
      const res = await request(app).put('/update-test/1').send({
        name: 'Jane Smith',
        email: 'jane@example.com',
        age: 25,
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('patch operation with validation (default)', () => {
    beforeEach(() => {
      app.use('/patch-test', patch(TestModel)); // validation enabled by default
    });

    test('should reject invalid data with validation errors', async () => {
      const res = await request(app).patch('/patch-test/1').send({
        email: 'invalid-email', // Invalid email
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details).toBeInstanceOf(Array);

      const errorFields = res.body.details.map((err) => err.field);
      expect(errorFields).toContain('email');
    });

    test('should accept valid partial data', async () => {
      const res = await request(app).patch('/patch-test/1').send({
        age: 35,
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('should validate all provided fields', async () => {
      const res = await request(app).patch('/patch-test/1').send({
        name: 'Valid Name',
        email: 'valid@example.com',
        age: 35,
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('without validation (explicitly disabled)', () => {
    beforeEach(() => {
      app.use('/no-validation-update', update(TestModel, { validate: false }));
      app.use('/no-validation-patch', patch(TestModel, { validate: false }));
    });

    test('update should not validate when explicitly disabled', async () => {
      const res = await request(app).put('/no-validation-update/1').send({
        name: 'Valid Name',
        email: 'valid@example.com',
        age: 25,
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('patch should not validate when explicitly disabled', async () => {
      const res = await request(app).patch('/no-validation-patch/1').send({
        age: 40,
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
