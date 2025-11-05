const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list, search } = require('../src');

describe('Enhanced foreign key mapping with Sequelize associations', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  test('should handle mixed association-based and pattern-based foreign keys', async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    const Artist = sequelize.define(
      'Artist',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        external_id: {
          type: DataTypes.STRING(50),
          unique: true,
          allowNull: false,
        },
        name: { type: DataTypes.STRING(100), allowNull: false },
      },
      { tableName: 'artists', timestamps: false }
    );

    const Label = sequelize.define(
      'Label',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        external_id: {
          type: DataTypes.STRING(50),
          unique: true,
          allowNull: false,
        },
        name: { type: DataTypes.STRING(100), allowNull: false },
      },
      { tableName: 'labels', timestamps: false }
    );

    const Album = sequelize.define(
      'Album',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        external_id: {
          type: DataTypes.STRING(50),
          unique: true,
          allowNull: false,
        },
        title: { type: DataTypes.STRING(100), allowNull: false },
        main_artist_id: { type: DataTypes.INTEGER, allowNull: false }, // Association-based
        producer_id: { type: DataTypes.INTEGER, allowNull: false }, // Association-based
        label_id: { type: DataTypes.INTEGER, allowNull: false }, // Pattern-based
      },
      { tableName: 'albums', timestamps: false }
    );

    // Set up associations with custom foreign key names
    Album.belongsTo(Artist, { as: 'mainArtist', foreignKey: 'main_artist_id' });
    Album.belongsTo(Artist, { as: 'producer', foreignKey: 'producer_id' });
    // No association for label_id - should fall back to pattern matching

    await sequelize.sync({ force: true });

    // Seed test data
    const artist = await Artist.create({
      external_id: 'artist-beatles',
      name: 'The Beatles',
    });

    const producer = await Artist.create({
      external_id: 'producer-martin',
      name: 'George Martin',
    });

    const label = await Label.create({
      external_id: 'label-apple',
      name: 'Apple Records',
    });

    const album = await Album.create({
      external_id: 'album-abbey-road',
      title: 'Abbey Road',
      main_artist_id: artist.id,
      producer_id: producer.id,
      label_id: label.id,
    });

    const app = express();
    app.use(bodyParser.json());

    // Configure relation_id_mapping for all models
    app.use(
      '/albums',
      list(Album, {
        id_mapping: 'external_id', // Root model mapping
        relation_id_mapping: [
          { model: Artist, id_field: 'external_id' },
          { model: Label, id_field: 'external_id' },
        ],
      })
    );

    const response = await request(app).get('/albums');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);

    const albumData = response.body.data[0];

    // Association-based mappings should work
    expect(albumData.main_artist_id).toBe('artist-beatles');
    expect(albumData.producer_id).toBe('producer-martin');

    // Pattern-based mapping should also work as fallback
    expect(albumData.label_id).toBe('label-apple');

    // Basic id mapping should still work
    expect(albumData.id).toBe('album-abbey-road');
  });

  test('should work with search endpoint as well', async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    const Artist = sequelize.define(
      'Artist',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        external_id: {
          type: DataTypes.STRING(50),
          unique: true,
          allowNull: false,
        },
        name: { type: DataTypes.STRING(100), allowNull: false },
      },
      { tableName: 'artists', timestamps: false }
    );

    const Song = sequelize.define(
      'Song',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        external_id: {
          type: DataTypes.STRING(50),
          unique: true,
          allowNull: false,
        },
        title: { type: DataTypes.STRING(100), allowNull: false },
        lead_vocalist_id: { type: DataTypes.INTEGER, allowNull: false }, // Custom association name
      },
      { tableName: 'songs', timestamps: false }
    );

    // Association with custom foreign key
    Song.belongsTo(Artist, {
      as: 'leadVocalist',
      foreignKey: 'lead_vocalist_id',
    });

    await sequelize.sync({ force: true });

    const artist = await Artist.create({
      external_id: 'vocalist-lennon',
      name: 'John Lennon',
    });

    const song = await Song.create({
      external_id: 'song-imagine',
      title: 'Imagine',
      lead_vocalist_id: artist.id,
    });

    const app = express();
    app.use(bodyParser.json());

    app.use(
      '/songs',
      search(Song, {
        id_mapping: 'external_id', // Root model mapping
        relation_id_mapping: [{ model: Artist, id_field: 'external_id' }],
      })
    );

    const response = await request(app)
      .post('/songs/search')
      .send({
        filtering: { title: 'Imagine' },
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);

    const songData = response.body.data[0];

    // Association-based foreign key should be mapped
    expect(songData.lead_vocalist_id).toBe('vocalist-lennon');
    expect(songData.lead_vocalist_id).not.toBe(artist.id);

    // Root id mapping should work
    expect(songData.id).toBe('song-imagine');
  });

  test('should handle missing associations gracefully with fallback to patterns', async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    const Category = sequelize.define(
      'Category',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        external_id: {
          type: DataTypes.STRING(50),
          unique: true,
          allowNull: false,
        },
        name: { type: DataTypes.STRING(100), allowNull: false },
      },
      { tableName: 'categories', timestamps: false }
    );

    const Product = sequelize.define(
      'Product',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        external_id: {
          type: DataTypes.STRING(50),
          unique: true,
          allowNull: false,
        },
        name: { type: DataTypes.STRING(100), allowNull: false },
        category_id: { type: DataTypes.INTEGER, allowNull: false }, // No association defined
      },
      { tableName: 'products', timestamps: false }
    );

    // Intentionally NO associations defined - should use pattern matching

    await sequelize.sync({ force: true });

    const category = await Category.create({
      external_id: 'cat-electronics',
      name: 'Electronics',
    });

    const product = await Product.create({
      external_id: 'prod-laptop',
      name: 'Gaming Laptop',
      category_id: category.id,
    });

    const app = express();
    app.use(bodyParser.json());

    app.use(
      '/products',
      list(Product, {
        relation_id_mapping: [{ model: Category, id_field: 'external_id' }],
      })
    );

    const response = await request(app).get('/products');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);

    const productData = response.body.data[0];

    // Should fall back to pattern-based detection
    expect(productData.category_id).toBe('cat-electronics');
    expect(productData.category_id).not.toBe(category.id);
  });
});
