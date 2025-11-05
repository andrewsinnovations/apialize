const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list } = require('../src');

describe('Foreign key mapping with custom foreign key names', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  test('should handle custom foreign key names defined in Sequelize associations', async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    // Artist model
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

    // Album model with custom foreign key name
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
        composer_id: { type: DataTypes.INTEGER, allowNull: false }, // Custom FK name
      },
      { tableName: 'albums', timestamps: false }
    );

    // Set up association with custom foreign key
    Album.belongsTo(Artist, {
      as: 'composer',
      foreignKey: 'composer_id', // Custom foreign key name
    });
    Artist.hasMany(Album, {
      as: 'compositions',
      foreignKey: 'composer_id',
    });

    await sequelize.sync({ force: true });

    // Seed data
    const artist = await Artist.create({
      external_id: 'composer-beethoven',
      name: 'Ludwig van Beethoven',
    });

    const album = await Album.create({
      external_id: 'album-symphony-9',
      title: 'Symphony No. 9',
      composer_id: artist.id, // Using custom FK name
    });

    const app = express();
    app.use(bodyParser.json());

    // Configure with relation_id_mapping
    app.use(
      '/albums',
      list(Album, {
        relation_id_mapping: [{ model: Artist, id_field: 'external_id' }],
      })
    );

    const response = await request(app).get('/albums');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);

    const albumData = response.body.data[0];

    // Enhanced implementation should handle custom foreign key names from associations
    expect(albumData.composer_id).toBe('composer-beethoven'); // Now mapped to external ID
    expect(albumData.composer_id).not.toBe(artist.id); // No longer internal ID
  });

  test('should show current limitation with non-standard foreign key names', async () => {
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
        artist_id: { type: DataTypes.INTEGER, allowNull: false }, // Standard FK name
        lead_performer_id: { type: DataTypes.INTEGER, allowNull: false }, // Non-standard FK name
      },
      { tableName: 'albums', timestamps: false }
    );

    // Set up associations
    Album.belongsTo(Artist, { as: 'artist', foreignKey: 'artist_id' });
    Album.belongsTo(Artist, {
      as: 'leadPerformer',
      foreignKey: 'lead_performer_id',
    });

    await sequelize.sync({ force: true });

    // Seed data
    const artist = await Artist.create({
      external_id: 'artist-beethoven',
      name: 'Ludwig van Beethoven',
    });

    const performer = await Artist.create({
      external_id: 'performer-karajan',
      name: 'Herbert von Karajan',
    });

    const album = await Album.create({
      external_id: 'album-symphony-9',
      title: 'Symphony No. 9',
      artist_id: artist.id,
      lead_performer_id: performer.id,
    });

    const app = express();
    app.use(bodyParser.json());

    app.use(
      '/albums',
      list(Album, {
        relation_id_mapping: [{ model: Artist, id_field: 'external_id' }],
      })
    );

    const response = await request(app).get('/albums');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);

    const albumData = response.body.data[0];

    // Standard pattern should be mapped
    expect(albumData.artist_id).toBe('artist-beethoven'); // Mapped to external ID

    // Custom association-based pattern should ALSO be mapped now
    expect(albumData.lead_performer_id).toBe('performer-karajan'); // Now mapped to external ID
    expect(albumData.lead_performer_id).not.toBe(performer.id); // No longer internal ID
  });
});
