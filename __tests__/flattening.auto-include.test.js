const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list, search } = require('../src');

describe('Response Flattening - Auto Include Creation', () => {
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

    // Associations
    Person.hasMany(PersonNames, { foreignKey: 'person_id', as: 'Names' });
    PersonNames.belongsTo(Person, { foreignKey: 'person_id', as: 'Person' });

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());

    return { sequelize, Person, PersonNames, app };
  }

  async function seedData(Person, PersonNames) {
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

    const person3 = await Person.create({
      external_id: 'person-789',
      login: 'bob.johnson@example.com',
      active: false,
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

    await PersonNames.create({
      person_id: person3.id,
      first_name: 'Bob',
      last_name: 'Johnson',
      age: 35,
      is_preferred: true,
    });

    return { person1, person2, person3 };
  }

  describe('Auto-create include from flattening config', () => {
    test('creates include automatically when not explicitly provided', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames);

      // Notice: No include specified in modelOptions, only in flattening config
      app.use(
        '/persons',
        list(
          Person,
          {
            flattening: {
              model: PersonNames,
              as: 'Names',
              attributes: ['first_name', 'last_name'],
            },
          },
          {} // Empty modelOptions - no include specified
        )
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);

      const firstPerson = res.body.data[0];
      expect(firstPerson.first_name).toBeDefined();
      expect(firstPerson.last_name).toBeDefined();
      expect(firstPerson.Names).toBeUndefined(); // Should be removed after flattening
      expect(firstPerson.login).toBeDefined(); // Original fields should remain
    });

    test('auto-created include works with filtering', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames);

      app.use(
        '/persons',
        list(
          Person,
          {
            flattening: {
              model: PersonNames,
              as: 'Names',
              attributes: ['first_name', 'last_name'],
            },
          },
          {} // No explicit include
        )
      );

      const res = await request(app).get('/persons?first_name=John');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].first_name).toBe('John');
      expect(res.body.data[0].last_name).toBe('Doe');
    });

    test('auto-created include works with ordering', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames);

      app.use(
        '/persons',
        list(
          Person,
          {
            flattening: {
              model: PersonNames,
              as: 'Names',
              attributes: ['first_name', 'last_name'],
            },
          },
          {} // No explicit include
        )
      );

      const res = await request(app).get('/persons?api:order_by=last_name');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data[0].last_name).toBe('Doe');
      expect(res.body.data[1].last_name).toBe('Johnson');
      expect(res.body.data[2].last_name).toBe('Smith');
    });

    test('auto-created include with aliased attributes', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames);

      app.use(
        '/persons',
        list(
          Person,
          {
            flattening: {
              model: PersonNames,
              as: 'Names',
              attributes: [
                'first_name',
                ['last_name', 'surname'],
                ['age', 'person_age'],
              ],
            },
          }
          // No modelOptions with include
        )
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);

      const firstPerson = res.body.data[0];
      expect(firstPerson.first_name).toBeDefined();
      expect(firstPerson.surname).toBeDefined();
      expect(firstPerson.person_age).toBeDefined();
      expect(firstPerson.last_name).toBeUndefined();
      expect(firstPerson.age).toBeUndefined();
      expect(firstPerson.Names).toBeUndefined();
    });

    test('respects explicit include when provided alongside flattening', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames);

      // With explicit include that has additional options
      app.use(
        '/persons',
        list(
          Person,
          {
            flattening: {
              model: PersonNames,
              as: 'Names',
              attributes: ['first_name', 'last_name'],
            },
          },
          {
            include: [
              {
                model: PersonNames,
                as: 'Names',
                required: true,
                where: { is_preferred: true }, // Additional filter
              },
            ],
          }
        )
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      // Should only return people with preferred names
      expect(res.body.data).toHaveLength(2); // John and Bob have preferred names
      expect(res.body.data[0].first_name).toBeDefined();
      expect(res.body.data[0].last_name).toBeDefined();
    });

    test('auto-created include works with search endpoint', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames);

      app.use(
        '/persons/search',
        search(
          Person,
          {
            path: '/',
            flattening: {
              model: PersonNames,
              as: 'Names',
              attributes: ['first_name', ['last_name', 'surname']],
            },
          }
          // No modelOptions with include
        )
      );

      const res = await request(app)
        .post('/persons/search')
        .send({
          filtering: {
            first_name: { icontains: 'jo' },
          },
          ordering: [{ order_by: 'surname', direction: 'ASC' }],
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].surname).toBe('Doe');
    });

    test('auto-created include with custom required option', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;

      // Create persons without names
      await Person.create({
        external_id: 'person-999',
        login: 'no.name@example.com',
        active: true,
      });

      await seedData(Person, PersonNames);

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name'],
            required: false, // Should include persons without names
          },
        })
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(4); // All 4 persons including one without names

      // Find the person without names
      const personWithoutNames = res.body.data.find(
        (p) => p.login === 'no.name@example.com'
      );
      expect(personWithoutNames).toBeDefined();
      expect(personWithoutNames.first_name).toBeUndefined();
    });

    test('validates flattening model matches when include exists', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames);

      // Create a different model for testing
      const OtherModel = sequelize.define('OtherModel', {
        name: DataTypes.STRING,
      });

      app.use(
        '/persons',
        list(
          Person,
          {
            flattening: {
              model: OtherModel, // Wrong model
              as: 'Names',
              attributes: ['first_name'],
            },
          },
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      const res = await request(app).get('/persons');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Advanced Auto-Include Features', () => {
    test('auto-created include supports complex filtering operators', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames);

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name', 'age'],
          },
        })
      );

      // Test range filtering
      const res = await request(app).get('/persons?age:gte=30');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2); // John (30) and Bob (35)
    });

    test('auto-created include with id_mapping', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames);

      app.use(
        '/persons',
        list(Person, {
          id_mapping: 'external_id',
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name', 'last_name'],
          },
        })
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data[0].id).toBe('person-123'); // Should use external_id
      expect(res.body.data[0].first_name).toBeDefined();
    });

    test('auto-created include with pagination', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames);

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name'],
          },
        })
      );

      const res = await request(app).get('/persons?api:page=1&api:page_size=2');

      expect(res.status).toBe(200);
      expect(res.body.meta.paging.count).toBe(3);
      expect(res.body.meta.paging.page).toBe(1);
      expect(res.body.meta.paging.size).toBe(2);
      expect(res.body.data).toHaveLength(2);
    });
  });
});
