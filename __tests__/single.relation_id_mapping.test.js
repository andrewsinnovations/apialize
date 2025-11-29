const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { single } = require('../src');

describe('Single Operation - relation_id_mapping', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  async function buildAppAndModels() {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    const Company = sequelize.define(
      'Company',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        company_uuid: { type: DataTypes.UUID, allowNull: false },
        name: { type: DataTypes.STRING, allowNull: false },
      },
      {
        timestamps: false,
        tableName: 'companies',
      }
    );

    const Department = sequelize.define(
      'Department',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        dept_uuid: { type: DataTypes.UUID, allowNull: false },
        company_id: { type: DataTypes.INTEGER, allowNull: false },
        name: { type: DataTypes.STRING, allowNull: false },
      },
      {
        timestamps: false,
        tableName: 'departments',
      }
    );

    const Employee = sequelize.define(
      'Employee',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        emp_uuid: { type: DataTypes.UUID, allowNull: false },
        department_id: { type: DataTypes.INTEGER, allowNull: false },
        company_id: { type: DataTypes.INTEGER, allowNull: false },
        first_name: { type: DataTypes.STRING, allowNull: false },
        last_name: { type: DataTypes.STRING, allowNull: false },
      },
      {
        timestamps: false,
        tableName: 'employees',
      }
    );

    // Associations
    Company.hasMany(Department, {
      foreignKey: 'company_id',
      as: 'Departments',
    });
    Department.belongsTo(Company, { foreignKey: 'company_id', as: 'Company' });

    Department.hasMany(Employee, {
      foreignKey: 'department_id',
      as: 'Employees',
    });
    Employee.belongsTo(Department, {
      foreignKey: 'department_id',
      as: 'Department',
    });

    Company.hasMany(Employee, { foreignKey: 'company_id', as: 'Employees' });
    Employee.belongsTo(Company, { foreignKey: 'company_id', as: 'Company' });

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());

    return { sequelize, Company, Department, Employee, app };
  }

  async function seedData(Company, Department, Employee) {
    const company1 = await Company.create({
      company_uuid: 'c1111111-1111-1111-1111-111111111111',
      name: 'Tech Corp',
    });

    const company2 = await Company.create({
      company_uuid: 'c2222222-2222-2222-2222-222222222222',
      name: 'Innovation Inc',
    });

    const dept1 = await Department.create({
      dept_uuid: 'd1111111-1111-1111-1111-111111111111',
      company_id: company1.id,
      name: 'Engineering',
    });

    const dept2 = await Department.create({
      dept_uuid: 'd2222222-2222-2222-2222-222222222222',
      company_id: company1.id,
      name: 'Marketing',
    });

    const emp1 = await Employee.create({
      emp_uuid: 'e1111111-1111-1111-1111-111111111111',
      department_id: dept1.id,
      company_id: company1.id,
      first_name: 'John',
      last_name: 'Doe',
    });

    const emp2 = await Employee.create({
      emp_uuid: 'e2222222-2222-2222-2222-222222222222',
      department_id: dept1.id,
      company_id: company1.id,
      first_name: 'Jane',
      last_name: 'Smith',
    });

    const emp3 = await Employee.create({
      emp_uuid: 'e3333333-3333-3333-3333-333333333333',
      department_id: dept2.id,
      company_id: company1.id,
      first_name: 'Bob',
      last_name: 'Johnson',
    });

    return { company1, company2, dept1, dept2, emp1, emp2, emp3 };
  }

  describe('Basic relation_id_mapping', () => {
    test('maps single related model foreign key to UUID', async () => {
      const ctx = await buildAppAndModels();
      const { Company, Department, Employee, app } = ctx;
      const { emp1 } = await seedData(Company, Department, Employee);

      app.use(
        '/employees',
        single(
          Employee,
          {
            id_mapping: 'emp_uuid',
            relation_id_mapping: [
              {
                model: Department,
                id_field: 'dept_uuid',
              },
            ],
          },
          {
            include: [{ model: Department, as: 'Department' }],
          }
        )
      );

      const res = await request(app).get(
        '/employees/e1111111-1111-1111-1111-111111111111'
      );

      expect(res.status).toBe(200);
      expect(res.body.record.id).toBe('e1111111-1111-1111-1111-111111111111');
      expect(res.body.record.department_id).toBe(
        'd1111111-1111-1111-1111-111111111111'
      ); // Mapped to UUID
      expect(res.body.record.Department).toBeDefined();
      expect(res.body.record.Department.id).toBe(
        'd1111111-1111-1111-1111-111111111111'
      );
    });

    test('maps multiple related models foreign keys', async () => {
      const ctx = await buildAppAndModels();
      const { Company, Department, Employee, app } = ctx;
      const { emp1 } = await seedData(Company, Department, Employee);

      app.use(
        '/employees',
        single(
          Employee,
          {
            id_mapping: 'emp_uuid',
            relation_id_mapping: [
              {
                model: Department,
                id_field: 'dept_uuid',
              },
              {
                model: Company,
                id_field: 'company_uuid',
              },
            ],
          },
          {
            include: [
              { model: Department, as: 'Department' },
              { model: Company, as: 'Company' },
            ],
          }
        )
      );

      const res = await request(app).get(
        '/employees/e1111111-1111-1111-1111-111111111111'
      );

      expect(res.status).toBe(200);
      expect(res.body.record.department_id).toBe(
        'd1111111-1111-1111-1111-111111111111'
      );
      expect(res.body.record.company_id).toBe(
        'c1111111-1111-1111-1111-111111111111'
      );
      expect(res.body.record.Department.id).toBe(
        'd1111111-1111-1111-1111-111111111111'
      );
      expect(res.body.record.Company.id).toBe(
        'c1111111-1111-1111-1111-111111111111'
      );
    });

    test('works without explicit includes - auto-created from flattening', async () => {
      const ctx = await buildAppAndModels();
      const { Company, Department, Employee, app } = ctx;
      const { emp1 } = await seedData(Company, Department, Employee);

      app.use(
        '/employees',
        single(Employee, {
          id_mapping: 'emp_uuid',
          relation_id_mapping: [
            {
              model: Department,
              id_field: 'dept_uuid',
            },
          ],
          flattening: {
            model: Department,
            as: 'Department',
            attributes: ['name'],
          },
        })
      );

      const res = await request(app).get(
        '/employees/e1111111-1111-1111-1111-111111111111'
      );

      expect(res.status).toBe(200);
      expect(res.body.record.department_id).toBe(
        'd1111111-1111-1111-1111-111111111111'
      );
      expect(res.body.record.name).toBe('Engineering'); // Flattened from Department
    });
  });

  describe('relation_id_mapping with flattening', () => {
    test('applies both relation_id_mapping and flattening', async () => {
      const ctx = await buildAppAndModels();
      const { Company, Department, Employee, app } = ctx;
      const { emp1 } = await seedData(Company, Department, Employee);

      app.use(
        '/employees',
        single(
          Employee,
          {
            id_mapping: 'emp_uuid',
            relation_id_mapping: [
              {
                model: Department,
                id_field: 'dept_uuid',
              },
              {
                model: Company,
                id_field: 'company_uuid',
              },
            ],
            flattening: [
              {
                model: Department,
                as: 'Department',
                attributes: [['name', 'department_name']],
              },
              {
                model: Company,
                as: 'Company',
                attributes: [['name', 'company_name']],
              },
            ],
          },
          {
            include: [
              { model: Department, as: 'Department' },
              { model: Company, as: 'Company' },
            ],
          }
        )
      );

      const res = await request(app).get(
        '/employees/e1111111-1111-1111-1111-111111111111'
      );

      expect(res.status).toBe(200);
      expect(res.body.record.id).toBe('e1111111-1111-1111-1111-111111111111');
      // Foreign keys should be mapped
      expect(res.body.record.department_id).toBe(
        'd1111111-1111-1111-1111-111111111111'
      );
      expect(res.body.record.company_id).toBe(
        'c1111111-1111-1111-1111-111111111111'
      );
      // Flattened attributes should be present
      expect(res.body.record.department_name).toBe('Engineering');
      expect(res.body.record.company_name).toBe('Tech Corp');
      // Nested objects should be removed
      expect(res.body.record.Department).toBeUndefined();
      expect(res.body.record.Company).toBeUndefined();
    });

    test('relation_id_mapping works with array flattening configs', async () => {
      const ctx = await buildAppAndModels();
      const { Company, Department, Employee, app } = ctx;
      const { emp1 } = await seedData(Company, Department, Employee);

      app.use(
        '/employees',
        single(Employee, {
          id_mapping: 'emp_uuid',
          relation_id_mapping: [
            {
              model: Department,
              id_field: 'dept_uuid',
            },
            {
              model: Company,
              id_field: 'company_uuid',
            },
          ],
          flattening: [
            {
              model: Department,
              as: 'Department',
              attributes: ['name'],
            },
            {
              model: Company,
              as: 'Company',
              attributes: [['name', 'company_name']],
            },
          ],
        })
      );

      const res = await request(app).get(
        '/employees/e1111111-1111-1111-1111-111111111111'
      );

      expect(res.status).toBe(200);
      expect(res.body.record.department_id).toBe(
        'd1111111-1111-1111-1111-111111111111'
      );
      expect(res.body.record.company_id).toBe(
        'c1111111-1111-1111-1111-111111111111'
      );
      expect(res.body.record.name).toBe('Engineering');
      expect(res.body.record.company_name).toBe('Tech Corp');
    });
  });

  describe('Edge cases', () => {
    test('works with no includes and no flattening', async () => {
      const ctx = await buildAppAndModels();
      const { Company, Department, Employee, app } = ctx;
      const { emp1 } = await seedData(Company, Department, Employee);

      // Even without includes, the foreign keys should still be mapped
      app.use(
        '/employees',
        single(Employee, {
          id_mapping: 'emp_uuid',
          relation_id_mapping: [
            {
              model: Department,
              id_field: 'dept_uuid',
            },
          ],
        })
      );

      const res = await request(app).get(
        '/employees/e1111111-1111-1111-1111-111111111111'
      );

      expect(res.status).toBe(200);
      expect(res.body.record.id).toBe('e1111111-1111-1111-1111-111111111111');
      // Foreign key should still be mapped even without include
      expect(res.body.record.department_id).toBe(
        'd1111111-1111-1111-1111-111111111111'
      );
    });

    test('handles null relation_id_mapping gracefully', async () => {
      const ctx = await buildAppAndModels();
      const { Company, Department, Employee, app } = ctx;
      const { emp1 } = await seedData(Company, Department, Employee);

      app.use(
        '/employees',
        single(
          Employee,
          {
            id_mapping: 'emp_uuid',
            relation_id_mapping: null,
          },
          {
            include: [{ model: Department, as: 'Department' }],
          }
        )
      );

      const res = await request(app).get(
        '/employees/e1111111-1111-1111-1111-111111111111'
      );

      expect(res.status).toBe(200);
      expect(res.body.record.id).toBe('e1111111-1111-1111-1111-111111111111');
      // Should return internal ID when no mapping
      expect(typeof res.body.record.department_id).toBe('number');
    });

    test('handles empty relation_id_mapping array', async () => {
      const ctx = await buildAppAndModels();
      const { Company, Department, Employee, app } = ctx;
      const { emp1 } = await seedData(Company, Department, Employee);

      app.use(
        '/employees',
        single(
          Employee,
          {
            id_mapping: 'emp_uuid',
            relation_id_mapping: [],
          },
          {
            include: [{ model: Department, as: 'Department' }],
          }
        )
      );

      const res = await request(app).get(
        '/employees/e1111111-1111-1111-1111-111111111111'
      );

      expect(res.status).toBe(200);
      expect(typeof res.body.record.department_id).toBe('number');
    });
  });

  describe('Nested includes with relation_id_mapping', () => {
    test('maps IDs for nested includes', async () => {
      const ctx = await buildAppAndModels();
      const { Company, Department, Employee, app } = ctx;
      const { emp1 } = await seedData(Company, Department, Employee);

      app.use(
        '/employees',
        single(
          Employee,
          {
            id_mapping: 'emp_uuid',
            relation_id_mapping: [
              {
                model: Department,
                id_field: 'dept_uuid',
              },
              {
                model: Company,
                id_field: 'company_uuid',
              },
            ],
          },
          {
            include: [
              {
                model: Department,
                as: 'Department',
                include: [{ model: Company, as: 'Company' }],
              },
            ],
          }
        )
      );

      const res = await request(app).get(
        '/employees/e1111111-1111-1111-1111-111111111111'
      );

      expect(res.status).toBe(200);
      expect(res.body.record.department_id).toBe(
        'd1111111-1111-1111-1111-111111111111'
      );
      expect(res.body.record.Department.id).toBe(
        'd1111111-1111-1111-1111-111111111111'
      );
      expect(res.body.record.Department.company_id).toBe(
        'c1111111-1111-1111-1111-111111111111'
      );
      expect(res.body.record.Department.Company.id).toBe(
        'c1111111-1111-1111-1111-111111111111'
      );
    });
  });

  describe('Compatibility with existing functionality', () => {
    test('works alongside standard id_mapping', async () => {
      const ctx = await buildAppAndModels();
      const { Company, Department, Employee, app } = ctx;
      const { dept1 } = await seedData(Company, Department, Employee);

      app.use(
        '/departments',
        single(
          Department,
          {
            id_mapping: 'dept_uuid',
            relation_id_mapping: [
              {
                model: Company,
                id_field: 'company_uuid',
              },
            ],
          },
          {
            include: [{ model: Company, as: 'Company' }],
          }
        )
      );

      const res = await request(app).get(
        '/departments/d1111111-1111-1111-1111-111111111111'
      );

      expect(res.status).toBe(200);
      expect(res.body.record.id).toBe('d1111111-1111-1111-1111-111111111111');
      expect(res.body.record.company_id).toBe(
        'c1111111-1111-1111-1111-111111111111'
      );
    });

    test('does not break when no includes are present', async () => {
      const ctx = await buildAppAndModels();
      const { Company, Department, Employee, app } = ctx;
      const { emp1 } = await seedData(Company, Department, Employee);

      app.use(
        '/employees',
        single(Employee, {
          id_mapping: 'emp_uuid',
          relation_id_mapping: [
            {
              model: Department,
              id_field: 'dept_uuid',
            },
          ],
        })
      );

      const res = await request(app).get(
        '/employees/e1111111-1111-1111-1111-111111111111'
      );

      expect(res.status).toBe(200);
      expect(res.body.record.first_name).toBe('John');
    });
  });
});
