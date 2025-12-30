const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const {
  single,
  create,
  list,
  update,
  patch,
  destroy,
  search,
  crud,
} = require('../src');

describe('Documentation - Model Configuration Examples', () => {
  let sequelize;

  beforeAll(async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('Basic Structure', () => {
    test('should define a model with apialize configuration', async () => {
      const Product = sequelize.define(
        'Product',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          sku: { type: DataTypes.STRING(50), unique: true },
          name: { type: DataTypes.STRING(100) },
          status: { type: DataTypes.STRING(20) },
        },
        {
          tableName: 'products_basic',
          timestamps: false,
          apialize: {
            // Configuration goes here
          },
        }
      );

      await Product.sync({ force: true });

      const app = express();
      app.use(bodyParser.json());
      app.use('/products', create(Product));

      const res = await request(app)
        .post('/products')
        .send({ sku: 'SKU-001', name: 'Test Product', status: 'active' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Configuration Hierarchy', () => {
    test('should apply configuration in the correct hierarchy', async () => {
      const Product = sequelize.define(
        'Product',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          sku: { type: DataTypes.STRING(50), unique: true },
          name: { type: DataTypes.STRING(100) },
        },
        {
          tableName: 'products_hierarchy',
          timestamps: false,
          apialize: {
            default: {
              // Applied to ALL operations
              id_mapping: 'sku',
            },
            list: {
              default: {
                // Applied to ALL list operations
                default_page_size: 50,
              },
              admin: {
                // Applied only when apialize_context: 'admin' is specified
                default_page_size: 200,
              },
            },
          },
        }
      );

      await Product.sync({ force: true });

      // Create test data
      for (let i = 1; i <= 100; i++) {
        await Product.create({
          sku: `SKU-${String(i).padStart(3, '0')}`,
          name: `Product ${i}`,
        });
      }

      const app = express();
      app.use(bodyParser.json());
      app.use('/products', list(Product));
      app.use('/admin/products', list(Product, { apialize_context: 'admin' }));

      // Test default context
      const defaultRes = await request(app).get('/products');
      expect(defaultRes.status).toBe(200);
      expect(defaultRes.body.data.length).toBe(50);

      // Test admin context
      const adminRes = await request(app).get('/admin/products');
      expect(adminRes.status).toBe(200);
      expect(adminRes.body.data.length).toBe(100);
    });
  });

  describe('Global Default Configuration', () => {
    test('should apply global defaults to all operations', async () => {
      const hooksRan = [];

      const Product = sequelize.define(
        'Product',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          sku: { type: DataTypes.STRING(50), unique: true },
          name: { type: DataTypes.STRING(100) },
        },
        {
          tableName: 'products_global',
          timestamps: false,
          apialize: {
            default: {
              id_mapping: 'sku',
              pre: async (context) => {
                hooksRan.push('pre');
              },
              post: async (context) => {
                hooksRan.push('post');
              },
            },
          },
        }
      );

      await Product.sync({ force: true });

      const app = express();
      app.use(bodyParser.json());
      app.use('/products', crud(Product));

      // Test create
      hooksRan.length = 0;
      const createRes = await request(app)
        .post('/products')
        .send({ sku: 'SKU-001', name: 'Product 1' });
      expect(createRes.status).toBe(201);
      expect(hooksRan).toEqual(['pre', 'post']);

      // Test single (using sku from id_mapping)
      hooksRan.length = 0;
      const singleRes = await request(app).get('/products/SKU-001');
      expect(singleRes.status).toBe(200);
      expect(singleRes.body.record.id).toBe('SKU-001');
      expect(hooksRan).toEqual(['pre', 'post']);
    });
  });

  describe('Operation-Specific Configuration', () => {
    test('should apply operation-specific defaults', async () => {
      const Product = sequelize.define(
        'Product',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          sku: { type: DataTypes.STRING(50), unique: true },
          name: { type: DataTypes.STRING(100) },
          status: { type: DataTypes.STRING(20) },
          category: { type: DataTypes.STRING(50) },
          created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
        },
        {
          tableName: 'products_operation_specific',
          timestamps: false,
          apialize: {
            default: {
              id_mapping: 'sku',
            },
            list: {
              default: {
                default_page_size: 50,
                default_order_by: 'name',
                default_order_dir: 'ASC',
                orderable_fields: ['name', 'created_at'],
                filterable_fields: ['status', 'category'],
              },
            },
            single: {
              default: {
                param_name: 'sku',
              },
            },
            create: {
              default: {
                validate: true,
                allowed_fields: ['name', 'sku', 'status'],
              },
            },
            update: {
              default: {
                validate: true,
                allowed_fields: ['name', 'status'],
              },
            },
          },
        }
      );

      await Product.sync({ force: true });

      // Create test data
      await Product.create({ sku: 'SKU-001', name: 'Zebra', status: 'active' });
      await Product.create({ sku: 'SKU-002', name: 'Apple', status: 'active' });

      const app = express();
      app.use(bodyParser.json());
      app.use('/products', crud(Product));

      // Test list ordering (should be ASC by name)
      const listRes = await request(app).get('/products');
      expect(listRes.status).toBe(200);
      expect(listRes.body.data[0].name).toBe('Apple');
      expect(listRes.body.data[1].name).toBe('Zebra');

      // Test single with sku param
      const singleRes = await request(app).get('/products/SKU-001');
      expect(singleRes.status).toBe(200);
      expect(singleRes.body.record.name).toBe('Zebra');
    });
  });

  describe('Named Contexts', () => {
    test('should support multiple named contexts for different use cases', async () => {
      const Product = sequelize.define(
        'Product',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          sku: { type: DataTypes.STRING(50), unique: true },
          name: { type: DataTypes.STRING(100) },
          status: { type: DataTypes.STRING(20) },
          category: { type: DataTypes.STRING(50) },
        },
        {
          tableName: 'products_named_contexts',
          timestamps: false,
          apialize: {
            default: {
              id_mapping: 'sku',
            },
            list: {
              default: {
                default_page_size: 20,
                filterable_fields: ['status'],
              },
              admin: {
                default_page_size: 100,
                filterable_fields: ['status', 'category'],
              },
              public: {
                default_page_size: 10,
                filterable_fields: ['status'],
              },
            },
            single: {
              default: {
                param_name: 'sku',
              },
              internal: {
                param_name: 'id',
                id_mapping: 'id',
              },
            },
          },
        }
      );

      await Product.sync({ force: true });

      // Create 50 test products
      for (let i = 1; i <= 50; i++) {
        await Product.create({
          sku: `SKU-${String(i).padStart(3, '0')}`,
          name: `Product ${i}`,
          status: 'active',
        });
      }

      const app = express();
      app.use(bodyParser.json());

      // Mount different contexts on different routes
      app.use('/api/products', list(Product));
      app.use(
        '/api/admin/products',
        list(Product, { apialize_context: 'admin' })
      );
      app.use(
        '/api/public/products',
        list(Product, { apialize_context: 'public' })
      );
      app.use('/api/products', single(Product));
      app.use('/internal/products', single(Product, { apialize_context: 'internal' }));

      // Test default context (20 per page)
      const defaultRes = await request(app).get('/api/products');
      expect(defaultRes.status).toBe(200);
      expect(defaultRes.body.data.length).toBe(20);

      // Test admin context (100 per page)
      const adminRes = await request(app).get('/api/admin/products');
      expect(adminRes.status).toBe(200);
      expect(adminRes.body.data.length).toBe(50); // Only 50 exist

      // Test public context (10 per page)
      const publicRes = await request(app).get('/api/public/products');
      expect(publicRes.status).toBe(200);
      expect(publicRes.body.data.length).toBe(10);

      // Test single with sku (default)
      const singleRes = await request(app).get('/api/products/SKU-001');
      expect(singleRes.status).toBe(200);
      expect(singleRes.body.record.id).toBe('SKU-001');

      // Test single with internal id
      const internalRes = await request(app).get('/internal/products/1');
      expect(internalRes.status).toBe(200);
      expect(internalRes.body.record.id).toBe(1);
    });
  });

  describe('Model Options - Scopes', () => {
    test('should apply scopes from model_options', async () => {
      const Product = sequelize.define(
        'Product',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          sku: { type: DataTypes.STRING(50), unique: true },
          name: { type: DataTypes.STRING(100) },
          status: { type: DataTypes.STRING(20) },
          is_featured: { type: DataTypes.BOOLEAN, defaultValue: false },
        },
        {
          tableName: 'products_scopes',
          timestamps: false,
        }
      );

      // Define scopes on the model
      Product.addScope('active', {
        where: { status: 'active' },
      });

      Product.addScope('featured', {
        where: { is_featured: true },
      });

      // Add apialize config after scopes are defined
      Product.options.apialize = {
        list: {
          default: {
            default_page_size: 50,
          },
          active: {
            model_options: {
              scopes: ['active'],
            },
          },
          featured: {
            model_options: {
              scopes: ['featured', 'active'],
            },
          },
        },
        single: {
          default: {
            param_name: 'sku',
          },
          activeOnly: {
            param_name: 'sku',
            model_options: {
              scopes: ['active'],
            },
          },
        },
      };

      await Product.sync({ force: true });

      // Create test data
      await Product.create({ sku: 'SKU-001', name: 'Active Featured', status: 'active', is_featured: true });
      await Product.create({ sku: 'SKU-002', name: 'Active Not Featured', status: 'active', is_featured: false });
      await Product.create({ sku: 'SKU-003', name: 'Inactive Featured', status: 'inactive', is_featured: true });
      await Product.create({ sku: 'SKU-004', name: 'Inactive Not Featured', status: 'inactive', is_featured: false });

      const app = express();
      app.use(bodyParser.json());

      // Different endpoints with different scopes
      app.use('/products', list(Product));
      app.use('/products/active', list(Product, { apialize_context: 'active' }));
      app.use('/products/featured', list(Product, { apialize_context: 'featured' }));
      app.use('/products', single(Product));
      app.use('/products/active', single(Product, { apialize_context: 'activeOnly' }));

      // Test all products (no scope)
      const allRes = await request(app).get('/products');
      expect(allRes.status).toBe(200);
      expect(allRes.body.data.length).toBe(4);

      // Test active products only
      const activeRes = await request(app).get('/products/active');
      expect(activeRes.status).toBe(200);
      expect(activeRes.body.data.length).toBe(2);
      expect(activeRes.body.data.every(p => p.status === 'active')).toBe(true);

      // Test featured and active products
      const featuredRes = await request(app).get('/products/featured');
      expect(featuredRes.status).toBe(200);
      expect(featuredRes.body.data.length).toBe(1);
      expect(featuredRes.body.data[0].name).toBe('Active Featured');
    });
  });

  describe('Global Model Options', () => {
    test('should apply global model_options to all operations', async () => {
      const Product = sequelize.define(
        'Product',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          sku: { type: DataTypes.STRING(50), unique: true },
          name: { type: DataTypes.STRING(100) },
          status: { type: DataTypes.STRING(20) },
        },
        {
          tableName: 'products_global_model_options',
          timestamps: false,
        }
      );

      Product.addScope('defaultScope', {
        where: { status: 'active' },
      });

      Product.options.apialize = {
        default: {
          id_mapping: 'sku',
          model_options: {
            scopes: ['defaultScope'],
          },
        },
      };

      await Product.sync({ force: true });

      // Create test data
      await Product.create({ sku: 'SKU-001', name: 'Active Product', status: 'active' });
      await Product.create({ sku: 'SKU-002', name: 'Inactive Product', status: 'inactive' });

      const app = express();
      app.use(bodyParser.json());
      app.use('/products', list(Product));

      // Should only return active products
      const res = await request(app).get('/products');
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].name).toBe('Active Product');
    });
  });

  describe('Complete Example - Multi-Tenant Application', () => {
    test('should handle multi-tenant configuration', async () => {
      const Order = sequelize.define(
        'Order',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          order_number: { type: DataTypes.STRING(50), unique: true },
          tenant_id: { type: DataTypes.INTEGER },
          status: { type: DataTypes.STRING(20) },
          total: { type: DataTypes.DECIMAL(10, 2) },
          created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
        },
        {
          tableName: 'orders_multitenant',
          timestamps: false,
          apialize: {
            default: {
              id_mapping: 'order_number',
              pre: async (context) => {
                // Add tenant filtering to all operations
                const tenantId = context.req.user.tenant_id;
                context.apply_where({ tenant_id: tenantId });
              },
            },
            list: {
              default: {
                default_page_size: 25,
                default_order_by: 'created_at',
                default_order_dir: 'DESC',
                filterable_fields: ['status'],
              },
              admin: {
                default_page_size: 100,
                filterable_fields: ['status', 'tenant_id'],
                pre: [], // Override global pre-hook for admins
              },
            },
            create: {
              default: {
                allowed_fields: ['order_number', 'total'],
                pre: async (context) => {
                  context.set_multiple_values({
                    tenant_id: context.req.user.tenant_id,
                    status: 'pending'
                  });
                },
              },
            },
          },
        }
      );

      await Order.sync({ force: true });

      // Create test data for two tenants
      await Order.create({ order_number: 'ORD-001', tenant_id: 1, status: 'pending', total: 100.00 });
      await Order.create({ order_number: 'ORD-002', tenant_id: 1, status: 'completed', total: 200.00 });
      await Order.create({ order_number: 'ORD-003', tenant_id: 2, status: 'pending', total: 150.00 });

      const app = express();
      app.use(bodyParser.json());

      // Middleware to simulate user
      app.use((req, res, next) => {
        req.user = { tenant_id: 1 }; // Tenant 1
        next();
      });

      app.use('/orders', list(Order));
      app.use('/orders', create(Order));

      // List should only show tenant 1 orders
      const listRes = await request(app).get('/orders');
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.length).toBe(2);
      expect(listRes.body.data.every(o => o.tenant_id === 1)).toBe(true);

      // Create should auto-set tenant_id and status
      const createRes = await request(app)
        .post('/orders')
        .send({ order_number: 'ORD-004', total: 300.00 });
      expect(createRes.status).toBe(201);
      
      // Verify the created order has correct tenant_id and status
      const verifyRes = await request(app).get('/orders');
      const createdOrder = verifyRes.body.data.find(o => o.id === 'ORD-004');
      expect(createdOrder.tenant_id).toBe(1);
      expect(createdOrder.status).toBe('pending');
    });
  });

  describe('Complete Example - Public and Admin APIs', () => {
    test('should handle public and admin API contexts', async () => {
      const Article = sequelize.define(
        'Article',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          slug: { type: DataTypes.STRING(100), unique: true },
          title: { type: DataTypes.STRING(200) },
          status: { type: DataTypes.STRING(20) },
          published_at: { type: DataTypes.DATE },
          category: { type: DataTypes.STRING(50) },
          author_id: { type: DataTypes.INTEGER },
        },
        {
          tableName: 'articles_public_admin',
          timestamps: false,
        }
      );

      Article.addScope('published', {
        where: { status: 'published' },
      });

      Article.options.apialize = {
        default: {
          id_mapping: 'slug',
        },
        list: {
          public: {
            default_page_size: 10,
            filterable_fields: ['category'],
            model_options: {
              scopes: ['published'],
            },
          },
          admin: {
            default_page_size: 50,
            filterable_fields: ['status', 'category', 'author_id'],
            model_options: {
              scopes: [],
            },
          },
        },
        single: {
          public: {
            param_name: 'slug',
            model_options: {
              scopes: ['published'],
            },
          },
          admin: {
            param_name: 'slug',
          },
        },
        create: {
          admin: {
            allowed_fields: ['title', 'slug', 'content', 'status'],
            post: async (context) => {
              // Auto-publish if status is 'published'
              if (context.payload.status === 'published') {
                await context.model.update(
                  { published_at: new Date() },
                  { where: { id: context.payload.id } }
                );
              }
            },
          },
        },
      };

      await Article.sync({ force: true });

      // Create test data
      await Article.create({ slug: 'published-article', title: 'Published Article', status: 'published' });
      await Article.create({ slug: 'draft-article', title: 'Draft Article', status: 'draft' });

      const app = express();
      app.use(bodyParser.json());

      // Public API
      app.use('/api/articles', list(Article, { apialize_context: 'public' }));
      app.use('/api/articles', single(Article, { apialize_context: 'public' }));

      // Admin API
      app.use('/admin/articles', list(Article, { apialize_context: 'admin' }));
      app.use('/admin/articles', single(Article, { apialize_context: 'admin' }));
      app.use('/admin/articles', create(Article, { apialize_context: 'admin' }));

      // Public list should only show published
      const publicListRes = await request(app).get('/api/articles');
      expect(publicListRes.status).toBe(200);
      expect(publicListRes.body.data.length).toBe(1);
      expect(publicListRes.body.data[0].title).toBe('Published Article');

      // Admin list should show all
      const adminListRes = await request(app).get('/admin/articles');
      expect(adminListRes.status).toBe(200);
      expect(adminListRes.body.data.length).toBe(2);

      // Public single should only show published
      const publicSingleRes = await request(app).get('/api/articles/published-article');
      expect(publicSingleRes.status).toBe(200);

      const publicDraftRes = await request(app).get('/api/articles/draft-article');
      expect(publicDraftRes.status).toBe(404);

      // Admin single should show all
      const adminDraftRes = await request(app).get('/admin/articles/draft-article');
      expect(adminDraftRes.status).toBe(200);
    });
  });

  describe('Complete Example - Different API Versions', () => {
    test('should support different API versions with different configurations', async () => {
      const User = sequelize.define(
        'User',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          uuid: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4 },
          username: { type: DataTypes.STRING(50), unique: true },
          email: { type: DataTypes.STRING(100) },
        },
        {
          tableName: 'users_api_versions',
          timestamps: false,
          apialize: {
            single: {
              v1: {
                id_mapping: 'username',
                param_name: 'username',
              },
              v2: {
                id_mapping: 'uuid',
                param_name: 'uuid',
              },
            },
            list: {
              v1: {
                default_page_size: 20,
              },
              v2: {
                default_page_size: 50,
                meta_show_ordering: true,
              },
            },
          },
        }
      );

      await User.sync({ force: true });

      // Create test user
      const user = await User.create({
        username: 'john_doe',
        email: 'john@example.com',
      });

      const app = express();
      app.use(bodyParser.json());

      // API v1
      app.use('/v1/users', list(User, { apialize_context: 'v1' }));
      app.use('/v1/users', single(User, { apialize_context: 'v1' }));

      // API v2
      app.use('/v2/users', list(User, { apialize_context: 'v2' }));
      app.use('/v2/users', single(User, { apialize_context: 'v2' }));

      // Test v1 single with username
      const v1SingleRes = await request(app).get('/v1/users/john_doe');
      expect(v1SingleRes.status).toBe(200);
      expect(v1SingleRes.body.record.id).toBe('john_doe');

      // Test v2 single with uuid
      const v2SingleRes = await request(app).get(`/v2/users/${user.uuid}`);
      expect(v2SingleRes.status).toBe(200);
      expect(v2SingleRes.body.record.id).toBe(user.uuid);

      // Test v2 list has meta_show_ordering
      const v2ListRes = await request(app).get('/v2/users');
      expect(v2ListRes.status).toBe(200);
      expect(v2ListRes.body.meta).toBeDefined();
      expect(v2ListRes.body.meta.ordering).toBeDefined();
    });
  });

  describe('Overriding Model Configuration', () => {
    test('should allow user-provided options to override model config', async () => {
      const Product = sequelize.define(
        'Product',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          sku: { type: DataTypes.STRING(50), unique: true },
          name: { type: DataTypes.STRING(100) },
          status: { type: DataTypes.STRING(20) },
        },
        {
          tableName: 'products_override',
          timestamps: false,
          apialize: {
            list: {
              default: {
                default_page_size: 50,
                filterable_fields: ['status'],
              },
            },
          },
        }
      );

      await Product.sync({ force: true });

      // Create 100 test products
      for (let i = 1; i <= 100; i++) {
        await Product.create({
          sku: `SKU-${String(i).padStart(3, '0')}`,
          name: `Product ${i}`,
          status: 'active',
        });
      }

      const app = express();
      app.use(bodyParser.json());

      // Override the default page size for this specific endpoint
      app.use('/products/large', list(Product, {
        default_page_size: 200, // Overrides model config
      }));

      // Use model defaults
      app.use('/products', list(Product));

      // Test with model defaults (50)
      const defaultRes = await request(app).get('/products');
      expect(defaultRes.status).toBe(200);
      expect(defaultRes.body.data.length).toBe(50);

      // Test with override (200, but only 100 exist)
      const overrideRes = await request(app).get('/products/large');
      expect(overrideRes.status).toBe(200);
      expect(overrideRes.body.data.length).toBe(100);
    });
  });
});
