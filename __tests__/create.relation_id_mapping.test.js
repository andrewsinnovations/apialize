const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { create } = require('../src');

async function buildAppAndModels() {
  const sequelize = new Sequelize('sqlite::memory:', { logging: false });

  // Artist model with both id and external_id
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

  // Album model with both id and external_id
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

  // Song model with both id and external_id
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
  Song.belongsTo(Artist, { as: 'artist', foreignKey: 'artist_id' });
  Album.hasMany(Song, { as: 'songs', foreignKey: 'album_id' });
  Artist.hasMany(Song, { as: 'songs', foreignKey: 'artist_id' });

  await sequelize.sync({ force: true });

  const app = express();
  app.use(bodyParser.json());

  return { sequelize, Artist, Album, Song, app };
}

async function seedArtists(Artist) {
  const [a1, a2] = await Artist.bulkCreate(
    [
      { external_id: 'artist-beethoven', name: 'Ludwig van Beethoven' },
      { external_id: 'artist-mozart', name: 'Wolfgang Amadeus Mozart' },
    ],
    { returning: true }
  );
  return { a1, a2 };
}

async function seedAlbums(Album, artistIds) {
  const [album1, album2] = await Album.bulkCreate(
    [
      {
        external_id: 'album-sym5',
        title: 'Symphony No. 5',
        artist_id: artistIds.a1.id,
      },
      {
        external_id: 'album-req',
        title: 'Requiem',
        artist_id: artistIds.a2.id,
      },
    ],
    { returning: true }
  );
  return { album1, album2 };
}

describe('create operation with relation_id_mapping', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  test('creates album using artist external_id mapping', async () => {
    const ctx = await buildAppAndModels();
    sequelize = ctx.sequelize;
    const { Artist, Album, app } = ctx;
    await seedArtists(Artist);

    // Configure create operation with relation_id_mapping
    app.use(
      '/albums',
      create(Album, {
        relation_id_mapping: [
          {
            model: Artist,
            id_field: 'external_id',
          },
        ],
      })
    );

    // Create album using artist external_id
    const response = await request(app)
      .post('/albums')
      .send({
        external_id: 'album-new',
        title: 'New Album',
        artist_id: 'artist-beethoven', // Using external_id
      })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.id).toBeDefined();

    // Verify the album was created with correct internal artist_id
    const createdAlbum = await Album.findOne({
      where: { external_id: 'album-new' },
    });
    expect(createdAlbum).toBeTruthy();
    expect(createdAlbum.title).toBe('New Album');
    // Should have Beethoven's internal ID, not the string 'artist-beethoven'
    expect(typeof createdAlbum.artist_id).toBe('number');
  });

  test('creates song with multiple foreign keys using external_id mapping', async () => {
    const ctx = await buildAppAndModels();
    sequelize = ctx.sequelize;
    const { Artist, Album, Song, app } = ctx;
    const artists = await seedArtists(Artist);
    await seedAlbums(Album, artists);

    // Configure create operation with relation_id_mapping for both Artist and Album
    app.use(
      '/songs',
      create(Song, {
        relation_id_mapping: [
          {
            model: Artist,
            id_field: 'external_id',
          },
          {
            model: Album,
            id_field: 'external_id',
          },
        ],
      })
    );

    // Create song using both album and artist external_ids
    const response = await request(app)
      .post('/songs')
      .send({
        external_id: 'song-new',
        title: 'New Song',
        album_id: 'album-sym5',
        artist_id: 'artist-beethoven',
      })
      .expect(201);

    expect(response.body.success).toBe(true);

    // Verify the song was created with correct internal IDs
    const createdSong = await Song.findOne({
      where: { external_id: 'song-new' },
    });
    expect(createdSong).toBeTruthy();
    expect(createdSong.title).toBe('New Song');
    expect(typeof createdSong.album_id).toBe('number');
    expect(typeof createdSong.artist_id).toBe('number');
  });

  test('bulk creates albums using external_id mapping', async () => {
    const ctx = await buildAppAndModels();
    sequelize = ctx.sequelize;
    const { Artist, Album, app } = ctx;
    await seedArtists(Artist);

    // Configure create operation with bulk create and relation_id_mapping
    app.use(
      '/albums',
      create(Album, {
        allow_bulk_create: true,
        relation_id_mapping: [
          {
            model: Artist,
            id_field: 'external_id',
          },
        ],
      })
    );

    // Bulk create albums using artist external_ids
    const response = await request(app)
      .post('/albums')
      .send([
        {
          external_id: 'album-bulk-1',
          title: 'Bulk Album 1',
          artist_id: 'artist-beethoven',
        },
        {
          external_id: 'album-bulk-2',
          title: 'Bulk Album 2',
          artist_id: 'artist-mozart',
        },
      ])
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.ids).toHaveLength(2);

    // Verify both albums were created with correct internal artist_ids
    const albums = await Album.findAll({
      where: {
        external_id: ['album-bulk-1', 'album-bulk-2'],
      },
      order: [['external_id', 'ASC']],
    });
    expect(albums).toHaveLength(2);
    expect(typeof albums[0].artist_id).toBe('number');
    expect(typeof albums[1].artist_id).toBe('number');
  });

  test('returns error when external_id does not exist', async () => {
    const ctx = await buildAppAndModels();
    sequelize = ctx.sequelize;
    const { Artist, Album, app } = ctx;
    await seedArtists(Artist);

    app.use(
      '/albums',
      create(Album, {
        relation_id_mapping: [
          {
            model: Artist,
            id_field: 'external_id',
          },
        ],
      })
    );

    // Try to create with non-existent artist external_id
    const response = await request(app)
      .post('/albums')
      .send({
        external_id: 'album-fail',
        title: 'Failed Album',
        artist_id: 'artist-nonexistent',
      })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toMatch(/Related record not found/);
  });

  test('works without relation_id_mapping when not configured', async () => {
    const ctx = await buildAppAndModels();
    sequelize = ctx.sequelize;
    const { Artist, Album, app } = ctx;
    const artists = await seedArtists(Artist);

    // Configure create WITHOUT relation_id_mapping
    app.use('/albums', create(Album));

    // Create album using internal artist_id directly
    const response = await request(app)
      .post('/albums')
      .send({
        external_id: 'album-direct',
        title: 'Direct Album',
        artist_id: artists.a1.id, // Using internal ID
      })
      .expect(201);

    expect(response.body.success).toBe(true);

    // Verify the album was created
    const createdAlbum = await Album.findOne({
      where: { external_id: 'album-direct' },
    });
    expect(createdAlbum).toBeTruthy();
    expect(createdAlbum.artist_id).toBe(artists.a1.id);
  });

  test('creates record with mixed fields including FK', async () => {
    const ctx = await buildAppAndModels();
    sequelize = ctx.sequelize;
    const { Artist, Album, app } = ctx;
    await seedArtists(Artist);

    app.use(
      '/albums',
      create(Album, {
        relation_id_mapping: [
          {
            model: Artist,
            id_field: 'external_id',
          },
        ],
      })
    );

    // Create with all fields including FK
    const response = await request(app)
      .post('/albums')
      .send({
        external_id: 'album-mixed',
        title: 'Mixed Fields Album',
        artist_id: 'artist-mozart',
      })
      .expect(201);

    expect(response.body.success).toBe(true);

    // Verify all fields were set correctly
    const createdAlbum = await Album.findOne({
      where: { external_id: 'album-mixed' },
    });
    expect(createdAlbum.title).toBe('Mixed Fields Album');
    expect(typeof createdAlbum.artist_id).toBe('number');
  });
});
