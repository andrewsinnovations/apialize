const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { search, list } = require('../src');

describe('disableSubqueryOnIncludeRequest configuration', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  async function buildAppAndModels(searchOptions = {}, listOptions = {}) {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    const Author = sequelize.define(
      'Author',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
      },
      { tableName: 'authors_subquery_test', timestamps: false }
    );

    const Book = sequelize.define(
      'Book',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        title: { type: DataTypes.STRING(100), allowNull: false },
        author_id: { type: DataTypes.INTEGER, allowNull: false },
        pages: { type: DataTypes.INTEGER, allowNull: false },
      },
      { tableName: 'books_subquery_test', timestamps: false }
    );

    // Setup associations
    Book.belongsTo(Author, { as: 'author', foreignKey: 'author_id' });
    Author.hasMany(Book, { as: 'books', foreignKey: 'author_id' });

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());

    // Mount search endpoint
    app.use(
      '/books',
      search(Book, searchOptions, {
        include: [{ model: Author, as: 'author' }],
      })
    );

    // Mount list endpoint
    app.use(
      '/books',
      list(Book, listOptions, {
        include: [{ model: Author, as: 'author' }],
      })
    );

    return { app, Book, Author };
  }

  async function seedData(Book, Author) {
    const author1 = await Author.create({ name: 'George Orwell' });
    const author2 = await Author.create({ name: 'Aldous Huxley' });

    await Book.bulkCreate([
      { title: '1984', author_id: author1.id, pages: 328 },
      { title: 'Animal Farm', author_id: author1.id, pages: 112 },
      { title: 'Brave New World', author_id: author2.id, pages: 268 },
    ]);
  }

  describe('search endpoint', () => {
    test('should disable subQuery when filtering by included field (default config)', async () => {
      const { app, Book, Author } = await buildAppAndModels();
      await seedData(Book, Author);

      // Mock the findAndCountAll method to capture the options
      let capturedOptions = null;
      const originalFindAndCountAll = Book.findAndCountAll;
      Book.findAndCountAll = function (options) {
        capturedOptions = options;
        return originalFindAndCountAll.call(this, options);
      };

      const response = await request(app)
        .post('/books/search')
        .send({
          filtering: {
            'author.name': 'George Orwell',
          },
        });

      expect(response.status).toBe(200);
      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.subQuery).toBe(false);

      // Restore original method
      Book.findAndCountAll = originalFindAndCountAll;
    });

    test('should disable subQuery when ordering by included field (default config)', async () => {
      const { app, Book, Author } = await buildAppAndModels();
      await seedData(Book, Author);

      // Mock the findAndCountAll method to capture the options
      let capturedOptions = null;
      const originalFindAndCountAll = Book.findAndCountAll;
      Book.findAndCountAll = function (options) {
        capturedOptions = options;
        return originalFindAndCountAll.call(this, options);
      };

      const response = await request(app)
        .post('/books/search')
        .send({
          ordering: { order_by: 'author.name', direction: 'asc' },
        });

      expect(response.status).toBe(200);
      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.subQuery).toBe(false);

      // Restore original method
      Book.findAndCountAll = originalFindAndCountAll;
    });

    test('should not disable subQuery when filtering by non-included field', async () => {
      const { app, Book, Author } = await buildAppAndModels();
      await seedData(Book, Author);

      // Mock the findAndCountAll method to capture the options
      let capturedOptions = null;
      const originalFindAndCountAll = Book.findAndCountAll;
      Book.findAndCountAll = function (options) {
        capturedOptions = options;
        return originalFindAndCountAll.call(this, options);
      };

      const response = await request(app)
        .post('/books/search')
        .send({
          filtering: {
            title: '1984',
          },
        });

      expect(response.status).toBe(200);
      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.subQuery).toBeUndefined(); // Should not be explicitly set

      // Restore original method
      Book.findAndCountAll = originalFindAndCountAll;
    });

    test('should allow subQuery when disableSubqueryOnIncludeRequest is false', async () => {
      const { app, Book, Author } = await buildAppAndModels({
        disableSubqueryOnIncludeRequest: false,
      });
      await seedData(Book, Author);

      // Mock the findAndCountAll method to capture the options
      let capturedOptions = null;
      const originalFindAndCountAll = Book.findAndCountAll;
      Book.findAndCountAll = function (options) {
        capturedOptions = options;
        return originalFindAndCountAll.call(this, options);
      };

      const response = await request(app)
        .post('/books/search')
        .send({
          filtering: {
            'author.name': 'George Orwell',
          },
        });

      expect(response.status).toBe(200);
      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.subQuery).toBeUndefined(); // Should not be set when disabled

      // Restore original method
      Book.findAndCountAll = originalFindAndCountAll;
    });

    test('should disable subQuery with nested AND/OR filters containing included fields', async () => {
      const { app, Book, Author } = await buildAppAndModels();
      await seedData(Book, Author);

      // Mock the findAndCountAll method to capture the options
      let capturedOptions = null;
      const originalFindAndCountAll = Book.findAndCountAll;
      Book.findAndCountAll = function (options) {
        capturedOptions = options;
        return originalFindAndCountAll.call(this, options);
      };

      const response = await request(app)
        .post('/books/search')
        .send({
          filtering: {
            and: [{ title: '1984' }, { 'author.name': 'George Orwell' }],
          },
        });

      expect(response.status).toBe(200);
      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.subQuery).toBe(false);

      // Restore original method
      Book.findAndCountAll = originalFindAndCountAll;
    });
  });

  describe('list endpoint', () => {
    test('should disable subQuery when filtering by included field via list query (default config)', async () => {
      const { app, Book, Author } = await buildAppAndModels({}, {});
      await seedData(Book, Author);

      // Mock the findAndCountAll method to capture the options
      let capturedOptions = null;
      const originalFindAndCountAll = Book.findAndCountAll;
      Book.findAndCountAll = function (options) {
        capturedOptions = options;
        return originalFindAndCountAll.call(this, options);
      };

      const response = await request(app).get(
        '/books?author.name=George Orwell'
      );

      expect(response.status).toBe(200);
      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.subQuery).toBe(false);

      // Restore original method
      Book.findAndCountAll = originalFindAndCountAll;
    });

    test('should disable subQuery when ordering by included field via list query (default config)', async () => {
      const { app, Book, Author } = await buildAppAndModels({}, {});
      await seedData(Book, Author);

      // Mock the findAndCountAll method to capture the options
      let capturedOptions = null;
      const originalFindAndCountAll = Book.findAndCountAll;
      Book.findAndCountAll = function (options) {
        capturedOptions = options;
        return originalFindAndCountAll.call(this, options);
      };

      const response = await request(app).get(
        '/books?api:order_by=author.name&api:order_dir=asc'
      );

      expect(response.status).toBe(200);
      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.subQuery).toBe(false);

      // Restore original method
      Book.findAndCountAll = originalFindAndCountAll;
    });
  });
});
