const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { single, create } = require('../src');

describe('single() with nested related models using external_id mapping', () => {
  let sequelize;
  let Artist;
  let Album;
  let Song;
  let app;

  beforeAll(async () => {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    // Artist model
    Artist = sequelize.define(
      'Artist',
      {
        id: {
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
          type: DataTypes.INTEGER,
        },
        external_id: {
          type: DataTypes.UUID,
          allowNull: false,
          unique: true,
          defaultValue: DataTypes.UUIDV4,
        },
        name: {
          type: DataTypes.STRING,
          allowNull: false,
        },
      },
      {
        sequelize,
        modelName: 'Artist',
        tableName: 'artists',
        timestamps: true,
      }
    );

    // Album model
    Album = sequelize.define(
      'Album',
      {
        id: {
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
          type: DataTypes.INTEGER,
        },
        external_id: {
          type: DataTypes.UUID,
          allowNull: false,
          unique: true,
          defaultValue: DataTypes.UUIDV4,
        },
        title: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        artistId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'artists',
            key: 'id',
          },
        },
      },
      {
        sequelize,
        modelName: 'Album',
        tableName: 'albums',
        timestamps: true,
      }
    );

    // Song model
    Song = sequelize.define(
      'Song',
      {
        id: {
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
          type: DataTypes.INTEGER,
        },
        external_id: {
          type: DataTypes.UUID,
          allowNull: false,
          unique: true,
          defaultValue: DataTypes.UUIDV4,
        },
        title: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        artistId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'artists',
            key: 'id',
          },
        },
        albumId: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: {
            model: 'albums',
            key: 'id',
          },
        },
      },
      {
        sequelize,
        modelName: 'Song',
        tableName: 'songs',
        timestamps: true,
      }
    );

    // Define associations
    Artist.hasMany(Album, { foreignKey: 'artistId', as: 'albums' });
    Album.belongsTo(Artist, { foreignKey: 'artistId', as: 'artist' });

    Artist.hasMany(Song, { foreignKey: 'artistId', as: 'songs' });
    Song.belongsTo(Artist, { foreignKey: 'artistId', as: 'artist' });

    Album.hasMany(Song, { foreignKey: 'albumId', as: 'songs' });
    Song.belongsTo(Album, { foreignKey: 'albumId', as: 'album' });

    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    await Song.destroy({ where: {} });
    await Album.destroy({ where: {} });
    await Artist.destroy({ where: {} });

    app = express();
    app.use(bodyParser.json());

    // Create endpoints for creating test data
    app.use('/artists', create(Artist));
    app.use('/albums', create(Album));
    app.use('/songs', create(Song));

    // Setup the nested route structure with external_id mapping at all levels
    app.use(
      '/artists',
      single(Artist, {
        id_mapping: 'external_id',
        related: [
          {
            model: Album,
            foreignKey: 'artistId',
            operations: ['list', 'get'],
            options: {
              id_mapping: 'external_id',
            },
            related: [
              {
                model: Song,
                foreignKey: 'albumId',
                operations: ['list', 'get'],
                options: {
                  id_mapping: 'external_id',
                },
              },
            ],
          },
        ],
      })
    );
  });

  afterAll(async () => {
    await sequelize.close();
  });

  test('should resolve nested parent IDs correctly with external_id mapping', async () => {
    // Create test data
    const artistRes = await request(app)
      .post('/artists')
      .send({ name: 'Test Artist' });

    const artist = await Artist.findByPk(artistRes.body.id);

    const albumRes = await request(app)
      .post('/albums')
      .send({ title: 'Test Album', artistId: artist.id });

    const album = await Album.findByPk(albumRes.body.id);

    const songRes = await request(app)
      .post('/songs')
      .send({ title: 'Test Song', artistId: artist.id, albumId: album.id });

    const song = await Song.findByPk(songRes.body.id);

    // Test the three-level nested route
    const route = `/artists/${artist.external_id}/albums/${album.external_id}/songs/${song.external_id}`;
    const response = await request(app).get(route);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.record).toMatchObject({
      id: song.external_id, // normalized to use external_id as id
      title: 'Test Song',
      artistId: artist.id,
      albumId: album.id,
    });
  });

  test('should return 404 for song that does not belong to specified album', async () => {
    // Create test data
    const artistRes = await request(app)
      .post('/artists')
      .send({ name: 'Test Artist' });

    const artist = await Artist.findByPk(artistRes.body.id);

    // Create two albums
    const album1Res = await request(app)
      .post('/albums')
      .send({ title: 'Album 1', artistId: artist.id });

    const album1 = await Album.findByPk(album1Res.body.id);

    const album2Res = await request(app)
      .post('/albums')
      .send({ title: 'Album 2', artistId: artist.id });

    const album2 = await Album.findByPk(album2Res.body.id);

    // Create a song belonging to album1
    const songRes = await request(app)
      .post('/songs')
      .send({ title: 'Test Song', artistId: artist.id, albumId: album1.id });

    const song = await Song.findByPk(songRes.body.id);

    // Try to access the song via album2 - should return 404
    const route = `/artists/${artist.external_id}/albums/${album2.external_id}/songs/${song.external_id}`;
    const response = await request(app).get(route);

    expect(response.status).toBe(404);
  });

  test('should list songs correctly scoped to album', async () => {
    // Create test data
    const artistRes = await request(app)
      .post('/artists')
      .send({ name: 'Test Artist' });

    const artist = await Artist.findByPk(artistRes.body.id);

    const albumRes = await request(app)
      .post('/albums')
      .send({ title: 'Test Album', artistId: artist.id });

    const album = await Album.findByPk(albumRes.body.id);

    // Create songs - some for this album, some for other albums
    const song1Res = await request(app)
      .post('/songs')
      .send({ title: 'Song 1', artistId: artist.id, albumId: album.id });

    const song2Res = await request(app)
      .post('/songs')
      .send({ title: 'Song 2', artistId: artist.id, albumId: album.id });

    // Create another album and song to ensure proper scoping
    const otherAlbumRes = await request(app)
      .post('/albums')
      .send({ title: 'Other Album', artistId: artist.id });

    const otherAlbum = await Album.findByPk(otherAlbumRes.body.id);

    await request(app).post('/songs').send({
      title: 'Other Song',
      artistId: artist.id,
      albumId: otherAlbum.id,
    });

    // List songs for the specific album
    const route = `/artists/${artist.external_id}/albums/${album.external_id}/songs`;
    const response = await request(app).get(route);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(2);

    const songTitles = response.body.data.map((s) => s.title).sort();
    expect(songTitles).toEqual(['Song 1', 'Song 2']);

    // Verify all songs belong to the correct album
    response.body.data.forEach((song) => {
      expect(song.albumId).toBe(album.id);
    });
  });
});
