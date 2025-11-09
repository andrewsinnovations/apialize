const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list, search } = require('../src');

describe('Response Flattening - Array Configuration', () => {
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
        zip_code: { type: DataTypes.STRING, allowNull: true },
        country: { type: DataTypes.STRING, allowNull: true },
      },
      {
        timestamps: false,
        tableName: 'addresses',
      }
    );

    const ContactInfo = sequelize.define(
      'ContactInfo',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        person_id: { type: DataTypes.INTEGER, allowNull: false },
        email: { type: DataTypes.STRING, allowNull: true },
        phone: { type: DataTypes.STRING, allowNull: true },
      },
      {
        timestamps: false,
        tableName: 'contact_info',
      }
    );

    // Associations
    Person.hasMany(PersonNames, { foreignKey: 'person_id', as: 'Names' });
    PersonNames.belongsTo(Person, { foreignKey: 'person_id', as: 'Person' });

    Person.hasMany(Address, { foreignKey: 'person_id', as: 'Addresses' });
    Address.belongsTo(Person, { foreignKey: 'person_id', as: 'Person' });

    Person.hasOne(ContactInfo, { foreignKey: 'person_id', as: 'Contact' });
    ContactInfo.belongsTo(Person, { foreignKey: 'person_id', as: 'Person' });

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());

    return { sequelize, Person, PersonNames, Address, ContactInfo, app };
  }

  async function seedData(Person, PersonNames, Address, ContactInfo) {
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

    await Address.create({
      person_id: person1.id,
      street: '123 Main St',
      city: 'New York',
      zip_code: '10001',
      country: 'USA',
    });

    await Address.create({
      person_id: person2.id,
      street: '456 Oak Ave',
      city: 'Los Angeles',
      zip_code: '90001',
      country: 'USA',
    });

    await Address.create({
      person_id: person3.id,
      street: '789 Pine Rd',
      city: 'Chicago',
      zip_code: '60601',
      country: 'USA',
    });

    await ContactInfo.create({
      person_id: person1.id,
      email: 'john@example.com',
      phone: '555-0001',
    });

    await ContactInfo.create({
      person_id: person2.id,
      email: 'jane@example.com',
      phone: '555-0002',
    });

    await ContactInfo.create({
      person_id: person3.id,
      email: 'bob@example.com',
      phone: '555-0003',
    });

    return { person1, person2, person3 };
  }

  describe('Array of Flattening Configurations', () => {
    test('flattens multiple includes with array configuration', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, Address, ContactInfo, app } = ctx;
      await seedData(Person, PersonNames, Address, ContactInfo);

      app.use(
        '/persons',
        list(
          Person,
          {
            flattening: [
              {
                model: PersonNames,
                as: 'Names',
                attributes: ['first_name', 'last_name'],
              },
              {
                model: Address,
                as: 'Addresses',
                attributes: ['city', 'country'],
              },
            ],
          },
          {
            include: [
              { model: PersonNames, as: 'Names', required: true },
              { model: Address, as: 'Addresses', required: true },
            ],
          }
        )
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);

      const firstPerson = res.body.data[0];
      expect(firstPerson.first_name).toBeDefined();
      expect(firstPerson.last_name).toBeDefined();
      expect(firstPerson.city).toBeDefined();
      expect(firstPerson.country).toBeDefined();
      expect(firstPerson.Names).toBeUndefined(); // Should be removed after flattening
      expect(firstPerson.Addresses).toBeUndefined(); // Should be removed after flattening
      expect(firstPerson.login).toBeDefined(); // Original fields should remain
    });

    test('array flattening with attribute aliasing', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, ContactInfo, app } = ctx;
      await seedData(Person, PersonNames, ctx.Address, ContactInfo);

      app.use(
        '/persons',
        list(
          Person,
          {
            flattening: [
              {
                model: PersonNames,
                as: 'Names',
                attributes: [
                  ['first_name', 'given_name'],
                  ['last_name', 'family_name'],
                ],
              },
              {
                model: ContactInfo,
                as: 'Contact',
                attributes: [['email', 'email_address'], 'phone'],
              },
            ],
          },
          {
            include: [
              { model: PersonNames, as: 'Names', required: true },
              { model: ContactInfo, as: 'Contact', required: true },
            ],
          }
        )
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);

      const firstPerson = res.body.data[0];
      expect(firstPerson.given_name).toBeDefined();
      expect(firstPerson.family_name).toBeDefined();
      expect(firstPerson.email_address).toBeDefined();
      expect(firstPerson.phone).toBeDefined();
      expect(firstPerson.first_name).toBeUndefined(); // Original field should not exist
      expect(firstPerson.last_name).toBeUndefined(); // Original field should not exist
      expect(firstPerson.email).toBeUndefined(); // Original field should not exist
      expect(firstPerson.Names).toBeUndefined(); // Include should be removed
      expect(firstPerson.Contact).toBeUndefined(); // Include should be removed
    });

    test('auto-creates includes from array flattening config', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, Address, ContactInfo, app } = ctx;
      await seedData(Person, PersonNames, Address, ContactInfo);

      app.use(
        '/persons',
        list(
          Person,
          {
            flattening: [
              {
                model: PersonNames,
                as: 'Names',
                attributes: ['first_name', 'last_name'],
              },
              {
                model: ContactInfo,
                as: 'Contact',
                attributes: ['email'],
              },
            ],
          },
          {} // Empty modelOptions - no includes specified
        )
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);

      const firstPerson = res.body.data[0];
      expect(firstPerson.first_name).toBeDefined();
      expect(firstPerson.last_name).toBeDefined();
      expect(firstPerson.email).toBeDefined();
      expect(firstPerson.Names).toBeUndefined();
      expect(firstPerson.Contact).toBeUndefined();
    });

    test('search with array flattening - filtering on flattened fields', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, Address, app } = ctx;
      await seedData(Person, PersonNames, Address, ctx.ContactInfo);

      app.use(
        '/persons',
        search(
          Person,
          {
            flattening: [
              {
                model: PersonNames,
                as: 'Names',
                attributes: ['first_name', 'last_name'],
              },
              {
                model: Address,
                as: 'Addresses',
                attributes: ['city'],
              },
            ],
          },
          {
            include: [
              { model: PersonNames, as: 'Names', required: true },
              { model: Address, as: 'Addresses', required: true },
            ],
          }
        )
      );

      const res = await request(app)
        .post('/persons/search')
        .send({
          filtering: {
            first_name: 'John',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].first_name).toBe('John');
      expect(res.body.data[0].city).toBe('New York');
    });

    test('search with array flattening - filtering on multiple flattened fields', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, Address, app } = ctx;
      await seedData(Person, PersonNames, Address, ctx.ContactInfo);

      app.use(
        '/persons',
        search(
          Person,
          {
            flattening: [
              {
                model: PersonNames,
                as: 'Names',
                attributes: ['first_name', 'last_name', 'age'],
              },
              {
                model: Address,
                as: 'Addresses',
                attributes: ['city', 'country'],
              },
            ],
          },
          {
            include: [
              { model: PersonNames, as: 'Names', required: true },
              { model: Address, as: 'Addresses', required: true },
            ],
          }
        )
      );

      const res = await request(app)
        .post('/persons/search')
        .send({
          filtering: {
            city: 'Los Angeles',
            age: { gte: 20 },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].first_name).toBe('Jane');
      expect(res.body.data[0].city).toBe('Los Angeles');
      expect(res.body.data[0].age).toBe(25);
    });

    test('search with array flattening - ordering on flattened fields', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, Address, app } = ctx;
      await seedData(Person, PersonNames, Address, ctx.ContactInfo);

      app.use(
        '/persons',
        search(
          Person,
          {
            flattening: [
              {
                model: PersonNames,
                as: 'Names',
                attributes: ['first_name', 'age'],
              },
              {
                model: Address,
                as: 'Addresses',
                attributes: ['city'],
              },
            ],
          },
          {
            include: [
              { model: PersonNames, as: 'Names', required: true },
              { model: Address, as: 'Addresses', required: true },
            ],
          }
        )
      );

      const res = await request(app)
        .post('/persons/search')
        .send({
          ordering: [{ order_by: 'age', direction: 'DESC' }],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data[0].age).toBe(35); // Bob (oldest)
      expect(res.body.data[1].age).toBe(30); // John
      expect(res.body.data[2].age).toBe(25); // Jane (youngest)
    });

    test('single object flattening still works (backward compatibility)', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames, ctx.Address, ctx.ContactInfo);

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
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);

      const firstPerson = res.body.data[0];
      expect(firstPerson.first_name).toBeDefined();
      expect(firstPerson.last_name).toBeDefined();
      expect(firstPerson.Names).toBeUndefined();
      expect(firstPerson.login).toBeDefined();
    });

    test('empty array flattening has no effect', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames, ctx.Address, ctx.ContactInfo);

      app.use(
        '/persons',
        list(
          Person,
          {
            flattening: [],
          },
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);

      const firstPerson = res.body.data[0];
      expect(firstPerson.Names).toBeDefined(); // Include should NOT be flattened
      expect(firstPerson.first_name).toBeUndefined(); // No flattening occurred
    });

    test('array flattening with search and complex filtering', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, Address, app } = ctx;
      await seedData(Person, PersonNames, Address, ctx.ContactInfo);

      app.use(
        '/persons',
        search(
          Person,
          {
            flattening: [
              {
                model: PersonNames,
                as: 'Names',
                attributes: ['first_name', 'last_name', 'age'],
              },
              {
                model: Address,
                as: 'Addresses',
                attributes: ['city', 'country'],
              },
            ],
          },
          {
            include: [
              { model: PersonNames, as: 'Names', required: true },
              { model: Address, as: 'Addresses', required: true },
            ],
          }
        )
      );

      const res = await request(app)
        .post('/persons/search')
        .send({
          filtering: {
            and: [{ age: { gte: 25 } }, { country: 'USA' }],
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data.every((p) => p.age >= 25)).toBe(true);
      expect(res.body.data.every((p) => p.country === 'USA')).toBe(true);
    });
  });
});
