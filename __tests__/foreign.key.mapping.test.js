const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { search, list } = require('../src');

describe('Foreign Key Mapping with relation_id_mapping', () => {
  let sequelize;
  let Artist;
  let Album;
  let Song;
  let app;

  beforeAll(async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    // Artist model with both id and external_id
    Artist = sequelize.define(
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

    // Album model with both id and external_id
    Album = sequelize.define(
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

    // Song model with both id and external_id
    Song = sequelize.define(
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

    // Set up associations (but don't include them in this test - we want to test FK mapping)
    Album.belongsTo(Artist, { as: 'artist', foreignKey: 'artist_id' });
    Artist.hasMany(Album, { as: 'albums', foreignKey: 'artist_id' });

    Song.belongsTo(Album, { as: 'album', foreignKey: 'album_id' });
    Song.belongsTo(Artist, { as: 'artist', foreignKey: 'artist_id' });
    Album.hasMany(Song, { as: 'songs', foreignKey: 'album_id' });
    Artist.hasMany(Song, { as: 'songs', foreignKey: 'artist_id' });

    await sequelize.sync({ force: true });

    // Seed test data
    const [artist1, artist2] = await Artist.bulkCreate(
      [
        { external_id: 'artist-beethoven', name: 'Ludwig van Beethoven' },
        { external_id: 'artist-mozart', name: 'Wolfgang Amadeus Mozart' },
      ],
      { returning: true }
    );

    const [album1, album2, album3] = await Album.bulkCreate(
      [
        {
          external_id: 'album-sym5',
          title: 'Symphony No. 5',
          artist_id: artist1.id,
        },
        {
          external_id: 'album-sym9',
          title: 'Symphony No. 9',
          artist_id: artist1.id,
        },
        { external_id: 'album-req', title: 'Requiem', artist_id: artist2.id },
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
        external_id: 'song-sym9-1',
        title: 'Symphony No. 9 - Ode to Joy',
        album_id: album2.id,
        artist_id: artist1.id,
      },
      {
        external_id: 'song-req-1',
        title: 'Requiem - Kyrie',
        album_id: album3.id,
        artist_id: artist2.id,
      },
    ]);
  });

  afterAll(async () => {
    if (sequelize) {
      await sequelize.close();
    }
  });

  beforeEach(() => {
    app = express();
    app.use(bodyParser.json());
  });

  describe('list endpoint foreign key mapping', () => {
    test('should replace artist_id and album_id with external IDs in response', async () => {
      // Configure list with relation_id_mapping for foreign key mapping
      app.use(
        '/songs',
        list(Song, {
          relation_id_mapping: [
            { model: Artist, id_field: 'external_id' },
            { model: Album, id_field: 'external_id' },
          ],
        })
      );

      const response = await request(app).get('/songs');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(4);

      // Check that foreign key values are replaced with external IDs
      const songs = response.body.data;

      // Find a Beethoven song
      const beethovenSong = songs.find((s) =>
        s.title.includes('Symphony No. 5')
      );
      expect(beethovenSong).toBeDefined();
      expect(beethovenSong.artist_id).toBe('artist-beethoven'); // Should be external_id, not internal ID
      expect(beethovenSong.album_id).toBe('album-sym5'); // Should be external_id, not internal ID

      // Find a Mozart song
      const mozartSong = songs.find((s) => s.title.includes('Requiem'));
      expect(mozartSong).toBeDefined();
      expect(mozartSong.artist_id).toBe('artist-mozart'); // Should be external_id, not internal ID
      expect(mozartSong.album_id).toBe('album-req'); // Should be external_id, not internal ID
    });

    test('should work with id_mapping for root model combined with FK mapping', async () => {
      // Configure both root id_mapping and relation_id_mapping
      app.use(
        '/songs',
        list(Song, {
          id_mapping: 'external_id', // Root model uses external_id for id
          relation_id_mapping: [
            { model: Artist, id_field: 'external_id' },
            { model: Album, id_field: 'external_id' },
          ],
        })
      );

      const response = await request(app).get('/songs');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(4);

      const song = response.body.data[0];
      // Root model ID should use external_id due to id_mapping
      expect(song.id).toMatch(/^song-/);
      // Foreign keys should also be mapped
      expect(song.artist_id).toMatch(/^artist-/);
      expect(song.album_id).toMatch(/^album-/);
    });

    test('should only map configured foreign keys', async () => {
      // Only configure Artist mapping, not Album
      app.use(
        '/songs',
        list(Song, {
          relation_id_mapping: [
            { model: Artist, id_field: 'external_id' },
            // Album intentionally omitted
          ],
        })
      );

      const response = await request(app).get('/songs');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(4);

      const song = response.body.data[0];
      // artist_id should be mapped to external_id
      expect(song.artist_id).toMatch(/^artist-/);
      // album_id should remain as internal ID (numeric)
      expect(typeof song.album_id).toBe('number');
    });
  });

  describe('search endpoint foreign key mapping', () => {
    test('should replace artist_id and album_id with external IDs in search response', async () => {
      app.use(
        '/songs',
        search(Song, {
          relation_id_mapping: [
            { model: Artist, id_field: 'external_id' },
            { model: Album, id_field: 'external_id' },
          ],
        })
      );

      const response = await request(app).post('/songs/search').send({
        filtering: {}, // Get all songs
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(4);

      // Check foreign key mapping
      const song = response.body.data[0];
      expect(song.artist_id).toMatch(/^artist-/);
      expect(song.album_id).toMatch(/^album-/);
    });

    test('should work with filtering and FK mapping together', async () => {
      app.use(
        '/songs',
        search(Song, {
          relation_id_mapping: [
            { model: Artist, id_field: 'external_id' },
            { model: Album, id_field: 'external_id' },
          ],
        })
      );

      // Filter by title to get specific song
      const response = await request(app)
        .post('/songs/search')
        .send({
          filtering: {
            title: { contains: 'Symphony No. 5' },
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2); // Two movements

      // All returned songs should have FK mapping applied
      for (const song of response.body.data) {
        expect(song.artist_id).toBe('artist-beethoven');
        expect(song.album_id).toBe('album-sym5');
      }
    });
  });

  describe('error handling', () => {
    test('should handle missing models gracefully', async () => {
      app.use(
        '/songs',
        list(Song, {
          relation_id_mapping: [
            { model: null, id_field: 'external_id' }, // Invalid mapping
            { model: Artist, id_field: 'external_id' },
          ],
        })
      );

      const response = await request(app).get('/songs');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // Should still work, just skip invalid mappings
      expect(response.body.data).toHaveLength(4);
    });

    test('should throw error for invalid id_field', async () => {
      app.use(
        '/songs',
        list(Song, {
          relation_id_mapping: [
            { model: Artist, id_field: 'nonexistent_field' },
          ],
        })
      );

      const response = await request(app).get('/songs');

      expect(response.status).toBe(500);
      // Should return error since invalid id_field will cause lookup to fail
    });

    test('should work when no foreign keys match the mapping patterns', async () => {
      // Test with a model that doesn't have foreign keys matching our patterns
      app.use(
        '/artists',
        list(Artist, {
          relation_id_mapping: [{ model: Album, id_field: 'external_id' }],
        })
      );

      const response = await request(app).get('/artists');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      // No foreign keys to map, should work normally
    });
  });
});
