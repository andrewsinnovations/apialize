const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { search } = require('../src');

// This test demonstrates the exact usage pattern described in the user request
describe('relation_id_mapping usage example', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  test('exact usage pattern from user request', async () => {
    // Setup database and models
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
        artist_id: { type: DataTypes.INTEGER, allowNull: false },
      },
      { tableName: 'albums', timestamps: false }
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
        album_id: { type: DataTypes.INTEGER, allowNull: false },
        artist_id: { type: DataTypes.INTEGER, allowNull: false },
      },
      { tableName: 'songs', timestamps: false }
    );

    // Set up associations
    Song.belongsTo(Album, { as: 'album', foreignKey: 'album_id' });
    Song.belongsTo(Artist, { as: 'artist', foreignKey: 'artist_id' });
    Album.belongsTo(Artist, { as: 'artist', foreignKey: 'artist_id' });

    await sequelize.sync({ force: true });

    // Seed test data
    const artist = await Artist.create({
      external_id: 'asdf1234',
      name: 'Test Artist',
    });

    const album = await Album.create({
      external_id: 'album-ext-123',
      title: 'Test Album',
      artist_id: artist.id,
    });

    await Song.create({
      external_id: 'song-ext-123',
      title: 'Test Song',
      album_id: album.id,
      artist_id: artist.id,
    });

    // Set up Express app exactly as described in user request
    const app = express();
    app.use(bodyParser.json());

    app.use(
      '/songs',
      search(
        Song,
        {
          id_mapping: 'external_id',
          relation_id_mapping: [
            {
              model: Album,
              id_field: 'external_id',
            },
            {
              model: Artist,
              id_field: 'external_id',
            },
          ],
        },
        {
          include: [
            { model: Album, as: 'album' },
            { model: Artist, as: 'artist' },
          ],
        }
      )
    );

    // Test the exact filter pattern from user request
    const res = await request(app)
      .post('/songs/search')
      .send({
        filters: { 'artist.id': 'asdf1234' },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Test Song');

    // The response should use external_id as id due to id_mapping
    expect(res.body.data[0].id).toBe('song-ext-123');
  });
});
