const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list, search, single, create, update, patch } = require('../src');

describe('Field Aliases', () => {
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
        person_name: { type: DataTypes.STRING, allowNull: false },
        person_age: { type: DataTypes.INTEGER, allowNull: true },
        person_email: { type: DataTypes.STRING, allowNull: true },
        active: { type: DataTypes.BOOLEAN, defaultValue: true },
      },
      {
        timestamps: false,
        tableName: 'persons',
      }
    );

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());

    return { sequelize, Person, app };
  }

  async function seedData(Person) {
    await Person.create({
      person_name: 'John Doe',
      person_age: 30,
      person_email: 'john@example.com',
      active: true,
    });

    await Person.create({
      person_name: 'Jane Smith',
      person_age: 25,
      person_email: 'jane@example.com',
      active: true,
    });

    await Person.create({
      person_name: 'Bob Johnson',
      person_age: 35,
      person_email: 'bob@example.com',
      active: false,
    });
  }

  describe('List Operation', () => {
    it('should return data with aliased field names', async () => {
      const { Person, app } = await buildAppAndModels();
      await seedData(Person);

      const aliases = {
        name: 'person_name',
        age: 'person_age',
        email: 'person_email',
      };

      app.use('/persons', list(Person, { aliases }));

      const response = await request(app).get('/persons');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3);
      expect(response.body.data[0]).toHaveProperty('name');
      expect(response.body.data[0]).toHaveProperty('age');
      expect(response.body.data[0]).toHaveProperty('email');
      expect(response.body.data[0]).not.toHaveProperty('person_name');
      expect(response.body.data[0]).not.toHaveProperty('person_age');
      expect(response.body.data[0]).not.toHaveProperty('person_email');
    });

    it('should filter by aliased field name', async () => {
      const { Person, app } = await buildAppAndModels();
      await seedData(Person);

      const aliases = {
        name: 'person_name',
        age: 'person_age',
      };

      app.use('/persons', list(Person, { aliases }));

      const response = await request(app).get('/persons?name=John Doe');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('John Doe');
    });

    it('should filter with operators using aliased field name', async () => {
      const { Person, app } = await buildAppAndModels();
      await seedData(Person);

      const aliases = {
        age: 'person_age',
      };

      app.use('/persons', list(Person, { aliases }));

      const response = await request(app).get('/persons?age:gte=30');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data.every((p) => p.age >= 30)).toBe(true);
    });

    it('should order by aliased field name', async () => {
      const { Person, app } = await buildAppAndModels();
      await seedData(Person);

      const aliases = {
        age: 'person_age',
      };

      app.use('/persons', list(Person, { aliases }));

      const response = await request(app).get(
        '/persons?api:order_by=age&api:order_dir=DESC'
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3);
      expect(response.body.data[0].age).toBe(35);
      expect(response.body.data[1].age).toBe(30);
      expect(response.body.data[2].age).toBe(25);
    });

    it('should work with allow_filtering_on using aliased names', async () => {
      const { Person, app } = await buildAppAndModels();
      await seedData(Person);

      const aliases = {
        name: 'person_name',
        age: 'person_age',
      };

      app.use(
        '/persons',
        list(Person, {
          aliases,
          allow_filtering_on: ['name'], // Use external alias name
        })
      );

      const response1 = await request(app).get('/persons?name=John Doe');
      expect(response1.status).toBe(200);
      expect(response1.body.data).toHaveLength(1);

      const response2 = await request(app).get('/persons?age=30');
      expect(response2.status).toBe(400);
    });

    it('should work with blockFilteringOn using aliased names', async () => {
      const { Person, app } = await buildAppAndModels();
      await seedData(Person);

      const aliases = {
        email: 'person_email',
      };

      app.use(
        '/persons',
        list(Person, {
          aliases,
          block_filtering_on: ['email'], // Use external alias name
        })
      );

      const response = await request(app).get(
        '/persons?email=john@example.com'
      );
      expect(response.status).toBe(400);
    });

    it('should work with allow_ordering_on using aliased names', async () => {
      const { Person, app } = await buildAppAndModels();
      await seedData(Person);

      const aliases = {
        name: 'person_name',
        age: 'person_age',
      };

      app.use(
        '/persons',
        list(Person, {
          aliases,
          allow_ordering_on: ['name'], // Use external alias name
        })
      );

      const response1 = await request(app).get('/persons?api:order_by=name');
      expect(response1.status).toBe(200);

      const response2 = await request(app).get('/persons?api:order_by=age');
      expect(response2.status).toBe(400);
    });

    it('should work with block_ordering_on using aliased names', async () => {
      const { Person, app } = await buildAppAndModels();
      await seedData(Person);

      const aliases = {
        email: 'person_email',
      };

      app.use(
        '/persons',
        list(Person, {
          aliases,
          block_ordering_on: ['email'], // Use external alias name
        })
      );

      const response = await request(app).get('/persons?api:order_by=email');
      expect(response.status).toBe(400);
    });

    it('should use default_order_by with aliased field name', async () => {
      const { Person, app } = await buildAppAndModels();
      await seedData(Person);

      const aliases = {
        age: 'person_age',
      };

      app.use('/persons', list(Person, { aliases, default_order_by: 'age' }));

      const response = await request(app).get('/persons');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3);
      // Should be ordered by age ASC (default direction)
      expect(response.body.data[0].age).toBe(25);
      expect(response.body.data[1].age).toBe(30);
      expect(response.body.data[2].age).toBe(35);
    });

    it('should use default_order_by with aliased id field', async () => {
      const { Person, app } = await buildAppAndModels();
      await seedData(Person);

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

      const response = await request(app).get('/persons');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3);
      // Should be ordered by id ASC (default direction)
      expect(response.body.data[0].personId).toBe(1);
      expect(response.body.data[1].personId).toBe(2);
      expect(response.body.data[2].personId).toBe(3);
    });
  });

  describe('Search Operation', () => {
    it('should return data with aliased field names', async () => {
      const { Person, app } = await buildAppAndModels();
      await seedData(Person);

      const aliases = {
        name: 'person_name',
        age: 'person_age',
      };

      app.use('/persons', search(Person, { aliases, path: '/' }));

      const response = await request(app).post('/persons').send({
        filtering: {},
        paging: { page: 1, size: 10 },
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3);
      expect(response.body.data[0]).toHaveProperty('name');
      expect(response.body.data[0]).toHaveProperty('age');
      expect(response.body.data[0]).not.toHaveProperty('person_name');
      expect(response.body.data[0]).not.toHaveProperty('person_age');
    });

    it('should filter by aliased field name', async () => {
      const { Person, app } = await buildAppAndModels();
      await seedData(Person);

      const aliases = {
        name: 'person_name',
      };

      app.use('/persons', search(Person, { aliases, path: '/' }));

      const response = await request(app).post('/persons').send({
        filtering: { name: 'Jane Smith' },
        paging: { page: 1, size: 10 },
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('Jane Smith');
    });

    it('should filter with operators using aliased field name', async () => {
      const { Person, app } = await buildAppAndModels();
      await seedData(Person);

      const aliases = {
        age: 'person_age',
      };

      app.use('/persons', search(Person, { aliases, path: '/' }));

      const response = await request(app).post('/persons').send({
        filtering: { age: { gte: 30 } },
        paging: { page: 1, size: 10 },
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data.every((p) => p.age >= 30)).toBe(true);
    });

    it('should order by aliased field name', async () => {
      const { Person, app } = await buildAppAndModels();
      await seedData(Person);

      const aliases = {
        age: 'person_age',
      };

      app.use('/persons', search(Person, { aliases, path: '/' }));

      const response = await request(app).post('/persons').send({
        filtering: {},
        ordering: [{ order_by: 'age', direction: 'DESC' }],
        paging: { page: 1, size: 10 },
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3);
      expect(response.body.data[0].age).toBe(35);
      expect(response.body.data[1].age).toBe(30);
      expect(response.body.data[2].age).toBe(25);
    });

    it('should use default_order_by with aliased field name', async () => {
      const { Person, app } = await buildAppAndModels();
      await seedData(Person);

      const aliases = {
        age: 'person_age',
      };

      app.use(
        '/persons',
        search(Person, { aliases, default_order_by: 'age', path: '/' })
      );

      const response = await request(app).post('/persons').send({
        filtering: {},
        paging: { page: 1, size: 10 },
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3);
      // Should be ordered by age ASC (default direction)
      expect(response.body.data[0].age).toBe(25);
      expect(response.body.data[1].age).toBe(30);
      expect(response.body.data[2].age).toBe(35);
    });

    it('should work with allow_ordering_on using aliased names', async () => {
      const { Person, app } = await buildAppAndModels();
      await seedData(Person);

      const aliases = {
        name: 'person_name',
        age: 'person_age',
      };

      app.use(
        '/persons',
        search(Person, {
          aliases,
          allow_ordering_on: ['name'], // Use external alias name
          path: '/',
        })
      );

      const response1 = await request(app).post('/persons').send({
        filtering: {},
        ordering: [{ order_by: 'name', direction: 'ASC' }],
        paging: { page: 1, size: 10 },
      });
      expect(response1.status).toBe(200);

      const response2 = await request(app).post('/persons').send({
        filtering: {},
        ordering: [{ order_by: 'age', direction: 'ASC' }],
        paging: { page: 1, size: 10 },
      });
      expect(response2.status).toBe(400);
    });

    it('should work with block_ordering_on using aliased names', async () => {
      const { Person, app } = await buildAppAndModels();
      await seedData(Person);

      const aliases = {
        email: 'person_email',
      };

      app.use(
        '/persons',
        search(Person, {
          aliases,
          block_ordering_on: ['email'], // Use external alias name
          path: '/',
        })
      );

      const response = await request(app).post('/persons').send({
        filtering: {},
        ordering: [{ order_by: 'email', direction: 'ASC' }],
        paging: { page: 1, size: 10 },
      });
      expect(response.status).toBe(400);
    });
  });

  describe('Single Operation', () => {
    it('should return data with aliased field names', async () => {
      const { Person, app } = await buildAppAndModels();
      await seedData(Person);

      const aliases = {
        name: 'person_name',
        age: 'person_age',
        email: 'person_email',
      };

      app.use('/persons', single(Person, { aliases }));

      const response = await request(app).get('/persons/1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.record).toHaveProperty('name', 'John Doe');
      expect(response.body.record).toHaveProperty('age', 30);
      expect(response.body.record).toHaveProperty('email', 'john@example.com');
      expect(response.body.record).not.toHaveProperty('person_name');
      expect(response.body.record).not.toHaveProperty('person_age');
      expect(response.body.record).not.toHaveProperty('person_email');
    });
  });

  describe('Create Operation', () => {
    it('should accept aliased field names in request body', async () => {
      const { Person, app } = await buildAppAndModels();

      const aliases = {
        name: 'person_name',
        age: 'person_age',
        email: 'person_email',
      };

      app.use('/persons', create(Person, { aliases }));

      const response = await request(app).post('/persons').send({
        name: 'Alice Cooper',
        age: 28,
        email: 'alice@example.com',
      });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.id).toBeDefined();

      const created = await Person.findByPk(response.body.id);
      expect(created.person_name).toBe('Alice Cooper');
      expect(created.person_age).toBe(28);
      expect(created.person_email).toBe('alice@example.com');
    });

    it('should accept bulk create with aliased field names', async () => {
      const { Person, app } = await buildAppAndModels();

      const aliases = {
        name: 'person_name',
        age: 'person_age',
      };

      app.use(
        '/persons',
        create(Person, { aliases, allow_bulk_create: true })
      );

      const response = await request(app)
        .post('/persons')
        .send([
          { name: 'Alice Cooper', age: 28 },
          { name: 'Charlie Brown', age: 32 },
        ]);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.ids).toHaveLength(2);

      const count = await Person.count();
      expect(count).toBe(2);
    });

    it('should work with allowed_fields using aliased names', async () => {
      const { Person, app } = await buildAppAndModels();

      const aliases = {
        name: 'person_name',
        age: 'person_age',
        email: 'person_email',
      };

      app.use(
        '/persons',
        create(Person, {
          aliases,
          allowed_fields: ['name', 'age'], // Use external alias names
        })
      );

      const response1 = await request(app).post('/persons').send({
        name: 'Alice Cooper',
        age: 28,
      });
      expect(response1.status).toBe(201);

      const response2 = await request(app).post('/persons').send({
        name: 'Bob Dylan',
        email: 'bob@example.com',
      });
      expect(response2.status).toBe(400);
    });

    it('should work with blocked_fields using aliased names', async () => {
      const { Person, app } = await buildAppAndModels();

      const aliases = {
        email: 'person_email',
      };

      app.use(
        '/persons',
        create(Person, {
          aliases,
          blocked_fields: ['email'], // Use external alias name
        })
      );

      const response = await request(app).post('/persons').send({
        person_name: 'Test User',
        email: 'test@example.com',
      });

      expect(response.status).toBe(400);
    });
  });

  describe('Update Operation', () => {
    it('should accept aliased field names in request body', async () => {
      const { Person, app } = await buildAppAndModels();
      await seedData(Person);

      const aliases = {
        name: 'person_name',
        age: 'person_age',
      };

      app.use('/persons', update(Person, { aliases }));

      const response = await request(app).put('/persons/1').send({
        name: 'John Updated',
        age: 31,
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const updated = await Person.findByPk(1);
      expect(updated.person_name).toBe('John Updated');
      expect(updated.person_age).toBe(31);
    });
  });

  describe('Patch Operation', () => {
    it('should accept aliased field names in request body', async () => {
      const { Person, app } = await buildAppAndModels();
      await seedData(Person);

      const aliases = {
        name: 'person_name',
        age: 'person_age',
      };

      app.use('/persons', patch(Person, { aliases }));

      const response = await request(app).patch('/persons/1').send({
        age: 31,
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const updated = await Person.findByPk(1);
      expect(updated.person_name).toBe('John Doe'); // Unchanged
      expect(updated.person_age).toBe(31); // Updated
    });
  });

  describe('Integration with Flattening', () => {
    it('should work alongside flattening without interference', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });

      const Person = sequelize.define(
        'Person',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          person_name: { type: DataTypes.STRING, allowNull: false },
        },
        {
          timestamps: false,
          tableName: 'persons',
        }
      );

      const Address = sequelize.define(
        'Address',
        {
          id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
          },
          person_id: { type: DataTypes.INTEGER, allowNull: false },
          city: { type: DataTypes.STRING, allowNull: true },
        },
        {
          timestamps: false,
          tableName: 'addresses',
        }
      );

      Person.hasOne(Address, { foreignKey: 'person_id', as: 'Address' });
      Address.belongsTo(Person, { foreignKey: 'person_id', as: 'Person' });

      await sequelize.sync({ force: true });

      const person = await Person.create({ person_name: 'John Doe' });
      await Address.create({ person_id: person.id, city: 'New York' });

      const app = express();
      app.use(bodyParser.json());

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

      const response = await request(app).get('/persons');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toHaveProperty('name', 'John Doe');
      expect(response.body.data[0]).toHaveProperty('address_city', 'New York');
      expect(response.body.data[0]).not.toHaveProperty('person_name');
      expect(response.body.data[0]).not.toHaveProperty('Address');
    });
  });
});

