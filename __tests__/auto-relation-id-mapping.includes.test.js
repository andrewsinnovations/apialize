const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list, search, single } = require('../src');

describe('Auto Relation ID Mapping - Included Models in Response', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  async function buildAppAndModels() {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    const Artist = sequelize.define(
      'Artist',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        external_id: { type: DataTypes.STRING, allowNull: false, unique: true },
        name: { type: DataTypes.STRING, allowNull: false },
      },
      {
        timestamps: false,
        tableName: 'artists',
        apialize: {
          apialize_id: 'external_id',
        },
      }
    );

    const Album = sequelize.define(
      'Album',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        external_id: { type: DataTypes.STRING, allowNull: false, unique: true },
        title: { type: DataTypes.STRING, allowNull: false },
        artist_id: { type: DataTypes.INTEGER, allowNull: false },
      },
      {
        timestamps: false,
        tableName: 'albums',
        apialize: {
          apialize_id: 'external_id',
        },
      }
    );

    const Song = sequelize.define(
      'Song',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        title: { type: DataTypes.STRING, allowNull: false },
        artist_id: { type: DataTypes.INTEGER, allowNull: false },
        album_id: { type: DataTypes.INTEGER, allowNull: false },
      },
      {
        timestamps: false,
        tableName: 'songs',
      }
    );

    // Associations
    Song.belongsTo(Artist, { foreignKey: 'artist_id', as: 'artist' });
    Song.belongsTo(Album, { foreignKey: 'album_id', as: 'album' });
    Artist.hasMany(Song, { foreignKey: 'artist_id', as: 'songs' });
    Album.hasMany(Song, { foreignKey: 'album_id', as: 'songs' });

    Album.belongsTo(Artist, { foreignKey: 'artist_id', as: 'artist' });
    Artist.hasMany(Album, { foreignKey: 'artist_id', as: 'albums' });

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());

    return { Artist, Album, Song, app };
  }

  async function seedData(Artist, Album, Song) {
    const artist1 = await Artist.create({
      external_id: 'artist-beethoven',
      name: 'Ludwig van Beethoven',
    });

    const artist2 = await Artist.create({
      external_id: 'artist-mozart',
      name: 'Wolfgang Amadeus Mozart',
    });

    const album1 = await Album.create({
      external_id: 'album-sym5',
      title: 'Symphony No. 5',
      artist_id: artist1.id,
    });

    const album2 = await Album.create({
      external_id: 'album-sym9',
      title: 'Symphony No. 9',
      artist_id: artist1.id,
    });

    const song1 = await Song.create({
      title: 'Symphony No. 5 - Movement 1',
      artist_id: artist1.id,
      album_id: album1.id,
    });

    const song2 = await Song.create({
      title: 'Symphony No. 9 - Ode to Joy',
      artist_id: artist1.id,
      album_id: album2.id,
    });

    return { artist1, artist2, album1, album2, song1, song2 };
  }

  describe('Included Models Without Flattening', () => {
    test('list endpoint returns included models in response with auto_relation_id_mapping', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      await seedData(Artist, Album, Song);

      app.use(
        '/songs',
        list(
          Song,
          {
            // auto_relation_id_mapping defaults to true
          },
          {
            include: [
              { model: Artist, as: 'artist' },
              { model: Album, as: 'album' },
            ],
          }
        )
      );

      const res = await request(app).get('/songs');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);

      // Verify the foreign keys are mapped to external IDs
      expect(res.body.data[0].artist_id).toBe('artist-beethoven');
      expect(res.body.data[0].album_id).toBe('album-sym5');

      // Verify the included models appear in the response
      expect(res.body.data[0].artist).toBeDefined();
      expect(res.body.data[0].artist.id).toBe('artist-beethoven'); // Mapped to external_id
      expect(res.body.data[0].artist.name).toBe('Ludwig van Beethoven');

      expect(res.body.data[0].album).toBeDefined();
      expect(res.body.data[0].album.id).toBe('album-sym5'); // Mapped to external_id
      expect(res.body.data[0].album.title).toBe('Symphony No. 5');
    });

    test('search endpoint returns included models in response with auto_relation_id_mapping', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      await seedData(Artist, Album, Song);

      app.use(
        '/songs',
        search(
          Song,
          {
            // auto_relation_id_mapping defaults to true
          },
          {
            include: [
              { model: Artist, as: 'artist' },
              { model: Album, as: 'album' },
            ],
          }
        )
      );

      const res = await request(app)
        .post('/songs/search')
        .send({
          filtering: { title: { icontains: 'symphony' } },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);

      // Verify the foreign keys are mapped to external IDs
      expect(res.body.data[0].artist_id).toBe('artist-beethoven');
      expect(res.body.data[0].album_id).toBe('album-sym5');

      // Verify the included models appear in the response
      expect(res.body.data[0].artist).toBeDefined();
      expect(res.body.data[0].artist.id).toBe('artist-beethoven');
      expect(res.body.data[0].artist.name).toBe('Ludwig van Beethoven');

      expect(res.body.data[0].album).toBeDefined();
      expect(res.body.data[0].album.id).toBe('album-sym5');
      expect(res.body.data[0].album.title).toBe('Symphony No. 5');
    });

    test('single endpoint returns included models in response with auto_relation_id_mapping', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      const { song1 } = await seedData(Artist, Album, Song);

      app.use(
        '/songs',
        single(
          Song,
          {
            // auto_relation_id_mapping defaults to true
          },
          {
            include: [
              { model: Artist, as: 'artist' },
              { model: Album, as: 'album' },
            ],
          }
        )
      );

      const res = await request(app).get(`/songs/${song1.id}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.record).toBeDefined();

      // Verify the foreign keys are mapped to external IDs
      expect(res.body.record.artist_id).toBe('artist-beethoven');
      expect(res.body.record.album_id).toBe('album-sym5');

      // Verify the included models appear in the response
      expect(res.body.record.artist).toBeDefined();
      expect(res.body.record.artist.id).toBe('artist-beethoven');
      expect(res.body.record.artist.name).toBe('Ludwig van Beethoven');

      expect(res.body.record.album).toBeDefined();
      expect(res.body.record.album.id).toBe('album-sym5');
      expect(res.body.record.album.title).toBe('Symphony No. 5');
    });

    test('included models have nested includes with auto_relation_id_mapping', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      await seedData(Artist, Album, Song);

      app.use(
        '/songs',
        list(
          Song,
          {
            // auto_relation_id_mapping defaults to true
          },
          {
            include: [
              {
                model: Album,
                as: 'album',
                include: [{ model: Artist, as: 'artist' }],
              },
            ],
          }
        )
      );

      const res = await request(app).get('/songs');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);

      // Verify the album is included
      expect(res.body.data[0].album).toBeDefined();
      expect(res.body.data[0].album.id).toBe('album-sym5');
      expect(res.body.data[0].album.title).toBe('Symphony No. 5');

      // Verify the nested artist in album is included
      expect(res.body.data[0].album.artist).toBeDefined();
      expect(res.body.data[0].album.artist.id).toBe('artist-beethoven');
      expect(res.body.data[0].album.artist.name).toBe('Ludwig van Beethoven');

      // Verify the album's foreign key is also mapped
      expect(res.body.data[0].album.artist_id).toBe('artist-beethoven');
    });

    test('included models without auto_relation_id_mapping still appear in response', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      await seedData(Artist, Album, Song);

      app.use(
        '/songs',
        list(
          Song,
          {
            auto_relation_id_mapping: false, // Explicitly disabled
          },
          {
            include: [
              { model: Artist, as: 'artist' },
              { model: Album, as: 'album' },
            ],
          }
        )
      );

      const res = await request(app).get('/songs');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);

      // Foreign keys should be internal IDs since auto_relation_id_mapping is disabled
      expect(typeof res.body.data[0].artist_id).toBe('number');
      expect(typeof res.body.data[0].album_id).toBe('number');

      // But included models should still appear in response
      expect(res.body.data[0].artist).toBeDefined();
      expect(res.body.data[0].artist.name).toBe('Ludwig van Beethoven');

      expect(res.body.data[0].album).toBeDefined();
      expect(res.body.data[0].album.title).toBe('Symphony No. 5');
    });
  });
});
