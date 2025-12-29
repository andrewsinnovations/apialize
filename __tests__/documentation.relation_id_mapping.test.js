/**
 * Documentation Examples Test: relation_id_mapping.md
 *
 * This test file validates that the code examples in documentation/relation_id_mapping.md
 * work as expected and produce the documented outputs.
 */

const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list, search, single, create, patch } = require('../src');

describe('Documentation Examples: relation_id_mapping.md', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  // Helper to build app with Artist, Album, Song models (auto_relation_id_mapping)
  async function buildAutoMappingApp() {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    const Artist = sequelize.define(
      'Artist',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        external_id: { type: DataTypes.STRING(50), unique: true, allowNull: false },
        name: { type: DataTypes.STRING(100), allowNull: false },
      },
      {
        tableName: 'doc_relmap_artists',
        timestamps: false,
        apialize: {
          apialize_id: 'external_id',
        },
      }
    );

    const Album = sequelize.define(
      'Album',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        external_id: { type: DataTypes.STRING(50), unique: true, allowNull: false },
        title: { type: DataTypes.STRING(100), allowNull: false },
        artist_id: { type: DataTypes.INTEGER, allowNull: false },
      },
      {
        tableName: 'doc_relmap_albums',
        timestamps: false,
        apialize: {
          apialize_id: 'external_id',
        },
      }
    );

    const Song = sequelize.define(
      'Song',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        external_id: { type: DataTypes.STRING(50), unique: true, allowNull: false },
        title: { type: DataTypes.STRING(100), allowNull: false },
        album_id: { type: DataTypes.INTEGER, allowNull: false },
        artist_id: { type: DataTypes.INTEGER, allowNull: false },
      },
      {
        tableName: 'doc_relmap_songs',
        timestamps: false,
      }
    );

    // Associations
    Album.belongsTo(Artist, { as: 'artist', foreignKey: 'artist_id' });
    Artist.hasMany(Album, { as: 'albums', foreignKey: 'artist_id' });

    Song.belongsTo(Album, { as: 'album', foreignKey: 'album_id' });
    Song.belongsTo(Artist, { as: 'artist', foreignKey: 'artist_id' });
    Album.hasMany(Song, { as: 'songs', foreignKey: 'album_id' });
    Artist.hasMany(Song, { as: 'songs', foreignKey: 'artist_id' });

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());

    return { Artist, Album, Song, app };
  }

  // Helper to build app with manual relation_id_mapping
  async function buildManualMappingApp() {
    sequelize = new Sequelize('sqlite::memory:', { logging: false });

    const Artist = sequelize.define(
      'Artist',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        external_id: { type: DataTypes.STRING(50), unique: true, allowNull: false },
        name: { type: DataTypes.STRING(100), allowNull: false },
      },
      { tableName: 'doc_relmap_artists2', timestamps: false }
    );

    const Album = sequelize.define(
      'Album',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        external_id: { type: DataTypes.STRING(50), unique: true, allowNull: false },
        title: { type: DataTypes.STRING(100), allowNull: false },
        artist_id: { type: DataTypes.INTEGER, allowNull: false },
      },
      { tableName: 'doc_relmap_albums2', timestamps: false }
    );

    const Song = sequelize.define(
      'Song',
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        external_id: { type: DataTypes.STRING(50), unique: true, allowNull: false },
        title: { type: DataTypes.STRING(100), allowNull: false },
        album_id: { type: DataTypes.INTEGER, allowNull: false },
        artist_id: { type: DataTypes.INTEGER, allowNull: false },
      },
      { tableName: 'doc_relmap_songs2', timestamps: false }
    );

    Album.belongsTo(Artist, { as: 'artist', foreignKey: 'artist_id' });
    Artist.hasMany(Album, { as: 'albums', foreignKey: 'artist_id' });
    Song.belongsTo(Album, { as: 'album', foreignKey: 'album_id' });
    Song.belongsTo(Artist, { as: 'artist', foreignKey: 'artist_id' });
    Album.hasMany(Song, { as: 'songs', foreignKey: 'album_id' });
    Artist.hasMany(Song, { as: 'songs', foreignKey: 'artist_id' });

    await sequelize.sync({ force: true });

    const app = express();
    app.use(bodyParser.json());

    return { Artist, Album, Song, app };
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
        { external_id: 'album-sym5', title: 'Symphony No. 5', artist_id: artist1.id },
        { external_id: 'album-sym9', title: 'Symphony No. 9', artist_id: artist1.id },
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

    return { artist1, artist2, album1, album2, album3 };
  }

  describe('Automatic Relation ID Mapping (Default)', () => {
    test('auto_relation_id_mapping is enabled by default', async () => {
      const { Artist, Album, Song, app } = await buildAutoMappingApp();
      await seedData(Artist, Album, Song);

      // No explicit relation_id_mapping needed
      app.use(
        '/albums',
        list(
          Album,
          {},
          {
            include: [{ model: Artist, as: 'artist' }],
          }
        )
      );

      // Filter by artist's external ID
      const res = await request(app).get('/albums?artist.id=artist-beethoven');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.map((a) => a.title)).toEqual([
        'Symphony No. 5',
        'Symphony No. 9',
      ]);
    });

    test('response foreign keys are mapped to external IDs', async () => {
      const { Artist, Album, Song, app } = await buildAutoMappingApp();
      await seedData(Artist, Album, Song);

      app.use('/songs', list(Song));

      const res = await request(app).get('/songs');
      expect(res.status).toBe(200);

      // Foreign keys should be mapped to external IDs
      const reqSong = res.body.data.find((s) => s.title === 'Requiem - Kyrie');
      expect(reqSong.artist_id).toBe('artist-mozart');
      expect(reqSong.album_id).toBe('album-req');
    });

    test('auto-mapping works in list operation', async () => {
      const { Artist, Album, Song, app } = await buildAutoMappingApp();
      await seedData(Artist, Album, Song);

      app.use(
        '/songs',
        list(
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

      const res = await request(app).get('/songs?album.id=album-sym5');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.map((s) => s.title)).toEqual([
        'Symphony No. 5 - Movement 1',
        'Symphony No. 5 - Movement 2',
      ]);
    });

    test('auto-mapping works in search operation', async () => {
      const { Artist, Album, Song, app } = await buildAutoMappingApp();
      await seedData(Artist, Album, Song);

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

      const res = await request(app).post('/songs/search').send({
        filtering: { 'artist.id': 'artist-beethoven' },
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
    });

    test('auto-mapping works in single operation', async () => {
      const { Artist, Album, Song, app } = await buildAutoMappingApp();
      const { album1 } = await seedData(Artist, Album, Song);

      app.use(
        '/albums',
        single(
          Album,
          {},
          {
            include: [{ model: Artist, as: 'artist' }],
          }
        )
      );

      const res = await request(app).get(`/albums/${album1.id}`);
      expect(res.status).toBe(200);
      expect(res.body.record.artist_id).toBe('artist-beethoven');
    });

    test('auto-mapping works in create operation - resolves external ID to internal', async () => {
      const { Artist, Album, app } = await buildAutoMappingApp();
      const [artist1] = await Artist.bulkCreate(
        [{ external_id: 'artist-beethoven', name: 'Beethoven' }],
        { returning: true }
      );

      app.use('/albums', create(Album));

      const res = await request(app).post('/albums').send({
        external_id: 'album-new',
        title: 'New Album',
        artist_id: 'artist-beethoven', // Using external ID
      });

      expect(res.status).toBe(201);

      // Verify internal ID was stored
      const createdAlbum = await Album.findOne({
        where: { external_id: 'album-new' },
      });
      expect(createdAlbum.artist_id).toBe(artist1.id);
    });

    test('auto-mapping works in patch operation', async () => {
      const { Artist, Album, app } = await buildAutoMappingApp();
      const [artist1, artist2] = await Artist.bulkCreate(
        [
          { external_id: 'artist-beethoven', name: 'Beethoven' },
          { external_id: 'artist-mozart', name: 'Mozart' },
        ],
        { returning: true }
      );
      const album = await Album.create({
        external_id: 'album-test',
        title: 'Test Album',
        artist_id: artist1.id,
      });

      app.use('/albums', patch(Album));

      const res = await request(app).patch(`/albums/${album.id}`).send({
        artist_id: 'artist-mozart', // Using external ID
      });

      expect(res.status).toBe(200);

      // Verify artist was changed
      await album.reload();
      expect(album.artist_id).toBe(artist2.id);
    });
  });

  describe('Manual Relation ID Mapping', () => {
    test('array syntax for relation_id_mapping', async () => {
      const { Artist, Album, Song, app } = await buildManualMappingApp();
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
            include: [
              { model: Artist, as: 'artist' },
              { model: Album, as: 'album' },
            ],
          }
        )
      );

      const res = await request(app).get('/songs?album.id=album-sym5');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    test('partial mapping - only some relations mapped', async () => {
      const { Artist, Album, Song, app } = await buildManualMappingApp();
      const { album1 } = await seedData(Artist, Album, Song);

      app.use(
        '/songs',
        list(
          Song,
          {
            relation_id_mapping: [
              { model: Artist, id_field: 'external_id' },
              // Album not mapped
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

      // artist.id uses external_id
      const res1 = await request(app).get('/songs?artist.id=artist-beethoven');
      expect(res1.status).toBe(200);
      expect(res1.body.data).toHaveLength(3);

      // album.id uses internal numeric ID
      const res2 = await request(app).get(`/songs?album.id=${album1.id}`);
      expect(res2.status).toBe(200);
      expect(res2.body.data).toHaveLength(2);
    });
  });

  describe('Disabling Auto-Mapping', () => {
    test('auto_relation_id_mapping: false uses internal IDs', async () => {
      const { Artist, Album, Song, app } = await buildAutoMappingApp();
      const { artist1 } = await seedData(Artist, Album, Song);

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

      // Using internal ID should work
      const res = await request(app).post('/songs/search').send({
        filtering: { 'artist.id': artist1.id },
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
    });
  });

  describe('Filtering with Relation ID Mapping', () => {
    test('filter operators work with mapped IDs', async () => {
      const { Artist, Album, Song, app } = await buildAutoMappingApp();
      await seedData(Artist, Album, Song);

      app.use(
        '/songs',
        list(
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

      // in operator
      const res = await request(app).get(
        '/songs?album.id:in=album-sym5,album-req'
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
    });

    test('search body filter operators', async () => {
      const { Artist, Album, Song, app } = await buildAutoMappingApp();
      await seedData(Artist, Album, Song);

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

      const res = await request(app).post('/songs/search').send({
        filtering: {
          'album.id': {
            in: ['album-sym5', 'album-sym9'],
          },
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
    });

    test('multiple relation filters combined', async () => {
      const { Artist, Album, Song, app } = await buildAutoMappingApp();
      await seedData(Artist, Album, Song);

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

      const res = await request(app).post('/songs/search').send({
        filtering: {
          'artist.id': 'artist-beethoven',
          'album.id': 'album-sym5',
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });
  });

  describe('Ordering with Relation ID Mapping', () => {
    test('order by related model external ID in list', async () => {
      const { Artist, Album, Song, app } = await buildAutoMappingApp();
      await seedData(Artist, Album, Song);

      app.use(
        '/songs',
        list(
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

      const res = await request(app).get('/songs?api:order_by=-artist.id');
      expect(res.status).toBe(200);
      // Mozart (artist-mozart) comes after Beethoven (artist-beethoven) alphabetically
      // but with DESC, Mozart first
      expect(res.body.data[0].title).toBe('Requiem - Kyrie');
    });

    test('order by related model in search', async () => {
      const { Artist, Album, Song, app } = await buildAutoMappingApp();
      await seedData(Artist, Album, Song);

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

      const res = await request(app).post('/songs/search').send({
        ordering: [{ order_by: 'artist.id', direction: 'DESC' }],
      });

      expect(res.status).toBe(200);
      expect(res.body.data[0].title).toBe('Requiem - Kyrie');
    });
  });

  describe('Response ID Mapping', () => {
    test('foreign keys in response are mapped', async () => {
      const { Artist, Album, Song, app } = await buildAutoMappingApp();
      await seedData(Artist, Album, Song);

      app.use('/songs', list(Song));

      const res = await request(app).get('/songs');
      expect(res.status).toBe(200);

      const song = res.body.data[0];
      expect(song.artist_id).toMatch(/^artist-/);
      expect(song.album_id).toMatch(/^album-/);
    });

    test('included model IDs are mapped', async () => {
      const { Artist, Album, Song, app } = await buildAutoMappingApp();
      await seedData(Artist, Album, Song);

      app.use(
        '/songs',
        list(
          Song,
          {},
          {
            include: [{ model: Artist, as: 'artist' }],
          }
        )
      );

      const res = await request(app).get('/songs');
      expect(res.status).toBe(200);

      const song = res.body.data[0];
      expect(song.artist.id).toMatch(/^artist-/);
    });
  });

  describe('Combining with Other Features', () => {
    test('relation_id_mapping works with flattening', async () => {
      sequelize = new Sequelize('sqlite::memory:', { logging: false });

      const Company = sequelize.define(
        'Company',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          company_uuid: { type: DataTypes.STRING(50), unique: true, allowNull: false },
          name: { type: DataTypes.STRING(100), allowNull: false },
        },
        {
          tableName: 'doc_relmap_companies',
          timestamps: false,
          apialize: {
            apialize_id: 'company_uuid',
          },
        }
      );

      const Department = sequelize.define(
        'Department',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          dept_uuid: { type: DataTypes.STRING(50), unique: true, allowNull: false },
          name: { type: DataTypes.STRING(100), allowNull: false },
          company_id: { type: DataTypes.INTEGER, allowNull: false },
        },
        {
          tableName: 'doc_relmap_departments',
          timestamps: false,
          apialize: {
            apialize_id: 'dept_uuid',
          },
        }
      );

      const Employee = sequelize.define(
        'Employee',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          emp_uuid: { type: DataTypes.STRING(50), unique: true, allowNull: false },
          first_name: { type: DataTypes.STRING(100), allowNull: false },
          department_id: { type: DataTypes.INTEGER, allowNull: false },
          company_id: { type: DataTypes.INTEGER, allowNull: false },
        },
        {
          tableName: 'doc_relmap_employees',
          timestamps: false,
          apialize: {
            apialize_id: 'emp_uuid',
          },
        }
      );

      // Associations
      Department.belongsTo(Company, { as: 'Company', foreignKey: 'company_id' });
      Employee.belongsTo(Department, { as: 'Department', foreignKey: 'department_id' });
      Employee.belongsTo(Company, { as: 'Company', foreignKey: 'company_id' });

      await sequelize.sync({ force: true });

      const company = await Company.create({
        company_uuid: 'c1111111-1111-1111-1111-111111111111',
        name: 'Tech Corp',
      });

      const department = await Department.create({
        dept_uuid: 'd1111111-1111-1111-1111-111111111111',
        name: 'Engineering',
        company_id: company.id,
      });

      await Employee.create({
        emp_uuid: 'e1111111-1111-1111-1111-111111111111',
        first_name: 'John',
        department_id: department.id,
        company_id: company.id,
      });

      const app = express();
      app.use(bodyParser.json());

      app.use(
        '/employees',
        single(
          Employee,
          {
            id_mapping: 'emp_uuid',
            relation_id_mapping: [
              { model: Department, id_field: 'dept_uuid' },
              { model: Company, id_field: 'company_uuid' },
            ],
            flattening: [
              { model: Department, as: 'Department', attributes: [['name', 'department_name']] },
              { model: Company, as: 'Company', attributes: [['name', 'company_name']] },
            ],
          },
          {
            include: [
              { model: Department, as: 'Department' },
              { model: Company, as: 'Company' },
            ],
          }
        )
      );

      const res = await request(app).get('/employees/e1111111-1111-1111-1111-111111111111');
      expect(res.status).toBe(200);
      expect(res.body.record.id).toBe('e1111111-1111-1111-1111-111111111111');
      expect(res.body.record.first_name).toBe('John');
      expect(res.body.record.department_id).toBe('d1111111-1111-1111-1111-111111111111');
      expect(res.body.record.company_id).toBe('c1111111-1111-1111-1111-111111111111');
      expect(res.body.record.department_name).toBe('Engineering');
      expect(res.body.record.company_name).toBe('Tech Corp');
    });
  });
});
