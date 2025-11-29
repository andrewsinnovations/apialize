const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes, Op } = require('sequelize');
const { list, search } = require('../src');

describe('Response Flattening - Full Include Options Support', () => {
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
        is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
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
        person_name_id: { type: DataTypes.INTEGER, allowNull: false },
        street: { type: DataTypes.STRING, allowNull: true },
        city: { type: DataTypes.STRING, allowNull: true },
      },
      {
        timestamps: false,
        tableName: 'addresses',
      }
    );

    // Associations
    Person.hasMany(PersonNames, { foreignKey: 'person_id', as: 'Names' });
    PersonNames.belongsTo(Person, { foreignKey: 'person_id', as: 'Person' });
    PersonNames.hasMany(Address, {
      foreignKey: 'person_name_id',
      as: 'Addresses',
    });
    Address.belongsTo(PersonNames, {
      foreignKey: 'person_name_id',
      as: 'PersonName',
    });

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

    const person3 = await Person.create({
      external_id: 'person-789',
      login: 'bob.johnson@example.com',
      active: false,
    });

    const name1 = await PersonNames.create({
      person_id: person1.id,
      first_name: 'John',
      last_name: 'Doe',
      age: 30,
      is_preferred: true,
      is_active: true,
    });

    const name2 = await PersonNames.create({
      person_id: person2.id,
      first_name: 'Jane',
      last_name: 'Smith',
      age: 25,
      is_preferred: false,
      is_active: true,
    });

    const name3 = await PersonNames.create({
      person_id: person3.id,
      first_name: 'Bob',
      last_name: 'Johnson',
      age: 35,
      is_preferred: true,
      is_active: false,
    });

    await Address.create({
      person_name_id: name1.id,
      street: '123 Main St',
      city: 'New York',
    });

    await Address.create({
      person_name_id: name2.id,
      street: '456 Oak Ave',
      city: 'Los Angeles',
    });

    return { person1, person2, person3, name1, name2, name3 };
  }

  describe('Standard Include Options', () => {
    test('supports where clause in flattening config', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames, ctx.Address);

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name', 'last_name'],
            where: { is_active: true }, // Only active names
          },
        })
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      // Bob's name is not active, so he shouldn't appear
      expect(res.body.data).toHaveLength(2);
      const names = res.body.data.map((p) => p.first_name);
      expect(names).toContain('John');
      expect(names).toContain('Jane');
      expect(names).not.toContain('Bob');
    });

    test('supports required option in flattening config', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;

      // Create person without names
      await Person.create({
        external_id: 'person-999',
        login: 'no.name@example.com',
        active: true,
      });

      await seedData(Person, PersonNames, ctx.Address);

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name'],
            required: false, // Left join
          },
        })
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(4); // All persons including one without names
    });

    test('supports attributes option in flattening config', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames, ctx.Address);

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name'], // Only select first_name
            // Flattening only exposes first_name
          },
        })
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      expect(res.body.data[0].first_name).toBeDefined();
      // Note: The flattening attributes array determines what gets flattened,
      // but we're testing that the include attributes option is respected
    });

    test('supports on clause in flattening config', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames, ctx.Address);

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name', 'last_name'],
            on: {
              person_id: { [Op.col]: 'Person.id' },
              is_active: true,
            },
          },
        })
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      // Should only include persons with active names
      expect(res.body.data).toHaveLength(2);
    });

    test('supports or option in flattening config', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames, ctx.Address);

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name', 'is_preferred'],
            where: {
              [Op.or]: [{ is_preferred: true }, { age: { [Op.lt]: 30 } }],
            },
            or: true,
          },
        })
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('Advanced Include Options', () => {
    test('supports nested include in flattening config', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, Address, app } = ctx;
      await seedData(Person, PersonNames, Address);

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name', 'last_name'],
            include: [
              {
                model: Address,
                as: 'Addresses',
                attributes: ['city'],
              },
            ],
          },
        })
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data[0].first_name).toBeDefined();
      // The nested Addresses should be in the response but not flattened
    });

    test('supports separate option for hasMany relations', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;

      // Create multiple names for one person
      const person = await Person.create({
        external_id: 'person-multi',
        login: 'multi@example.com',
        active: true,
      });

      await PersonNames.create({
        person_id: person.id,
        first_name: 'First',
        last_name: 'Name',
        age: 25,
      });

      await PersonNames.create({
        person_id: person.id,
        first_name: 'Second',
        last_name: 'Name',
        age: 26,
      });

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name'],
            separate: true, // Use separate query
            limit: 1, // Only load 1 name per person
          },
        })
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    test('supports limit option with separate=true', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;

      const person = await Person.create({
        external_id: 'person-limited',
        login: 'limited@example.com',
        active: true,
      });

      // Create 3 names
      await PersonNames.create({
        person_id: person.id,
        first_name: 'Name1',
        last_name: 'Test',
        age: 25,
      });

      await PersonNames.create({
        person_id: person.id,
        first_name: 'Name2',
        last_name: 'Test',
        age: 26,
      });

      await PersonNames.create({
        person_id: person.id,
        first_name: 'Name3',
        last_name: 'Test',
        age: 27,
      });

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name'],
            separate: true,
            limit: 2, // Limit to 2 names
          },
        })
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    test('supports duplicating option in flattening config', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames, ctx.Address);

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name', 'last_name'],
            duplicating: false, // Prevent duplicating
          },
        })
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
    });

    test('supports order option in flattening config', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;

      const person = await Person.create({
        external_id: 'person-ordered',
        login: 'ordered@example.com',
        active: true,
      });

      await PersonNames.create({
        person_id: person.id,
        first_name: 'Zoe',
        last_name: 'Test',
        age: 25,
      });

      await PersonNames.create({
        person_id: person.id,
        first_name: 'Alice',
        last_name: 'Test',
        age: 26,
      });

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name'],
            separate: true,
            order: [['first_name', 'ASC']], // Order names alphabetically
          },
        })
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('Complex Scenarios', () => {
    test('combines multiple include options', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, Address, app } = ctx;
      await seedData(Person, PersonNames, Address);

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name', 'last_name', 'age'],
            where: { is_active: true },
            required: true,
            include: [
              {
                model: Address,
                as: 'Addresses',
                where: { city: { [Op.ne]: null } },
                required: false,
              },
            ],
          },
        })
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      // Should only include persons with active names
      const activeNames = res.body.data.every((p) => p.first_name);
      expect(activeNames).toBe(true);
    });

    test('works with search endpoint and all options', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames, ctx.Address);

      app.use(
        '/persons/search',
        search(Person, {
          path: '/',
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name', 'last_name', 'age'], // Use simple names first
            required: true,
          },
        })
      );

      const res = await request(app)
        .post('/persons/search')
        .send({
          filtering: {
            age: { gte: 25 },
          },
          ordering: [{ orderby: 'last_name', direction: 'ASC' }],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.length).toBeGreaterThan(0);

      // Verify flattening worked
      const firstPerson = res.body.data[0];
      expect(firstPerson.last_name).toBeDefined();
      expect(firstPerson.first_name).toBeDefined();
      expect(firstPerson.age).toBeDefined();
      expect(firstPerson.Names).toBeUndefined(); // Should be flattened out
    });

    test('preserves explicit include when it matches flattening', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames, ctx.Address);

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
                where: { is_preferred: true },
                required: true,
              },
            ],
          }
        )
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      // Should only return persons with preferred names
      expect(res.body.data).toHaveLength(2); // John and Bob
    });
  });

  describe('Edge Cases and Validation', () => {
    test('handles empty attributes array', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames, ctx.Address);

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: [], // Empty - no fields flattened
            required: true,
          },
        })
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
    });

    test('supports association option instead of model/as', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames, ctx.Address);

      const association = Person.associations.Names;

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name'],
            association: association,
          },
        })
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data[0].first_name).toBeDefined();
    });
  });
});
