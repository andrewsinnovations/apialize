/**
 * Documentation Examples Test: aliasing.md
 *
 * This test file validates that the code examples in documentation/aliasing.md
 * work as expected and produce the documented outputs.
 */

const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list, search, single, create, update, patch } = require('../src');

describe('Documentation Examples: aliasing.md', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  // Helper to build app with Person model (matches documentation examples)
  async function buildPersonApp() {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    const Person = sequelize.define(
      'Person',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        person_name: { type: DataTypes.STRING(100), allowNull: false },
        person_age: { type: DataTypes.INTEGER, allowNull: true },
        person_email: { type: DataTypes.STRING(100), allowNull: true },
        active: { type: DataTypes.BOOLEAN, defaultValue: true },
      },
      { tableName: 'doc_aliasing_persons', timestamps: false }
    );

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());

    return { Person, app };
  }

  // Helper to build app with User model (for cleaner API names example)
  async function buildUserApp() {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    const User = sequelize.define(
      'User',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        user_first_name: { type: DataTypes.STRING(100), allowNull: false },
        user_last_name: { type: DataTypes.STRING(100), allowNull: false },
        user_email_address: { type: DataTypes.STRING(100), allowNull: true },
      },
      { tableName: 'doc_aliasing_users', timestamps: false }
    );

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());

    return { User, app };
  }

  // Helper to build app with Person and Address models (for flattening example)
  async function buildPersonWithAddressApp() {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    const Person = sequelize.define(
      'Person',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        person_name: { type: DataTypes.STRING(100), allowNull: false },
      },
      { tableName: 'doc_aliasing_persons_flat', timestamps: false }
    );

    const Address = sequelize.define(
      'Address',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        person_id: { type: DataTypes.INTEGER, allowNull: false },
        city: { type: DataTypes.STRING(100), allowNull: true },
      },
      { tableName: 'doc_aliasing_addresses', timestamps: false }
    );

    Person.hasOne(Address, { foreignKey: 'person_id', as: 'Address' });
    Address.belongsTo(Person, { foreignKey: 'person_id', as: 'Person' });

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());

    return { Person, Address, app };
  }

  async function seedPersons(Person) {
    await Person.bulkCreate([
      {
        person_name: 'John Doe',
        person_age: 30,
        person_email: 'john@example.com',
        active: true,
      },
      {
        person_name: 'Jane Smith',
        person_age: 25,
        person_email: 'jane@example.com',
        active: true,
      },
      {
        person_name: 'Bob Johnson',
        person_age: 35,
        person_email: 'bob@example.com',
        active: false,
      },
    ]);
  }

  describe('Basic Usage', () => {
    // Documentation: "Database column: person_name → API field: name"
    test('aliases map database columns to API field names', async () => {
      const { Person, app } = await buildPersonApp();
      await seedPersons(Person);

      const aliases = {
        name: 'person_name',
        age: 'person_age',
        email: 'person_email',
      };

      app.use('/persons', list(Person, { aliases }));

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);
      // Response uses aliased names
      expect(res.body.data[0]).toHaveProperty('name');
      expect(res.body.data[0]).toHaveProperty('age');
      expect(res.body.data[0]).toHaveProperty('email');
      // Database column names are not exposed
      expect(res.body.data[0]).not.toHaveProperty('person_name');
      expect(res.body.data[0]).not.toHaveProperty('person_age');
      expect(res.body.data[0]).not.toHaveProperty('person_email');
    });
  });

  describe('How It Works', () => {
    describe('Request Transformation (Input)', () => {
      // Documentation: "Client sends: { 'name': 'John Doe', 'age': 30 }
      // Transformed to: { 'person_name': 'John Doe', 'person_age': 30 }"
      test('transforms external names to internal names on create', async () => {
        const { Person, app } = await buildPersonApp();

        const aliases = {
          name: 'person_name',
          age: 'person_age',
        };

        app.use('/persons', create(Person, { aliases }));

        const res = await request(app).post('/persons').send({
          name: 'John Doe',
          age: 30,
        });

        expect(res.status).toBe(201);

        // Verify data was stored with internal column names
        const created = await Person.findByPk(res.body.id);
        expect(created.person_name).toBe('John Doe');
        expect(created.person_age).toBe(30);
      });
    });

    describe('Response Transformation (Output)', () => {
      // Documentation: "Database returns: { 'person_name': 'John Doe', 'person_age': 30 }
      // Transformed to: { 'name': 'John Doe', 'age': 30 }"
      test('transforms internal names to external names in response', async () => {
        const { Person, app } = await buildPersonApp();

        await Person.create({ person_name: 'John Doe', person_age: 30 });

        const aliases = {
          name: 'person_name',
          age: 'person_age',
        };

        app.use('/persons', single(Person, { aliases }));

        const res = await request(app).get('/persons/1');

        expect(res.status).toBe(200);
        expect(res.body.record).toHaveProperty('name', 'John Doe');
        expect(res.body.record).toHaveProperty('age', 30);
        expect(res.body.record).not.toHaveProperty('person_name');
        expect(res.body.record).not.toHaveProperty('person_age');
      });
    });

    describe('Query Parameter Transformation', () => {
      // Documentation: "GET /persons?name=John Doe
      // Translates to: WHERE person_name = 'John Doe'"
      test('transforms query parameters from external to internal names', async () => {
        const { Person, app } = await buildPersonApp();
        await seedPersons(Person);

        const aliases = {
          name: 'person_name',
          age: 'person_age',
        };

        app.use('/persons', list(Person, { aliases }));

        const res = await request(app).get('/persons?name=John Doe');

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].name).toBe('John Doe');
      });
    });
  });

  describe('Use Cases', () => {
    describe('1. Cleaner API Names', () => {
      // Documentation: Convert database naming conventions to clean simple names
      test('converts snake_case with prefixes to clean names', async () => {
        const { User, app } = await buildUserApp();

        await User.create({
          user_first_name: 'John',
          user_last_name: 'Doe',
          user_email_address: 'john@example.com',
        });

        const aliases = {
          firstName: 'user_first_name',
          lastName: 'user_last_name',
          email: 'user_email_address',
        };

        app.use('/users', list(User, { aliases }));

        const res = await request(app).get('/users?firstName=John');

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toHaveProperty('firstName', 'John');
        expect(res.body.data[0]).toHaveProperty('lastName', 'Doe');
        expect(res.body.data[0]).toHaveProperty('email', 'john@example.com');
        expect(res.body.data[0]).not.toHaveProperty('user_first_name');
        expect(res.body.data[0]).not.toHaveProperty('user_last_name');
        expect(res.body.data[0]).not.toHaveProperty('user_email_address');
      });
    });

    describe('2. Hiding Implementation Details', () => {
      // Documentation: Expose logical names without revealing database structure
      test('hides implementation details with logical names', async () => {
        const { Person, app } = await buildPersonApp();

        await Person.create({
          person_name: 'Test User',
          person_age: 30,
          active: true,
        });

        const aliases = {
          status: 'active',
          createdAt: 'person_age', // Using person_age as stand-in for timestamp
        };

        app.use('/persons', list(Person, { aliases }));

        const res = await request(app).get('/persons');

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        // Logical names are exposed
        expect(res.body.data[0]).toHaveProperty('status', true);
        expect(res.body.data[0]).toHaveProperty('createdAt', 30);
        // Internal names are hidden
        expect(res.body.data[0]).not.toHaveProperty('active');
        expect(res.body.data[0]).not.toHaveProperty('person_age');
      });
    });

    describe('3. Backward Compatibility', () => {
      // Documentation: Keep API using 'title' for backward compatibility when column renamed to 'person_name'
      test('maintains old API field names when database columns change', async () => {
        const { Person, app } = await buildPersonApp();

        await Person.create({ person_name: 'My Title' });

        // Column was renamed from 'title' to 'name' in database
        // Keep API using 'title' for backward compatibility
        const aliases = {
          title: 'person_name',
        };

        app.use('/persons', list(Person, { aliases }));

        const res = await request(app).get('/persons?title=My Title');

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toHaveProperty('title', 'My Title');
      });
    });

    describe('4. ID Field Aliasing', () => {
      // Documentation: Alias the ID field to expose a different primary key
      test('aliases the ID field with default_order_by', async () => {
        const { Person, app } = await buildPersonApp();
        await seedPersons(Person);

        const aliases = {
          personId: 'id',
        };

        app.use(
          '/persons',
          list(Person, {
            aliases,
            id_mapping: 'id',
            default_order_by: 'personId',
          })
        );

        const res = await request(app).get('/persons');

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(3);
        // Verify id is aliased to personId
        expect(res.body.data[0]).toHaveProperty('personId');
        expect(res.body.data[0]).not.toHaveProperty('id');
        // Verify ordering by personId works
        expect(res.body.data[0].personId).toBe(1);
        expect(res.body.data[1].personId).toBe(2);
        expect(res.body.data[2].personId).toBe(3);
      });
    });
  });

  describe('Integration with Other Features', () => {
    describe('With Filtering Options', () => {
      // Documentation: use external alias names with allow_filtering_on/block_filtering_on
      test('allow_filtering_on uses external alias names', async () => {
        const { Person, app } = await buildPersonApp();
        await seedPersons(Person);

        const aliases = {
          name: 'person_name',
          age: 'person_age',
          email: 'person_email',
        };

        app.use(
          '/persons',
          list(Person, {
            aliases,
            allow_filtering_on: ['name', 'age'],
          })
        );

        // Filtering by allowed 'name' field works
        const res1 = await request(app).get('/persons?name=John Doe');
        expect(res1.status).toBe(200);
        expect(res1.body.data).toHaveLength(1);

        // Filtering by non-allowed 'email' field is blocked
        const res2 = await request(app).get('/persons?email=john@example.com');
        expect(res2.status).toBe(400);
      });

      test('block_filtering_on uses external alias names', async () => {
        const { Person, app } = await buildPersonApp();
        await seedPersons(Person);

        const aliases = {
          name: 'person_name',
          age: 'person_age',
          email: 'person_email',
        };

        app.use(
          '/persons',
          list(Person, {
            aliases,
            block_filtering_on: ['email'],
          })
        );

        // Filtering by blocked 'email' field returns 400
        const res = await request(app).get('/persons?email=john@example.com');
        expect(res.status).toBe(400);
      });
    });

    describe('With Ordering Options', () => {
      // Documentation: use external names with allow_ordering_on/block_ordering_on/default_order_by
      test('allow_ordering_on uses external alias names', async () => {
        const { Person, app } = await buildPersonApp();
        await seedPersons(Person);

        const aliases = {
          name: 'person_name',
          age: 'person_age',
        };

        app.use(
          '/persons',
          list(Person, {
            aliases,
            allow_ordering_on: ['name', 'age'],
          })
        );

        // Ordering by allowed 'name' field works
        const res1 = await request(app).get('/persons?api:order_by=name');
        expect(res1.status).toBe(200);

        // Ordering by non-allowed field is blocked
        const res2 = await request(app).get('/persons?api:order_by=email');
        expect(res2.status).toBe(400);
      });

      test('default_order_by uses external alias name', async () => {
        const { Person, app } = await buildPersonApp();
        await seedPersons(Person);

        const aliases = {
          name: 'person_name',
          age: 'person_age',
        };

        app.use(
          '/persons',
          list(Person, {
            aliases,
            default_order_by: 'age',
          })
        );

        const res = await request(app).get('/persons');

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(3);
        // Ordered by age ASC (default direction)
        expect(res.body.data[0].age).toBe(25);
        expect(res.body.data[1].age).toBe(30);
        expect(res.body.data[2].age).toBe(35);
      });
    });

    describe('With Field Control Options', () => {
      // Documentation: allowed_fields and blocked_fields use external names
      test('allowed_fields uses external alias names in create', async () => {
        const { Person, app } = await buildPersonApp();

        const aliases = {
          name: 'person_name',
          age: 'person_age',
          email: 'person_email',
        };

        app.use(
          '/persons',
          create(Person, {
            aliases,
            allowed_fields: ['name', 'age'],
          })
        );

        // Creating with allowed fields works
        const res1 = await request(app).post('/persons').send({
          name: 'Alice',
          age: 28,
        });
        expect(res1.status).toBe(201);

        // Creating with non-allowed 'email' field is blocked
        const res2 = await request(app).post('/persons').send({
          name: 'Bob',
          email: 'bob@example.com',
        });
        expect(res2.status).toBe(400);
      });

      test('blocked_fields uses external alias names in create', async () => {
        const { Person, app } = await buildPersonApp();

        const aliases = {
          name: 'person_name',
          age: 'person_age',
          email: 'person_email',
        };

        app.use(
          '/persons',
          create(Person, {
            aliases,
            blocked_fields: ['email'],
          })
        );

        // Creating with blocked 'email' field returns 400
        const res = await request(app).post('/persons').send({
          name: 'Test User',
          email: 'test@example.com',
        });
        expect(res.status).toBe(400);
      });
    });

    describe('With Flattening', () => {
      // Documentation: Field aliases work alongside flattening without interference
      test('aliases work alongside flattening', async () => {
        const { Person, Address, app } = await buildPersonWithAddressApp();

        const person = await Person.create({ person_name: 'John Doe' });
        await Address.create({ person_id: person.id, city: 'New York' });

        const aliases = {
          name: 'person_name',
        };

        const flattening = {
          model: Address,
          as: 'Address',
          attributes: [['city', 'address_city']],
        };

        app.use(
          '/persons',
          list(Person, {
            aliases,
            flattening,
          })
        );

        const res = await request(app).get('/persons');

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        // Aliased field
        expect(res.body.data[0]).toHaveProperty('name', 'John Doe');
        expect(res.body.data[0]).not.toHaveProperty('person_name');
        // Flattened field
        expect(res.body.data[0]).toHaveProperty('address_city', 'New York');
        expect(res.body.data[0]).not.toHaveProperty('Address');
      });
    });
  });

  describe('Examples', () => {
    describe('List Operation', () => {
      // Documentation: GET /persons?name=John&age:gte=25&api:order_by=age
      test('list with filtering and ordering using aliased names', async () => {
        const { Person, app } = await buildPersonApp();
        await seedPersons(Person);

        const aliases = {
          name: 'person_name',
          age: 'person_age',
        };

        app.use('/persons', list(Person, { aliases }));

        const res = await request(app).get(
          '/persons?name:icontains=John&age:gte=25&api:order_by=age'
        );

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.length).toBeGreaterThanOrEqual(1);
        // Data uses external names
        expect(res.body.data[0]).toHaveProperty('name');
        expect(res.body.data[0]).toHaveProperty('age');
        // Meta contains paging info
        expect(res.body.meta).toHaveProperty('paging');
      });
    });

    describe('Search Operation', () => {
      // Documentation: POST /persons with filtering and ordering in body
      test('search with filtering and ordering using aliased names', async () => {
        const { Person, app } = await buildPersonApp();
        await seedPersons(Person);

        const aliases = {
          name: 'person_name',
          age: 'person_age',
        };

        app.use('/persons', search(Person, { aliases, path: '/' }));

        const res = await request(app)
          .post('/persons')
          .send({
            filtering: { name: 'Jane Smith' },
            ordering: [{ order_by: 'age', direction: 'DESC' }],
            paging: { page: 1, size: 10 },
          });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toHaveProperty('name', 'Jane Smith');
        expect(res.body.data[0]).toHaveProperty('age', 25);
      });

      test('search with operator filters using aliased names', async () => {
        const { Person, app } = await buildPersonApp();
        await seedPersons(Person);

        const aliases = {
          name: 'person_name',
          age: 'person_age',
        };

        app.use('/persons', search(Person, { aliases, path: '/' }));

        const res = await request(app)
          .post('/persons')
          .send({
            filtering: { age: { gte: 30 } },
            paging: { page: 1, size: 10 },
          });

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(2);
        expect(res.body.data.every((p) => p.age >= 30)).toBe(true);
      });
    });

    describe('Single Operation', () => {
      // Documentation: GET /persons/1 returns record with aliased names
      test('single returns record with aliased field names', async () => {
        const { Person, app } = await buildPersonApp();

        await Person.create({
          person_name: 'John Doe',
          person_age: 30,
          person_email: 'john@example.com',
        });

        const aliases = {
          name: 'person_name',
          age: 'person_age',
          email: 'person_email',
        };

        app.use('/persons', single(Person, { aliases }));

        const res = await request(app).get('/persons/1');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.record).toHaveProperty('name', 'John Doe');
        expect(res.body.record).toHaveProperty('age', 30);
        expect(res.body.record).toHaveProperty('email', 'john@example.com');
        expect(res.body.record).not.toHaveProperty('person_name');
        expect(res.body.record).not.toHaveProperty('person_age');
        expect(res.body.record).not.toHaveProperty('person_email');
      });
    });

    describe('Create Operation', () => {
      // Documentation: POST /persons with aliased field names
      test('create accepts aliased field names in request body', async () => {
        const { Person, app } = await buildPersonApp();

        const aliases = {
          name: 'person_name',
          age: 'person_age',
          email: 'person_email',
        };

        app.use('/persons', create(Person, { aliases }));

        const res = await request(app).post('/persons').send({
          name: 'Alice Cooper',
          age: 28,
          email: 'alice@example.com',
        });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.id).toBeDefined();

        // Verify data was stored with internal column names
        const created = await Person.findByPk(res.body.id);
        expect(created.person_name).toBe('Alice Cooper');
        expect(created.person_age).toBe(28);
        expect(created.person_email).toBe('alice@example.com');
      });
    });

    describe('Update Operation', () => {
      // Documentation: PUT /persons/1 with aliased field names
      test('update accepts aliased field names in request body', async () => {
        const { Person, app } = await buildPersonApp();

        const person = await Person.create({
          person_name: 'John Doe',
          person_age: 30,
          person_email: 'john@example.com',
        });

        const aliases = {
          name: 'person_name',
          age: 'person_age',
        };

        app.use('/persons', update(Person, { aliases }));

        const res = await request(app).put(`/persons/${person.id}`).send({
          name: 'John Updated',
          age: 31,
        });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        // Verify data was updated
        await person.reload();
        expect(person.person_name).toBe('John Updated');
        expect(person.person_age).toBe(31);
      });
    });

    describe('Patch Operation', () => {
      // Documentation: PATCH /persons/1 with aliased field names
      test('patch accepts aliased field names in request body', async () => {
        const { Person, app } = await buildPersonApp();

        const person = await Person.create({
          person_name: 'John Doe',
          person_age: 30,
          person_email: 'john@example.com',
        });

        const aliases = {
          name: 'person_name',
          age: 'person_age',
        };

        app.use('/persons', patch(Person, { aliases }));

        const res = await request(app).patch(`/persons/${person.id}`).send({
          age: 31,
        });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        // Verify only age was updated
        await person.reload();
        expect(person.person_name).toBe('John Doe'); // Unchanged
        expect(person.person_age).toBe(31); // Updated
      });
    });

    describe('Bulk Create with Aliases', () => {
      // Documentation: Bulk create with aliased field names
      test('bulk create accepts aliased field names', async () => {
        const { Person, app } = await buildPersonApp();

        const aliases = {
          name: 'person_name',
          age: 'person_age',
        };

        app.use('/persons', create(Person, { aliases, allow_bulk_create: true }));

        const res = await request(app)
          .post('/persons')
          .send([
            { name: 'Alice', age: 28 },
            { name: 'Bob', age: 32 },
          ]);

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.ids).toHaveLength(2);

        // Verify data was stored
        const count = await Person.count();
        expect(count).toBe(2);

        const alice = await Person.findByPk(res.body.ids[0]);
        expect(alice.person_name).toBe('Alice');
        expect(alice.person_age).toBe(28);
      });
    });
  });

  describe('Best Practices', () => {
    describe('4. Handle Unaliased Fields', () => {
      // Documentation: Fields without aliases are passed through unchanged
      test('unaliased fields pass through unchanged', async () => {
        const { Person, app } = await buildPersonApp();
        await seedPersons(Person);

        // Only 'name' is aliased; 'person_age' uses its column name directly
        const aliases = {
          name: 'person_name',
        };

        app.use('/persons', list(Person, { aliases }));

        // Filter by aliased name
        const res1 = await request(app).get('/persons?name=John Doe');
        expect(res1.status).toBe(200);
        expect(res1.body.data).toHaveLength(1);

        // Filter by unaliased column name directly
        const res2 = await request(app).get('/persons?person_age:gte=30');
        expect(res2.status).toBe(200);
        expect(res2.body.data).toHaveLength(2); // John Doe (30) and Bob Johnson (35)
      });
    });
  });

  describe('Consistency Across Operations', () => {
    // Documentation: Apply the same aliases across all operations for a resource
    test('same aliases work consistently across list, single, create, patch', async () => {
      const { Person, app } = await buildPersonApp();

      const personAliases = {
        name: 'person_name',
        age: 'person_age',
        email: 'person_email',
      };

      app.use('/persons', list(Person, { aliases: personAliases }));
      app.use('/persons', single(Person, { aliases: personAliases }));
      app.use('/persons', create(Person, { aliases: personAliases }));
      app.use('/persons', patch(Person, { aliases: personAliases }));

      // Create using aliased names
      const createRes = await request(app).post('/persons').send({
        name: 'Test User',
        age: 25,
        email: 'test@example.com',
      });
      expect(createRes.status).toBe(201);
      const id = createRes.body.id;

      // Single returns aliased names
      const singleRes = await request(app).get(`/persons/${id}`);
      expect(singleRes.status).toBe(200);
      expect(singleRes.body.record).toHaveProperty('name', 'Test User');
      expect(singleRes.body.record).toHaveProperty('age', 25);
      expect(singleRes.body.record).toHaveProperty('email', 'test@example.com');

      // List returns aliased names
      const listRes = await request(app).get('/persons?name=Test User');
      expect(listRes.status).toBe(200);
      expect(listRes.body.data).toHaveLength(1);
      expect(listRes.body.data[0]).toHaveProperty('name', 'Test User');

      // Patch using aliased names
      const patchRes = await request(app).patch(`/persons/${id}`).send({
        age: 26,
      });
      expect(patchRes.status).toBe(200);

      // Verify update was applied
      const verifyRes = await request(app).get(`/persons/${id}`);
      expect(verifyRes.body.record).toHaveProperty('age', 26);
    });
  });
});
