/**
 * Test for relation_id_mapping with UUID external_id fields
 * Verifies that foreign key lookups use the actual database primary key
 * instead of incorrectly trying to use the UUID external_id field
 */
const { DataTypes } = require('sequelize');
const { Sequelize } = require('sequelize');
const express = require('express');
const request = require('supertest');
const { search } = require('../src/index');

describe('relation_id_mapping with UUID external_id', () => {
  let sequelize;
  let Category;
  let Team;
  let app;

  beforeAll(async () => {
    sequelize = new Sequelize('sqlite::memory:', {
      logging: false,
    });

    // Define Category model with external_id (UUID)
    Category = sequelize.define(
      'Category',
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        title: {
          type: DataTypes.STRING(191),
          allowNull: false,
        },
        external_id: {
          type: DataTypes.UUID,
          allowNull: false,
          defaultValue: DataTypes.UUIDV4,
        },
      },
      {
        tableName: 'categories',
        timestamps: false,
      }
    );

    // Define Team model with category_id foreign key
    Team = sequelize.define(
      'Team',
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        name: {
          type: DataTypes.STRING(1024),
          allowNull: false,
        },
        category_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'categories',
            key: 'id',
          },
        },
        external_id: {
          type: DataTypes.UUID,
          allowNull: false,
          defaultValue: DataTypes.UUIDV4,
        },
      },
      {
        tableName: 'teams',
        timestamps: false,
      }
    );

    // Define associations
    Team.belongsTo(Category, {
      foreignKey: 'category_id',
      as: 'category',
    });

    Category.hasMany(Team, {
      foreignKey: 'category_id',
      as: 'teams',
    });

    await sequelize.sync({ force: true });

    // Create test data
    const category = await Category.create({
      title: 'Test Category',
    });

    await Team.create({
      name: 'Team 1',
      category_id: category.id,
    });

    await Team.create({
      name: 'Team 2',
      category_id: category.id,
    });

    // Setup Express app with apialize
    app = express();
    app.use(express.json());

    const router = express.Router();
    router.use(
      search(Team, {
        id_mapping: 'external_id',
        relation_id_mapping: [
          {
            model: Category,
            id_field: 'external_id',
          },
        ],
      })
    );

    app.use('/teams', router);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  test('should handle search with relation_id_mapping for UUID external_id fields', async () => {
    const response = await request(app)
      .post('/teams/search')
      .send({})
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0]).toHaveProperty('id');
    expect(response.body.data[0]).toHaveProperty('name');
    expect(response.body.data[0]).toHaveProperty('category_id');

    // Verify the id field is mapped from external_id (UUID)
    expect(response.body.data[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );

    // Verify category_id is also mapped to UUID (from Category's external_id)
    expect(response.body.data[0].category_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  test('should handle search with filters on foreign key', async () => {
    const category = await Category.findOne();

    const response = await request(app)
      .post('/teams/search')
      .send({
        filters: {
          category_id: category.external_id, // Using UUID from external_id
        },
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0].category_id).toBe(category.external_id);
  });

  test('should check what primaryKeyAttribute is', async () => {
    console.log('Team.primaryKeyAttribute:', Team.primaryKeyAttribute);
    console.log('Category.primaryKeyAttribute:', Category.primaryKeyAttribute);

    const teamRaw = await Team.findOne({ raw: true });
    console.log('Team raw from DB:', teamRaw);

    expect(Team.primaryKeyAttribute).toBe('id');
    expect(Category.primaryKeyAttribute).toBe('id');
  });
});
