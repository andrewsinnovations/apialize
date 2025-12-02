const { cancel_operation } = require('../src/contextHelpers');
const create = require('../src/create');
const request = require('supertest');
const express = require('express');
const { Sequelize, DataTypes } = require('sequelize');

describe('cancel_operation', () => {
  let mockContext;

  beforeEach(() => {
    mockContext = {
      _ctx: {},
    };
  });

  it('should cancel operation with default statusCode 400 and default message', () => {
    const boundCancel = cancel_operation.bind(mockContext);
    const result = boundCancel();

    expect(mockContext._ctx._cancelled).toBe(true);
    expect(mockContext._ctx._cancelStatusCode).toBe(400);
    expect(mockContext._ctx._cancelResponse).toEqual({
      success: false,
      message: 'Operation cancelled',
      _apializeCancelled: true,
      _cancelStatusCode: 400,
    });
    expect(result).toEqual({
      success: false,
      message: 'Operation cancelled',
      _apializeCancelled: true,
      _cancelStatusCode: 400,
    });
  });

  it('should cancel operation with custom statusCode', () => {
    const boundCancel = cancel_operation.bind(mockContext);
    const result = boundCancel(403);

    expect(mockContext._ctx._cancelled).toBe(true);
    expect(mockContext._ctx._cancelStatusCode).toBe(403);
    expect(mockContext._ctx._cancelResponse).toEqual({
      success: false,
      message: 'Operation cancelled',
      _apializeCancelled: true,
      _cancelStatusCode: 403,
    });
  });

  it('should cancel operation with custom statusCode and custom response', () => {
    const boundCancel = cancel_operation.bind(mockContext);
    const customResponse = { error: 'Unauthorized access' };
    const result = boundCancel(401, customResponse);

    expect(mockContext._ctx._cancelled).toBe(true);
    expect(mockContext._ctx._cancelStatusCode).toBe(401);
    expect(mockContext._ctx._cancelResponse).toEqual({
      error: 'Unauthorized access',
      _apializeCancelled: true,
      _cancelStatusCode: 401,
    });
    expect(result).toEqual({
      error: 'Unauthorized access',
      _apializeCancelled: true,
      _cancelStatusCode: 401,
    });
  });

  it('should use default statusCode 400 when statusCode is null or undefined', () => {
    const boundCancel = cancel_operation.bind(mockContext);
    
    boundCancel(null, { custom: 'response' });
    expect(mockContext._ctx._cancelStatusCode).toBe(400);

    mockContext._ctx = {};
    boundCancel(undefined, { custom: 'response' });
    expect(mockContext._ctx._cancelStatusCode).toBe(400);
  });

  it('should throw error when cancel_operation is not called on context object', () => {
    const boundCancel = cancel_operation.bind({});
    expect(() => boundCancel()).toThrow('cancel_operation must be called on context object');
  });

  it('should preserve custom response properties and add _apializeCancelled flag', () => {
    const boundCancel = cancel_operation.bind(mockContext);
    const customResponse = { status: 'cancelled', reason: 'user_cancelled', data: { id: 123 } };
    const result = boundCancel(422, customResponse);

    expect(result).toEqual({
      status: 'cancelled',
      reason: 'user_cancelled',
      data: { id: 123 },
      _apializeCancelled: true,
      _cancelStatusCode: 422,
    });
  });

  describe('POST operation with transaction rollback', () => {
    let sequelize;
    let Customer;
    let app;

    beforeEach(async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });

      Customer = sequelize.define(
        'Customer',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          firstName: {
            type: DataTypes.STRING(100),
            allowNull: false,
          },
          lastName: {
            type: DataTypes.STRING(100),
            allowNull: false,
          },
          email: {
            type: DataTypes.STRING(255),
            allowNull: false,
            unique: true,
          },
        },
        { tableName: 'customers', timestamps: false }
      );

      await sequelize.sync({ force: true });

      app = express();
      app.use(express.json());
    });

    afterEach(async () => {
      await sequelize.close();
    });

    it('should rollback transaction when cancel_operation is called in pre-hook', async () => {
      const createRouter = create(Customer, {
        pre: async (context) => {
          // Cancel the operation in pre-hook with custom statusCode
          context.cancel_operation(422, { error: 'Pre-hook validation failed' });
        },
      });

      app.use('/customers', createRouter);

      const response = await request(app)
        .post('/customers')
        .send({ firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' });

      expect(response.status).toBe(422);
      expect(response.body).toEqual({ error: 'Pre-hook validation failed' });

      // Verify that no customer was created (transaction was rolled back)
      const customers = await Customer.findAll();
      expect(customers.length).toBe(0);
    });

    it('should rollback transaction when cancel_operation is called in post-hook', async () => {
      const createRouter = create(Customer, {
        post: async (context) => {
          // Cancel the operation in post-hook with custom statusCode
          context.cancel_operation(409, { error: 'Post-hook validation failed' });
        },
      });

      app.use('/customers', createRouter);

      const response = await request(app)
        .post('/customers')
        .send({ firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: 'Post-hook validation failed' });

      // Verify that no customer was created (transaction was rolled back)
      const customers = await Customer.findAll();
      expect(customers.length).toBe(0);
    });

    it('should use default statusCode 400 when statusCode is not provided in cancel_operation', async () => {
      const createRouter = create(Customer, {
        pre: async (context) => {
          // Cancel without providing statusCode
          context.cancel_operation(undefined, { error: 'Cancelled without status code' });
        },
      });

      app.use('/customers', createRouter);

      const response = await request(app)
        .post('/customers')
        .send({ firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Cancelled without status code' });
    });

    it('should use default statusCode 400 when cancel_operation is called without parameters', async () => {
      const createRouter = create(Customer, {
        pre: async (context) => {
          // Cancel without any parameters
          context.cancel_operation();
        },
      });

      app.use('/customers', createRouter);

      const response = await request(app)
        .post('/customers')
        .send({ firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        success: false,
        message: 'Operation cancelled',
      });
    });

    it('should rollback transaction and return custom response with custom statusCode', async () => {
      const createRouter = create(Customer, {
        pre: async (context) => {
          context.cancel_operation(403, {
            success: false,
            code: 'INSUFFICIENT_PERMISSIONS',
            message: 'You do not have permission to create customers',
          });
        },
      });

      app.use('/customers', createRouter);

      const response = await request(app)
        .post('/customers')
        .send({ firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' });

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        success: false,
        code: 'INSUFFICIENT_PERMISSIONS',
        message: 'You do not have permission to create customers',
      });

      // Verify that no customer was created (transaction was rolled back)
      const customers = await Customer.findAll();
      expect(customers.length).toBe(0);
    });
  });
});
