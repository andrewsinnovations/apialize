const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list, search, single } = require('../src');

describe('Response Flattening', () => {
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

    // Scope with include
    Person.addScope('withNames', {
      include: [
        {
          model: PersonNames,
          as: 'Names',
          required: true,
        },
      ],
    });

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

  describe('Basic Flattening', () => {
    test('flattens included model attributes with simple string mapping', async () => {
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
      expect(firstPerson.Names).toBeUndefined(); // Should be removed after flattening
      expect(firstPerson.login).toBeDefined(); // Original fields should remain
    });

    test('flattens with attribute aliasing using array format', async () => {
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
          },
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);

      const firstPerson = res.body.data[0];
      expect(firstPerson.first_name).toBeDefined();
      expect(firstPerson.surname).toBeDefined(); // Aliased field
      expect(firstPerson.person_age).toBeDefined(); // Another aliased field
      expect(firstPerson.last_name).toBeUndefined(); // Original field should not exist
      expect(firstPerson.age).toBeUndefined(); // Original field should not exist
      expect(firstPerson.Names).toBeUndefined(); // Include should be removed
    });

    test('works with id_mapping', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames);

      app.use(
        '/persons',
        list(
          Person,
          {
            id_mapping: 'external_id',
            flattening: {
              model: PersonNames,
              as: 'Names',
              attributes: ['first_name', ['last_name', 'lname']],
            },
          },
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);

      const firstPerson = res.body.data[0];
      expect(firstPerson.id).toBe('person-123'); // Should use external_id
      expect(firstPerson.first_name).toBeDefined();
      expect(firstPerson.lname).toBeDefined();
    });
  });

  describe('Filtering on Flattened Fields', () => {
    test('filters by flattened field with simple equality', async () => {
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
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      const res = await request(app).get('/persons?first_name=John');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].first_name).toBe('John');
      expect(res.body.data[0].last_name).toBe('Doe');
    });

    test('filters by aliased flattened field', async () => {
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
              attributes: [['last_name', 'surname']],
            },
          },
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      const res = await request(app).get('/persons?surname=Smith');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].surname).toBe('Smith');
    });

    test('supports filtering operators on flattened fields', async () => {
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
              attributes: ['first_name', 'age'],
            },
          },
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      // Test case-insensitive contains
      const containsRes = await request(app).get(
        '/persons?first_name:icontains=jo'
      );
      expect(containsRes.status).toBe(200);
      expect(containsRes.body.data).toHaveLength(1); // Only John matches "jo" in first_name

      // Test numeric comparison
      const ageRes = await request(app).get('/persons?age:gte=30');
      expect(ageRes.status).toBe(200);
      expect(ageRes.body.data).toHaveLength(2); // John (30) and Bob (35)
    });

    test('combines flattened and regular field filters', async () => {
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
              attributes: ['first_name'],
            },
          },
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      const res = await request(app).get(
        '/persons?first_name=John&login=john.doe@example.com'
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].first_name).toBe('John');
      expect(res.body.data[0].login).toBe('john.doe@example.com');
    });

    test('supports additional comparison operators on flattened fields', async () => {
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
              attributes: ['first_name', 'age'],
            },
          },
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      // Test less than
      const ltRes = await request(app).get('/persons?age:lt=30');
      expect(ltRes.status).toBe(200);
      expect(ltRes.body.data).toHaveLength(1); // Only Jane (25)
      expect(ltRes.body.data[0].first_name).toBe('Jane');

      // Test less than or equal
      const lteRes = await request(app).get('/persons?age:lte=30');
      expect(lteRes.status).toBe(200);
      expect(lteRes.body.data).toHaveLength(2); // Jane (25) and John (30)

      // Test greater than
      const gtRes = await request(app).get('/persons?age:gt=30');
      expect(gtRes.status).toBe(200);
      expect(gtRes.body.data).toHaveLength(1); // Only Bob (35)
      expect(gtRes.body.data[0].first_name).toBe('Bob');
    });

    test('supports set operations (in, not_in) on flattened fields', async () => {
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
              attributes: ['first_name', 'age'],
            },
          },
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      // Test in operation with ages
      const inRes = await request(app).get('/persons?age:in=25,30');
      expect(inRes.status).toBe(200);
      expect(inRes.body.data).toHaveLength(2); // Jane (25) and John (30)
      const ages = inRes.body.data.map((p) => p.age);
      expect(ages).toContain(25);
      expect(ages).toContain(30);

      // Test not_in operation
      const notInRes = await request(app).get('/persons?age:not_in=25,30');
      expect(notInRes.status).toBe(200);
      expect(notInRes.body.data).toHaveLength(1); // Only Bob (35)
      expect(notInRes.body.data[0].age).toBe(35);

      // Test in operation with names
      const nameInRes = await request(app).get(
        '/persons?first_name:in=John,Jane'
      );
      expect(nameInRes.status).toBe(200);
      expect(nameInRes.body.data).toHaveLength(2);
      const names = nameInRes.body.data.map((p) => p.first_name);
      expect(names).toContain('John');
      expect(names).toContain('Jane');
    });

    test('supports string prefix/suffix operations on flattened fields', async () => {
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
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      // Test starts_with
      const startsRes = await request(app).get(
        '/persons?first_name:starts_with=Jo'
      );
      expect(startsRes.status).toBe(200);
      expect(startsRes.body.data).toHaveLength(1); // Only John
      expect(startsRes.body.data[0].first_name).toBe('John');

      // Test ends_with
      const endsRes = await request(app).get(
        '/persons?last_name:ends_with=son'
      );
      expect(endsRes.status).toBe(200);
      expect(endsRes.body.data).toHaveLength(1); // Only Johnson
      expect(endsRes.body.data[0].last_name).toBe('Johnson');

      // Test contains (case-sensitive)
      const containsRes = await request(app).get(
        '/persons?last_name:contains=mith'
      );
      expect(containsRes.status).toBe(200);
      expect(containsRes.body.data).toHaveLength(1); // Only Smith
      expect(containsRes.body.data[0].last_name).toBe('Smith');
    });

    test('supports negative string operations on flattened fields', async () => {
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
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      // Test not_contains (case-sensitive)
      const notContainsRes = await request(app).get(
        '/persons?first_name:not_contains=oh'
      );
      expect(notContainsRes.status).toBe(200);
      expect(notContainsRes.body.data).toHaveLength(2); // Jane and Bob (not John)
      const names = notContainsRes.body.data.map((p) => p.first_name);
      expect(names).toContain('Jane');
      expect(names).toContain('Bob');
      expect(names).not.toContain('John');

      // Test not_icontains (case-insensitive)
      const notIContainsRes = await request(app).get(
        '/persons?first_name:not_icontains=AN'
      );
      expect(notIContainsRes.status).toBe(200);
      expect(notIContainsRes.body.data).toHaveLength(2); // John and Bob (not Jane)
      const notIContainsNames = notIContainsRes.body.data.map(
        (p) => p.first_name
      );
      expect(notIContainsNames).toContain('John');
      expect(notIContainsNames).toContain('Bob');
      expect(notIContainsNames).not.toContain('Jane');

      // Test not_starts_with
      const notStartsRes = await request(app).get(
        '/persons?first_name:not_starts_with=J'
      );
      expect(notStartsRes.status).toBe(200);
      expect(notStartsRes.body.data).toHaveLength(1); // Only Bob
      expect(notStartsRes.body.data[0].first_name).toBe('Bob');

      // Test not_ends_with
      const notEndsRes = await request(app).get(
        '/persons?last_name:not_ends_with=e'
      );
      expect(notEndsRes.status).toBe(200);
      expect(notEndsRes.body.data).toHaveLength(2); // Smith and Johnson (Doe ends with 'e')
      const notEndsNames = notEndsRes.body.data.map((p) => p.last_name);
      expect(notEndsNames).toContain('Smith');
      expect(notEndsNames).toContain('Johnson');
      expect(notEndsNames).not.toContain('Doe');
    });

    test('supports equality/inequality operators on flattened fields', async () => {
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
              attributes: ['first_name', 'age'],
            },
          },
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      // Test not equal (neq)
      const neqRes = await request(app).get('/persons?age:neq=30');
      expect(neqRes.status).toBe(200);
      expect(neqRes.body.data).toHaveLength(2); // Jane (25) and Bob (35)
      const ages = neqRes.body.data.map((p) => p.age);
      expect(ages).toContain(25);
      expect(ages).toContain(35);
      expect(ages).not.toContain(30);

      // Test case-insensitive equality (ieq)
      const ieqRes = await request(app).get('/persons?first_name:ieq=JOHN');
      expect(ieqRes.status).toBe(200);
      expect(ieqRes.body.data).toHaveLength(1); // Only John
      expect(ieqRes.body.data[0].first_name).toBe('John');
    });

    test('supports boolean operations on flattened fields', async () => {
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
              attributes: ['first_name', 'is_preferred'],
            },
          },
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      // Test is_true
      const isTrueRes = await request(app).get('/persons?is_preferred:is_true');
      expect(isTrueRes.status).toBe(200);
      expect(isTrueRes.body.data).toHaveLength(2); // John and Bob
      const preferredNames = isTrueRes.body.data.map((p) => p.first_name);
      expect(preferredNames).toContain('John');
      expect(preferredNames).toContain('Bob');
      expect(preferredNames).not.toContain('Jane');

      // Test is_false
      const isFalseRes = await request(app).get(
        '/persons?is_preferred:is_false'
      );
      expect(isFalseRes.status).toBe(200);
      expect(isFalseRes.body.data).toHaveLength(1); // Only Jane
      expect(isFalseRes.body.data[0].first_name).toBe('Jane');
      expect(isFalseRes.body.data[0].is_preferred).toBe(false);
    });

    test('supports complex filtering combinations with multiple operators on flattened fields', async () => {
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
              attributes: ['first_name', 'last_name', 'age', 'is_preferred'],
            },
          },
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      // Test combining multiple flattened field filters
      const complexRes = await request(app).get(
        '/persons?age:gte=25&is_preferred:is_true&first_name:starts_with=J'
      );
      expect(complexRes.status).toBe(200);
      expect(complexRes.body.data).toHaveLength(1); // Only John matches all criteria
      expect(complexRes.body.data[0].first_name).toBe('John');
      expect(complexRes.body.data[0].age).toBe(30);
      expect(complexRes.body.data[0].is_preferred).toBe(true);

      // Test combining set operations with other filters
      const setComplexRes = await request(app).get(
        '/persons?first_name:in=John,Jane&age:lt=35'
      );
      expect(setComplexRes.status).toBe(200);
      expect(setComplexRes.body.data).toHaveLength(2); // John and Jane (both under 35)
      const complexNames = setComplexRes.body.data.map((p) => p.first_name);
      expect(complexNames).toContain('John');
      expect(complexNames).toContain('Jane');
      expect(complexNames).not.toContain('Bob');
    });
  });

  describe('Ordering on Flattened Fields', () => {
    test('orders by flattened field', async () => {
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
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      const res = await request(app).get('/persons?api:order_by=last_name');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data[0].last_name).toBe('Doe');
      expect(res.body.data[1].last_name).toBe('Johnson');
      expect(res.body.data[2].last_name).toBe('Smith');
    });

    test('orders by aliased flattened field', async () => {
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
              attributes: [['last_name', 'surname']],
            },
          },
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      const res = await request(app).get('/persons?api:order_by=-surname');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data[0].surname).toBe('Smith');
      expect(res.body.data[1].surname).toBe('Johnson');
      expect(res.body.data[2].surname).toBe('Doe');
    });

    test('supports multi-field ordering with flattened fields', async () => {
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
              attributes: ['first_name', 'age'],
            },
          },
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      const res = await request(app).get(
        '/persons?api:order_by=age,first_name'
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      // Should be ordered by age ASC, then first_name ASC
      expect(res.body.data[0].age).toBe(25); // Jane
      expect(res.body.data[1].age).toBe(30); // John
      expect(res.body.data[2].age).toBe(35); // Bob
    });
  });

  describe('Search API with Flattening', () => {
    test('supports flattening in search endpoint', async () => {
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
          },
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      const res = await request(app)
        .post('/persons/search')
        .send({
          filtering: {
            first_name: { icontains: 'jo' },
          },
          ordering: [{ orderby: 'surname', direction: 'ASC' }],
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].surname).toBe('Doe'); // John Doe
    });

    test('search filters by aliased flattened fields', async () => {
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
              attributes: [['age', 'person_age']],
            },
          },
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      const res = await request(app)
        .post('/persons/search')
        .send({
          filtering: {
            person_age: { gte: 30 },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2); // John (30) and Bob (35)
      expect(res.body.data.every((person) => person.person_age >= 30)).toBe(
        true
      );
    });

    test('search supports comprehensive filtering operations on flattened fields', async () => {
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
              attributes: ['first_name', 'last_name', 'age', 'is_preferred'],
            },
          },
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      // Test set operations in search
      const setRes = await request(app)
        .post('/persons/search')
        .send({
          filtering: {
            age: { in: [25, 30] },
            is_preferred: { is_true: true },
          },
        });

      expect(setRes.status).toBe(200);
      expect(setRes.body.data).toHaveLength(1); // Only John (30, preferred)
      expect(setRes.body.data[0].first_name).toBe('John');

      // Test string operations in search
      const stringRes = await request(app)
        .post('/persons/search')
        .send({
          filtering: {
            first_name: { starts_with: 'J' },
            last_name: { not_contains: 'Smith' },
          },
        });

      expect(stringRes.status).toBe(200);
      expect(stringRes.body.data).toHaveLength(1); // Only John (Jane has Smith)
      expect(stringRes.body.data[0].first_name).toBe('John');

      // Test complex combination in search
      const complexRes = await request(app)
        .post('/persons/search')
        .send({
          filtering: {
            age: { gte: 25, lt: 35 },
            first_name: { not_in: ['Bob'] },
            is_preferred: { is_true: true }, // Match preferred names
          },
        });

      expect(complexRes.status).toBe(200);
      expect(complexRes.body.data).toHaveLength(1); // Only John matches (Jane isn't preferred)
      expect(complexRes.body.data[0].first_name).toBe('John');
    });
  });

  describe('Error Handling', () => {
    test('returns 400 when flattening model does not match include', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames);

      // Create a dummy model for testing
      const DummyModel = sequelize.define('Dummy', {
        name: DataTypes.STRING,
      });

      app.use(
        '/persons',
        list(
          Person,
          {
            flattening: {
              model: DummyModel, // Wrong model
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

    test('returns 400 when flattening alias does not exist in includes', async () => {
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
              as: 'WrongAlias', // Wrong alias
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

    test('returns 400 when filtering by invalid flattened field', async () => {
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
              attributes: ['first_name'], // Only first_name is flattened
            },
          },
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      // Try to filter by non-flattened field that maps to include
      const res = await request(app).get('/persons?last_name=Doe');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Advanced Features', () => {
    test('works with scopes', async () => {
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
          {
            scopes: ['withNames'],
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      const res = await request(app).get('/persons');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data[0].first_name).toBeDefined();
      expect(res.body.data[0].Names).toBeUndefined(); // Should be flattened out
    });

    test('properly handles pagination with flattening', async () => {
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
              attributes: ['first_name'],
            },
          },
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      const res = await request(app).get('/persons?api:page=1&api:page_size=2');

      expect(res.status).toBe(200);
      expect(res.body.meta.paging.count).toBe(3);
      expect(res.body.meta.paging.page).toBe(1);
      expect(res.body.meta.paging.size).toBe(2);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].first_name).toBeDefined();
    });

    test('disables subqueries automatically when flattening is used', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames);

      let capturedOptions = null;

      // Mock the findAndCountAll to capture options
      const originalFindAndCountAll = Person.findAndCountAll;
      Person.findAndCountAll = function (options) {
        capturedOptions = options;
        return originalFindAndCountAll.call(this, options);
      };

      app.use(
        '/persons',
        list(
          Person,
          {
            flattening: {
              model: PersonNames,
              as: 'Names',
              attributes: ['first_name'],
            },
          },
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      await request(app).get('/persons');

      expect(capturedOptions.subQuery).toBe(false);

      // Restore original method
      Person.findAndCountAll = originalFindAndCountAll;
    });
  });

  describe('Single Endpoint with Flattening', () => {
    test('flattens included model attributes on single endpoint', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      const { person1 } = await seedData(Person, PersonNames);

      app.use(
        '/persons',
        single(
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

      const res = await request(app).get(`/persons/${person1.id}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.record).toBeDefined();
      expect(res.body.record.first_name).toBe('John');
      expect(res.body.record.last_name).toBe('Doe');
      expect(res.body.record.Names).toBeUndefined(); // Should be removed after flattening
      expect(res.body.record.login).toBe('john.doe@example.com'); // Original fields should remain
    });

    test('single endpoint flattens with attribute aliasing', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      const { person2 } = await seedData(Person, PersonNames);

      app.use(
        '/persons',
        single(
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
          },
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      const res = await request(app).get(`/persons/${person2.id}`);

      expect(res.status).toBe(200);
      expect(res.body.record.first_name).toBe('Jane');
      expect(res.body.record.surname).toBe('Smith'); // Aliased field
      expect(res.body.record.person_age).toBe(25); // Another aliased field
      expect(res.body.record.last_name).toBeUndefined(); // Original field should not exist
      expect(res.body.record.age).toBeUndefined(); // Original field should not exist
      expect(res.body.record.Names).toBeUndefined(); // Include should be removed
    });

    test('single endpoint works with id_mapping and flattening', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames);

      app.use(
        '/persons',
        single(
          Person,
          {
            id_mapping: 'external_id',
            flattening: {
              model: PersonNames,
              as: 'Names',
              attributes: ['first_name', ['last_name', 'lname']],
            },
          },
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      const res = await request(app).get('/persons/person-123');

      expect(res.status).toBe(200);
      expect(res.body.record.id).toBe('person-123'); // Should use external_id
      expect(res.body.record.first_name).toBe('John');
      expect(res.body.record.lname).toBe('Doe');
    });

    test('single endpoint flattening with multiple attributes', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      const { person3 } = await seedData(Person, PersonNames);

      app.use(
        '/persons',
        single(
          Person,
          {
            flattening: {
              model: PersonNames,
              as: 'Names',
              attributes: ['first_name', 'last_name', 'age', 'is_preferred'],
            },
          },
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      const res = await request(app).get(`/persons/${person3.id}`);

      expect(res.status).toBe(200);
      expect(res.body.record.first_name).toBe('Bob');
      expect(res.body.record.last_name).toBe('Johnson');
      expect(res.body.record.age).toBe(35);
      expect(res.body.record.is_preferred).toBe(true);
      expect(res.body.record.Names).toBeUndefined();
    });

    test('single endpoint returns 404 when record not found with flattening', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      await seedData(Person, PersonNames);

      app.use(
        '/persons',
        single(
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

      const res = await request(app).get('/persons/99999');

      expect(res.status).toBe(404);
    });

    test('single endpoint flattening works with array config', async () => {
      const ctx = await buildAppAndModels();
      const { Person, PersonNames, app } = ctx;
      const { person1 } = await seedData(Person, PersonNames);

      app.use(
        '/persons',
        single(
          Person,
          {
            flattening: [
              {
                model: PersonNames,
                as: 'Names',
                attributes: ['first_name', ['last_name', 'family_name']],
              },
            ],
          },
          {
            include: [{ model: PersonNames, as: 'Names', required: true }],
          }
        )
      );

      const res = await request(app).get(`/persons/${person1.id}`);

      expect(res.status).toBe(200);
      expect(res.body.record.first_name).toBe('John');
      expect(res.body.record.family_name).toBe('Doe');
      expect(res.body.record.last_name).toBeUndefined();
      expect(res.body.record.Names).toBeUndefined();
    });
  });
});
