const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { single } = require('../src');

describe('Single Operation - Flattening Auto Include Creation', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  async function buildAppAndModels() {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    const Person = sequelize.define(
      'Person',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        external_id: { type: DataTypes.UUID, allowNull: true },
        login: { type: DataTypes.STRING, allowNull: false },
        active: { type: DataTypes.BOOLEAN, defaultValue: true },
      },
      {
        timestamps: false,
        tableName: 'persons',
      }
    );

    const PersonNames = sequelize.define(
      'PersonNames',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        person_id: { type: DataTypes.INTEGER, allowNull: false },
        first_name: { type: DataTypes.STRING, allowNull: true },
        last_name: { type: DataTypes.STRING, allowNull: true },
        age: { type: DataTypes.INTEGER, allowNull: true },
        is_preferred: { type: DataTypes.BOOLEAN, defaultValue: false },
      },
      {
        timestamps: false,
        tableName: 'person_names',
      }
    );

    const Address = sequelize.define(
      'Address',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        person_id: { type: DataTypes.INTEGER, allowNull: false },
        street: { type: DataTypes.STRING, allowNull: true },
        city: { type: DataTypes.STRING, allowNull: true },
        zip: { type: DataTypes.STRING, allowNull: true },
      },
      {
        timestamps: false,
        tableName: 'addresses',
      }
    );

    // Associations
    Person.hasOne(PersonNames, { foreignKey: 'person_id', as: 'Name' });
    PersonNames.belongsTo(Person, { foreignKey: 'person_id', as: 'Person' });

    Person.hasOne(Address, { foreignKey: 'person_id', as: 'Address' });
    Address.belongsTo(Person, { foreignKey: 'person_id', as: 'Person' });

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());

    return { sequelize, Person, PersonNames, Address, app };
  }

  async function seedData(Person, PersonNames, Address) {
    const person1 = await Person.create({
      external_id: 'person-123',
      login: 'john.doe@example.com',
      active: true,
    });

    const person2 = await Person.create({
      external_id: 'person-456',
      login: 'jane.smith@example.com',
      active: true,
    });

    await PersonNames.create({
      person_id: person1.id,
      first_name: 'John',
      last_name: 'Doe',
      age: 30,
      is_preferred: true,
    });

    await PersonNames.create({
      person_id: person2.id,
      first_name: 'Jane',
      last_name: 'Smith',
      age: 25,
      is_preferred: false,
    });

    await Address.create({
      person_id: person1.id,
      street: '123 Main St',
      city: 'Springfield',
      zip: '12345',
    });

    await Address.create({
      person_id: person2.id,
      street: '456 Oak Ave',
      city: 'Portland',
      zip: '67890',
    });

    return { person1, person2 };
  }

  describe('Basic Auto-Include Creation', () => {
    test('creates include automatically when not explicitly provided', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, Address, app } = ctx;
      const { person1 } = await seedData(Person, PersonNames, Address);

      // Notice: No include specified in modelOptions, only in flattening config
      app.use(
        '/persons',
        single(
          Person,
          {
            flattening: {
              model: PersonNames,
              as: 'Name',
              attributes: ['first_name', 'last_name'],
            },
          },
          {} // Empty modelOptions - no include specified
        )
      );

      const res = await request(app).get(`/persons/${person1.id}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.record).toBeDefined();

      const record = res.body.record;
      expect(record.first_name).toBe('John');
      expect(record.last_name).toBe('Doe');
      expect(record.Name).toBeUndefined(); // Should be removed after flattening
      expect(record.login).toBe('john.doe@example.com'); // Original fields should remain
    });

    test('auto-created include works with id_mapping', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, Address, app } = ctx;
      const { person1 } = await seedData(Person, PersonNames, Address);

      app.use(
        '/persons',
        single(Person, {
          id_mapping: 'external_id',
          flattening: {
            model: PersonNames,
            as: 'Name',
            attributes: ['first_name', 'last_name'],
          },
        })
      );

      const res = await request(app).get('/persons/person-123');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.record.id).toBe('person-123'); // Should use external_id
      expect(res.body.record.first_name).toBe('John');
      expect(res.body.record.last_name).toBe('Doe');
    });

    test('auto-created include with aliased attributes', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, Address, app } = ctx;
      const { person1 } = await seedData(Person, PersonNames, Address);

      app.use(
        '/persons',
        single(Person, {
          flattening: {
            model: PersonNames,
            as: 'Name',
            attributes: [
              'first_name',
              ['last_name', 'surname'],
              ['age', 'person_age'],
            ],
          },
        })
      );

      const res = await request(app).get(`/persons/${person1.id}`);

      expect(res.status).toBe(200);
      expect(res.body.record.first_name).toBe('John');
      expect(res.body.record.surname).toBe('Doe');
      expect(res.body.record.person_age).toBe(30);
      expect(res.body.record.last_name).toBeUndefined();
      expect(res.body.record.age).toBeUndefined();
      expect(res.body.record.Name).toBeUndefined();
    });

    test('respects explicit include when provided alongside flattening', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, Address, app } = ctx;
      const { person1, person2 } = await seedData(Person, PersonNames, Address);

      // With explicit include that has additional options
      app.use(
        '/persons',
        single(
          Person,
          {
            flattening: {
              model: PersonNames,
              as: 'Name',
              attributes: ['first_name', 'last_name'],
            },
          },
          {
            include: [
              {
                model: PersonNames,
                as: 'Name',
                required: false, // Use required: false so record is returned even if Name doesn't match
                where: { is_preferred: true }, // Additional filter
              },
            ],
          }
        )
      );

      // person1 has preferred name, should work
      const res1 = await request(app).get(`/persons/${person1.id}`);
      expect(res1.status).toBe(200);
      expect(res1.body.record.first_name).toBe('John');

      // person2 does not have preferred name, should return person but without name fields
      const res2 = await request(app).get(`/persons/${person2.id}`);
      expect(res2.status).toBe(200);
      expect(res2.body.record.login).toBe('jane.smith@example.com');
      expect(res2.body.record.first_name).toBeUndefined(); // No name matched the filter
      expect(res2.body.record.last_name).toBeUndefined();
    });

    test('auto-created include with custom required option', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, Address, app } = ctx;

      // Create person without name
      const person3 = await Person.create({
        external_id: 'person-999',
        login: 'no.name@example.com',
        active: true,
      });

      app.use(
        '/persons',
        single(Person, {
          flattening: {
            model: PersonNames,
            as: 'Name',
            attributes: ['first_name'],
            required: false, // Should include persons without names
          },
        })
      );

      const res = await request(app).get(`/persons/${person3.id}`);

      expect(res.status).toBe(200);
      expect(res.body.record.login).toBe('no.name@example.com');
      expect(res.body.record.first_name).toBeUndefined();
    });
  });

  describe('Multiple Flattening Configs', () => {
    test('auto-creates includes for array of flattening configs', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, Address, app } = ctx;
      const { person1 } = await seedData(Person, PersonNames, Address);

      app.use(
        '/persons',
        single(Person, {
          flattening: [
            {
              model: PersonNames,
              as: 'Name',
              attributes: ['first_name', 'last_name'],
            },
            {
              model: Address,
              as: 'Address',
              attributes: ['street', 'city'],
            },
          ],
        })
      );

      const res = await request(app).get(`/persons/${person1.id}`);

      expect(res.status).toBe(200);
      expect(res.body.record.first_name).toBe('John');
      expect(res.body.record.last_name).toBe('Doe');
      expect(res.body.record.street).toBe('123 Main St');
      expect(res.body.record.city).toBe('Springfield');
      expect(res.body.record.Name).toBeUndefined();
      expect(res.body.record.Address).toBeUndefined();
    });

    test('combines auto-created includes with existing includes', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, Address, app } = ctx;
      const { person1 } = await seedData(Person, PersonNames, Address);

      app.use(
        '/persons',
        single(
          Person,
          {
            flattening: [
              {
                model: PersonNames,
                as: 'Name',
                attributes: ['first_name'],
              },
              {
                model: Address,
                as: 'Address',
                attributes: ['city'],
              },
            ],
          },
          {
            include: [
              {
                model: PersonNames,
                as: 'Name',
                required: true,
              },
            ],
          }
        )
      );

      const res = await request(app).get(`/persons/${person1.id}`);

      expect(res.status).toBe(200);
      expect(res.body.record.first_name).toBe('John');
      expect(res.body.record.city).toBe('Springfield');
    });
  });

  describe('Error Handling', () => {
    test('returns 400 when flattening model does not match include', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, Address, app } = ctx;
      const { person1 } = await seedData(Person, PersonNames, Address);

      app.use(
        '/persons',
        single(
          Person,
          {
            flattening: {
              model: Address, // Wrong model
              as: 'Name',
              attributes: ['first_name'],
            },
          },
          {
            include: [{ model: PersonNames, as: 'Name', required: true }],
          }
        )
      );

      const res = await request(app).get(`/persons/${person1.id}`);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('returns 404 when record not found with auto-created include', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, Address, app } = ctx;
      await seedData(Person, PersonNames, Address);

      app.use(
        '/persons',
        single(Person, {
          flattening: {
            model: PersonNames,
            as: 'Name',
            attributes: ['first_name'],
          },
        })
      );

      const res = await request(app).get('/persons/99999');
      expect(res.status).toBe(404);
    });
  });

  describe('Integration with Model Scope', () => {
    test('combines auto-created include with model scope includes', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, Address, app } = ctx;
      const { person1 } = await seedData(Person, PersonNames, Address);

      // Create a scoped model with existing includes
      const PersonWithScope = Person.scope({
        include: [
          {
            model: Address,
            as: 'Address',
            required: false,
          },
        ],
      });

      app.use(
        '/persons',
        single(PersonWithScope, {
          flattening: {
            model: PersonNames,
            as: 'Name',
            attributes: ['first_name', 'last_name'],
          },
        })
      );

      const res = await request(app).get(`/persons/${person1.id}`);

      expect(res.status).toBe(200);
      expect(res.body.record.first_name).toBe('John'); // From auto-created include
      expect(res.body.record.last_name).toBe('Doe'); // From auto-created include
      expect(res.body.record.Address).toBeDefined(); // From scope include (not flattened)
      expect(res.body.record.Address.city).toBe('Springfield');
    });

    test('auto-created include works with model scope where clause', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, Address, app } = ctx;
      await seedData(Person, PersonNames, Address);

      // Create a scoped model with where clause
      const ActivePersons = Person.scope({
        where: { active: true },
      });

      app.use(
        '/persons',
        single(ActivePersons, {
          flattening: {
            model: PersonNames,
            as: 'Name',
            attributes: ['first_name'],
          },
        })
      );

      // Should find active person
      const res = await request(app).get('/persons/1');
      expect(res.status).toBe(200);
      expect(res.body.record.first_name).toBe('John');
    });
  });

  describe('Advanced Flattening Features', () => {
    test('auto-created include with nested attributes', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, Address, app } = ctx;
      const { person1 } = await seedData(Person, PersonNames, Address);

      app.use(
        '/persons',
        single(Person, {
          flattening: {
            model: PersonNames,
            as: 'Name',
            attributes: ['first_name', 'last_name', 'age', 'is_preferred'],
          },
        })
      );

      const res = await request(app).get(`/persons/${person1.id}`);

      expect(res.status).toBe(200);
      expect(res.body.record.first_name).toBe('John');
      expect(res.body.record.last_name).toBe('Doe');
      expect(res.body.record.age).toBe(30);
      expect(res.body.record.is_preferred).toBe(true);
    });

    test('validates flattening config before query execution', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, Address, app } = ctx;
      const { person1 } = await seedData(Person, PersonNames, Address);

      // Invalid flattening config (missing required fields)
      app.use(
        '/persons',
        single(Person, {
          flattening: {
            // Missing 'as' field
            model: PersonNames,
            attributes: ['first_name'],
          },
        })
      );

      const res = await request(app).get(`/persons/${person1.id}`);
      expect(res.status).toBe(400);
    });
  });

  describe('Compatibility with Existing Tests', () => {
    test('works without flattening config (backwards compatible)', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, Address, app } = ctx;
      const { person1 } = await seedData(Person, PersonNames, Address);

      app.use('/persons', single(Person));

      const res = await request(app).get(`/persons/${person1.id}`);

      expect(res.status).toBe(200);
      expect(res.body.record.login).toBe('john.doe@example.com');
      expect(res.body.record.Name).toBeUndefined(); // No include, so no relation data
    });

    test('works with manual include without flattening', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, Address, app } = ctx;
      const { person1 } = await seedData(Person, PersonNames, Address);

      app.use(
        '/persons',
        single(
          Person,
          {},
          {
            include: [{ model: PersonNames, as: 'Name' }],
          }
        )
      );

      const res = await request(app).get(`/persons/${person1.id}`);

      expect(res.status).toBe(200);
      expect(res.body.record.Name).toBeDefined(); // Should have nested object
      expect(res.body.record.Name.first_name).toBe('John');
    });
  });
});
