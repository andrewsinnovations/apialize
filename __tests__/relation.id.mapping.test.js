const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { search, list } = require('../src');

async function buildAppAndModels() {
  const sequelize = new Sequelize('sqlite::memory:', { logging: false });

  // Artist model with both id and external_id
  const Artist = sequelize.define(
    'Artist',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      external_id: { type: DataTypes.STRING(50), unique: true, allowNull: false },
      name: { type: DataTypes.STRING(100), allowNull: false },
    },
    { tableName: 'artists', timestamps: false }
  );

  // Album model with both id and external_id  
  const Album = sequelize.define(
    'Album',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      external_id: { type: DataTypes.STRING(50), unique: true, allowNull: false },
      title: { type: DataTypes.STRING(100), allowNull: false },
      artist_id: { type: DataTypes.INTEGER, allowNull: false },
    },
    { tableName: 'albums', timestamps: false }
  );

  // Song model with both id and external_id
  const Song = sequelize.define(
    'Song',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      external_id: { type: DataTypes.STRING(50), unique: true, allowNull: false },
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
  Song.belongsTo(Artist, { as: 'artist', foreignKey: 'artist_id' });
  Album.hasMany(Song, { as: 'songs', foreignKey: 'album_id' });
  Artist.hasMany(Song, { as: 'songs', foreignKey: 'artist_id' });

  await sequelize.sync({ force: true });

  const app = express();
  app.use(bodyParser.json());

  return { sequelize, Artist, Album, Song, app };
}

async function seed(Artist, Album, Song) {
  // Create artists
  const [a1, a2] = await Artist.bulkCreate([
    { external_id: 'artist-beethoven', name: 'Ludwig van Beethoven' },
    { external_id: 'artist-mozart', name: 'Wolfgang Amadeus Mozart' }
  ], { returning: true });

  // Create albums
  const [album1, album2, album3] = await Album.bulkCreate([
    { external_id: 'album-sym5', title: 'Symphony No. 5', artist_id: a1.id },
    { external_id: 'album-sym9', title: 'Symphony No. 9', artist_id: a1.id },
    { external_id: 'album-req', title: 'Requiem', artist_id: a2.id }
  ], { returning: true });

  // Create songs
  await Song.bulkCreate([
    { external_id: 'song-sym5-1', title: 'Symphony No. 5 - Movement 1', album_id: album1.id, artist_id: a1.id },
    { external_id: 'song-sym5-2', title: 'Symphony No. 5 - Movement 2', album_id: album1.id, artist_id: a1.id },
    { external_id: 'song-sym9-1', title: 'Symphony No. 9 - Ode to Joy', album_id: album2.id, artist_id: a1.id },
    { external_id: 'song-req-1', title: 'Requiem - Kyrie', album_id: album3.id, artist_id: a2.id },
  ]);

  return { a1, a2, album1, album2, album3 };
}

function getSongTitles(res) {
  return res.body.data.map((r) => r.title);
}

function getAlbumTitles(res) {
  return res.body.data.map((r) => r.title);
}

