const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { patch } = require('../src');

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

async function seed(Artist, Album, Song) {
  // Create artists
  const [a1, a2] = await Artist.bulkCreate(
    [
      { external_id: 'artist-beethoven', name: 'Ludwig van Beethoven' },
      { external_id: 'artist-mozart', name: 'Wolfgang Amadeus Mozart' },
    ],
    { returning: true }
  );

  // Create albums
  const [album1, album2, album3] = await Album.bulkCreate(
    [
      { external_id: 'album-sym5', title: 'Symphony No. 5', artist_id: a1.id },
      { external_id: 'album-sym9', title: 'Symphony No. 9', artist_id: a1.id },
      { external_id: 'album-req', title: 'Requiem', artist_id: a2.id },
    ],
    { returning: true }
  );

  // Create songs
  await Song.bulkCreate([
    {
      external_id: 'song-sym5-1',
      title: 'Symphony No. 5 - Movement 1',
      album_id: album1.id,
      artist_id: a1.id,
    },
    {
      external_id: 'song-sym5-2',
      title: 'Symphony No. 5 - Movement 2',
      album_id: album1.id,
      artist_id: a1.id,
    },
    {
      external_id: 'song-sym9-1',
      title: 'Symphony No. 9 - Ode to Joy',
      album_id: album2.id,
      artist_id: a1.id,
    },
    {
      external_id: 'song-req-1',
      title: 'Requiem - Kyrie',
      album_id: album3.id,
      artist_id: a2.id,
    },
  ]);

  return { a1, a2, album1, album2, album3 };
}

