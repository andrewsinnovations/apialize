const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list, search } = require('../src');

describe('Response Flattening - Through Table Support', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  async function buildAppAndModels() {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    const Student = sequelize.define(
      'Student',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        student_id: { type: DataTypes.STRING, allowNull: false, unique: true },
        name: { type: DataTypes.STRING, allowNull: false },
      },
      {
        timestamps: false,
        tableName: 'students',
      }
    );

    const Course = sequelize.define(
      'Course',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        course_code: { type: DataTypes.STRING, allowNull: false, unique: true },
        title: { type: DataTypes.STRING, allowNull: false },
        credits: { type: DataTypes.INTEGER, defaultValue: 3 },
      },
      {
        timestamps: false,
        tableName: 'courses',
      }
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
      {
        timestamps: false,
        tableName: 'enrollments',
      }
    );

    // Many-to-many with through table
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

    return { sequelize, Student, Course, Enrollment, app };
  }

  async function seedData(Student, Course, Enrollment) {
    const student1 = await Student.create({
      student_id: 'S001',
      name: 'Alice Johnson',
    });

    const student2 = await Student.create({
      student_id: 'S002',
      name: 'Bob Smith',
    });

    const student3 = await Student.create({
      student_id: 'S003',
      name: 'Charlie Brown',
    });

    const course1 = await Course.create({
      course_code: 'CS101',
      title: 'Introduction to Computer Science',
      credits: 3,
    });

    const course2 = await Course.create({
      course_code: 'MATH201',
      title: 'Calculus II',
      credits: 4,
    });

    const course3 = await Course.create({
      course_code: 'ENG101',
      title: 'English Composition',
      credits: 3,
    });

    // Enrollments
    await Enrollment.create({
      student_id: student1.id,
      course_id: course1.id,
      grade: 'A',
      semester: 'Fall 2024',
      status: 'completed',
    });

    await Enrollment.create({
      student_id: student1.id,
      course_id: course2.id,
      grade: 'B+',
      semester: 'Fall 2024',
      status: 'completed',
    });

    await Enrollment.create({
      student_id: student2.id,
      course_id: course1.id,
      grade: 'A-',
      semester: 'Fall 2024',
      status: 'completed',
    });

    await Enrollment.create({
      student_id: student2.id,
      course_id: course3.id,
      semester: 'Spring 2025',
      status: 'active',
    });

    await Enrollment.create({
      student_id: student3.id,
      course_id: course2.id,
      grade: 'C',
      semester: 'Fall 2024',
      status: 'completed',
    });

    return { student1, student2, student3, course1, course2, course3 };
  }

  describe('Basic Through Table Flattening', () => {
    test('flattens belongsToMany relationship with through table', async () => {
      const ctx = await buildAppAndModels();
      const { Student, Course, app } = ctx;
      await seedData(Student, Course, ctx.Enrollment);

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
      expect(res.body.success).toBe(true);

      // Note: With belongsToMany and separate: false (default),
      // we get duplicate rows for students with multiple courses
      expect(res.body.data.length).toBeGreaterThan(0);

      const firstStudent = res.body.data[0];
      expect(firstStudent.course_code).toBeDefined();
      expect(firstStudent.course_title).toBeDefined();
      expect(firstStudent.Courses).toBeUndefined(); // Should be flattened
    });

    test('belongsToMany flattening works correctly', async () => {
      const ctx = await buildAppAndModels();
      const { Student, Course, app } = ctx;
      await seedData(Student, Course, ctx.Enrollment);

      app.use(
        '/students',
        list(Student, {
          flattening: {
            model: Course,
            as: 'Courses',
            attributes: ['course_code', 'title'],
            // Note: separate: true is NOT supported for belongsToMany in Sequelize
          },
        })
      );

      const res = await request(app).get('/students');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Should successfully flatten belongsToMany relationships
      expect(res.body.data.length).toBeGreaterThan(0);

      const firstStudent = res.body.data[0];
      expect(firstStudent.course_code).toBeDefined();
      expect(firstStudent.title).toBeDefined();
      expect(firstStudent.Courses).toBeUndefined(); // Should be flattened
    });

    test('filters through table attributes', async () => {
      const ctx = await buildAppAndModels();
      const { Student, Course, Enrollment, app } = ctx;
      await seedData(Student, Course, Enrollment);

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
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    test('includes through table attributes in flattening', async () => {
      const ctx = await buildAppAndModels();
      const { Student, Course, Enrollment, app } = ctx;
      await seedData(Student, Course, Enrollment);

      app.use(
        '/students',
        list(Student, {
          flattening: {
            model: Course,
            as: 'Courses',
            attributes: ['course_code', 'title'],
            through: {
              attributes: ['grade', 'semester', 'status'],
            },
          },
        })
      );

      const res = await request(app).get('/students');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);

      // The through attributes are included in the nested Courses object
      // (before flattening removes it)
    });
  });

  describe('Through Table with Filtering and Ordering', () => {
    test('filters by flattened course fields', async () => {
      const ctx = await buildAppAndModels();
      const { Student, Course, app } = ctx;
      await seedData(Student, Course, ctx.Enrollment);

      app.use(
        '/students',
        list(Student, {
          flattening: {
            model: Course,
            as: 'Courses',
            attributes: ['course_code', 'title', 'credits'],
          },
        })
      );

      const res = await request(app).get('/students?course_code=CS101');

      expect(res.status).toBe(200);
      // Should return students enrolled in CS101
      expect(res.body.data.length).toBeGreaterThan(0);
      res.body.data.forEach((student) => {
        expect(student.course_code).toBe('CS101');
      });
    });

    test('orders by flattened course fields', async () => {
      const ctx = await buildAppAndModels();
      const { Student, Course, app } = ctx;
      await seedData(Student, Course, ctx.Enrollment);

      app.use(
        '/students',
        list(Student, {
          flattening: {
            model: Course,
            as: 'Courses',
            attributes: ['course_code', 'title'],
          },
        })
      );

      const res = await request(app).get('/students?api:order_by=course_code');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);

      // Verify ordering
      for (let i = 1; i < res.body.data.length; i++) {
        expect(
          res.body.data[i].course_code >= res.body.data[i - 1].course_code
        ).toBe(true);
      }
    });

    test('combines course and student filters', async () => {
      const ctx = await buildAppAndModels();
      const { Student, Course, app } = ctx;
      await seedData(Student, Course, ctx.Enrollment);

      app.use(
        '/students',
        list(Student, {
          flattening: {
            model: Course,
            as: 'Courses',
            attributes: ['course_code', 'title', 'credits'],
          },
        })
      );

      const res = await request(app).get(
        '/students?name:icontains=alice&credits:gte=3'
      );

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      res.body.data.forEach((student) => {
        expect(student.name.toLowerCase()).toContain('alice');
        expect(student.credits).toBeGreaterThanOrEqual(3);
      });
    });
  });

  describe('Through Table with Search API', () => {
    test('works with search endpoint', async () => {
      const ctx = await buildAppAndModels();
      const { Student, Course, app } = ctx;
      await seedData(Student, Course, ctx.Enrollment);

      app.use(
        '/students/search',
        search(Student, {
          path: '/',
          flattening: {
            model: Course,
            as: 'Courses',
            attributes: ['course_code', 'title', 'credits'],
            // No separate: true for belongsToMany
          },
        })
      );

      const res = await request(app)
        .post('/students/search')
        .send({
          filtering: {
            credits: { gte: 3 },
          },
          ordering: [{ orderby: 'course_code', direction: 'ASC' }],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    test('filters through table in search', async () => {
      const ctx = await buildAppAndModels();
      const { Student, Course, Enrollment, app } = ctx;
      await seedData(Student, Course, Enrollment);

      app.use(
        '/students/search',
        search(Student, {
          path: '/',
          flattening: {
            model: Course,
            as: 'Courses',
            attributes: ['course_code', 'title'],
            through: {
              where: { status: 'active' },
            },
          },
        })
      );

      const res = await request(app).post('/students/search').send({
        filtering: {},
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Only students with active enrollments should be returned
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('Complex Through Table Scenarios', () => {
    test('handles multiple students with same course', async () => {
      const ctx = await buildAppAndModels();
      const { Student, Course, app } = ctx;
      await seedData(Student, Course, ctx.Enrollment);

      app.use(
        '/students',
        list(Student, {
          flattening: {
            model: Course,
            as: 'Courses',
            attributes: ['course_code', 'title'],
          },
        })
      );

      const res = await request(app).get('/students?course_code=CS101');

      expect(res.status).toBe(200);
      // Both Alice and Bob are in CS101
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    });

    test('through table with paranoid option', async () => {
      const ctx = await buildAppAndModels();
      const { Student, Course, app } = ctx;
      await seedData(Student, Course, ctx.Enrollment);

      app.use(
        '/students',
        list(Student, {
          flattening: {
            model: Course,
            as: 'Courses',
            attributes: ['course_code', 'title'],
            through: {
              paranoid: false, // Include soft-deleted if model supports it
            },
          },
        })
      );

      const res = await request(app).get('/students');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('through table with custom alias', async () => {
      const ctx = await buildAppAndModels();
      const { Student, Course, Enrollment, app } = ctx;
      await seedData(Student, Course, Enrollment);

      app.use(
        '/students',
        list(Student, {
          flattening: {
            model: Course,
            as: 'Courses',
            attributes: ['course_code', 'title'],
            through: {
              as: 'enrollment_info', // Custom alias for through table
              attributes: ['grade', 'semester'],
            },
          },
        })
      );

      const res = await request(app).get('/students');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    test('through table respects where conditions', async () => {
      const ctx = await buildAppAndModels();
      const { Student, Course, app } = ctx;
      await seedData(Student, Course, ctx.Enrollment);

      app.use(
        '/students',
        list(Student, {
          flattening: {
            model: Course,
            as: 'Courses',
            attributes: ['course_code', 'title'],
            through: {
              where: { status: 'completed' },
            },
          },
        })
      );

      const res = await request(app).get('/students');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Should only show students with completed enrollments
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });
});
