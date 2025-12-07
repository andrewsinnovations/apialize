const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { create, update, patch, list, search, single } = require('../src');

describe('auto_relation_id_mapping feature', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  async function buildAppAndModels() {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    // Artist model with apialize_id configured
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
      {
        tableName: 'artists',
        timestamps: false,
        apialize: {
          apialize_id: 'external_id',
        },
      }
    );

    // Album model with apialize_id configured
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
      {
        tableName: 'albums',
        timestamps: false,
        apialize: {
          apialize_id: 'external_id',
        },
      }
    );

    // Song model without apialize_id configured
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

    return { artist1, artist2, album1, album2, album3 };
  }

  describe('auto generation from belongsTo with apialize_id', () => {
    test('automatically generates relation_id_mapping for search endpoint', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      await seedData(Artist, Album, Song);

      // Configure search WITHOUT explicit relation_id_mapping
      // Should auto-generate from belongsTo associations with apialize_id
      app.use(
        '/songs',
        search(
          Song,
          {}, // auto_relation_id_mapping defaults to true
          {
            include: [
              { model: Artist, as: 'artist' },
              { model: Album, as: 'album' },
            ],
          }
        )
      );

      // Filter by artist.id should use artist.external_id automatically
      const res = await request(app)
        .post('/songs/search')
        .send({
          filtering: { 'artist.id': 'artist-beethoven' },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data.map((s) => s.title)).toEqual([
        'Symphony No. 5 - Movement 1',
        'Symphony No. 5 - Movement 2',
        'Symphony No. 9 - Ode to Joy',
      ]);
    });

    test('automatically generates relation_id_mapping for list endpoint', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      await seedData(Artist, Album, Song);

      // Configure list WITHOUT explicit relation_id_mapping
      app.use(
        '/songs',
        list(
          Song,
          {}, // auto_relation_id_mapping defaults to true
          {
            include: [
              { model: Artist, as: 'artist' },
              { model: Album, as: 'album' },
            ],
          }
        )
      );

      // Filter by album.id should use album.external_id automatically
      const res = await request(app)
        .get('/songs')
        .query({ 'album.id': 'album-sym5' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.map((s) => s.title)).toEqual([
        'Symphony No. 5 - Movement 1',
        'Symphony No. 5 - Movement 2',
      ]);
    });

    test('automatically generates relation_id_mapping for create endpoint', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      const { artist1 } = await seedData(Artist, Album, Song);

      // Configure create WITHOUT explicit relation_id_mapping
      app.use('/albums', create(Album)); // auto_relation_id_mapping defaults to true

      // Create album using artist external_id
      const res = await request(app)
        .post('/albums')
        .send({
          external_id: 'album-new',
          title: 'New Album',
          artist_id: 'artist-beethoven', // Using external_id
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      
      // Verify the album was created with correct internal artist_id
      const createdAlbum = await Album.findOne({
        where: { external_id: 'album-new' },
      });
      expect(createdAlbum).toBeTruthy();
      expect(createdAlbum.artist_id).toBe(artist1.id); // Should be internal ID in DB
    });

    test('automatically generates relation_id_mapping for update endpoint', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      const { artist2, album1 } = await seedData(Artist, Album, Song);

      // Configure update WITHOUT explicit relation_id_mapping
      app.use('/albums', update(Album)); // auto_relation_id_mapping defaults to true

      // Update album artist using external_id
      const res = await request(app)
        .put(`/albums/${album1.id}`)
        .send({
          external_id: 'album-sym5',
          title: 'Symphony No. 5',
          artist_id: 'artist-mozart', // Using external_id to change artist
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      
      // Verify the album was updated with correct internal artist_id
      const updatedAlbum = await Album.findByPk(album1.id);
      expect(updatedAlbum.artist_id).toBe(artist2.id);
    });

    test('automatically generates relation_id_mapping for patch endpoint', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      const { artist2, album1 } = await seedData(Artist, Album, Song);

      // Configure patch WITHOUT explicit relation_id_mapping
      app.use('/albums', patch(Album)); // auto_relation_id_mapping defaults to true

      // Patch album artist using external_id
      const res = await request(app)
        .patch(`/albums/${album1.id}`)
        .send({
          artist_id: 'artist-mozart', // Using external_id
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      
      // Verify the album was updated with correct internal artist_id
      const updatedAlbum = await Album.findByPk(album1.id);
      expect(updatedAlbum.artist_id).toBe(artist2.id);
    });

    test('automatically generates relation_id_mapping for single endpoint', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      const { album1 } = await seedData(Artist, Album, Song);

      // Configure single WITHOUT explicit relation_id_mapping
      app.use(
        '/albums',
        single(
          Album,
          {}, // auto_relation_id_mapping defaults to true
          {
            include: [{ model: Artist, as: 'artist' }],
          }
        )
      );

      // Get album - should map artist_id in response
      const res = await request(app).get(`/albums/${album1.id}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.record.artist_id).toBe('artist-beethoven'); // External ID
    });
  });

  describe('auto_relation_id_mapping option control', () => {
    test('can disable auto_relation_id_mapping explicitly', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      const { artist1 } = await seedData(Artist, Album, Song);

      // Explicitly disable auto_relation_id_mapping
      app.use(
        '/songs',
        search(
          Song,
          { auto_relation_id_mapping: false },
          {
            include: [{ model: Artist, as: 'artist' }],
          }
        )
      );

      // Using internal ID should work when auto is disabled
      const res = await request(app)
        .post('/songs/search')
        .send({
          filtering: { 'artist.id': artist1.id },
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
    });

    test('manual relation_id_mapping takes precedence over auto', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      await seedData(Artist, Album, Song);

      // Provide manual relation_id_mapping
      // Auto should not apply when manual is provided
      app.use(
        '/songs',
        search(
          Song,
          {
            relation_id_mapping: [
              { model: Album, id_field: 'external_id' },
              // Note: NOT including Artist mapping
            ],
          },
          {
            include: [
              { model: Artist, as: 'artist' },
              { model: Album, as: 'album' },
            ],
          }
        )
      );

      // Album mapping should work (manual)
      const res1 = await request(app)
        .post('/songs/search')
        .send({
          filtering: { 'album.id': 'album-sym5' },
        });

      expect(res1.status).toBe(200);
      expect(res1.body.data).toHaveLength(2);
    });
  });

  describe('only includes models with apialize_id', () => {
    test('skips belongsTo associations without apialize_id', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      await seedData(Artist, Album, Song);

      // Song has belongsTo both Artist and Album
      // Artist and Album both have apialize_id configured
      // This should auto-generate mappings for both
      app.use(
        '/songs',
        search(
          Song,
          {},
          {
            include: [
              { model: Artist, as: 'artist' },
              { model: Album, as: 'album' },
            ],
          }
        )
      );

      // This should work because Song has belongsTo Artist which has apialize_id
      const res = await request(app)
        .post('/songs/search')
        .send({
          filtering: { 'artist.id': 'artist-beethoven' },
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
    });
  });

  describe('foreign key mapping in responses', () => {
    test('automatically maps foreign keys in list responses', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      await seedData(Artist, Album, Song);

      app.use('/songs', list(Song)); // auto_relation_id_mapping defaults to true

      const res = await request(app).get('/songs');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(4);

      // Foreign keys should be mapped to external IDs
      const song = res.body.data.find((s) => s.title === 'Requiem - Kyrie');
      expect(song.artist_id).toBe('artist-mozart');
      expect(song.album_id).toBe('album-req');
    });

    test('automatically maps foreign keys in single responses', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      const { album1 } = await seedData(Artist, Album, Song);

      app.use('/albums', single(Album)); // auto_relation_id_mapping defaults to true

      const res = await request(app).get(`/albums/${album1.id}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.record.artist_id).toBe('artist-beethoven'); // External ID
    });
  });

  describe('multiple belongsTo relationships', () => {
    test('generates mappings for all belongsTo relationships with apialize_id', async () => {
      const { Artist, Album, Song, app } = await buildAppAndModels();
      await seedData(Artist, Album, Song);

      // Song has belongsTo both Artist and Album, both have apialize_id
      app.use(
        '/songs',
        search(
          Song,
          {},
          {
            include: [
              { model: Artist, as: 'artist' },
              { model: Album, as: 'album' },
            ],
          }
        )
      );

      // Should handle filtering by both
      const res = await request(app)
        .post('/songs/search')
        .send({
          filtering: {
            'artist.id': 'artist-beethoven',
            'album.id': 'album-sym5',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.map((s) => s.title)).toEqual([
        'Symphony No. 5 - Movement 1',
        'Symphony No. 5 - Movement 2',
      ]);
    });
  });
});