describe('patch operation with relation_id_mapping', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  test('patches album artist using external_id mapping', async () => {
    const ctx = await buildAppAndModels();
    sequelize = ctx.sequelize;
    const { Artist, Album, Song, app } = ctx;
    const seedData = await seed(Artist, Album, Song);

    // Configure patch operation with relation_id_mapping
    app.use(
      '/albums',
      patch(Album, {
        relation_id_mapping: [
          {
            model: Artist,
            id_field: 'external_id',
          },
        ],
        id_mapping: 'external_id',
      })
    );

    // Patch album to change artist using external_id
    const response = await request(app)
      .patch('/albums/album-sym5')
      .send({
        artist_id: 'artist-mozart', // Using external_id instead of internal id
      })
      .expect(200);

    expect(response.body.success).toBe(true);

    // Verify the album was updated with the correct internal artist_id
    const updatedAlbum = await Album.findOne({
      where: { external_id: 'album-sym5' },
    });
    expect(updatedAlbum.artist_id).toBe(seedData.a2.id); // Mozart's internal ID
  });

  test('patches song with multiple foreign keys using external_id mapping', async () => {
    const ctx = await buildAppAndModels();
    sequelize = ctx.sequelize;
    const { Artist, Album, Song, app } = ctx;
    const seedData = await seed(Artist, Album, Song);

    // Configure patch operation with relation_id_mapping for both Artist and Album
    app.use(
      '/songs',
      patch(Song, {
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
        id_mapping: 'external_id',
      })
    );

    // Patch song to change both album and artist using external_ids
    const response = await request(app)
      .patch('/songs/song-sym5-1')
      .send({
        album_id: 'album-req', // Mozart's Requiem
        artist_id: 'artist-mozart',
      })
      .expect(200);

    expect(response.body.success).toBe(true);

    // Verify the song was updated with correct internal IDs
    const updatedSong = await Song.findOne({
      where: { external_id: 'song-sym5-1' },
    });
    expect(updatedSong.album_id).toBe(seedData.album3.id); // Requiem's internal ID
    expect(updatedSong.artist_id).toBe(seedData.a2.id); // Mozart's internal ID
  });

  test('patches song title without affecting foreign keys', async () => {
    const ctx = await buildAppAndModels();
    sequelize = ctx.sequelize;
    const { Artist, Album, Song, app } = ctx;
    const seedData = await seed(Artist, Album, Song);

    app.use(
      '/songs',
      patch(Song, {
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
        id_mapping: 'external_id',
      })
    );

    // Patch only the title (no foreign key changes)
    const response = await request(app)
      .patch('/songs/song-sym5-1')
      .send({
        title: 'Symphony No. 5 - Allegro con brio',
      })
      .expect(200);

    expect(response.body.success).toBe(true);

    // Verify the song title was updated and FKs remain unchanged
    const updatedSong = await Song.findOne({
      where: { external_id: 'song-sym5-1' },
    });
    expect(updatedSong.title).toBe('Symphony No. 5 - Allegro con brio');
    expect(updatedSong.album_id).toBe(seedData.album1.id);
    expect(updatedSong.artist_id).toBe(seedData.a1.id);
  });

  test('patches with undefined foreign key value (not included in request)', async () => {
    const ctx = await buildAppAndModels();
    sequelize = ctx.sequelize;
    const { Artist, Album, Song, app } = ctx;
    const seedData = await seed(Artist, Album, Song);

    app.use(
      '/albums',
      patch(Album, {
        relation_id_mapping: [
          {
            model: Artist,
            id_field: 'external_id',
          },
        ],
        id_mapping: 'external_id',
      })
    );

    // Patch without including artist_id (should not trigger reverse mapping)
    const response = await request(app)
      .patch('/albums/album-sym5')
      .send({
        title: 'Updated Title',
      })
      .expect(200);

    expect(response.body.success).toBe(true);

    // Verify the album title was updated but artist_id unchanged
    const updatedAlbum = await Album.findOne({
      where: { external_id: 'album-sym5' },
    });
    expect(updatedAlbum.title).toBe('Updated Title');
    expect(updatedAlbum.artist_id).toBe(seedData.a1.id); // Still Beethoven
  });

  test('returns error when external_id does not exist', async () => {
    const ctx = await buildAppAndModels();
    sequelize = ctx.sequelize;
    const { Artist, Album, Song, app } = ctx;
    await seed(Artist, Album, Song);

    app.use(
      '/albums',
      patch(Album, {
        relation_id_mapping: [
          {
            model: Artist,
            id_field: 'external_id',
          },
        ],
        id_mapping: 'external_id',
      })
    );

    // Try to patch with non-existent artist external_id
    const response = await request(app)
      .patch('/albums/album-sym5')
      .send({
        artist_id: 'artist-nonexistent',
      })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toMatch(/Related record not found/);
  });

  test('works without relation_id_mapping when not configured', async () => {
    const ctx = await buildAppAndModels();
    sequelize = ctx.sequelize;
    const { Artist, Album, Song, app } = ctx;
    const seedData = await seed(Artist, Album, Song);

    // Configure patch WITHOUT relation_id_mapping
    app.use(
      '/albums',
      patch(Album, {
        id_mapping: 'external_id',
      })
    );

    // Patch album using internal artist_id directly
    const response = await request(app)
      .patch('/albums/album-sym5')
      .send({
        artist_id: seedData.a2.id, // Using internal ID
      })
      .expect(200);

    expect(response.body.success).toBe(true);

    // Verify the album was updated
    const updatedAlbum = await Album.findOne({
      where: { external_id: 'album-sym5' },
    });
    expect(updatedAlbum.artist_id).toBe(seedData.a2.id);
  });

  test('patches multiple fields including title and foreign key', async () => {
    const ctx = await buildAppAndModels();
    sequelize = ctx.sequelize;
    const { Artist, Album, Song, app } = ctx;
    const seedData = await seed(Artist, Album, Song);

    app.use(
      '/albums',
      patch(Album, {
        relation_id_mapping: [
          {
            model: Artist,
            id_field: 'external_id',
          },
        ],
        id_mapping: 'external_id',
      })
    );

    // Patch both title and artist
    const response = await request(app)
      .patch('/albums/album-sym5')
      .send({
        title: 'Symphony No. 5 in C minor',
        artist_id: 'artist-mozart',
      })
      .expect(200);

    expect(response.body.success).toBe(true);

    // Verify both fields were updated
    const updatedAlbum = await Album.findOne({
      where: { external_id: 'album-sym5' },
    });
    expect(updatedAlbum.title).toBe('Symphony No. 5 in C minor');
    expect(updatedAlbum.artist_id).toBe(seedData.a2.id);
  });
});
