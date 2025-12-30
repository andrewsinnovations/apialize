/**
 * Documentation Examples Test: flattening.md
 *
 * This test file validates that the code examples in documentation/flattening.md
 * work as expected and produce the documented outputs.
 */

const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes, Op } = require('sequelize');
const { list, search, single } = require('../src');

describe('Documentation Examples: flattening.md', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  // Helper to build app with Person and PersonNames models
  async function buildPersonApp() {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    const Person = sequelize.define(
      'Person',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        external_id: { type: DataTypes.STRING, allowNull: true },
        login: { type: DataTypes.STRING, allowNull: false },
        active: { type: DataTypes.BOOLEAN, defaultValue: true },
      },
      { timestamps: false, tableName: 'doc_flat_persons' }
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
      { timestamps: false, tableName: 'doc_flat_person_names' }
    );

    Person.hasOne(PersonNames, { foreignKey: 'person_id', as: 'Names' });
    PersonNames.belongsTo(Person, { foreignKey: 'person_id', as: 'Person' });

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());

    return { Person, PersonNames, app };
  }

  // Helper to build app with multiple related models
  async function buildMultiRelationApp() {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    const Person = sequelize.define(
      'Person',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        login: { type: DataTypes.STRING, allowNull: false },
      },
      { timestamps: false, tableName: 'doc_flat_persons2' }
    );

    const PersonNames = sequelize.define(
      'PersonNames',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        person_id: { type: DataTypes.INTEGER, allowNull: false },
        first_name: { type: DataTypes.STRING, allowNull: true },
        last_name: { type: DataTypes.STRING, allowNull: true },
      },
      { timestamps: false, tableName: 'doc_flat_person_names2' }
    );

    const Address = sequelize.define(
      'Address',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        person_id: { type: DataTypes.INTEGER, allowNull: false },
        city: { type: DataTypes.STRING, allowNull: true },
        country: { type: DataTypes.STRING, allowNull: true },
      },
      { timestamps: false, tableName: 'doc_flat_addresses' }
    );

    const ContactInfo = sequelize.define(
      'ContactInfo',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        person_id: { type: DataTypes.INTEGER, allowNull: false },
        email: { type: DataTypes.STRING, allowNull: true },
        phone: { type: DataTypes.STRING, allowNull: true },
      },
      { timestamps: false, tableName: 'doc_flat_contacts' }
    );

    Person.hasOne(PersonNames, { foreignKey: 'person_id', as: 'Names' });
    Person.hasOne(Address, { foreignKey: 'person_id', as: 'Addresses' });
    Person.hasOne(ContactInfo, { foreignKey: 'person_id', as: 'Contact' });

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());

    return { Person, PersonNames, Address, ContactInfo, app };
  }

  // Helper to build app with many-to-many relationship
  async function buildManyToManyApp() {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    const Student = sequelize.define(
      'Student',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        student_id: { type: DataTypes.STRING, allowNull: false, unique: true },
        name: { type: DataTypes.STRING, allowNull: false },
      },
      { timestamps: false, tableName: 'doc_flat_students' }
    );

    const Course = sequelize.define(
      'Course',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        course_code: { type: DataTypes.STRING, allowNull: false, unique: true },
        title: { type: DataTypes.STRING, allowNull: false },
        credits: { type: DataTypes.INTEGER, defaultValue: 3 },
      },
      { timestamps: false, tableName: 'doc_flat_courses' }
    );

    const Enrollment = sequelize.define(
      'Enrollment',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        student_id: { type: DataTypes.INTEGER, allowNull: false },
        course_id: { type: DataTypes.INTEGER, allowNull: false },
        grade: { type: DataTypes.STRING, allowNull: true },
        semester: { type: DataTypes.STRING, allowNull: false },
        status: { type: DataTypes.STRING, defaultValue: 'active' },
      },
      { timestamps: false, tableName: 'doc_flat_enrollments' }
    );

    Student.belongsToMany(Course, {
      through: Enrollment,
      foreignKey: 'student_id',
      otherKey: 'course_id',
      as: 'Courses',
    });

    Course.belongsToMany(Student, {
      through: Enrollment,
      foreignKey: 'course_id',
      otherKey: 'student_id',
      as: 'Students',
    });

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());

    return { Student, Course, Enrollment, app };
  }

  async function seedPersonData(Person, PersonNames) {
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
      is_active: true,
    });

    await PersonNames.create({
      person_id: person2.id,
      first_name: 'Jane',
      last_name: 'Smith',
      age: 25,
      is_preferred: false,
      is_active: true,
    });

    await PersonNames.create({
      person_id: person3.id,
      first_name: 'Bob',
      last_name: 'Johnson',
      age: 35,
      is_preferred: true,
      is_active: false,
    });

    return { person1, person2, person3 };
  }

  describe('Basic Usage', () => {
    test('without flattening - nested response', async () => {
      const { Person, PersonNames, app } = await buildPersonApp();
      await seedPersonData(Person, PersonNames);

      app.use(
        '/persons',
        list(
          Person,
          {},
          {
            include: [{ model: PersonNames, as: 'Names' }],
          }
        )
      );

      const res = await request(app).get('/persons');
      expect(res.status).toBe(200);
      expect(res.body.data[0].Names).toBeDefined();
      expect(res.body.data[0].Names.first_name).toBe('John');
    });

    test('with flattening - attributes lifted to parent', async () => {
      const { Person, PersonNames, app } = await buildPersonApp();
      await seedPersonData(Person, PersonNames);

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name', 'last_name'],
          },
        })
      );

      const res = await request(app).get('/persons');
      expect(res.status).toBe(200);
      expect(res.body.data[0].first_name).toBe('John');
      expect(res.body.data[0].last_name).toBe('Doe');
      expect(res.body.data[0].Names).toBeUndefined(); // Nested object removed
      expect(res.body.data[0].login).toBeDefined(); // Original fields remain
    });
  });

  describe('Attribute Configuration', () => {
    test('simple string attributes', async () => {
      const { Person, PersonNames, app } = await buildPersonApp();
      await seedPersonData(Person, PersonNames);

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name', 'last_name', 'age'],
          },
        })
      );

      const res = await request(app).get('/persons');
      expect(res.status).toBe(200);
      expect(res.body.data[0].first_name).toBeDefined();
      expect(res.body.data[0].last_name).toBeDefined();
      expect(res.body.data[0].age).toBeDefined();
    });

    test('array with alias - [originalName, aliasName]', async () => {
      const { Person, PersonNames, app } = await buildPersonApp();
      await seedPersonData(Person, PersonNames);

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: [
              'first_name',
              ['last_name', 'surname'],
              ['age', 'person_age'],
            ],
          },
        })
      );

      const res = await request(app).get('/persons');
      expect(res.status).toBe(200);

      const firstPerson = res.body.data[0];
      expect(firstPerson.first_name).toBe('John');
      expect(firstPerson.surname).toBe('Doe'); // Aliased
      expect(firstPerson.person_age).toBe(30); // Aliased
      expect(firstPerson.last_name).toBeUndefined(); // Original name not present
      expect(firstPerson.age).toBeUndefined(); // Original name not present
    });
  });

  describe('Include Options', () => {
    test('where clause filters included model', async () => {
      const { Person, PersonNames, app } = await buildPersonApp();
      await seedPersonData(Person, PersonNames);

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
      // Bob's name is_active: false, so excluded
      expect(res.body.data).toHaveLength(2);
      const names = res.body.data.map((p) => p.first_name);
      expect(names).toContain('John');
      expect(names).toContain('Jane');
      expect(names).not.toContain('Bob');
    });

    test('required: false uses left join', async () => {
      const { Person, PersonNames, app } = await buildPersonApp();

      // Create person without PersonNames
      await Person.create({
        external_id: 'person-999',
        login: 'no.name@example.com',
      });

      await seedPersonData(Person, PersonNames);

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name'],
            required: false, // Left join - include persons without names
          },
        })
      );

      const res = await request(app).get('/persons');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(4); // All persons including one without names
    });
  });

  describe('Custom Join Conditions (on)', () => {
    test('custom join conditions using on option', async () => {
      const { Person, PersonNames, app } = await buildPersonApp();
      await seedPersonData(Person, PersonNames);

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
      // Only persons with is_active: true names should be returned
      expect(res.body.data).toHaveLength(2); // John and Jane (Bob's name is_active: false)
      const names = res.body.data.map((p) => p.first_name);
      expect(names).toContain('John');
      expect(names).toContain('Jane');
      expect(names).not.toContain('Bob');
    });
  });

  describe('Auto-Include Creation', () => {
    test('creates include automatically when not explicitly provided', async () => {
      const { Person, PersonNames, app } = await buildPersonApp();
      await seedPersonData(Person, PersonNames);

      // No include specified in modelOptions
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
          {} // Empty modelOptions
        )
      );

      const res = await request(app).get('/persons');
      expect(res.status).toBe(200);
      expect(res.body.data[0].first_name).toBeDefined();
      expect(res.body.data[0].last_name).toBeDefined();
    });
  });

  describe('Multiple Flattenings', () => {
    test('flattens multiple associations with array configuration', async () => {
      const { Person, PersonNames, Address, ContactInfo, app } =
        await buildMultiRelationApp();

      const person = await Person.create({ login: 'john@example.com' });
      await PersonNames.create({
        person_id: person.id,
        first_name: 'John',
        last_name: 'Doe',
      });
      await Address.create({
        person_id: person.id,
        city: 'New York',
        country: 'USA',
      });
      await ContactInfo.create({
        person_id: person.id,
        email: 'john@example.com',
        phone: '555-0001',
      });

      app.use(
        '/persons',
        list(Person, {
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
            {
              model: ContactInfo,
              as: 'Contact',
              attributes: [['email', 'email_address'], 'phone'],
            },
          ],
        })
      );

      const res = await request(app).get('/persons');
      expect(res.status).toBe(200);

      const firstPerson = res.body.data[0];
      expect(firstPerson.first_name).toBe('John');
      expect(firstPerson.last_name).toBe('Doe');
      expect(firstPerson.city).toBe('New York');
      expect(firstPerson.country).toBe('USA');
      expect(firstPerson.email_address).toBe('john@example.com');
      expect(firstPerson.phone).toBe('555-0001');
      expect(firstPerson.Names).toBeUndefined();
      expect(firstPerson.Addresses).toBeUndefined();
      expect(firstPerson.Contact).toBeUndefined();
    });
  });

  describe('Filtering on Flattened Fields', () => {
    test('simple equality filter', async () => {
      const { Person, PersonNames, app } = await buildPersonApp();
      await seedPersonData(Person, PersonNames);

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name', 'last_name'],
          },
        })
      );

      const res = await request(app).get('/persons?first_name=John');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].first_name).toBe('John');
    });

    test('filter operators on flattened fields', async () => {
      const { Person, PersonNames, app } = await buildPersonApp();
      await seedPersonData(Person, PersonNames);

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

      // icontains operator
      const containsRes = await request(app).get(
        '/persons?first_name:icontains=jo'
      );
      expect(containsRes.status).toBe(200);
      expect(containsRes.body.data).toHaveLength(1);
      expect(containsRes.body.data[0].first_name).toBe('John');

      // gte operator
      const ageRes = await request(app).get('/persons?age:gte=30');
      expect(ageRes.status).toBe(200);
      expect(ageRes.body.data).toHaveLength(2); // John (30) and Bob (35)
    });

    test('filter on aliased flattened field', async () => {
      const { Person, PersonNames, app } = await buildPersonApp();
      await seedPersonData(Person, PersonNames);

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: [['last_name', 'surname']],
          },
        })
      );

      const res = await request(app).get('/persons?surname=Smith');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].surname).toBe('Smith');
    });

    test('combining flattened and regular field filters', async () => {
      const { Person, PersonNames, app } = await buildPersonApp();
      await seedPersonData(Person, PersonNames);

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

      const res = await request(app).get(
        '/persons?first_name=John&login=john.doe@example.com'
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].first_name).toBe('John');
      expect(res.body.data[0].login).toBe('john.doe@example.com');
    });

    test('in operator on flattened fields', async () => {
      const { Person, PersonNames, app } = await buildPersonApp();
      await seedPersonData(Person, PersonNames);

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

      const res = await request(app).get('/persons?first_name:in=John,Jane');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      const names = res.body.data.map((p) => p.first_name);
      expect(names).toContain('John');
      expect(names).toContain('Jane');
    });
  });

  describe('Ordering on Flattened Fields', () => {
    test('order by flattened field ascending', async () => {
      const { Person, PersonNames, app } = await buildPersonApp();
      await seedPersonData(Person, PersonNames);

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name', 'last_name'],
          },
        })
      );

      const res = await request(app).get('/persons?api:order_by=last_name');
      expect(res.status).toBe(200);
      expect(res.body.data[0].last_name).toBe('Doe');
      expect(res.body.data[1].last_name).toBe('Johnson');
      expect(res.body.data[2].last_name).toBe('Smith');
    });

    test('order by aliased flattened field descending', async () => {
      const { Person, PersonNames, app } = await buildPersonApp();
      await seedPersonData(Person, PersonNames);

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: [['last_name', 'surname']],
          },
        })
      );

      const res = await request(app).get('/persons?api:order_by=-surname');
      expect(res.status).toBe(200);
      expect(res.body.data[0].surname).toBe('Smith');
      expect(res.body.data[1].surname).toBe('Johnson');
      expect(res.body.data[2].surname).toBe('Doe');
    });

    test('multi-field ordering with flattened fields', async () => {
      const { Person, PersonNames, app } = await buildPersonApp();
      await seedPersonData(Person, PersonNames);

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

      const res = await request(app).get('/persons?api:order_by=age,first_name');
      expect(res.status).toBe(200);
      expect(res.body.data[0].age).toBe(25); // Jane
      expect(res.body.data[1].age).toBe(30); // John
      expect(res.body.data[2].age).toBe(35); // Bob
    });
  });

  describe('Search Operation', () => {
    test('flattening works in search endpoint', async () => {
      const { Person, PersonNames, app } = await buildPersonApp();
      await seedPersonData(Person, PersonNames);

      app.use(
        '/persons',
        search(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name', ['last_name', 'surname']],
          },
        })
      );

      const res = await request(app).post('/persons/search').send({
        filtering: {
          first_name: 'John',
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].first_name).toBe('John');
      expect(res.body.data[0].surname).toBe('Doe');
    });
  });

  describe('Single Operation', () => {
    test('flattening works in single endpoint', async () => {
      const { Person, PersonNames, app } = await buildPersonApp();
      const { person1 } = await seedPersonData(Person, PersonNames);

      app.use(
        '/persons',
        single(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name', 'last_name'],
          },
        })
      );

      const res = await request(app).get(`/persons/${person1.id}`);
      expect(res.status).toBe(200);
      expect(res.body.record.first_name).toBe('John');
      expect(res.body.record.last_name).toBe('Doe');
      expect(res.body.record.Names).toBeUndefined();
    });
  });

  describe('Working with ID Mapping', () => {
    test('flattening works with id_mapping', async () => {
      const { Person, PersonNames, app } = await buildPersonApp();
      await seedPersonData(Person, PersonNames);

      app.use(
        '/persons',
        list(Person, {
          id_mapping: 'external_id',
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name', ['last_name', 'surname']],
          },
        })
      );

      const res = await request(app).get('/persons');
      expect(res.status).toBe(200);

      const firstPerson = res.body.data[0];
      expect(firstPerson.id).toBe('person-123'); // Uses external_id
      expect(firstPerson.first_name).toBe('John');
      expect(firstPerson.surname).toBe('Doe');
    });
  });

  describe('Many-to-Many Relationships', () => {
    test('flattens belongsToMany relationship', async () => {
      const { Student, Course, Enrollment, app } = await buildManyToManyApp();

      const student = await Student.create({
        student_id: 'S001',
        name: 'Alice Johnson',
      });

      const course = await Course.create({
        course_code: 'CS101',
        title: 'Introduction to Computer Science',
        credits: 3,
      });

      await Enrollment.create({
        student_id: student.id,
        course_id: course.id,
        grade: 'A',
        semester: 'Fall 2024',
        status: 'completed',
      });

      app.use(
        '/students',
        list(Student, {
          flattening: {
            model: Course,
            as: 'Courses',
            attributes: ['course_code', ['title', 'course_title']],
          },
        })
      );

      const res = await request(app).get('/students');
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);

      const firstStudent = res.body.data[0];
      expect(firstStudent.course_code).toBe('CS101');
      expect(firstStudent.course_title).toBe('Introduction to Computer Science');
      expect(firstStudent.Courses).toBeUndefined();
    });

    test('through table options', async () => {
      const { Student, Course, Enrollment, app } = await buildManyToManyApp();

      const student = await Student.create({
        student_id: 'S001',
        name: 'Alice Johnson',
      });

      const course1 = await Course.create({
        course_code: 'CS101',
        title: 'Intro to CS',
      });

      const course2 = await Course.create({
        course_code: 'MATH201',
        title: 'Calculus II',
      });

      await Enrollment.create({
        student_id: student.id,
        course_id: course1.id,
        grade: 'A',
        semester: 'Fall 2024',
        status: 'completed',
      });

      await Enrollment.create({
        student_id: student.id,
        course_id: course2.id,
        semester: 'Spring 2025',
        status: 'active', // Not completed
      });

      app.use(
        '/students',
        list(Student, {
          flattening: {
            model: Course,
            as: 'Courses',
            attributes: ['course_code', 'title'],
            through: {
              where: { status: 'completed' }, // Only completed enrollments
            },
          },
        })
      );

      const res = await request(app).get('/students');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1); // Only one course is completed
      expect(res.body.data[0].course_code).toBe('CS101');
    });
  });

  describe('Best Practices', () => {
    test('use aliases to avoid collisions', async () => {
      const { Person, PersonNames, app } = await buildPersonApp();
      await seedPersonData(Person, PersonNames);

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: [
              ['id', 'name_id'], // Avoid collision with Person.id
              'first_name',
            ],
          },
        })
      );

      const res = await request(app).get('/persons');
      expect(res.status).toBe(200);

      const firstPerson = res.body.data[0];
      // Person.id should still be present
      expect(firstPerson.id).toBeDefined();
      expect(typeof firstPerson.id).toBe('number');
      // PersonNames.id should be aliased to name_id
      expect(firstPerson.name_id).toBeDefined();
      expect(firstPerson.first_name).toBeDefined();
      // The alias prevents the PersonNames.id from overwriting Person.id
      // (Both happen to be the same value in this seed data, but the alias
      // ensures they are stored under different keys)
    });
  });

  describe('Advanced Filter Operators on Flattened Fields', () => {
    test('starts_with and ends_with', async () => {
      const { Person, PersonNames, app } = await buildPersonApp();
      await seedPersonData(Person, PersonNames);

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name', 'last_name'],
          },
        })
      );

      const startsRes = await request(app).get(
        '/persons?first_name:starts_with=Jo'
      );
      expect(startsRes.status).toBe(200);
      expect(startsRes.body.data).toHaveLength(1);
      expect(startsRes.body.data[0].first_name).toBe('John');

      const endsRes = await request(app).get('/persons?last_name:ends_with=son');
      expect(endsRes.status).toBe(200);
      expect(endsRes.body.data).toHaveLength(1);
      expect(endsRes.body.data[0].last_name).toBe('Johnson');
    });

    test('boolean operators (is_true, is_false)', async () => {
      const { Person, PersonNames, app } = await buildPersonApp();
      await seedPersonData(Person, PersonNames);

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name', 'is_preferred'],
          },
        })
      );

      const isTrueRes = await request(app).get('/persons?is_preferred:is_true');
      expect(isTrueRes.status).toBe(200);
      expect(isTrueRes.body.data).toHaveLength(2); // John and Bob
      const preferredNames = isTrueRes.body.data.map((p) => p.first_name);
      expect(preferredNames).toContain('John');
      expect(preferredNames).toContain('Bob');

      const isFalseRes = await request(app).get('/persons?is_preferred:is_false');
      expect(isFalseRes.status).toBe(200);
      expect(isFalseRes.body.data).toHaveLength(1);
      expect(isFalseRes.body.data[0].first_name).toBe('Jane');
    });

    test('comparison operators (lt, lte, gt, neq)', async () => {
      const { Person, PersonNames, app } = await buildPersonApp();
      await seedPersonData(Person, PersonNames);

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

      const ltRes = await request(app).get('/persons?age:lt=30');
      expect(ltRes.status).toBe(200);
      expect(ltRes.body.data).toHaveLength(1);
      expect(ltRes.body.data[0].first_name).toBe('Jane');

      const neqRes = await request(app).get('/persons?age:neq=30');
      expect(neqRes.status).toBe(200);
      expect(neqRes.body.data).toHaveLength(2);
      const ages = neqRes.body.data.map((p) => p.age);
      expect(ages).toContain(25);
      expect(ages).toContain(35);
      expect(ages).not.toContain(30);
    });
  });

  describe('Complex Filtering Combinations', () => {
    test('multiple filter operators on flattened fields', async () => {
      const { Person, PersonNames, app } = await buildPersonApp();
      await seedPersonData(Person, PersonNames);

      app.use(
        '/persons',
        list(Person, {
          flattening: {
            model: PersonNames,
            as: 'Names',
            attributes: ['first_name', 'age', 'is_preferred'],
          },
        })
      );

      const res = await request(app).get(
        '/persons?age:gte=25&is_preferred:is_true&first_name:starts_with=J'
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1); // Only John matches all criteria
      expect(res.body.data[0].first_name).toBe('John');
    });
  });
});
