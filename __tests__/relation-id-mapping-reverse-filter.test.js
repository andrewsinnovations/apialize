const express = require('express');
const request = require('supertest');
const Sequelize = require('sequelize');
const { list, search, single } = require('../src/index');

describe('Relation ID Mapping - Reverse Filter (UUID to external_id)', () => {
  let sequelize;
  let Team;
  let Category;
  let app;
  let createdCategory;
  let createdTeam;

  beforeAll(async () => {
    sequelize = new Sequelize('sqlite::memory:', {
      logging: false,
    });

    Category = sequelize.define(
      'Category',
      {
        id: {
          type: Sequelize.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        external_id: {
          type: Sequelize.UUID,
          unique: true,
          defaultValue: Sequelize.UUIDV4,
        },
        name: { type: Sequelize.STRING },
      },
      {
        timestamps: false,
      }
    );

    Team = sequelize.define(
      'Team',
      {
        id: {
          type: Sequelize.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        external_id: {
          type: Sequelize.UUID,
          unique: true,
          defaultValue: Sequelize.UUIDV4,
        },
        name: { type: Sequelize.STRING },
        category_id: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
      },
      {
        timestamps: false,
      }
    );

    Team.belongsTo(Category, { foreignKey: 'category_id', as: 'Category' });

    await sequelize.sync({ force: true });

    // Create test data
    createdCategory = await Category.create({ name: 'Test Category' });
    createdTeam = await Team.create({
      name: 'Team 1',
      category_id: createdCategory.id,
    });

    app = express();
    app.use(express.json());

    const relationMapping = [{ model: Category, id_field: 'external_id' }];

    const router = express.Router();

    router.use(
      list(Team, {
        relation_id_mapping: relationMapping,
      })
    );

    router.use(
      search(Team, {
        relation_id_mapping: relationMapping,
      })
    );

    router.use(
      single(Team, {
        relation_id_mapping: relationMapping,
      })
    );

    app.use('/teams', router);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('Search endpoint with reverse FK mapping', () => {
    it('should filter by category_id using UUID (external_id)', async () => {
      const response = await request(app)
        .post('/teams/search')
        .send({
          filtering: {
            category_id: createdCategory.external_id,
          },
        })
        .expect(200);

      expect(response.body.data).toBeDefined();
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].name).toBe('Team 1');
      expect(response.body.data[0].category_id).toBe(
        createdCategory.external_id
      );
    });

    // TODO: Complex operators like 'in' with reverse mapping need additional work
    // The Symbol keys are being constructed correctly but may be lost during object merging
    it('should filter by category_id using array of UUIDs (in operator)', async () => {
      // Create another category and team
      const category2 = await Category.create({ name: 'Category 2' });
      const team2 = await Team.create({
        name: 'Team 2',
        category_id: category2.id,
      });

      const response = await request(app)
        .post('/teams/search')
        .send({
          filtering: {
            category_id: {
              in: [createdCategory.external_id, category2.external_id],
            },
          },
        })
        .expect(200);

      expect(response.body.data).toBeDefined();
      expect(response.body.data.length).toBe(2);

      const teamNames = response.body.data.map((t) => t.name).sort();
      expect(teamNames).toEqual(['Team 1', 'Team 2']);
    });

    it('should handle null category_id with LEFT JOIN', async () => {
      // Create a team without a category
      const teamWithoutCategory = await Team.create({
        name: 'Team Without Category',
        category_id: null,
      });

      const response = await request(app)
        .post('/teams/search')
        .send({
          filtering: {
            category_id: createdCategory.external_id,
          },
        })
        .expect(200);

      expect(response.body.data).toBeDefined();
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].name).toBe('Team 1');
    });
  });

  describe('List endpoint with reverse FK mapping', () => {
    it('should filter by category_id using UUID in query params', async () => {
      const response = await request(app)
        .get('/teams')
        .query({
          category_id: createdCategory.external_id,
        })
        .expect(200);

      expect(response.body.data).toBeDefined();
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].name).toBe('Team 1');
      expect(response.body.data[0].category_id).toBe(
        createdCategory.external_id
      );
    });
  });

  describe('Response transformation', () => {
    it('should map category_id in response to external_id', async () => {
      const response = await request(app)
        .post('/teams/search')
        .send({})
        .expect(200);

      expect(response.body.data).toBeDefined();

      const teamsWithCategory = response.body.data.filter((t) => t.category_id);
      expect(teamsWithCategory.length).toBeGreaterThan(0);

      teamsWithCategory.forEach((team) => {
        // category_id should be a UUID, not an integer
        expect(typeof team.category_id).toBe('string');
        expect(team.category_id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        );
      });
    });
  });
});
