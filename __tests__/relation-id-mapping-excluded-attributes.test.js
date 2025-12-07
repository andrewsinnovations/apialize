const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list, single, search } = require('../src');

describe('relation_id_mapping with excluded attributes', () => {
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

    Album.belongsTo(Artist, { as: 'artist', foreignKey: 'artist_id' });
    Artist.hasMany(Album, { as: 'albums', foreignKey: 'artist_id' });

    Song.belongsTo(Album, { as: 'album', foreignKey: 'album_id' });
    Album.hasMany(Song, { as: 'songs', foreignKey: 'album_id' });

    Song.belongsTo(Artist, { as: 'artist', foreignKey: 'artist_id' });
    Artist.hasMany(Song, { as: 'songs', foreignKey: 'artist_id' });

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());

    return { sequelize, Artist, Album, Song, app };
  }

  async function seedData(Artist, Album, Song) {
    const [artist1, artist2] = await Artist.bulkCreate(
      [
        { external_id: 'artist-beethoven', name: 'Ludwig van Beethoven' },
        { external_id: 'artist-mozart', name: 'Wolfgang Amadeus Mozart' },
      ],
      { returning: true }
    );

    const [album1, album2] = await Album.bulkCreate(
      [
        {
          external_id: 'album-sym5',
          title: 'Symphony No. 5',
          artist_id: artist1.id,
        },
        {
          external_id: 'album-req',
          title: 'Requiem',
          artist_id: artist2.id,
        },
      ],
      { returning: true }
    );

    await Song.bulkCreate([
      {
        external_id: 'song-sym5-1',
        title: 'Symphony No. 5 - Movement 1',
        album_id: album1.id,
        artist_id: artist1.id,
      },
      {
        external_id: 'song-sym5-2',
        title: 'Symphony No. 5 - Movement 2',
        album_id: album1.id,
        artist_id: artist1.id,
      },
      {
        external_id: 'song-req-1',
        title: 'Requiem - Kyrie',
        album_id: album2.id,
        artist_id: artist2.id,
      },
    ]);

    return { artist1, artist2, album1, album2 };
  }

  describe('excluded foreign key fields are not mapped', () => {
    test('should not map artist_id when excluded from attributes', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      await seedData(Artist, Album, Song);

      // Exclude artist_id from response
      app.use(
        '/songs',
        list(
          Song,
          {
            relation_id_mapping: [
              { model: Artist, id_field: 'external_id' },
              { model: Album, id_field: 'external_id' },
            ],
          },
          {
            attributes: { exclude: ['artist_id'] }, // Exclude artist_id
          }
        )
      );

      const res = await request(app).get('/songs');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);

      const song = res.body.data[0];
      // artist_id should not be in response since it was excluded
      expect(song.artist_id).toBeUndefined();
      // album_id should still be mapped since it wasn't excluded
      expect(song.album_id).toBe('album-sym5');
    });

    test('should not map any foreign keys when all are excluded', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      await seedData(Artist, Album, Song);

      // Exclude both foreign keys
      app.use(
        '/songs',
        list(
          Song,
          {
            relation_id_mapping: [
              { model: Artist, id_field: 'external_id' },
              { model: Album, id_field: 'external_id' },
            ],
          },
          {
            attributes: { exclude: ['artist_id', 'album_id'] },
          }
        )
      );

      const res = await request(app).get('/songs');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);

      const song = res.body.data[0];
      // Both foreign keys should be excluded
      expect(song.artist_id).toBeUndefined();
      expect(song.album_id).toBeUndefined();
      // Other fields should still be present
      expect(song.title).toBeDefined();
      expect(song.id).toBeDefined();
    });

    test('should only include specified attributes and map those that exist', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      await seedData(Artist, Album, Song);

      // Only include specific attributes (title and album_id)
      app.use(
        '/songs',
        list(
          Song,
          {
            relation_id_mapping: [
              { model: Artist, id_field: 'external_id' },
              { model: Album, id_field: 'external_id' },
            ],
          },
          {
            attributes: ['id', 'title', 'album_id'], // Only include these
          }
        )
      );

      const res = await request(app).get('/songs');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);

      const song = res.body.data[0];
      // Only included attributes should be present
      expect(song.id).toBeDefined();
      expect(song.title).toBeDefined();
      expect(song.album_id).toBe('album-sym5'); // Should be mapped
      // artist_id should not be present (not included)
      expect(song.artist_id).toBeUndefined();
      expect(song.external_id).toBeUndefined();
    });
  });

  describe('works with single endpoint', () => {
    test('should not map excluded foreign keys in single endpoint', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      const { album1 } = await seedData(Artist, Album, Song);

      app.use(
        '/songs',
        single(
          Song,
          {
            relation_id_mapping: [
              { model: Artist, id_field: 'external_id' },
              { model: Album, id_field: 'external_id' },
            ],
          },
          {
            attributes: { exclude: ['artist_id'] },
          }
        )
      );

      const song = await Song.findOne({ where: { album_id: album1.id } });
      const res = await request(app).get(`/songs/${song.id}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.record.artist_id).toBeUndefined();
      expect(res.body.record.album_id).toBe('album-sym5'); // Should be mapped
    });
  });

  describe('works with search endpoint', () => {
    test('should not map excluded foreign keys in search results', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      await seedData(Artist, Album, Song);

      app.use(
        '/songs',
        search(
          Song,
          {
            relation_id_mapping: [
              { model: Artist, id_field: 'external_id' },
              { model: Album, id_field: 'external_id' },
            ],
          },
          {
            attributes: { exclude: ['artist_id'] },
          }
        )
      );

      const res = await request(app)
        .post('/songs/search')
        .send({ filtering: {} });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);

      const song = res.body.data[0];
      expect(song.artist_id).toBeUndefined();
      expect(song.album_id).toBeDefined(); // Should be mapped
    });
  });

  describe('optimization: no unnecessary lookups for excluded fields', () => {
    test('should not perform database lookups for excluded foreign keys', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      await seedData(Artist, Album, Song);

      // This test verifies the optimization by excluding all foreign keys
      // The system should not perform any lookups since no foreign keys need mapping
      app.use(
        '/songs',
        list(
          Song,
          {
            relation_id_mapping: [
              { model: Artist, id_field: 'external_id' },
              { model: Album, id_field: 'external_id' },
            ],
          },
          {
            // Only include fields that don't need mapping
            attributes: ['id', 'title', 'external_id'],
          }
        )
      );

      const res = await request(app).get('/songs');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);

      const song = res.body.data[0];
      // No foreign keys should be present
      expect(song.artist_id).toBeUndefined();
      expect(song.album_id).toBeUndefined();
      // Other fields should be present
      expect(song.id).toBeDefined();
      expect(song.title).toBeDefined();
      expect(song.external_id).toBeDefined();
    });
  });

  describe('handles mixed scenarios', () => {
    test('should handle some foreign keys excluded and some included', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      await seedData(Artist, Album, Song);

      app.use(
        '/songs',
        list(
          Song,
          {
            relation_id_mapping: [
              { model: Artist, id_field: 'external_id' },
              { model: Album, id_field: 'external_id' },
            ],
          },
          {
            attributes: ['id', 'title', 'album_id'], // Include album_id but not artist_id
          }
        )
      );

      const res = await request(app).get('/songs');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);

      const song = res.body.data[0];
      expect(song.album_id).toBe('album-sym5'); // Mapped
      expect(song.artist_id).toBeUndefined(); // Not included
      expect(song.title).toBeDefined();
    });

    test('should work with exclude and relation_id_mapping on different models', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      await seedData(Artist, Album, Song);

      // Configure relation_id_mapping for both, but only include artist_id
      app.use(
        '/songs',
        list(
          Song,
          {
            relation_id_mapping: [
              { model: Artist, id_field: 'external_id' },
              { model: Album, id_field: 'external_id' },
            ],
          },
          {
            attributes: { exclude: ['album_id'] }, // Exclude album_id
          }
        )
      );

      const res = await request(app).get('/songs');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const song = res.body.data[0];
      expect(song.artist_id).toBe('artist-beethoven'); // Mapped
      expect(song.album_id).toBeUndefined(); // Excluded
    });
  });

  describe('edge cases', () => {
    test('should handle attributes with only id field', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      await seedData(Artist, Album, Song);

      // Only include id, no foreign keys
      app.use(
        '/songs',
        list(
          Song,
          {
            relation_id_mapping: [
              { model: Artist, id_field: 'external_id' },
              { model: Album, id_field: 'external_id' },
            ],
          },
          {
            attributes: ['id'], // Only id field
          }
        )
      );

      const res = await request(app).get('/songs');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);

      const song = res.body.data[0];
      // Only id should be present, no foreign keys
      expect(song.id).toBeDefined();
      expect(song.artist_id).toBeUndefined();
      expect(song.album_id).toBeUndefined();
      expect(song.title).toBeUndefined();
    });

    test('should not error when relation_id_mapping references excluded fields', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      await seedData(Artist, Album, Song);

      // Even though we have relation_id_mapping, if the foreign key is excluded,
      // it should just not be mapped (no error)
      app.use(
        '/songs',
        list(
          Song,
          {
            relation_id_mapping: [
              { model: Artist, id_field: 'external_id' },
              { model: Album, id_field: 'external_id' },
            ],
          },
          {
            attributes: { exclude: ['artist_id', 'album_id'] },
          }
        )
      );

      const res = await request(app).get('/songs');

      // Should succeed without errors
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
