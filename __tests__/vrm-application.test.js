/**
 * VRM Application Integration Test
 *
 * This test simulates a full multi-tenant vehicle management application using
 * the apialize endpoints. It demonstrates:
 * - Multi-tenant data isolation (organizations)
 * - User authentication via login endpoints
 * - Authorization middleware that checks access
 * - Full CRUD operations on vehicles, customers, service records, and parts
 *
 * The test creates a realistic scenario where multiple organizations have their
 * own users, customers, and vehicles - and users can only access data within
 * their own organization.
 */

const express = require('express');
const request = require('supertest');
const bodyParser = require('body-parser');
const { list, single, create, patch, destroy, search } = require('../src');
const { createVrmDatabase } = require('./fixtures/vrm-database');

// Simple session store for testing
let sessions = new Map();

// Generate a simple token (no external uuid dependency)
function generateToken() {
  return `tok_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

// Simulated password hashing (in production, use bcrypt)
function hashPassword(password) {
  return `hashed_${password}`;
}

function verifyPassword(password, hash) {
  return hash === `hashed_${password}`;
}

describe('VRM Multi-Tenant Application', () => {
  let db;
  let app;

  beforeEach(async () => {
    // Reset sessions
    sessions = new Map();

    // Create fresh database without sample data - we'll create our own
    db = await createVrmDatabase({ loadData: false });

    // Build the application
    app = buildApplication(db);
  });

  afterEach(async () => {
    if (db && db.sequelize) {
      await db.sequelize.close();
    }
  });

  /**
   * Builds the Express application with all VRM endpoints
   */
  function buildApplication(db) {
    const { models } = db;
    const {
      Organization,
      User,
      Customer,
      Vehicle,
      CustomerVehicle,
      ServiceRecord,
      Part,
      ServicePart,
    } = models;

    const app = express();
    app.use(bodyParser.json());

    // =================================================================
    // PUBLIC ROUTES (No authentication required)
    // =================================================================

    // Login endpoint - authenticates user and returns token
    app.post('/auth/login', async (req, res) => {
      try {
        const { username, password } = req.body;

        if (!username || !password) {
          return res.status(400).json({
            success: false,
            error: 'Username and password are required',
          });
        }

        const user = await User.findOne({
          where: { username },
          include: [{ model: Organization, as: 'organization' }],
        });

        if (!user) {
          return res.status(401).json({
            success: false,
            error: 'Invalid credentials',
          });
        }

        if (!verifyPassword(password, user.password)) {
          return res.status(401).json({
            success: false,
            error: 'Invalid credentials',
          });
        }

        if (!user.isActive) {
          return res.status(403).json({
            success: false,
            error: 'Account is disabled',
          });
        }

        // Create session
        const token = generateToken();
        sessions.set(token, {
          userId: user.id,
          username: user.username,
          organizationId: user.organizationId,
          organizationName: user.organization?.name,
        });

        // Update last login
        await user.update({ lastLogin: new Date() });

        res.json({
          success: true,
          token,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            organization: {
              id: user.organization?.id,
              name: user.organization?.name,
              slug: user.organization?.slug,
            },
          },
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Internal server error',
        });
      }
    });

    // Logout endpoint
    app.post('/auth/logout', (req, res) => {
      const token = extractToken(req);
      if (token) {
        sessions.delete(token);
      }
      res.json({ success: true });
    });

    // Get current user info
    app.get('/auth/me', (req, res) => {
      const token = extractToken(req);
      const session = token ? sessions.get(token) : null;

      if (!session) {
        return res.status(401).json({
          success: false,
          error: 'Not authenticated',
        });
      }

      res.json({
        success: true,
        user: {
          userId: session.userId,
          username: session.username,
          organizationId: session.organizationId,
          organizationName: session.organizationName,
        },
      });
    });

    // =================================================================
    // AUTHENTICATION MIDDLEWARE
    // =================================================================

    function extractToken(req) {
      const authHeader = req.headers.authorization;
      if (!authHeader) return null;
      const match = authHeader.match(/^Bearer (.+)$/i);
      return match ? match[1] : null;
    }

    // Middleware to require authentication and set organization scope
    const requireAuth = (req, res, next) => {
      const token = extractToken(req);

      if (!token) {
        return res.status(401).json({
          success: false,
          error: 'Authorization token required',
        });
      }

      const session = sessions.get(token);

      if (!session) {
        return res.status(401).json({
          success: false,
          error: 'Invalid or expired token',
        });
      }

      // Attach session to request for use in other middleware
      req.session = session;
      next();
    };

    // Middleware to scope data to the user's organization
    const scopeToOrganization = (req, res, next) => {
      const { organizationId } = req.session;

      // Apply organization filter to all queries (use camelCase for Sequelize attribute names)
      req.apialize.applyWhere({ organizationId: organizationId });

      // For create/update operations, ensure organizationId is set
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        req.apialize.values = {
          ...(req.apialize.values || {}),
          organizationId: organizationId,
        };
      }

      next();
    };

    // Combined auth + scoping middleware
    const authAndScope = [requireAuth, scopeToOrganization];

    // =================================================================
    // PROTECTED ROUTES - Customers
    // =================================================================

    const customerOptions = {
      middleware: authAndScope,
      id_mapping: 'externalId',
    };

    app.use('/api/customers', list(Customer, customerOptions));
    app.use('/api/customers', search(Customer, customerOptions));
    app.use('/api/customers', create(Customer, customerOptions));
    app.use('/api/customers', single(Customer, customerOptions));
    app.use('/api/customers', patch(Customer, customerOptions));
    app.use('/api/customers', destroy(Customer, customerOptions));

    // =================================================================
    // PROTECTED ROUTES - Vehicles
    // =================================================================

    // Vehicles aren't directly org-scoped (they're linked via CustomerVehicle)
    // So we need custom handling to only show vehicles for customers in the org
    const vehicleScopeMiddleware = async (req, res, next) => {
      const { organizationId } = req.session;

      // For list operations, we'll use a custom query approach
      // Get all customer IDs for this organization
      const customers = await Customer.findAll({
        where: { organizationId },
        attributes: ['id'],
      });

      const customerIds = customers.map((c) => c.id);

      // Get all vehicle IDs linked to these customers
      const customerVehicles = await CustomerVehicle.findAll({
        where: { customerId: customerIds },
        attributes: ['vehicleId'],
      });

      const vehicleIds = customerVehicles.map((cv) => cv.vehicleId);

      // Scope to only these vehicles
      if (vehicleIds.length > 0) {
        req.apialize.applyWhere({ id: vehicleIds });
      } else {
        // No vehicles - use impossible condition
        req.apialize.applyWhere({ id: -1 });
      }

      next();
    };

    const vehicleOptions = {
      middleware: [requireAuth, vehicleScopeMiddleware],
      id_mapping: 'externalId',
    };

    app.use('/api/vehicles', list(Vehicle, vehicleOptions));
    app.use('/api/vehicles', search(Vehicle, vehicleOptions));
    app.use('/api/vehicles', create(Vehicle, vehicleOptions));
    app.use('/api/vehicles', single(Vehicle, vehicleOptions));
    app.use('/api/vehicles', patch(Vehicle, vehicleOptions));
    app.use('/api/vehicles', destroy(Vehicle, vehicleOptions));

    // =================================================================
    // PROTECTED ROUTES - Service Records
    // =================================================================

    const serviceRecordScopeMiddleware = async (req, res, next) => {
      const { organizationId } = req.session;

      // Get all customer IDs for this organization
      const customers = await Customer.findAll({
        where: { organizationId },
        attributes: ['id'],
      });

      const customerIds = customers.map((c) => c.id);

      if (customerIds.length > 0) {
        req.apialize.applyWhere({ customerId: customerIds });
      } else {
        req.apialize.applyWhere({ customerId: -1 });
      }

      next();
    };

    const serviceRecordOptions = {
      middleware: [requireAuth, serviceRecordScopeMiddleware],
      id_mapping: 'externalId',
    };
    const serviceRecordModelOptions = {
      include: [
        { model: Vehicle, as: 'vehicle' },
        { model: Customer, as: 'customer' },
      ],
    };

    app.use(
      '/api/service-records',
      list(ServiceRecord, serviceRecordOptions, serviceRecordModelOptions)
    );
    app.use(
      '/api/service-records',
      search(ServiceRecord, serviceRecordOptions, serviceRecordModelOptions)
    );
    app.use(
      '/api/service-records',
      create(ServiceRecord, serviceRecordOptions, serviceRecordModelOptions)
    );
    app.use(
      '/api/service-records',
      single(ServiceRecord, serviceRecordOptions, serviceRecordModelOptions)
    );
    app.use(
      '/api/service-records',
      patch(ServiceRecord, serviceRecordOptions, serviceRecordModelOptions)
    );
    app.use(
      '/api/service-records',
      destroy(ServiceRecord, serviceRecordOptions, serviceRecordModelOptions)
    );

    // =================================================================
    // PROTECTED ROUTES - Parts (global, not org-scoped - shared inventory)
    // =================================================================

    const partsOptions = {
      middleware: [requireAuth],
      id_mapping: 'externalId',
    };

    app.use('/api/parts', list(Part, partsOptions));
    app.use('/api/parts', search(Part, partsOptions));
    app.use('/api/parts', create(Part, partsOptions));
    app.use('/api/parts', single(Part, partsOptions));
    app.use('/api/parts', patch(Part, partsOptions));
    app.use('/api/parts', destroy(Part, partsOptions));

    // =================================================================
    // SEARCH ENDPOINTS (search is already mounted individually above)
    // =================================================================

    // Error handler
    app.use((err, req, res, next) => {
      console.error('App error:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Internal server error',
      });
    });

    return app;
  }

  // =================================================================
  // HELPER FUNCTIONS FOR TESTS
  // =================================================================

  // Reusable middleware functions for tests
  function extractToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return null;
    const match = authHeader.match(/^Bearer (.+)$/i);
    return match ? match[1] : null;
  }

  const requireAuth = (req, res, next) => {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authorization token required',
      });
    }

    const session = sessions.get(token);

    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
      });
    }

    req.session = session;
    next();
  };

  const scopeToOrganization = (req, res, next) => {
    const { organizationId } = req.session;

    req.apialize.applyWhere({ organizationId: organizationId });

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      req.apialize.values = {
        ...(req.apialize.values || {}),
        organizationId: organizationId,
      };
    }

    next();
  };

  async function createOrganization(name, slug) {
    return db.models.Organization.create({
      name,
      slug,
      email: `${slug}@example.com`,
      isActive: true,
    });
  }

  async function createUser(organizationId, username, password, email) {
    return db.models.User.create({
      organizationId,
      username,
      password: hashPassword(password),
      email,
      isActive: true,
    });
  }

  async function login(username, password) {
    const res = await request(app)
      .post('/auth/login')
      .send({ username, password });
    return res;
  }

  function authHeader(token) {
    return { Authorization: `Bearer ${token}` };
  }

  // =================================================================
  // TESTS
  // =================================================================

  describe('Authentication', () => {
    let org1;
    let user1;

    beforeEach(async () => {
      org1 = await createOrganization('Test Dealership', 'test-dealership');
      user1 = await createUser(
        org1.id,
        'testuser',
        'password123',
        'test@example.com'
      );
    });

    test('successful login returns token and user info', async () => {
      const res = await login('testuser', 'password123');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.username).toBe('testuser');
      expect(res.body.user.organization.name).toBe('Test Dealership');
    });

    test('login with wrong password fails', async () => {
      const res = await login('testuser', 'wrongpassword');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Invalid credentials');
    });

    test('login with non-existent user fails', async () => {
      const res = await login('nonexistent', 'password123');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid credentials');
    });

    test('login with disabled account fails', async () => {
      await user1.update({ isActive: false });

      const res = await login('testuser', 'password123');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Account is disabled');
    });

    test('get current user info with valid token', async () => {
      const loginRes = await login('testuser', 'password123');
      const token = loginRes.body.token;

      const res = await request(app).get('/auth/me').set(authHeader(token));

      expect(res.status).toBe(200);
      expect(res.body.user.username).toBe('testuser');
    });

    test('get current user info without token fails', async () => {
      const res = await request(app).get('/auth/me');

      expect(res.status).toBe(401);
    });

    test('logout invalidates token', async () => {
      const loginRes = await login('testuser', 'password123');
      const token = loginRes.body.token;

      // Token works before logout
      let meRes = await request(app).get('/auth/me').set(authHeader(token));
      expect(meRes.status).toBe(200);

      // Logout
      await request(app).post('/auth/logout').set(authHeader(token));

      // Token no longer works
      meRes = await request(app).get('/auth/me').set(authHeader(token));
      expect(meRes.status).toBe(401);
    });
  });

  describe('Multi-Tenant Data Isolation', () => {
    let org1, org2;
    let user1, user2;
    let token1, token2;

    beforeEach(async () => {
      // Create two organizations
      org1 = await createOrganization('Downtown Auto', 'downtown-auto');
      org2 = await createOrganization('Elite Motors', 'elite-motors');

      // Create users for each org
      user1 = await createUser(
        org1.id,
        'downtown_user',
        'pass123',
        'user@downtown.com'
      );
      user2 = await createUser(
        org2.id,
        'elite_user',
        'pass456',
        'user@elite.com'
      );

      // Login both users
      const login1 = await login('downtown_user', 'pass123');
      const login2 = await login('elite_user', 'pass456');
      token1 = login1.body.token;
      token2 = login2.body.token;
    });

    test('users can only see customers from their organization', async () => {
      // Create customers for org1
      await db.models.Customer.bulkCreate([
        {
          organizationId: org1.id,
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@downtown.com',
        },
        {
          organizationId: org1.id,
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'jane@downtown.com',
        },
      ]);

      // Create customers for org2
      await db.models.Customer.bulkCreate([
        {
          organizationId: org2.id,
          firstName: 'Bob',
          lastName: 'Wilson',
          email: 'bob@elite.com',
        },
      ]);

      // User 1 should see only Downtown Auto customers
      const res1 = await request(app)
        .get('/api/customers')
        .set(authHeader(token1));

      expect(res1.status).toBe(200);
      expect(res1.body.meta.paging.count).toBe(2);
      expect(res1.body.data.map((c) => c.firstName).sort()).toEqual([
        'Jane',
        'John',
      ]);

      // User 2 should see only Elite Motors customers
      const res2 = await request(app)
        .get('/api/customers')
        .set(authHeader(token2));

      expect(res2.status).toBe(200);
      expect(res2.body.meta.paging.count).toBe(1);
      expect(res2.body.data[0].firstName).toBe('Bob');
    });

    test('users cannot access customers from other organizations by ID', async () => {
      // Create customer for org1
      const customer = await db.models.Customer.create({
        organizationId: org1.id,
        firstName: 'Secret',
        lastName: 'Customer',
        email: 'secret@downtown.com',
      });

      // User 1 can access this customer
      const res1 = await request(app)
        .get(`/api/customers/${customer.externalId}`)
        .set(authHeader(token1));

      expect(res1.status).toBe(200);
      expect(res1.body.record.firstName).toBe('Secret');

      // User 2 (different org) should get 404
      const res2 = await request(app)
        .get(`/api/customers/${customer.externalId}`)
        .set(authHeader(token2));

      expect(res2.status).toBe(404);
    });

    test('creating a customer automatically assigns to user organization', async () => {
      const res = await request(app)
        .post('/api/customers')
        .set(authHeader(token1))
        .send({
          firstName: 'New',
          lastName: 'Customer',
          email: 'new@example.com',
        });

      expect(res.status).toBe(201);

      // Verify the customer was created with the correct organization
      // Note: res.body.id is the externalId (UUID) due to id_mapping
      const customer = await db.models.Customer.findOne({
        where: { externalId: res.body.id },
      });
      expect(customer).not.toBeNull();
      expect(customer.organizationId).toBe(org1.id);
    });

    test('users cannot update customers from other organizations', async () => {
      // Create customer for org1
      const customer = await db.models.Customer.create({
        organizationId: org1.id,
        firstName: 'Original',
        lastName: 'Name',
        email: 'original@downtown.com',
      });

      // User 2 tries to update - should get 404
      const res = await request(app)
        .patch(`/api/customers/${customer.externalId}`)
        .set(authHeader(token2))
        .send({ firstName: 'Hacked' });

      expect(res.status).toBe(404);

      // Verify name unchanged
      await customer.reload();
      expect(customer.firstName).toBe('Original');
    });

    test('users cannot delete customers from other organizations', async () => {
      // Create customer for org1
      const customer = await db.models.Customer.create({
        organizationId: org1.id,
        firstName: 'ToDelete',
        lastName: 'Customer',
        email: 'delete@downtown.com',
      });

      // User 2 tries to delete - should get 404
      const res = await request(app)
        .delete(`/api/customers/${customer.externalId}`)
        .set(authHeader(token2));

      expect(res.status).toBe(404);

      // Verify customer still exists
      const stillExists = await db.models.Customer.findByPk(customer.id);
      expect(stillExists).not.toBeNull();
    });
  });

  describe('Customer Management', () => {
    let org, user, token;

    beforeEach(async () => {
      org = await createOrganization('Test Org', 'test-org');
      user = await createUser(org.id, 'testuser', 'password', 'test@org.com');
      const loginRes = await login('testuser', 'password');
      token = loginRes.body.token;
    });

    test('create a new customer', async () => {
      const res = await request(app)
        .post('/api/customers')
        .set(authHeader(token))
        .send({
          firstName: 'Alice',
          lastName: 'Wonder',
          email: 'alice@wonder.com',
          phoneNumber: '+1-555-1234',
          membershipTier: 'gold',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.id).toBeDefined(); // Returns external ID when id_mapping is externalId

      // Verify by fetching the created customer
      const getRes = await request(app)
        .get(`/api/customers/${res.body.id}`)
        .set(authHeader(token));

      expect(getRes.status).toBe(200);
      expect(getRes.body.record.firstName).toBe('Alice');
      expect(getRes.body.record.lastName).toBe('Wonder');
      expect(getRes.body.record.email).toBe('alice@wonder.com');
    });

    test('list all customers with pagination', async () => {
      // Create multiple customers
      for (let i = 1; i <= 15; i++) {
        await db.models.Customer.create({
          organizationId: org.id,
          firstName: `Customer`,
          lastName: `${i}`,
          email: `customer${i}@test.com`,
        });
      }

      // Get first page (apialize uses api:page and api:page_size)
      const page1 = await request(app)
        .get('/api/customers?api:page=1&api:page_size=10')
        .set(authHeader(token));

      expect(page1.status).toBe(200);
      expect(page1.body.data.length).toBe(10);
      expect(page1.body.meta.paging.count).toBe(15);
      expect(page1.body.meta.paging.page).toBe(1);

      // Get second page
      const page2 = await request(app)
        .get('/api/customers?api:page=2&api:page_size=10')
        .set(authHeader(token));

      expect(page2.status).toBe(200);
      expect(page2.body.data.length).toBe(5);
    });

    test('get single customer by external ID', async () => {
      const customer = await db.models.Customer.create({
        organizationId: org.id,
        firstName: 'Specific',
        lastName: 'Customer',
        email: 'specific@test.com',
      });

      const res = await request(app)
        .get(`/api/customers/${customer.externalId}`)
        .set(authHeader(token));

      expect(res.status).toBe(200);
      expect(res.body.record.firstName).toBe('Specific');
      expect(res.body.record.email).toBe('specific@test.com');
    });

    test('update customer via PATCH', async () => {
      const customer = await db.models.Customer.create({
        organizationId: org.id,
        firstName: 'Old',
        lastName: 'Name',
        email: 'old@test.com',
        membershipTier: 'bronze',
      });

      const res = await request(app)
        .patch(`/api/customers/${customer.externalId}`)
        .set(authHeader(token))
        .send({
          firstName: 'New',
          membershipTier: 'platinum',
        });

      expect(res.status).toBe(200);

      await customer.reload();
      expect(customer.firstName).toBe('New');
      expect(customer.lastName).toBe('Name'); // Unchanged
      expect(customer.membershipTier).toBe('platinum');
    });

    test('delete customer', async () => {
      const customer = await db.models.Customer.create({
        organizationId: org.id,
        firstName: 'Delete',
        lastName: 'Me',
        email: 'delete@test.com',
      });

      const res = await request(app)
        .delete(`/api/customers/${customer.externalId}`)
        .set(authHeader(token));

      expect(res.status).toBe(200);

      // Soft delete - paranoid mode
      const deleted = await db.models.Customer.findByPk(customer.id);
      expect(deleted).toBeNull();

      // But should exist if we include paranoid: false
      const paranoid = await db.models.Customer.findByPk(customer.id, {
        paranoid: false,
      });
      expect(paranoid).not.toBeNull();
      expect(paranoid.deletedAt).not.toBeNull();
    });
  });

  describe('Vehicle Management', () => {
    let org, user, token, customer;

    beforeEach(async () => {
      org = await createOrganization('Auto Shop', 'auto-shop');
      user = await createUser(
        org.id,
        'mechanic',
        'wrench123',
        'mechanic@shop.com'
      );
      const loginRes = await login('mechanic', 'wrench123');
      token = loginRes.body.token;

      // Create a customer for this org
      customer = await db.models.Customer.create({
        organizationId: org.id,
        firstName: 'Car',
        lastName: 'Owner',
        email: 'owner@cars.com',
      });
    });

    test('vehicles linked to org customers are accessible', async () => {
      // Create a vehicle
      const vehicle = await db.models.Vehicle.create({
        vin: '1HGBH41JXMN109186',
        make: 'Honda',
        model: 'Accord',
        year: 2021,
        color: 'Silver',
        mileage: 15000,
      });

      // Link vehicle to customer via CustomerVehicle
      await db.models.CustomerVehicle.create({
        customerId: customer.id,
        vehicleId: vehicle.id,
        relationship: 'owner',
        startDate: '2021-01-01',
      });

      // User should be able to see this vehicle
      const res = await request(app)
        .get('/api/vehicles')
        .set(authHeader(token));

      expect(res.status).toBe(200);
      expect(res.body.meta.paging.count).toBe(1);
      expect(res.body.data[0].make).toBe('Honda');
      expect(res.body.data[0].model).toBe('Accord');
    });

    test('vehicles not linked to org customers are not accessible', async () => {
      // Create another org with their own customer
      const org2 = await createOrganization('Other Shop', 'other-shop');
      const customer2 = await db.models.Customer.create({
        organizationId: org2.id,
        firstName: 'Other',
        lastName: 'Customer',
        email: 'other@customer.com',
      });

      // Create a vehicle linked to org2's customer
      const vehicle = await db.models.Vehicle.create({
        vin: '5YJSA1E14HF123456',
        make: 'Tesla',
        model: 'Model S',
        year: 2022,
        color: 'White',
      });

      await db.models.CustomerVehicle.create({
        customerId: customer2.id,
        vehicleId: vehicle.id,
        relationship: 'owner',
        startDate: '2022-01-01',
      });

      // User from org1 should NOT see this vehicle
      const res = await request(app)
        .get('/api/vehicles')
        .set(authHeader(token));

      expect(res.status).toBe(200);
      expect(res.body.meta.paging.count).toBe(0);
    });
  });

  describe('Service Records', () => {
    let org, user, token, customer, vehicle;

    beforeEach(async () => {
      org = await createOrganization('Service Center', 'service-center');
      user = await createUser(
        org.id,
        'advisor',
        'service123',
        'advisor@service.com'
      );
      const loginRes = await login('advisor', 'service123');
      token = loginRes.body.token;

      // Create customer and vehicle
      customer = await db.models.Customer.create({
        organizationId: org.id,
        firstName: 'Service',
        lastName: 'Customer',
        email: 'service@customer.com',
      });

      vehicle = await db.models.Vehicle.create({
        vin: '1FTFW1ET5EFC12345',
        make: 'Ford',
        model: 'F-150',
        year: 2020,
        mileage: 42000,
      });

      await db.models.CustomerVehicle.create({
        customerId: customer.id,
        vehicleId: vehicle.id,
        relationship: 'owner',
        startDate: '2020-01-01',
      });
    });

    test('list service records for customer', async () => {
      // Create service records
      await db.models.ServiceRecord.bulkCreate([
        {
          vehicleId: vehicle.id,
          customerId: customer.id,
          serviceType: 'maintenance',
          description: 'Oil change',
          serviceDate: '2025-01-15',
          laborCost: 45.0,
          totalCost: 75.0,
          status: 'completed',
        },
        {
          vehicleId: vehicle.id,
          customerId: customer.id,
          serviceType: 'repair',
          description: 'Brake replacement',
          serviceDate: '2025-06-20',
          laborCost: 180.0,
          totalCost: 450.0,
          status: 'completed',
        },
      ]);

      const res = await request(app)
        .get('/api/service-records')
        .set(authHeader(token));

      expect(res.status).toBe(200);
      expect(res.body.meta.paging.count).toBe(2);
      expect(res.body.data.map((s) => s.serviceType).sort()).toEqual([
        'maintenance',
        'repair',
      ]);
    });

    test('service records include vehicle and customer details', async () => {
      await db.models.ServiceRecord.create({
        vehicleId: vehicle.id,
        customerId: customer.id,
        serviceType: 'inspection',
        description: 'Annual inspection',
        serviceDate: '2025-11-01',
        status: 'completed',
      });

      const res = await request(app)
        .get('/api/service-records')
        .set(authHeader(token));

      expect(res.status).toBe(200);
      expect(res.body.data[0].vehicle.make).toBe('Ford');
      expect(res.body.data[0].customer.firstName).toBe('Service');
    });
  });

  describe('Parts Inventory (Global/Shared)', () => {
    let org1, org2, user1, user2, token1, token2;

    beforeEach(async () => {
      org1 = await createOrganization('Shop 1', 'shop-1');
      org2 = await createOrganization('Shop 2', 'shop-2');

      user1 = await createUser(org1.id, 'user1', 'pass1', 'user1@shop1.com');
      user2 = await createUser(org2.id, 'user2', 'pass2', 'user2@shop2.com');

      const login1 = await login('user1', 'pass1');
      const login2 = await login('user2', 'pass2');
      token1 = login1.body.token;
      token2 = login2.body.token;
    });

    test('parts are accessible to all organizations', async () => {
      // Create some parts
      await db.models.Part.bulkCreate([
        {
          partNumber: 'BRK-001',
          name: 'Brake Pads',
          category: 'brakes',
          unitPrice: 89.99,
          quantityInStock: 50,
        },
        {
          partNumber: 'OIL-001',
          name: 'Oil Filter',
          category: 'engine',
          unitPrice: 12.99,
          quantityInStock: 100,
        },
      ]);

      // User from org1 can see parts
      const res1 = await request(app).get('/api/parts').set(authHeader(token1));

      expect(res1.status).toBe(200);
      expect(res1.body.meta.paging.count).toBe(2);

      // User from org2 can also see the same parts
      const res2 = await request(app).get('/api/parts').set(authHeader(token2));

      expect(res2.status).toBe(200);
      expect(res2.body.meta.paging.count).toBe(2);
    });

    test('search parts by category', async () => {
      await db.models.Part.bulkCreate([
        {
          partNumber: 'BRK-001',
          name: 'Brake Pads',
          category: 'brakes',
          unitPrice: 89.99,
        },
        {
          partNumber: 'BRK-002',
          name: 'Brake Rotors',
          category: 'brakes',
          unitPrice: 125.0,
        },
        {
          partNumber: 'ENG-001',
          name: 'Spark Plugs',
          category: 'engine',
          unitPrice: 52.0,
        },
      ]);

      const res = await request(app)
        .post('/api/parts/search')
        .set(authHeader(token1))
        .send({
          filtering: {
            category: 'brakes',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.meta.paging.count).toBe(2);
      expect(res.body.data.every((p) => p.category === 'brakes')).toBe(true);
    });
  });

  describe('Search Functionality', () => {
    let org, user, token;

    beforeEach(async () => {
      org = await createOrganization('Search Test Org', 'search-test');
      user = await createUser(org.id, 'searcher', 'find123', 'search@test.com');
      const loginRes = await login('searcher', 'find123');
      token = loginRes.body.token;

      // Create test customers
      await db.models.Customer.bulkCreate([
        {
          organizationId: org.id,
          firstName: 'John',
          lastName: 'Smith',
          email: 'john.smith@email.com',
          membershipTier: 'gold',
        },
        {
          organizationId: org.id,
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane.doe@email.com',
          membershipTier: 'platinum',
        },
        {
          organizationId: org.id,
          firstName: 'Bob',
          lastName: 'Johnson',
          email: 'bob.johnson@email.com',
          membershipTier: 'bronze',
        },
      ]);
    });

    test('search customers by name', async () => {
      const res = await request(app)
        .post('/api/customers/search')
        .set(authHeader(token))
        .send({
          filtering: {
            firstName: { icontains: 'jo' },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.meta.paging.count).toBe(1);
      expect(res.body.data[0].firstName).toBe('John');
    });

    test('search customers by membership tier', async () => {
      const res = await request(app)
        .post('/api/customers/search')
        .set(authHeader(token))
        .send({
          filtering: {
            membershipTier: { in: ['gold', 'platinum'] },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.meta.paging.count).toBe(2);
    });

    test('search with multiple filters', async () => {
      const res = await request(app)
        .post('/api/customers/search')
        .set(authHeader(token))
        .send({
          filtering: {
            lastName: { icontains: 'son' },
            membershipTier: 'bronze',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.meta.paging.count).toBe(1);
      expect(res.body.data[0].lastName).toBe('Johnson');
    });

    test('search respects organization scope', async () => {
      // First do an Organization.create
      const dummy = await db.models.Organization.create({
        name: 'Dummy',
        slug: 'dummy',
        email: 'dummy@test.com',
        isActive: true,
      });

      // Now search for Smith - should only find our org's John Smith
      const res = await request(app)
        .post('/api/customers/search')
        .set(authHeader(token))
        .send({
          filtering: {
            lastName: 'Smith',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.meta.paging.count).toBe(1);
      expect(res.body.data[0].firstName).toBe('John'); // John Smith from our org
    });
  });

  describe('Authorization Edge Cases', () => {
    test('unauthenticated request returns 401', async () => {
      const res = await request(app).get('/api/customers');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Authorization token required');
    });

    test('invalid token returns 401', async () => {
      const res = await request(app)
        .get('/api/customers')
        .set({ Authorization: 'Bearer invalid_token_123' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid or expired token');
    });

    test('malformed authorization header returns 401', async () => {
      const res = await request(app)
        .get('/api/customers')
        .set({ Authorization: 'Basic user:pass' });

      expect(res.status).toBe(401);
    });
  });

  describe('Full User Journey', () => {
    test('complete workflow: login, manage customers and vehicles, create service', async () => {
      // Setup: Create organization and user
      const org = await createOrganization(
        'Premium Auto Service',
        'premium-auto'
      );
      await createUser(
        org.id,
        'service_advisor',
        'welcome123',
        'advisor@premium.com'
      );

      // Step 1: Login
      const loginRes = await request(app)
        .post('/auth/login')
        .send({ username: 'service_advisor', password: 'welcome123' });

      expect(loginRes.status).toBe(200);
      const token = loginRes.body.token;

      // Step 2: Create a new customer
      const customerRes = await request(app)
        .post('/api/customers')
        .set(authHeader(token))
        .send({
          firstName: 'Michael',
          lastName: 'Roberts',
          email: 'michael.roberts@email.com',
          phoneNumber: '+1-555-9999',
          membershipTier: 'silver',
        });

      expect(customerRes.status).toBe(201);
      // With id_mapping: 'externalId', the returned 'id' is actually the externalId (UUID)
      const customerExternalId = customerRes.body.id;

      // Look up the actual internal ID for relationships
      const createdCustomer = await db.models.Customer.findOne({
        where: { externalId: customerExternalId },
      });
      const customerInternalId = createdCustomer.id;

      // Step 3: Verify customer appears in list
      const listRes = await request(app)
        .get('/api/customers')
        .set(authHeader(token));

      expect(listRes.status).toBe(200);
      expect(listRes.body.data.length).toBe(1);
      expect(listRes.body.data[0].firstName).toBe('Michael');

      // Step 4: Create a vehicle (directly in DB since vehicle creation isn't org-scoped)
      const vehicle = await db.models.Vehicle.create({
        vin: 'WBAJA5C50HWB12345',
        make: 'BMW',
        model: '3 Series',
        year: 2023,
        color: 'Black',
        mileage: 5000,
        engineType: 'plugin-hybrid',
      });

      // Link vehicle to customer using internal IDs
      await db.models.CustomerVehicle.create({
        customerId: customerInternalId,
        vehicleId: vehicle.id,
        relationship: 'owner',
        startDate: new Date().toISOString().split('T')[0],
        isPrimary: true,
      });

      // Step 5: Verify vehicle is accessible
      const vehiclesRes = await request(app)
        .get('/api/vehicles')
        .set(authHeader(token));

      expect(vehiclesRes.status).toBe(200);
      expect(vehiclesRes.body.data.length).toBe(1);
      expect(vehiclesRes.body.data[0].make).toBe('BMW');

      // Step 6: Create a service record (using internal IDs for foreign keys)
      const serviceRes = await request(app)
        .post('/api/service-records')
        .set(authHeader(token))
        .send({
          vehicleId: vehicle.id,
          customerId: customerInternalId,
          serviceType: 'maintenance',
          description: 'First scheduled service at 5000 miles',
          serviceDate: new Date().toISOString().split('T')[0],
          laborCost: 120.0,
          partsCost: 85.0,
          totalCost: 205.0,
          laborHours: 1.5,
          mileageAtService: 5000,
          technicianName: 'Expert Tech',
          status: 'completed',
        });

      expect(serviceRes.status).toBe(201);

      // Step 7: Update customer membership based on service
      const updateRes = await request(app)
        .patch(`/api/customers/${customerExternalId}`)
        .set(authHeader(token))
        .send({
          membershipTier: 'gold',
        });

      expect(updateRes.status).toBe(200);

      // Step 8: Verify service record shows in list
      const servicesRes = await request(app)
        .get('/api/service-records')
        .set(authHeader(token));

      expect(servicesRes.status).toBe(200);
      expect(servicesRes.body.data.length).toBe(1);
      expect(servicesRes.body.data[0].description).toContain('5000 miles');

      // Step 9: Search for customer
      const searchRes = await request(app)
        .post('/api/customers/search')
        .set(authHeader(token))
        .send({
          filtering: {
            membershipTier: 'gold',
          },
        });

      expect(searchRes.status).toBe(200);
      expect(searchRes.body.data.length).toBe(1);
      expect(searchRes.body.data[0].firstName).toBe('Michael');

      // Step 10: Logout
      await request(app).post('/auth/logout').set(authHeader(token));

      // Verify can no longer access data
      const afterLogoutRes = await request(app)
        .get('/api/customers')
        .set(authHeader(token));

      expect(afterLogoutRes.status).toBe(401);
    });
  });

  describe('List Operation Advanced Features', () => {
    let org, user, token;

    beforeEach(async () => {
      org = await createOrganization('Advanced Test Org', 'advanced-test');
      user = await createUser(org.id, 'advanceduser', 'adv123', 'adv@test.com');
      const loginRes = await login('advanceduser', 'adv123');
      token = loginRes.body.token;
    });

    describe('allow_filtering and allow_ordering', () => {
      test('allowFiltering: false disables query string filtering', async () => {
        // Create customers with different tiers
        await db.models.Customer.bulkCreate([
          {
            organizationId: org.id,
            firstName: 'Alpha',
            lastName: 'User',
            email: 'alpha@test.com',
            membershipTier: 'gold',
          },
          {
            organizationId: org.id,
            firstName: 'Beta',
            lastName: 'User',
            email: 'beta@test.com',
            membershipTier: 'bronze',
          },
        ]);

        // Build a temporary app with allow_filtering: false for parts endpoint
        const testApp = express();
        testApp.use(bodyParser.json());

        const authAndScope = [requireAuth, scopeToOrganization];

        testApp.use(
          '/test-parts',
          list(db.models.Part, {
            middleware: [requireAuth],
            allow_filtering: false,
          })
        );

        // Create parts
        await db.models.Part.bulkCreate([
          {
            partNumber: 'P1',
            name: 'Part 1',
            category: 'brakes',
            unitPrice: 10,
          },
          {
            partNumber: 'P2',
            name: 'Part 2',
            category: 'engine',
            unitPrice: 20,
          },
        ]);

        // Try to filter - should be ignored and return all parts
        const res = await request(testApp)
          .get('/test-parts?category=brakes')
          .set(authHeader(token));

        expect(res.status).toBe(200);
        expect(res.body.meta.paging.count).toBe(2); // Both parts returned despite filter
      });

      test('allow_ordering: false disables custom ordering', async () => {
        // Create customers with different names
        await db.models.Customer.bulkCreate([
          {
            organizationId: org.id,
            firstName: 'Zulu',
            lastName: 'Last',
            email: 'zulu@test.com',
          },
          {
            organizationId: org.id,
            firstName: 'Alpha',
            lastName: 'First',
            email: 'alpha@test.com',
          },
        ]);

        const testApp = express();
        testApp.use(bodyParser.json());

        const authAndScope = [requireAuth, scopeToOrganization];

        testApp.use(
          '/test-customers',
          list(db.models.Customer, {
            middleware: authAndScope,
            allow_ordering: false,
            default_order_by: 'id',
            default_order_dir: 'ASC',
          })
        );

        // Try to order by firstName - should be ignored and use default (id ASC)
        const res = await request(testApp)
          .get('/test-customers?api:order_by=firstName&api:order_dir=DESC')
          .set(authHeader(token));

        expect(res.status).toBe(200);
        // Should be ordered by id (insertion order), not firstName DESC
        expect(res.body.data[0].firstName).toBe('Zulu'); // First inserted
        expect(res.body.data[1].firstName).toBe('Alpha'); // Second inserted
      });
    });

    describe('meta_show_filters and meta_show_ordering', () => {
      test('meta_show_filters: true includes applied filters in response', async () => {
        await db.models.Customer.bulkCreate([
          {
            organizationId: org.id,
            firstName: 'John',
            lastName: 'Doe',
            email: 'john@test.com',
            membershipTier: 'gold',
          },
        ]);

        const testApp = express();
        testApp.use(bodyParser.json());

        const authAndScope = [requireAuth, scopeToOrganization];

        testApp.use(
          '/test-customers',
          list(db.models.Customer, {
            middleware: authAndScope,
            meta_show_filters: true,
          })
        );

        const res = await request(testApp)
          .get('/test-customers?membershipTier=gold&firstName:icontains=jo')
          .set(authHeader(token));

        expect(res.status).toBe(200);
        expect(res.body.meta.filtering).toBeDefined();
        expect(res.body.meta.filtering.membershipTier).toBe('gold');
        expect(res.body.meta.filtering.firstName).toEqual({ icontains: 'jo' });
      });

      test('meta_show_ordering: true includes ordering info in response', async () => {
        await db.models.Customer.create({
          organizationId: org.id,
          firstName: 'Test',
          lastName: 'User',
          email: 'test@test.com',
        });

        const testApp = express();
        testApp.use(bodyParser.json());

        const authAndScope = [requireAuth, scopeToOrganization];

        testApp.use(
          '/test-customers',
          list(db.models.Customer, {
            middleware: authAndScope,
            meta_show_ordering: true,
          })
        );

        const res = await request(testApp)
          .get('/test-customers?api:order_by=firstName&api:order_dir=DESC')
          .set(authHeader(token));

        expect(res.status).toBe(200);
        expect(res.body.meta.ordering).toBeDefined();
        expect(res.body.meta.ordering).toEqual([
          { order_by: 'firstName', direction: 'DESC' },
        ]);
      });
    });

    describe('pre and post hooks', () => {
      test('pre hook can modify context before list execution', async () => {
        await db.models.Customer.bulkCreate([
          {
            organizationId: org.id,
            firstName: 'Alice',
            lastName: 'Pre',
            email: 'alice@test.com',
          },
          {
            organizationId: org.id,
            firstName: 'Bob',
            lastName: 'Hook',
            email: 'bob@test.com',
          },
        ]);

        const testApp = express();
        testApp.use(bodyParser.json());

        const authAndScope = [requireAuth, scopeToOrganization];

        testApp.use(
          '/test-customers',
          list(db.models.Customer, {
            middleware: authAndScope,
            pre: async (context) => {
              // Pre hook can stash data
              return { preExecuted: true, timestamp: Date.now() };
            },
            post: async (context) => {
              // Verify preResult is available
              expect(context.preResult).toBeDefined();
              expect(context.preResult.preExecuted).toBe(true);
              // Add custom meta to response
              context.payload.meta.hookExecuted = true;
              context.payload.meta.recordCount = context.payload.data.length;
            },
          })
        );

        const res = await request(testApp)
          .get('/test-customers')
          .set(authHeader(token));

        expect(res.status).toBe(200);
        expect(res.body.meta.hookExecuted).toBe(true);
        expect(res.body.meta.recordCount).toBe(2);
      });
    });

    describe('multiple ordering fields', () => {
      test('supports array of ordering objects', async () => {
        await db.models.Customer.bulkCreate([
          {
            organizationId: org.id,
            firstName: 'Alice',
            lastName: 'Smith',
            email: 'alice.smith@test.com',
            membershipTier: 'gold',
          },
          {
            organizationId: org.id,
            firstName: 'Bob',
            lastName: 'Smith',
            email: 'bob.smith@test.com',
            membershipTier: 'bronze',
          },
          {
            organizationId: org.id,
            firstName: 'Alice',
            lastName: 'Jones',
            email: 'alice.jones@test.com',
            membershipTier: 'platinum',
          },
        ]);

        const testApp = express();
        testApp.use(bodyParser.json());

        const authAndScope = [requireAuth, scopeToOrganization];

        testApp.use(
          '/test-customers',
          search(db.models.Customer, {
            middleware: authAndScope,
            metaShowOrdering: true,
          })
        );

        // Search with multiple ordering: lastName ASC, then firstName ASC
        const res = await request(testApp)
          .post('/test-customers/search')
          .set(authHeader(token))
          .send({
            ordering: [
              { order_by: 'lastName', direction: 'ASC' },
              { order_by: 'firstName', direction: 'ASC' },
            ],
          });

        expect(res.status).toBe(200);
        expect(res.body.data.length).toBe(3);
        // Jones comes before Smith (lastName ASC)
        expect(res.body.data[0].lastName).toBe('Jones');
        // Within Smith, Alice before Bob (firstName ASC)
        expect(res.body.data[1].lastName).toBe('Smith');
        expect(res.body.data[1].firstName).toBe('Alice');
        expect(res.body.data[2].lastName).toBe('Smith');
        expect(res.body.data[2].firstName).toBe('Bob');

        expect(res.body.meta.ordering).toEqual([
          { order_by: 'lastName', direction: 'ASC' },
          { order_by: 'firstName', direction: 'ASC' },
        ]);
      });
    });

    describe('advanced filtering operators', () => {
      beforeEach(async () => {
        await db.models.Customer.bulkCreate([
          {
            organizationId: org.id,
            firstName: 'Alice',
            lastName: 'Anderson',
            email: 'alice@test.com',
            membershipTier: 'platinum',
          },
          {
            organizationId: org.id,
            firstName: 'Bob',
            lastName: 'Brown',
            email: 'bob@test.com',
            membershipTier: 'gold',
          },
          {
            organizationId: org.id,
            firstName: 'Charlie',
            lastName: 'Chen',
            email: 'charlie@test.com',
            membershipTier: 'bronze',
          },
          {
            organizationId: org.id,
            firstName: 'Diana',
            lastName: 'Davis',
            email: 'diana@test.com',
            membershipTier: 'silver',
          },
        ]);
      });

      test('ieq - case-insensitive equality', async () => {
        const res = await request(app)
          .get('/api/customers?firstName:ieq=ALICE')
          .set(authHeader(token));

        expect(res.status).toBe(200);
        expect(res.body.meta.paging.count).toBe(1);
        expect(res.body.data[0].firstName).toBe('Alice');
      });

      test('starts_with operator', async () => {
        const res = await request(app)
          .get('/api/customers?lastName:starts_with=A')
          .set(authHeader(token));

        expect(res.status).toBe(200);
        expect(res.body.meta.paging.count).toBe(1);
        expect(res.body.data[0].lastName).toBe('Anderson');
      });

      test('ends_with operator', async () => {
        const res = await request(app)
          .get('/api/customers?lastName:ends_with=son')
          .set(authHeader(token));

        expect(res.status).toBe(200);
        expect(res.body.meta.paging.count).toBe(1);
        expect(res.body.data[0].lastName).toBe('Anderson');
      });

      test('not_in operator', async () => {
        const res = await request(app)
          .get('/api/customers?membershipTier:not_in=gold,platinum')
          .set(authHeader(token));

        expect(res.status).toBe(200);
        expect(res.body.meta.paging.count).toBe(2);
        const tiers = res.body.data.map((c) => c.membershipTier).sort();
        expect(tiers).toEqual(['bronze', 'silver']);
      });

      test('not_contains operator', async () => {
        const res = await request(app)
          .get('/api/customers?email:not_contains=alice')
          .set(authHeader(token));

        expect(res.status).toBe(200);
        expect(res.body.meta.paging.count).toBe(3);
        expect(res.body.data.every((c) => !c.email.includes('alice'))).toBe(
          true
        );
      });
    });

    describe('advanced filtering with search (gt, gte, lt, lte)', () => {
      beforeEach(async () => {
        // Create service records with different costs
        const customer = await db.models.Customer.create({
          organizationId: org.id,
          firstName: 'Test',
          lastName: 'Customer',
          email: 'test@customer.com',
        });

        const vehicle = await db.models.Vehicle.create({
          vin: 'VIN12345678901234',
          make: 'Toyota',
          model: 'Camry',
          year: 2020,
        });

        await db.models.CustomerVehicle.create({
          customerId: customer.id,
          vehicleId: vehicle.id,
          relationship: 'owner',
          startDate: '2020-01-01',
        });

        await db.models.ServiceRecord.bulkCreate([
          {
            vehicleId: vehicle.id,
            customerId: customer.id,
            serviceType: 'maintenance',
            description: 'Oil change',
            serviceDate: '2025-01-01',
            totalCost: 50.0,
            status: 'completed',
          },
          {
            vehicleId: vehicle.id,
            customerId: customer.id,
            serviceType: 'repair',
            description: 'Brake replacement',
            serviceDate: '2025-02-01',
            totalCost: 200.0,
            status: 'completed',
          },
          {
            vehicleId: vehicle.id,
            customerId: customer.id,
            serviceType: 'inspection',
            description: 'Annual inspection',
            serviceDate: '2025-03-01',
            totalCost: 100.0,
            status: 'completed',
          },
          {
            vehicleId: vehicle.id,
            customerId: customer.id,
            serviceType: 'repair',
            description: 'Transmission work',
            serviceDate: '2025-04-01',
            totalCost: 500.0,
            status: 'completed',
          },
        ]);
      });

      test('gt - greater than operator', async () => {
        const res = await request(app)
          .post('/api/service-records/search')
          .set(authHeader(token))
          .send({
            filtering: {
              totalCost: { gt: 100 },
            },
          });

        expect(res.status).toBe(200);
        expect(res.body.meta.paging.count).toBe(2); // 200 and 500
        expect(res.body.data.every((s) => s.totalCost > 100)).toBe(true);
      });

      test('gte - greater than or equal operator', async () => {
        const res = await request(app)
          .post('/api/service-records/search')
          .set(authHeader(token))
          .send({
            filtering: {
              totalCost: { gte: 100 },
            },
          });

        expect(res.status).toBe(200);
        expect(res.body.meta.paging.count).toBe(3); // 100, 200, 500
        expect(res.body.data.every((s) => s.totalCost >= 100)).toBe(true);
      });

      test('lt - less than operator', async () => {
        const res = await request(app)
          .post('/api/service-records/search')
          .set(authHeader(token))
          .send({
            filtering: {
              totalCost: { lt: 100 },
            },
          });

        expect(res.status).toBe(200);
        expect(res.body.meta.paging.count).toBe(1); // 50
        expect(res.body.data[0].totalCost).toBe(50);
      });

      test('lte - less than or equal operator', async () => {
        const res = await request(app)
          .post('/api/service-records/search')
          .set(authHeader(token))
          .send({
            filtering: {
              totalCost: { lte: 100 },
            },
          });

        expect(res.status).toBe(200);
        expect(res.body.meta.paging.count).toBe(2); // 50, 100
        expect(res.body.data.every((s) => s.totalCost <= 100)).toBe(true);
      });

      test('combined operators - cost range', async () => {
        const res = await request(app)
          .post('/api/service-records/search')
          .set(authHeader(token))
          .send({
            filtering: {
              totalCost: { gte: 100, lte: 300 },
            },
          });

        expect(res.status).toBe(200);
        expect(res.body.meta.paging.count).toBe(2); // 100, 200
        expect(
          res.body.data.every((s) => s.totalCost >= 100 && s.totalCost <= 300)
        ).toBe(true);
      });
    });

    describe('flattening - flatten included relationship data', () => {
      test('flattening with belongsTo association', async () => {
        // Create customer and vehicle with relationship
        const customer = await db.models.Customer.create({
          organizationId: org.id,
          firstName: 'Flatten',
          lastName: 'Test',
          email: 'flatten@test.com',
        });

        const vehicle = await db.models.Vehicle.create({
          vin: 'FLAT1234567890123',
          make: 'Honda',
          model: 'Accord',
          year: 2022,
        });

        await db.models.CustomerVehicle.create({
          customerId: customer.id,
          vehicleId: vehicle.id,
          relationship: 'owner',
          startDate: '2022-01-01',
        });

        await db.models.ServiceRecord.create({
          vehicleId: vehicle.id,
          customerId: customer.id,
          serviceType: 'maintenance',
          description: 'Flattening test service',
          serviceDate: '2025-05-01',
          totalCost: 150.0,
          status: 'completed',
        });

        const testApp = express();
        testApp.use(bodyParser.json());

        const serviceRecordScopeMiddleware = async (req, res, next) => {
          const { organizationId } = req.session;

          const customers = await db.models.Customer.findAll({
            where: { organizationId },
            attributes: ['id'],
          });

          const customerIds = customers.map((c) => c.id);

          if (customerIds.length > 0) {
            req.apialize.applyWhere({ customerId: customerIds });
          } else {
            req.apialize.applyWhere({ customerId: -1 });
          }

          next();
        };

        // Use flattening to include vehicle and customer data flattened into response
        testApp.use(
          '/test-services',
          list(
            db.models.ServiceRecord,
            {
              middleware: [requireAuth, serviceRecordScopeMiddleware],
              flattening: [
                {
                  model: db.models.Vehicle,
                  as: 'vehicle',
                  attributes: [
                    ['make', 'vehicle_make'],
                    ['model', 'vehicle_model'],
                  ],
                },
                {
                  model: db.models.Customer,
                  as: 'customer',
                  attributes: [['firstName', 'customer_first_name']],
                },
              ],
            },
            {
              include: [
                { model: db.models.Vehicle, as: 'vehicle' },
                { model: db.models.Customer, as: 'customer' },
              ],
            }
          )
        );

        const res = await request(testApp)
          .get('/test-services')
          .set(authHeader(token));

        expect(res.status).toBe(200);
        expect(res.body.data.length).toBe(1);

        // Check that flattened fields are in the response
        const record = res.body.data[0];
        expect(record.vehicle_make).toBe('Honda');
        expect(record.vehicle_model).toBe('Accord');
        expect(record.customer_first_name).toBe('Flatten');

        // Original nested objects should be removed after flattening
        expect(record.vehicle).toBeUndefined();
        expect(record.customer).toBeUndefined();
      });
    });

    describe('disableSubqueryOnIncludeRequest', () => {
      test('disableSubqueryOnIncludeRequest: false enables subquery optimization', async () => {
        // Create test data with one-to-many relationship
        const customer = await db.models.Customer.create({
          organizationId: org.id,
          firstName: 'Subquery',
          lastName: 'Test',
          email: 'subquery@test.com',
        });

        const vehicle1 = await db.models.Vehicle.create({
          vin: 'SUB00112345678901',
          make: 'Toyota',
          model: 'Corolla',
          year: 2020,
        });

        const vehicle2 = await db.models.Vehicle.create({
          vin: 'SUB00212345678901',
          make: 'Toyota',
          model: 'Camry',
          year: 2021,
        });

        await db.models.CustomerVehicle.bulkCreate([
          {
            customerId: customer.id,
            vehicleId: vehicle1.id,
            relationship: 'owner',
            startDate: '2020-01-01',
          },
          {
            customerId: customer.id,
            vehicleId: vehicle2.id,
            relationship: 'owner',
            startDate: '2021-01-01',
          },
        ]);

        await db.models.ServiceRecord.bulkCreate([
          {
            vehicleId: vehicle1.id,
            customerId: customer.id,
            serviceType: 'maintenance',
            description: 'Service 1',
            serviceDate: '2025-01-01',
            totalCost: 100,
            status: 'completed',
          },
          {
            vehicleId: vehicle1.id,
            customerId: customer.id,
            serviceType: 'repair',
            description: 'Service 2',
            serviceDate: '2025-02-01',
            totalCost: 200,
            status: 'completed',
          },
          {
            vehicleId: vehicle2.id,
            customerId: customer.id,
            serviceType: 'inspection',
            description: 'Service 3',
            serviceDate: '2025-03-01',
            totalCost: 50,
            status: 'completed',
          },
        ]);

        const testApp = express();
        testApp.use(bodyParser.json());

        const serviceRecordScopeMiddleware = async (req, res, next) => {
          const { organizationId } = req.session;

          const customers = await db.models.Customer.findAll({
            where: { organizationId },
            attributes: ['id'],
          });

          const customerIds = customers.map((c) => c.id);

          if (customerIds.length > 0) {
            req.apialize.applyWhere({ customerId: customerIds });
          } else {
            req.apialize.applyWhere({ customerId: -1 });
          }

          next();
        };

        // With disableSubqueryOnIncludeRequest: false, Sequelize may use subqueries
        testApp.use(
          '/test-services',
          list(
            db.models.ServiceRecord,
            {
              middleware: [requireAuth, serviceRecordScopeMiddleware],
              disableSubqueryOnIncludeRequest: false,
            },
            {
              include: [
                { model: db.models.Vehicle, as: 'vehicle' },
                { model: db.models.Customer, as: 'customer' },
              ],
            }
          )
        );

        const res = await request(testApp)
          .get('/test-services')
          .set(authHeader(token));

        expect(res.status).toBe(200);
        expect(res.body.meta.paging.count).toBe(3);
        expect(res.body.data.length).toBe(3);

        // Verify includes are present
        expect(res.body.data[0].vehicle).toBeDefined();
        expect(res.body.data[0].customer).toBeDefined();
      });
    });
  });
});