describe('relation_id_mapping feature', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  describe('search endpoint with relation_id_mapping', () => {
    test('filters by artist.id using external_id mapping', async () => {
      const ctx = await buildAppAndModels();
      sequelize = ctx.sequelize;
      const { Artist, Album, Song, app } = ctx;
      const seedData = await seed(Artist, Album, Song);

      // Configure search with relation_id_mapping
      app.use('/songs', search(Song, {
        relation_id_mapping: [
          { model: Artist, id_field: 'external_id' },
          { model: Album, id_field: 'external_id' }
        ]
      }, {
        include: [
          { model: Artist, as: 'artist' },
          { model: Album, as: 'album' }
        ]
      }));

      // Filter by artist.id should use artist.external_id
      const res1 = await request(app)
        .post('/songs/search')
        .send({ 
          filters: { 'artist.id': 'artist-beethoven' }
        });

      expect(res1.status).toBe(200);
      expect(getSongTitles(res1)).toEqual([
        'Symphony No. 5 - Movement 1',
        'Symphony No. 5 - Movement 2', 
        'Symphony No. 9 - Ode to Joy'
      ]);

      // Filter by artist.id should use artist.external_id for Mozart
      const res2 = await request(app)
        .post('/songs/search')
        .send({ 
          filters: { 'artist.id': 'artist-mozart' }
        });

      expect(res2.status).toBe(200);
      expect(getSongTitles(res2)).toEqual(['Requiem - Kyrie']);
    });

    test('filters by album.id using external_id mapping', async () => {
      const ctx = await buildAppAndModels();
      sequelize = ctx.sequelize;
      const { Artist, Album, Song, app } = ctx;
      await seed(Artist, Album, Song);

      // Configure search with relation_id_mapping
      app.use('/songs', search(Song, {
        relation_id_mapping: [
          { model: Artist, id_field: 'external_id' },
          { model: Album, id_field: 'external_id' }
        ]
      }, {
        include: [
          { model: Artist, as: 'artist' },
          { model: Album, as: 'album' }
        ]
      }));

      // Filter by album.id should use album.external_id
      const res = await request(app)
        .post('/songs/search')
        .send({ 
          filters: { 'album.id': 'album-sym5' }
        });

      expect(res.status).toBe(200);
      expect(getSongTitles(res)).toEqual([
        'Symphony No. 5 - Movement 1',
        'Symphony No. 5 - Movement 2'
      ]);
    });

    test('works with complex filters and operators', async () => {
      const ctx = await buildAppAndModels();
      sequelize = ctx.sequelize;
      const { Artist, Album, Song, app } = ctx;
      await seed(Artist, Album, Song);

      app.use('/songs', search(Song, {
        relation_id_mapping: [
          { model: Artist, id_field: 'external_id' },
          { model: Album, id_field: 'external_id' }
        ]
      }, {
        include: [
          { model: Artist, as: 'artist' },
          { model: Album, as: 'album' }
        ]
      }));

      // Use 'in' operator with multiple external IDs
      const res = await request(app)
        .post('/songs/search')
        .send({ 
          filters: { 
            'album.id': { 
              'in': ['album-sym5', 'album-req'] 
            }
          }
        });

      expect(res.status).toBe(200);
      expect(getSongTitles(res)).toEqual([
        'Symphony No. 5 - Movement 1',
        'Symphony No. 5 - Movement 2',
        'Requiem - Kyrie'
      ]);
    });

    test('orders by relation fields using external_id mapping', async () => {
      const ctx = await buildAppAndModels();
      sequelize = ctx.sequelize;
      const { Artist, Album, Song, app } = ctx;
      await seed(Artist, Album, Song);

      app.use('/songs', search(Song, {
        relation_id_mapping: [
          { model: Artist, id_field: 'external_id' },
          { model: Album, id_field: 'external_id' }
        ]
      }, {
        include: [
          { model: Artist, as: 'artist' },
          { model: Album, as: 'album' }
        ]
      }));

      // Order by artist.id should use artist.external_id
      const res = await request(app)
        .post('/songs/search')
        .send({ 
          ordering: [
            { orderby: 'artist.id', direction: 'DESC' }
          ]
        });

      expect(res.status).toBe(200);
      // Should be ordered by external_id: artist-mozart comes before artist-beethoven when DESC
      const titles = getSongTitles(res);
      expect(titles[0]).toBe('Requiem - Kyrie'); // Mozart first when DESC
      expect(titles.slice(1)).toEqual([
        'Symphony No. 5 - Movement 1',
        'Symphony No. 5 - Movement 2',
        'Symphony No. 9 - Ode to Joy'
      ]);
    });

    test('works with partial relation_id_mapping configuration', async () => {
      const ctx = await buildAppAndModels();
      sequelize = ctx.sequelize;
      const { Artist, Album, Song, app } = ctx;
      await seed(Artist, Album, Song);

      // Only map Artist, not Album
      app.use('/songs', search(Song, {
        relation_id_mapping: [
          { model: Artist, id_field: 'external_id' }
          // Album intentionally omitted - should use regular id
        ]
      }, {
        include: [
          { model: Artist, as: 'artist' },
          { model: Album, as: 'album' }
        ]
      }));

      // artist.id should use external_id
      const res1 = await request(app)
        .post('/songs/search')
        .send({ 
          filters: { 'artist.id': 'artist-beethoven' }
        });

      expect(res1.status).toBe(200);
      expect(getSongTitles(res1)).toEqual([
        'Symphony No. 5 - Movement 1',
        'Symphony No. 5 - Movement 2',
        'Symphony No. 9 - Ode to Joy'
      ]);

      // album.id should use regular numeric id (not external_id)
      const res2 = await request(app)
        .post('/songs/search')
        .send({ 
          filters: { 'album.id': 1 } // Using numeric ID since Album mapping not configured
        });

      expect(res2.status).toBe(200);
      expect(getSongTitles(res2)).toEqual([
        'Symphony No. 5 - Movement 1',
        'Symphony No. 5 - Movement 2'
      ]);
    });

    test('handles non-id field filtering normally', async () => {
      const ctx = await buildAppAndModels();
      sequelize = ctx.sequelize;
      const { Artist, Album, Song, app } = ctx;
      await seed(Artist, Album, Song);

      app.use('/songs', search(Song, {
        relation_id_mapping: [
          { model: Artist, id_field: 'external_id' },
          { model: Album, id_field: 'external_id' }
        ]
      }, {
        include: [
          { model: Artist, as: 'artist' },
          { model: Album, as: 'album' }
        ]
      }));

      // artist.name should not be affected by relation_id_mapping
      const res = await request(app)
        .post('/songs/search')
        .send({ 
          filters: { 'artist.name': 'Ludwig van Beethoven' }
        });

      expect(res.status).toBe(200);
      expect(getSongTitles(res)).toEqual([
        'Symphony No. 5 - Movement 1',
        'Symphony No. 5 - Movement 2',
        'Symphony No. 9 - Ode to Joy'
      ]);
    });
  });

  describe('list endpoint with relation_id_mapping', () => {
    test('filters by artist.id using external_id mapping', async () => {
      const ctx = await buildAppAndModels();
      sequelize = ctx.sequelize;
      const { Artist, Album, Song, app } = ctx;
      await seed(Artist, Album, Song);

      // Configure list with relation_id_mapping
      app.use('/songs', list(Song, {
        relation_id_mapping: [
          { model: Artist, id_field: 'external_id' },
          { model: Album, id_field: 'external_id' }
        ]
      }, {
        include: [
          { model: Artist, as: 'artist' },
          { model: Album, as: 'album' }
        ]
      }));

      // Filter by artist.id should use artist.external_id
      const res = await request(app)
        .get('/songs')
        .query({ 'artist.id': 'artist-beethoven' });

      expect(res.status).toBe(200);
      expect(getSongTitles(res)).toEqual([
        'Symphony No. 5 - Movement 1',
        'Symphony No. 5 - Movement 2',
        'Symphony No. 9 - Ode to Joy'
      ]);
    });

    test('filters by album.id using external_id mapping', async () => {
      const ctx = await buildAppAndModels();
      sequelize = ctx.sequelize;
      const { Artist, Album, Song, app } = ctx;
      await seed(Artist, Album, Song);

      app.use('/songs', list(Song, {
        relation_id_mapping: [
          { model: Artist, id_field: 'external_id' },
          { model: Album, id_field: 'external_id' }
        ]
      }, {
        include: [
          { model: Artist, as: 'artist' },
          { model: Album, as: 'album' }
        ]
      }));

      // Filter by album.id should use album.external_id
      const res = await request(app)
        .get('/songs')
        .query({ 'album.id': 'album-sym5' });

      expect(res.status).toBe(200);
      expect(getSongTitles(res)).toEqual([
        'Symphony No. 5 - Movement 1',
        'Symphony No. 5 - Movement 2'
      ]);
    });

    test('works with operators in query string', async () => {
      const ctx = await buildAppAndModels();
      sequelize = ctx.sequelize;
      const { Artist, Album, Song, app } = ctx;
      await seed(Artist, Album, Song);

      app.use('/songs', list(Song, {
        relation_id_mapping: [
          { model: Artist, id_field: 'external_id' },
          { model: Album, id_field: 'external_id' }
        ]
      }, {
        include: [
          { model: Artist, as: 'artist' },
          { model: Album, as: 'album' }
        ]
      }));

      // Use 'in' operator with external IDs
      const res = await request(app)
        .get('/songs')
        .query({ 'album.id:in': 'album-sym5,album-req' });

      expect(res.status).toBe(200);
      expect(getSongTitles(res)).toEqual([
        'Symphony No. 5 - Movement 1',
        'Symphony No. 5 - Movement 2',
        'Requiem - Kyrie'
      ]);
    });

    test('orders by relation fields using external_id mapping', async () => {
      const ctx = await buildAppAndModels();
      sequelize = ctx.sequelize;
      const { Artist, Album, Song, app } = ctx;
      await seed(Artist, Album, Song);

      app.use('/songs', list(Song, {
        relation_id_mapping: [
          { model: Artist, id_field: 'external_id' },
          { model: Album, id_field: 'external_id' }
        ]
      }, {
        include: [
          { model: Artist, as: 'artist' },
          { model: Album, as: 'album' }
        ]
      }));

      // Order by artist.id should use artist.external_id
      const res = await request(app)
        .get('/songs')
        .query({ 
          'api:orderby': '-artist.id' // DESC order by external_id
        });

      expect(res.status).toBe(200);
      // Should be ordered by external_id: mozart comes before beethoven when DESC
      const titles = getSongTitles(res);
      expect(titles[0]).toBe('Requiem - Kyrie'); // Mozart first when DESC
      expect(titles.slice(1)).toEqual([
        'Symphony No. 5 - Movement 1',
        'Symphony No. 5 - Movement 2',
        'Symphony No. 9 - Ode to Joy'
      ]);
    });

    test('handles non-id field filtering normally', async () => {
      const ctx = await buildAppAndModels();
      sequelize = ctx.sequelize;
      const { Artist, Album, Song, app } = ctx;
      await seed(Artist, Album, Song);

      app.use('/songs', list(Song, {
        relation_id_mapping: [
          { model: Artist, id_field: 'external_id' },
          { model: Album, id_field: 'external_id' }
        ]
      }, {
        include: [
          { model: Artist, as: 'artist' },
          { model: Album, as: 'album' }
        ]
      }));

      // artist.name should not be affected by relation_id_mapping
      const res = await request(app)
        .get('/songs')
        .query({ 'artist.name': 'Wolfgang Amadeus Mozart' });

      expect(res.status).toBe(200);
      expect(getSongTitles(res)).toEqual(['Requiem - Kyrie']);
    });
  });

  describe('error handling', () => {
    test('handles invalid relation_id_mapping gracefully', async () => {
      const ctx = await buildAppAndModels();
      sequelize = ctx.sequelize;
      const { Artist, Album, Song, app } = ctx;
      await seed(Artist, Album, Song);

      // Configure with invalid mapping (missing id_field)
      app.use('/songs', search(Song, {
        relation_id_mapping: [
          { model: Artist } // Missing id_field
        ]
      }, {
        include: [
          { model: Artist, as: 'artist' }
        ]
      }));

      // Should fall back to regular id behavior when mapping is invalid
      const res = await request(app)
        .post('/songs/search')
        .send({ 
          filters: { 'artist.id': 1 } // Should use numeric id since mapping is invalid
        });

      expect(res.status).toBe(200);
      // Should work with numeric ID fallback
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    test('handles non-existent mapped field gracefully', async () => {
      const ctx = await buildAppAndModels();
      sequelize = ctx.sequelize;
      const { Artist, Album, Song, app } = ctx;
      await seed(Artist, Album, Song);

      // Configure with non-existent field
      app.use('/songs', search(Song, {
        relation_id_mapping: [
          { model: Artist, id_field: 'nonexistent_field' }
        ]
      }, {
        include: [
          { model: Artist, as: 'artist' }
        ]
      }));

      // Should return error for invalid column
      const res = await request(app)
        .post('/songs/search')
        .send({ 
          filters: { 'artist.id': 'some-value' }
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('combination with regular id_mapping', () => {
    test('works together with root model id_mapping', async () => {
      const ctx = await buildAppAndModels();
      sequelize = ctx.sequelize;
      const { Artist, Album, Song, app } = ctx;
      await seed(Artist, Album, Song);

      // Configure both root id_mapping and relation_id_mapping
      app.use('/songs', search(Song, {
        id_mapping: 'external_id', // Root model uses external_id for id
        relation_id_mapping: [
          { model: Artist, id_field: 'external_id' },
          { model: Album, id_field: 'external_id' }
        ]
      }, {
        include: [
          { model: Artist, as: 'artist' },
          { model: Album, as: 'album' }
        ]
      }));

      // Both root model and relations should use external_id
      const res = await request(app)
        .post('/songs/search')
        .send({ 
          filters: { 
            'artist.id': 'artist-beethoven',
            'album.id': 'album-sym5'
          }
        });

      expect(res.status).toBe(200);
      expect(getSongTitles(res)).toEqual([
        'Symphony No. 5 - Movement 1',
        'Symphony No. 5 - Movement 2'
      ]);

      // Response should use external_id as id field due to root id_mapping
      expect(res.body.data[0].id).toBe('song-sym5-1');
      expect(res.body.data[1].id).toBe('song-sym5-2');
    });
  });
});